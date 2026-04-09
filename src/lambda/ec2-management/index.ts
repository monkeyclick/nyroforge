import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { EC2Client, RunInstancesCommand, TerminateInstancesCommand, DescribeInstancesCommand, DescribeImagesCommand, AuthorizeSecurityGroupIngressCommand, _InstanceType } from '@aws-sdk/client-ec2';
import { DynamoDBClient, PutItemCommand, GetItemCommand, UpdateItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient, CreateSecretCommand, PutSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SSMClient, GetParameterCommand, SendCommandCommand } from '@aws-sdk/client-ssm';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { v4 as uuidv4 } from 'uuid';

// Initialize AWS clients
const ec2Client = new EC2Client({});
const dynamoClient = new DynamoDBClient({});
const secretsClient = new SecretsManagerClient({});
const ssmClient = new SSMClient({});

// Environment variables
const WORKSTATIONS_TABLE = process.env.WORKSTATIONS_TABLE_NAME!;
const VPC_ID = process.env.VPC_ID!;
const USERS_TABLE = process.env.USERS_TABLE!;
const ROLES_TABLE = process.env.ROLES_TABLE!;
const GROUPS_TABLE = process.env.GROUPS_TABLE!;
const AUDIT_LOGS_TABLE = process.env.AUDIT_TABLE!;
const BOOTSTRAP_PACKAGES_TABLE = process.env.BOOTSTRAP_PACKAGES_TABLE || 'WorkstationBootstrapPackages';
const PACKAGE_QUEUE_TABLE = process.env.PACKAGE_QUEUE_TABLE || 'WorkstationPackageQueue';
const GROUP_PACKAGE_BINDINGS_TABLE = process.env.GROUP_PACKAGE_BINDINGS_TABLE || 'GroupPackageBindings';

// Types for RBAC
type Permission =
  | 'workstations:create'
  | 'workstations:read'
  | 'workstations:update'
  | 'workstations:delete'
  | 'workstations:manage-all'
  | 'users:create'
  | 'users:read'
  | 'users:update'
  | 'users:delete'
  | 'users:manage-all'
  | 'roles:create'
  | 'roles:read'
  | 'roles:update'
  | 'roles:delete'
  | 'groups:create'
  | 'groups:read'
  | 'groups:update'
  | 'groups:delete'
  | 'system:admin';

interface EnhancedUser {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  status: 'active' | 'inactive' | 'suspended';
  roleIds: string[];
  groupIds: string[];
  directPermissions: Permission[];
  effectivePermissions?: Permission[];
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface Role {
  roleId: string;
  name: string;
  description: string;
  permissions: Permission[];
  isSystemRole: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Group {
  groupId: string;
  name: string;
  description: string;
  roleIds: string[];
  permissions: Permission[];
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface LaunchWorkstationRequest {
  region: string;
  instanceType: string;
  osVersion: string;
  authMethod: 'domain' | 'local';
  domainConfig?: {
    domainName: string;
    ouPath?: string;
  };
  localAdminConfig?: {
    username: string;
  };
  autoTerminateHours?: number;
  tags?: Record<string, string>;
  bootstrapPackages?: string[]; // Array of package IDs to install
  // Cost allocation fields
  costCenter?: string;
  environment?: 'dev' | 'staging' | 'prod';
  projectName?: string;
}

// Required cost allocation tags for AWS Cost Explorer
const REQUIRED_COST_TAGS = [
  'CostCenter',
  'Environment',
  'Project',
  'Owner',
  'CreatedBy',
  'CreatedDate',
  'Application',
  'WorkstationId',
  'UserId'
] as const;

type CostAllocationTag = typeof REQUIRED_COST_TAGS[number];

interface CostAllocationTags {
  CostCenter: string;
  Environment: string;
  Project: string;
  Owner: string;
  CreatedBy: string;
  CreatedDate: string;
  Application: string;
  WorkstationId: string;
  UserId: string;
}

/**
 * Generate complete cost allocation tags for EC2 instance
 */
function generateCostAllocationTags(
  workstationId: string,
  userId: string,
  request: LaunchWorkstationRequest
): CostAllocationTags {
  const timestamp = new Date().toISOString();
  
  return {
    CostCenter: request.costCenter || 'default',
    Environment: request.environment || 'prod',
    Project: request.projectName || 'MediaWorkstationAutomation',
    Owner: userId,
    CreatedBy: 'ec2-management-lambda',
    CreatedDate: timestamp,
    Application: 'VDI-Workstation',
    WorkstationId: workstationId,
    UserId: userId,
  };
}

/**
 * Validate that all required cost allocation tags are present
 */
function validateCostAllocationTags(tags: CostAllocationTags | Record<string, string>): { valid: boolean; missingTags: string[] } {
  const tagsRecord = tags as Record<string, string>;
  const missingTags = REQUIRED_COST_TAGS.filter(tag => !tagsRecord[tag] || tagsRecord[tag].trim() === '');
  return {
    valid: missingTags.length === 0,
    missingTags
  };
}

interface BootstrapPackage {
  packageId: string;
  name: string;
  description: string;
  type: 'driver' | 'application';
  category: string;
  downloadUrl: string;
  installCommand: string;
  installArgs?: string;
  requiresGpu?: boolean;
  supportedGpuFamilies?: string[];
  osVersions: string[];
  isRequired: boolean;
  isEnabled: boolean;
  order: number;
  estimatedInstallTimeMinutes: number;
  metadata?: Record<string, any>;
}

interface WorkstationRecord {
  PK: string;
  SK: string;
  instanceId: string;
  userId: string;
  userRole: string;
  region: string;
  availabilityZone: string;
  instanceType: string;
  osVersion: string;
  amiId: string;
  vpcId: string;
  subnetId: string;
  securityGroupId: string;
  publicIp?: string;
  privateIp?: string;
  authMethod: 'domain' | 'local';
  domainJoined?: boolean;
  domainName?: string;
  localAdminUser?: string;
  credentialsSecretArn?: string;
  status: 'launching' | 'running' | 'stopping' | 'stopped' | 'terminated';
  launchTime: string;
  lastStatusCheck: string;
  autoTerminateAt?: string;
  estimatedHourlyCost: number;
  estimatedMonthlyCost: number;
  actualCostToDate: number;
  tags: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  // User-editable friendly name for the workstation
  friendlyName?: string;
  // Enhanced ownership info (populated on read)
  ownerName?: string;
  ownerGroups?: string[];
}

// Permission checking functions
async function getUserPermissions(userId: string): Promise<Permission[]> {
  console.log(`[getUserPermissions] Fetching permissions for user: ${userId}`);
  
  try {
    // Get user record
    const userResult = await dynamoClient.send(new GetItemCommand({
      TableName: USERS_TABLE,
      Key: marshall({ id: userId }),
    }));

    if (!userResult.Item) {
      console.log(`[getUserPermissions] User not found in Users table: ${userId}`);
      // Return basic permissions for backwards compatibility
      return ['workstations:read', 'workstations:create', 'workstations:update', 'workstations:delete'];
    }

    const user = unmarshall(userResult.Item) as EnhancedUser;
    const permissions = new Set<Permission>(user.directPermissions || []);
    console.log(`[getUserPermissions] Direct permissions: ${Array.from(permissions).join(', ')}`);

    // Get permissions from roles
    for (const roleId of user.roleIds || []) {
      console.log(`[getUserPermissions] Fetching role: ${roleId}`);
      const roleResult = await dynamoClient.send(new GetItemCommand({
        TableName: ROLES_TABLE,
        Key: marshall({ id: roleId }),
      }));

      if (roleResult.Item) {
        const role = unmarshall(roleResult.Item) as Role;
        console.log(`[getUserPermissions] Role ${role.name} permissions: ${role.permissions.join(', ')}`);
        role.permissions.forEach(p => permissions.add(p));
      }
    }

    // Get permissions from groups
    for (const groupId of user.groupIds || []) {
      console.log(`[getUserPermissions] Fetching group: ${groupId}`);
      const groupResult = await dynamoClient.send(new GetItemCommand({
        TableName: GROUPS_TABLE,
        Key: marshall({ id: groupId }),
      }));

      if (groupResult.Item) {
        const group = unmarshall(groupResult.Item) as Group;
        console.log(`[getUserPermissions] Group ${group.name} direct permissions: ${group.permissions.join(', ')}`);
        group.permissions.forEach(p => permissions.add(p));

        // Get permissions from group roles
        for (const roleId of group.roleIds || []) {
          console.log(`[getUserPermissions] Fetching group role: ${roleId}`);
          const roleResult = await dynamoClient.send(new GetItemCommand({
            TableName: ROLES_TABLE,
            Key: marshall({ id: roleId }),
          }));

          if (roleResult.Item) {
            const role = unmarshall(roleResult.Item) as Role;
            console.log(`[getUserPermissions] Group role ${role.name} permissions: ${role.permissions.join(', ')}`);
            role.permissions.forEach(p => permissions.add(p));
          }
        }
      }
    }

    const finalPermissions = Array.from(permissions);
    console.log(`[getUserPermissions] Final permissions for ${userId}: ${finalPermissions.join(', ')}`);
    return finalPermissions;
  } catch (error) {
    console.error('[getUserPermissions] Error getting user permissions:', error);
    console.error('[getUserPermissions] Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    // Return basic permissions for backwards compatibility
    return ['workstations:read', 'workstations:create', 'workstations:update', 'workstations:delete'];
  }
}

async function hasPermission(userId: string, permission: Permission): Promise<boolean> {
  console.log(`[hasPermission] Checking if user ${userId} has permission: ${permission}`);
  const permissions = await getUserPermissions(userId);
  const result = permissions.includes(permission) || permissions.includes('system:admin');
  console.log(`[hasPermission] Result: ${result}`);
  return result;
}

async function canAccessWorkstation(userId: string, workstationUserId: string): Promise<boolean> {
  console.log(`[canAccessWorkstation] Checking if user ${userId} can access workstation owned by ${workstationUserId}`);
  
  // Users can always access their own workstations
  if (userId === workstationUserId) {
    console.log('[canAccessWorkstation] User owns the workstation - access granted');
    return true;
  }

  // Check if user has manage-all permission
  const result = await hasPermission(userId, 'workstations:manage-all');
  console.log(`[canAccessWorkstation] User has manage-all permission: ${result}`);
  return result;
}

async function logAuditEvent(userId: string, action: string, resourceType: string, resourceId: string, details?: any): Promise<void> {
  try {
    console.log(`[logAuditEvent] Logging audit event: ${action} on ${resourceType}:${resourceId} by ${userId}`);
    
    const timestamp = new Date().toISOString();
    const auditLog = {
      id: userId, // Partition key - group by user
      timestamp, // Sort key - chronological order
      auditId: uuidv4(), // Unique identifier for this log entry
      action,
      resourceType,
      resourceId,
      details: details ? JSON.stringify(details) : undefined,
      ipAddress: 'unknown', // Could be extracted from event
    };

    await dynamoClient.send(new PutItemCommand({
      TableName: AUDIT_LOGS_TABLE,
      Item: marshall(auditLog),
    }));
    
    console.log('[logAuditEvent] Audit event logged successfully');
  } catch (error) {
    console.error('[logAuditEvent] Error logging audit event:', error);
    // Don't fail the main operation if audit logging fails
  }
}

interface GroupPackageInfo {
  packageId: string;
  isMandatory: boolean;
  autoInstall: boolean;
  installOrder: number;
  groupName: string;
}

/**
 * Get packages associated with user's groups
 */
async function getUserGroupPackages(userId: string): Promise<GroupPackageInfo[]> {
  console.log(`[getUserGroupPackages] Getting group packages for user: ${userId}`);
  
  try {
    // Get user record to find their groups
    const userResult = await dynamoClient.send(new GetItemCommand({
      TableName: USERS_TABLE,
      Key: marshall({ id: userId }),
    }));

    if (!userResult.Item) {
      console.log(`[getUserGroupPackages] User not found: ${userId}`);
      return [];
    }

    const user = unmarshall(userResult.Item) as EnhancedUser;
    const groupIds = user.groupIds || [];
    
    if (groupIds.length === 0) {
      console.log('[getUserGroupPackages] User has no groups');
      return [];
    }

    console.log(`[getUserGroupPackages] User belongs to ${groupIds.length} groups:`, groupIds);

    // Query GroupPackageBindings for each group
    const groupPackages: GroupPackageInfo[] = [];

    for (const groupId of groupIds) {
      try {
        // Get group info for name
        const groupResult = await dynamoClient.send(new GetItemCommand({
          TableName: GROUPS_TABLE,
          Key: marshall({ id: groupId }),
        }));

        const groupName = groupResult.Item
          ? (unmarshall(groupResult.Item) as Group).name
          : groupId;

        // Query package bindings for this group
        const queryResult = await dynamoClient.send(new QueryCommand({
          TableName: GROUP_PACKAGE_BINDINGS_TABLE,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: marshall({
            ':pk': `group#${groupId}`
          })
        }));

        if (queryResult.Items && queryResult.Items.length > 0) {
          console.log(`[getUserGroupPackages] Found ${queryResult.Items.length} package bindings for group ${groupName}`);
          
          for (const item of queryResult.Items) {
            const binding = unmarshall(item);
            
            // Only include if autoInstall is true
            if (binding.autoInstall) {
              groupPackages.push({
                packageId: binding.packageId,
                isMandatory: binding.isMandatory || false,
                autoInstall: binding.autoInstall,
                installOrder: binding.installOrder || 50,
                groupName: groupName
              });
              console.log(`[getUserGroupPackages] Added package ${binding.packageId} from group ${groupName} (mandatory: ${binding.isMandatory || false})`);
            }
          }
        }
      } catch (error) {
        console.error(`[getUserGroupPackages] Error processing group ${groupId}:`, error);
        // Continue with other groups
      }
    }

    console.log(`[getUserGroupPackages] Returning ${groupPackages.length} total group packages`);
    return groupPackages;
  } catch (error) {
    console.error('[getUserGroupPackages] Error:', error);
    return []; // Return empty array on error, don't fail launch
  }
}

/**
 * Create package queue items in DynamoDB for post-boot installation
 */
async function createPackageQueueItems(
  instanceId: string,
  packages: BootstrapPackage[],
  userId: string,
  groupIds: string[]
): Promise<void> {
  console.log(`[createPackageQueueItems] Creating ${packages.length} queue items for instance ${instanceId}`);
  
  try {
    const timestamp = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days

    for (const pkg of packages) {
      const queueItem = {
        PK: `workstation#${instanceId}`,
        SK: `package#${pkg.packageId}#${pkg.order}`,
        packageId: pkg.packageId,
        packageName: pkg.name,
        downloadUrl: pkg.downloadUrl,
        installCommand: pkg.installCommand,
        installArgs: pkg.installArgs || '',
        status: 'pending',
        installOrder: pkg.order,
        required: pkg.isRequired,
        retryCount: 0,
        maxRetries: 3,
        createdAt: timestamp,
        createdBy: userId,
        groupId: groupIds[0] || null,
        ttl: ttl
      };

      await dynamoClient.send(new PutItemCommand({
        TableName: PACKAGE_QUEUE_TABLE,
        Item: marshall(queueItem, { removeUndefinedValues: true })
      }));

      console.log(`[createPackageQueueItems] Created queue item for package ${pkg.packageId}`);
    }

    console.log(`[createPackageQueueItems] Successfully created ${packages.length} queue items`);
  } catch (error) {
    console.error('[createPackageQueueItems] Error creating queue items:', error);
    throw error; // Let caller handle the error
  }
}


export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  console.log('='.repeat(80));
  console.log('=== EC2 Management Handler Started ===');
  console.log('='.repeat(80));
  console.log('Request ID:', context.awsRequestId);
  console.log('Function Name:', context.functionName);
  console.log('Memory Limit:', context.memoryLimitInMB);
  console.log('Time Remaining:', context.getRemainingTimeInMillis(), 'ms');
  console.log('\n--- Event Details ---');
  console.log('Event:', JSON.stringify(event, null, 2));
  // Environment variable logging removed for security (HIGH-11)
  console.log('='.repeat(80));

  try {
    // Validate required environment variables
    const requiredEnvVars = {
      WORKSTATIONS_TABLE_NAME: process.env.WORKSTATIONS_TABLE_NAME,
      USERS_TABLE: process.env.USERS_TABLE,
      ROLES_TABLE: process.env.ROLES_TABLE,
      GROUPS_TABLE: process.env.GROUPS_TABLE,
      AUDIT_TABLE: process.env.AUDIT_TABLE,
      VPC_ID: process.env.VPC_ID,
    };
    
    const missingEnvVars = Object.entries(requiredEnvVars)
      .filter(([_, value]) => !value)
      .map(([key, _]) => key);
    
    if (missingEnvVars.length > 0) {
      console.error('❌ Missing required environment variables:', missingEnvVars);
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({
          message: 'Lambda configuration error',
          error: `Missing environment variables: ${missingEnvVars.join(', ')}`,
          details: 'Please check Lambda function environment configuration'
        }),
      };
    }

    const { httpMethod, pathParameters, body, requestContext } = event;
    const userId = requestContext.authorizer?.claims?.email || 
                   requestContext.authorizer?.claims?.sub || 
                   requestContext.authorizer?.claims?.['cognito:username'] ||
                   'unknown';
    
    console.log('\n--- Request Context ---');
    console.log('Extracted userId:', userId);
    console.log('HTTP Method:', httpMethod);
    console.log('Path Parameters:', JSON.stringify(pathParameters));
    console.log('Query Parameters:', JSON.stringify(event.queryStringParameters));
    console.log('Body:', body ? body.substring(0, 200) : 'none');

    // Check if user exists and is active (with fallback for backwards compatibility)
    console.log('\n--- User Verification ---');
    console.log('Checking user in DynamoDB table:', USERS_TABLE);
    
    let user: EnhancedUser | null = null;
    
    try {
      const userResult = await dynamoClient.send(new GetItemCommand({
        TableName: USERS_TABLE,
        Key: marshall({ id: userId }),
      }));
      
      if (userResult.Item) {
        user = unmarshall(userResult.Item) as EnhancedUser;
        console.log('✅ User found in Users table');
        console.log('User status:', user.status);
        console.log('User roles:', user.roleIds?.join(', ') || 'none');
        console.log('User groups:', user.groupIds?.join(', ') || 'none');
        console.log('Direct permissions:', user.directPermissions?.join(', ') || 'none');
      } else {
        console.warn('⚠️  User NOT found in Users table');
        console.warn('Operating in backwards compatibility mode with default permissions');
      }
    } catch (error) {
      console.error('❌ Error querying Users table:', error);
      console.error('Error details:', {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      console.warn('⚠️  WARNING: Could not verify user in Users table');
      console.warn('Allowing operation for backwards compatibility');
    }

    // If user exists but is not active, deny access
    if (user && user.status !== 'active') {
      console.log('❌ User access denied - account not active. Status:', user.status);
      await logAuditEvent(userId, 'DENIED_ACCESS', 'system', 'all', { reason: 'inactive_account', status: user.status });
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({ 
          message: 'User account is not active',
          status: user.status,
          details: 'Please contact your administrator'
        }),
      };
    }

    console.log('\n--- Processing Request ---');
    
    switch (httpMethod) {
      case 'GET':
        if (pathParameters?.workstationId) {
          console.log('Route: GET /workstations/{workstationId}');
          if (!(await hasPermission(userId, 'workstations:read'))) {
            await logAuditEvent(userId, 'DENIED_ACCESS', 'workstation', pathParameters.workstationId);
            return {
              statusCode: 403,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
                'Access-Control-Allow-Headers': 'Content-Type,Authorization',
                'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
              },
              body: JSON.stringify({ message: 'Insufficient permissions' }),
            };
          }
          return await getWorkstation(pathParameters.workstationId, userId);
        } else {
          console.log('Route: GET /workstations (list)');
          if (!(await hasPermission(userId, 'workstations:read'))) {
            await logAuditEvent(userId, 'DENIED_ACCESS', 'workstations', 'list');
            return {
              statusCode: 403,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
                'Access-Control-Allow-Headers': 'Content-Type,Authorization',
                'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
              },
              body: JSON.stringify({ message: 'Insufficient permissions' }),
            };
          }
          return await listWorkstations(event.queryStringParameters, userId);
        }
      
      case 'POST':
        console.log('Route: POST /workstations (launch)');
        if (!(await hasPermission(userId, 'workstations:create'))) {
          await logAuditEvent(userId, 'DENIED_CREATE', 'workstation', 'new');
          return {
            statusCode: 403,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
              'Access-Control-Allow-Headers': 'Content-Type,Authorization',
              'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
            },
            body: JSON.stringify({ message: 'Insufficient permissions to create workstations' }),
          };
        }
        const launchRequest = JSON.parse(body || '{}') as LaunchWorkstationRequest;
        return await launchWorkstation(launchRequest, userId, event);
      
      case 'DELETE':
        if (pathParameters?.workstationId) {
          console.log('Route: DELETE /workstations/{workstationId}');
          if (!(await hasPermission(userId, 'workstations:delete'))) {
            await logAuditEvent(userId, 'DENIED_DELETE', 'workstation', pathParameters.workstationId);
            return {
              statusCode: 403,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
                'Access-Control-Allow-Headers': 'Content-Type,Authorization',
                'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
              },
              body: JSON.stringify({ message: 'Insufficient permissions to delete workstations' }),
            };
          }
          return await terminateWorkstation(pathParameters.workstationId, userId);
        }
        break;
      
      case 'PUT':
        if (event.path?.includes('/reconcile')) {
          console.log('Route: PUT /workstations/reconcile');
          if (!(await hasPermission(userId, 'workstations:manage-all'))) {
            await logAuditEvent(userId, 'DENIED_RECONCILE', 'workstations', 'all');
            return {
              statusCode: 403,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
                'Access-Control-Allow-Headers': 'Content-Type,Authorization',
                'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
              },
              body: JSON.stringify({ message: 'Insufficient permissions to reconcile workstations' }),
            };
          }
          return await reconcileWorkstations(userId);
        }
        break;
      
      case 'PATCH':
        if (pathParameters?.workstationId) {
          console.log('Route: PATCH /workstations/{workstationId}');
          if (!(await hasPermission(userId, 'workstations:update'))) {
            await logAuditEvent(userId, 'DENIED_UPDATE', 'workstation', pathParameters.workstationId);
            return {
              statusCode: 403,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
                'Access-Control-Allow-Headers': 'Content-Type,Authorization',
                'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
              },
              body: JSON.stringify({ message: 'Insufficient permissions to update workstations' }),
            };
          }
          const updateRequest = JSON.parse(body || '{}');
          return await updateWorkstation(pathParameters.workstationId, updateRequest, userId);
        }
        break;
    }

    console.log('❌ Invalid request - no matching route found');
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({ 
        message: 'Invalid request',
        method: httpMethod,
        path: event.path
      }),
    };
  } catch (error) {
    console.error('='.repeat(80));
    console.error('❌ FATAL ERROR in handler');
    console.error('='.repeat(80));
    console.error('Internal error:', error);
    console.error('='.repeat(80));
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        error: 'An internal error occurred. Please try again later.'
      }),
    };
  }
};

async function launchWorkstation(request: LaunchWorkstationRequest, userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  console.log('\n--- launchWorkstation Started ---');
  console.log('Request:', JSON.stringify(request, null, 2));
  
  await logAuditEvent(userId, 'CREATE_WORKSTATION', 'workstation', 'new', { request });
  const workstationId = `ws-${uuidv4()}`;
  const timestamp = new Date().toISOString();

  try {
    // Validate instance type
    console.log('Validating instance type...');
    const allowedTypes = await getAllowedInstanceTypes();
    console.log('Allowed instance types:', allowedTypes);
    
    if (!allowedTypes.includes(request.instanceType)) {
      console.error('❌ Invalid instance type:', request.instanceType);
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({ 
          message: 'Invalid instance type',
          requestedType: request.instanceType,
          allowedTypes
        }),
      };
    }

    // Get latest Windows AMI
    console.log('Finding Windows AMI for:', request.osVersion);
    const amiId = await getLatestWindowsAMI(request.osVersion);
    if (!amiId) {
      console.error('❌ Could not find Windows AMI for:', request.osVersion);
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({ message: 'Could not find suitable Windows AMI' }),
      };
    }
    console.log('✅ Found AMI:', amiId);

    // Get instance profile ARN
    console.log('Getting instance profile ARN...');
    const instanceProfileArn = await getInstanceProfileArn();
    console.log('✅ Instance Profile:', instanceProfileArn);

    // Get user-selected packages
    const userSelectedPackages = request.bootstrapPackages || [];
    console.log(`User selected ${userSelectedPackages.length} packages`);

    // Get group-associated packages
    console.log('Getting group-associated packages...');
    const groupPackages = await getUserGroupPackages(userId);
    console.log(`Found ${groupPackages.length} group packages`);

    // Get user's group IDs for queue creation
    let userGroupIds: string[] = [];
    try {
      const userResult = await dynamoClient.send(new GetItemCommand({
        TableName: USERS_TABLE,
        Key: marshall({ id: userId }),
      }));
      if (userResult.Item) {
        const userData = unmarshall(userResult.Item) as EnhancedUser;
        userGroupIds = userData.groupIds || [];
      }
    } catch (error) {
      console.warn('Could not fetch user group IDs:', error);
    }

    // Combine: user-selected + group packages (remove duplicates)
    const groupPackageIds = groupPackages.map((gp: GroupPackageInfo) => gp.packageId);
    const allRequestedPackageIds = [...new Set([...userSelectedPackages, ...groupPackageIds])];
    console.log(`Total requested packages (after deduplication): ${allRequestedPackageIds.length}`);

    // Get full package details
    console.log('Getting bootstrap package details...');
    const allPackages = await getBootstrapPackages(
      request.instanceType,
      request.osVersion,
      allRequestedPackageIds
    );
    console.log(`✅ Found ${allPackages.length} packages total`);

    // Split packages: UserData (critical) vs Post-boot
    const criticalCategories = ['driver', 'dcv', 'monitoring'];
    const userDataPackages = allPackages.filter(pkg =>
      pkg.isRequired ||
      pkg.type === 'driver' ||
      criticalCategories.includes(pkg.category?.toLowerCase() || '')
    );

    const postBootPackages = allPackages.filter(pkg =>
      !userDataPackages.includes(pkg)
    );

    console.log(`Package split - UserData: ${userDataPackages.length}, Post-boot: ${postBootPackages.length}`);
    console.log('UserData packages:', userDataPackages.map(p => p.name).join(', ') || 'none');
    console.log('Post-boot packages:', postBootPackages.map(p => p.name).join(', ') || 'none');

    // Create credentials first if using local admin (need password for user data script)
    let credentialsSecretArn: string | undefined;
    let adminPassword: string | undefined;
    if (request.authMethod === 'local') {
      try {
        console.log('Creating local admin credentials...');
        const credentials = await createLocalAdminCredentials(workstationId, request.localAdminConfig?.username || 'Administrator');
        credentialsSecretArn = credentials.arn;
        adminPassword = credentials.password;
        console.log('✅ Credentials created:', credentialsSecretArn);
      } catch (credError) {
        console.error('⚠️  Warning: Failed to create credentials:', credError);
        // Generate a temporary password to allow instance to launch
        adminPassword = generateSecurePassword();
      }
    }

    // Generate user data script with ONLY critical packages (must be after password is created)
    console.log('Generating user data script with critical packages only...');
    const userData = generateUserDataScript(request, workstationId, userDataPackages, adminPassword);
    console.log(`UserData script size: ${userData.length} bytes (limit: 16384 bytes)`);

    // Launch EC2 instance with retry logic for capacity issues
    console.log('Launching EC2 instance...');
    let runResult;
    let instanceId;
    let lastError;
    let subnetId: string = '';
    let securityGroupId: string = '';
    let availabilityZone: string = '';
    const excludedSubnets: string[] = []; // Track failed subnets to try different AZs

    // Try up to 3 times with different subnets if capacity issues occur
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Get fresh network config for each attempt, excluding previously failed subnets
        console.log('Getting network configuration...');
        const networkConfig = await getNetworkConfiguration(excludedSubnets);
        subnetId = networkConfig.subnetId;
        securityGroupId = networkConfig.securityGroupId;
        availabilityZone = networkConfig.availabilityZone;
        console.log(`Launch attempt ${attempt}/${maxRetries} using subnet: ${subnetId} in AZ: ${availabilityZone}`);

        // Generate cost allocation tags
        const costAllocationTags = generateCostAllocationTags(workstationId, userId, request);
        console.log('Cost allocation tags:', JSON.stringify(costAllocationTags, null, 2));
        
        // Validate cost allocation tags
        const tagValidation = validateCostAllocationTags(costAllocationTags);
        if (!tagValidation.valid) {
          console.warn('⚠️  Missing cost allocation tags:', tagValidation.missingTags.join(', '));
        }
        
        // Merge all tags: cost allocation tags + instance name + user custom tags
        const allTags = [
          { Key: 'Name', Value: `MediaWorkstation-${workstationId}` },
          // Required cost allocation tags
          { Key: 'CostCenter', Value: costAllocationTags.CostCenter },
          { Key: 'Environment', Value: costAllocationTags.Environment },
          { Key: 'Project', Value: costAllocationTags.Project },
          { Key: 'Owner', Value: costAllocationTags.Owner },
          { Key: 'CreatedBy', Value: costAllocationTags.CreatedBy },
          { Key: 'CreatedDate', Value: costAllocationTags.CreatedDate },
          { Key: 'Application', Value: costAllocationTags.Application },
          { Key: 'WorkstationId', Value: costAllocationTags.WorkstationId },
          { Key: 'UserId', Value: costAllocationTags.UserId },
          // User custom tags (may override defaults)
          ...(request.tags ? Object.entries(request.tags).map(([key, value]) => ({ Key: key, Value: value })) : []),
        ];
        
        console.log(`Launching instance with ${allTags.length} tags`);

        const runCommand = new RunInstancesCommand({
          ImageId: amiId,
          InstanceType: request.instanceType as _InstanceType,
          MinCount: 1,
          MaxCount: 1,
          SubnetId: subnetId,
          SecurityGroupIds: [securityGroupId],
          IamInstanceProfile: {
            Arn: instanceProfileArn,
          },
          UserData: Buffer.from(userData).toString('base64'),
          TagSpecifications: [
            {
              ResourceType: 'instance',
              Tags: allTags,
            },
            {
              // Also tag the root EBS volume with cost allocation tags
              ResourceType: 'volume',
              Tags: [
                { Key: 'Name', Value: `MediaWorkstation-${workstationId}-root` },
                { Key: 'CostCenter', Value: costAllocationTags.CostCenter },
                { Key: 'Environment', Value: costAllocationTags.Environment },
                { Key: 'Project', Value: costAllocationTags.Project },
                { Key: 'Owner', Value: costAllocationTags.Owner },
                { Key: 'WorkstationId', Value: costAllocationTags.WorkstationId },
                { Key: 'UserId', Value: costAllocationTags.UserId },
              ],
            },
          ],
          BlockDeviceMappings: [{
            DeviceName: '/dev/sda1',
            Ebs: {
              VolumeSize: 100, // 100GB root volume
              VolumeType: 'gp3',
              Encrypted: true,
            },
          }],
        });

        runResult = await ec2Client.send(runCommand);
        instanceId = runResult.Instances?.[0]?.InstanceId;

        if (instanceId) {
          console.log(`✅ Instance launched on attempt ${attempt}: ${instanceId}`);
          break; // Success, exit retry loop
        }
      } catch (error: any) {
        lastError = error;
        console.warn(`Launch attempt ${attempt} failed:`, error.name, error.message);
        
        // Only retry on capacity errors
        if (error.name === 'InsufficientInstanceCapacity' && attempt < maxRetries) {
          // Add this subnet to the exclusion list so we try a different AZ
          excludedSubnets.push(subnetId);
          console.log(`Retrying with different subnet (excluding ${excludedSubnets.length} subnet(s))...`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
          continue;
        }
        
        // For other errors or last attempt, throw
        throw error;
      }
    }

    if (!instanceId || !runResult) {
      throw lastError || new Error('Failed to launch instance - no instance ID returned');
    }

    // Credentials were already created before EC2 launch

    // Automatically add user's IP to security group for RDP access
    try {
      console.log('Adding user IP to security group for RDP access...');
      const userIp = await getUserIpAddress(event);
      if (userIp) {
        await addIpToSecurityGroup(securityGroupId, userIp, `Auto-added for ${userId} on launch`);
        console.log(`✅ Added ${userIp} to security group ${securityGroupId}`);
      } else {
        console.warn('⚠️  Could not determine user IP address');
      }
    } catch (ipError) {
      console.warn('⚠️  Failed to add user IP to security group:', ipError);
      // Continue - workstation is still usable, user can manually add IP
    }

    // Calculate estimated costs
    const hourlyCost = getInstanceHourlyCost(request.instanceType);
    const monthlyCost = hourlyCost * 24 * 30;
    console.log('Cost estimates - Hourly: $' + hourlyCost + ', Monthly: $' + monthlyCost);

    // Store workstation record in DynamoDB
    console.log('Storing workstation record in DynamoDB...');
    const workstationRecord: WorkstationRecord = {
      PK: `WORKSTATION#${workstationId}`,
      SK: 'METADATA',
      instanceId,
      userId,
      userRole: 'user',
      region: request.region,
      availabilityZone: runResult.Instances?.[0]?.Placement?.AvailabilityZone || '',
      instanceType: request.instanceType,
      osVersion: request.osVersion,
      amiId,
      vpcId: VPC_ID,
      subnetId,
      securityGroupId,
      authMethod: request.authMethod,
      domainName: request.domainConfig?.domainName,
      localAdminUser: request.localAdminConfig?.username || 'Administrator',
      credentialsSecretArn,
      status: 'launching',
      launchTime: timestamp,
      lastStatusCheck: timestamp,
      autoTerminateAt: request.autoTerminateHours 
        ? new Date(Date.now() + request.autoTerminateHours * 60 * 60 * 1000).toISOString()
        : undefined,
      estimatedHourlyCost: hourlyCost,
      estimatedMonthlyCost: monthlyCost,
      actualCostToDate: 0,
      tags: request.tags || {},
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    try {
      const putCommand = new PutItemCommand({
        TableName: WORKSTATIONS_TABLE,
        Item: marshall(workstationRecord, { removeUndefinedValues: true }),
      });

      await dynamoClient.send(putCommand);
      console.log('✅ Workstation record stored');
    } catch (dbError) {
      console.error('⚠️  Warning: Failed to store workstation record, but instance launched successfully:', dbError);
      console.error('Database error details:', {
        name: dbError instanceof Error ? dbError.name : 'Unknown',
        message: dbError instanceof Error ? dbError.message : String(dbError),
        stack: dbError instanceof Error ? dbError.stack : undefined,
      });
      // Continue - instance is running, record can be reconciled later
    }

    // Create package queue items for post-boot installation
    if (postBootPackages.length > 0) {
      try {
        console.log(`Creating ${postBootPackages.length} package queue items for post-boot installation...`);
        // Extract unique group IDs from the group packages we retrieved earlier
        // Use the user's group IDs we retrieved earlier
        await createPackageQueueItems(instanceId, postBootPackages, userId, userGroupIds);
        console.log('✅ Package queue items created successfully');
      } catch (error) {
        console.error('⚠️ Failed to create package queue items:', error);
        await logAuditEvent(userId, 'QUEUE_CREATION_FAILED', 'workstation', workstationId, {
          error: error instanceof Error ? error.message : String(error),
          packageCount: postBootPackages.length
        });
        // Continue - workstation is functional, packages can be queued later via API
      }
    } else {
      console.log('ℹ️ No post-boot packages to queue (all packages in UserData)');
    }

    console.log('=== launchWorkstation Completed Successfully ===\n');
    
    const responseBody = {
      workstationId,
      instanceId,
      status: 'launching',
      estimatedReadyTime: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      ...(credentialsSecretArn && { credentialsAvailable: true }),
    };
    
    console.log('Response body:', JSON.stringify(responseBody));
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify(responseBody),
    };

  } catch (error) {
    console.error('❌ Error launching workstation:', error);
    console.error('Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Failed to launch workstation',
        error: error instanceof Error ? error.message : 'Unknown error',
        details: 'Check CloudWatch logs for more information'
      }),
    };
  }
}

async function getWorkstation(workstationId: string, userId: string): Promise<APIGatewayProxyResult> {
  console.log('\n--- getWorkstation Started ---');
  console.log('WorkstationId:', workstationId);
  console.log('UserId:', userId);
  
  try {
    const getCommand = new GetItemCommand({
      TableName: WORKSTATIONS_TABLE,
      Key: marshall({
        PK: `WORKSTATION#${workstationId}`,
        SK: 'METADATA',
      }),
    });

    const result = await dynamoClient.send(getCommand);
    
    if (!result.Item) {
      console.log('❌ Workstation not found');
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({ message: 'Workstation not found' }),
      };
    }

    const workstation = unmarshall(result.Item) as WorkstationRecord;
    console.log('✅ Workstation found');
    console.log('Workstation owner:', workstation.userId);

    // Check permissions
    if (!(await canAccessWorkstation(userId, workstation.userId))) {
      console.log('❌ Access denied');
      await logAuditEvent(userId, 'DENIED_ACCESS', 'workstation', workstationId);
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({ message: 'Access denied' }),
      };
    }

    await logAuditEvent(userId, 'READ_WORKSTATION', 'workstation', workstationId);

    // Get current instance status from EC2
    console.log('Fetching EC2 instance status...');
    const describeCommand = new DescribeInstancesCommand({
      InstanceIds: [workstation.instanceId],
    });

    const ec2Result = await ec2Client.send(describeCommand);
    const instance = ec2Result.Reservations?.[0]?.Instances?.[0];

    if (instance) {
      workstation.status = mapEC2StatusToWorkstationStatus(instance.State?.Name || 'unknown');
      workstation.publicIp = instance.PublicIpAddress;
      workstation.privateIp = instance.PrivateIpAddress;
      console.log('EC2 Status:', instance.State?.Name, '→ Workstation Status:', workstation.status);
    }

    // Include connection info if instance is running
    const connectionInfo = instance?.State?.Name === 'running' ? {
      publicIp: workstation.publicIp,
      rdp: {
        port: 3389,
        protocol: 'RDP',
        enabled: true
      },
      dcv: {
        port: 8443,
        protocol: 'DCV',
        quicEnabled: true,
        webUrl: `https://${workstation.publicIp}:8443`,
        enabled: true
      },
      credentials: workstation.authMethod === 'local' ? {
        type: 'local',
        username: workstation.localAdminUser,
      } : {
        type: 'domain',
        domain: workstation.domainName,
      },
    } : undefined;

    console.log('=== getWorkstation Completed Successfully ===\n');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        ...workstation,
        connectionInfo,
      }),
    };

  } catch (error) {
    console.error('❌ Error getting workstation:', error);
    console.error('Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Failed to get workstation',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

async function listWorkstations(queryParams: any, userId: string): Promise<APIGatewayProxyResult> {
  console.log('\n--- listWorkstations Started ---');
  console.log('Query Params:', JSON.stringify(queryParams));
  console.log('UserId:', userId);
  
  try {
    let queryCommand;

    const hasManageAll = await hasPermission(userId, 'workstations:manage-all');
    console.log('User has manage-all permission:', hasManageAll);
    
    if (hasManageAll && queryParams?.userId) {
      console.log('Admin querying specific user workstations:', queryParams.userId);
      queryCommand = new QueryCommand({
        TableName: WORKSTATIONS_TABLE,
        IndexName: 'UserIdIndex',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: marshall({
          ':userId': queryParams.userId,
        }),
      });
    } else if (hasManageAll && queryParams?.status) {
      console.log('Admin querying by status:', queryParams.status);
      queryCommand = new QueryCommand({
        TableName: WORKSTATIONS_TABLE,
        IndexName: 'StatusIndex',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: marshall({
          ':status': queryParams.status,
        }),
      });
    } else if (!hasManageAll) {
      console.log('User querying own workstations');
      queryCommand = new QueryCommand({
        TableName: WORKSTATIONS_TABLE,
        IndexName: 'UserIdIndex',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: marshall({
          ':userId': userId,
        }),
      });
    } else {
      console.log('Admin querying all workstations (using Scan)');
      const { ScanCommand } = await import('@aws-sdk/client-dynamodb');
      queryCommand = new ScanCommand({
        TableName: WORKSTATIONS_TABLE,
        FilterExpression: 'begins_with(PK, :pk)',
        ExpressionAttributeValues: marshall({
          ':pk': 'WORKSTATION#',
        }),
      });
    }

    const result = await dynamoClient.send(queryCommand);
    const workstations = (result.Items || []).map(item => {
      const ws = unmarshall(item);
      // Extract workstationId from PK if not already present
      if (!ws.workstationId && ws.PK && ws.PK.startsWith('WORKSTATION#')) {
        ws.workstationId = ws.PK.replace('WORKSTATION#', '');
      }
      return ws;
    });
    console.log('✅ Found', workstations.length, 'workstations in DynamoDB');

    // Sync with EC2 to get current status
    console.log('Syncing with EC2 for current statuses...');
    const instanceIds = workstations.map(ws => ws.instanceId).filter(Boolean);
    
    if (instanceIds.length > 0) {
      try {
        const describeCommand = new DescribeInstancesCommand({
          InstanceIds: instanceIds,
        });
        const ec2Result = await ec2Client.send(describeCommand);
        // Filter out shutting-down and terminated instances - these shouldn't recreate records
        const ec2Instances = ec2Result.Reservations?.flatMap(r => r.Instances || [])
          .filter(i => i.State?.Name !== 'shutting-down' && i.State?.Name !== 'terminated') || [];
        
        console.log(`Found ${ec2Instances.length} EC2 instances`);
        
        // Update workstation statuses based on EC2
        const statusUpdates: Promise<void>[] = [];
        
        for (const workstation of workstations) {
          const ec2Instance = ec2Instances.find(i => i.InstanceId === workstation.instanceId);
          
          if (ec2Instance) {
            const currentStatus = mapEC2StatusToWorkstationStatus(ec2Instance.State?.Name || 'unknown');
            const publicIp = ec2Instance.PublicIpAddress;
            const privateIp = ec2Instance.PrivateIpAddress;
            
            // Update if status or IPs changed
            if (currentStatus !== workstation.status ||
                publicIp !== workstation.publicIp ||
                privateIp !== workstation.privateIp) {
              
              console.log(`Updating ${workstation.instanceId}: ${workstation.status} -> ${currentStatus}`);
              
              workstation.status = currentStatus;
              workstation.publicIp = publicIp;
              workstation.privateIp = privateIp;
              workstation.lastStatusCheck = new Date().toISOString();
              
              // Update in DynamoDB asynchronously
              statusUpdates.push(
                dynamoClient.send(new UpdateItemCommand({
                  TableName: WORKSTATIONS_TABLE,
                  Key: marshall({
                    PK: workstation.PK,
                    SK: workstation.SK,
                  }),
                  UpdateExpression: 'SET #status = :status, publicIp = :publicIp, privateIp = :privateIp, lastStatusCheck = :timestamp, updatedAt = :timestamp',
                  ExpressionAttributeNames: {
                    '#status': 'status',
                  },
                  ExpressionAttributeValues: marshall({
                    ':status': currentStatus,
                    ':publicIp': publicIp || null,
                    ':privateIp': privateIp || null,
                    ':timestamp': workstation.lastStatusCheck,
                  }),
                })).then(() => {
                  console.log(`✅ Updated ${workstation.instanceId} status in DynamoDB`);
                }).catch((err) => {
                  console.error(`⚠️  Failed to update ${workstation.instanceId}:`, err);
                })
              );
            }
          } else {
            // Instance not found in EC2 - might be terminated
            console.log(`Instance ${workstation.instanceId} not found in EC2, checking if should be marked terminated or deleted`);
            
            // If instance not in EC2, it's been terminated - delete the record entirely
            console.log(`Deleting DynamoDB record for missing instance ${workstation.instanceId}`);
            const { DeleteItemCommand } = await import('@aws-sdk/client-dynamodb');
            
            statusUpdates.push(
              dynamoClient.send(new DeleteItemCommand({
                TableName: WORKSTATIONS_TABLE,
                Key: marshall({
                  PK: workstation.PK,
                  SK: workstation.SK,
                }),
              })).then(() => {
                console.log(`✅ Deleted record for missing instance ${workstation.instanceId}`);
                // Remove from the workstations array so it doesn't appear in results
                const index = workstations.indexOf(workstation);
                if (index > -1) {
                  workstations.splice(index, 1);
                }
              }).catch((err) => {
                console.error(`⚠️  Failed to delete record for ${workstation.instanceId}:`, err);
              })
            );
          }
        }
        
        // Don't wait for updates to complete, return current state
        Promise.all(statusUpdates).catch(err => {
          console.error('⚠️  Some status updates failed:', err);
        });
        
      } catch (ec2Error) {
        console.error('⚠️  Failed to fetch EC2 statuses:', ec2Error);
        // Continue with DynamoDB data if EC2 query fails
      }
    }

    // Enrich workstations with ownership info (owner name and groups)
    console.log('Enriching workstations with ownership info...');
    const userCache = new Map<string, { name: string; groups: string[] }>();
    
    for (const workstation of workstations) {
      const wsUserId = workstation.userId;
      
      if (!wsUserId) continue;
      
      // Check cache first
      if (userCache.has(wsUserId)) {
        const cached = userCache.get(wsUserId)!;
        workstation.ownerName = cached.name;
        workstation.ownerGroups = cached.groups;
        continue;
      }
      
      try {
        // Lookup user info
        const userResult = await dynamoClient.send(new GetItemCommand({
          TableName: USERS_TABLE,
          Key: marshall({ id: wsUserId }),
        }));
        
        if (userResult.Item) {
          const userData = unmarshall(userResult.Item) as EnhancedUser;
          const displayName = [userData.firstName, userData.lastName]
            .filter(Boolean)
            .join(' ') || userData.email || wsUserId;
          
          // Get group names
          const groupNames: string[] = [];
          for (const groupId of userData.groupIds || []) {
            try {
              const groupResult = await dynamoClient.send(new GetItemCommand({
                TableName: GROUPS_TABLE,
                Key: marshall({ id: groupId }),
              }));
              if (groupResult.Item) {
                const group = unmarshall(groupResult.Item) as Group;
                groupNames.push(group.name);
              }
            } catch (err) {
              console.warn(`Could not fetch group ${groupId}:`, err);
            }
          }
          
          workstation.ownerName = displayName;
          workstation.ownerGroups = groupNames;
          
          // Cache for future lookups
          userCache.set(wsUserId, { name: displayName, groups: groupNames });
        } else {
          // User not found, use userId as name
          workstation.ownerName = wsUserId;
          userCache.set(wsUserId, { name: wsUserId, groups: [] });
        }
      } catch (err) {
        console.warn(`Could not fetch user info for ${wsUserId}:`, err);
        workstation.ownerName = wsUserId;
      }
    }
    console.log(`Enriched ${workstations.length} workstations with ownership info`);

    // Calculate summary statistics with updated statuses
    const runningInstances = workstations.filter(w => w.status === 'running').length;
    const totalHourlyCost = workstations
      .filter(w => w.status === 'running')
      .reduce((sum, w) => sum + (w.estimatedHourlyCost || 0), 0);
    const estimatedMonthlyCost = totalHourlyCost * 24 * 30;

    await logAuditEvent(userId, 'LIST_WORKSTATIONS', 'workstations', 'list', { count: workstations.length });

    console.log('=== listWorkstations Completed Successfully ===\n');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        workstations,
        summary: {
          totalInstances: workstations.length,
          runningInstances,
          totalHourlyCost,
          estimatedMonthlyCost,
        },
      }),
    };

  } catch (error) {
    console.error('❌ Error listing workstations:', error);
    console.error('Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Failed to list workstations',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

async function terminateWorkstation(workstationId: string, userId: string): Promise<APIGatewayProxyResult> {
  console.log('\n--- terminateWorkstation Started ---');
  console.log('WorkstationId:', workstationId);
  console.log('UserId:', userId);
  
  try {
    // Get workstation record
    const getCommand = new GetItemCommand({
      TableName: WORKSTATIONS_TABLE,
      Key: marshall({
        PK: `WORKSTATION#${workstationId}`,
        SK: 'METADATA',
      }),
    });

    const result = await dynamoClient.send(getCommand);
    
    if (!result.Item) {
      console.log('❌ Workstation not found');
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({ message: 'Workstation not found' }),
      };
    }

    const workstation = unmarshall(result.Item) as WorkstationRecord;
    console.log('✅ Workstation found');
    console.log('Workstation owner:', workstation.userId);
    console.log('Workstation status:', workstation.status);

    // Check permissions
    if (!(await canAccessWorkstation(userId, workstation.userId))) {
      console.log('❌ Access denied');
      await logAuditEvent(userId, 'DENIED_DELETE', 'workstation', workstationId);
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({ message: 'Access denied' }),
      };
    }

    // If instance is already terminated, just delete the DynamoDB record
    if (workstation.status === 'terminated') {
      console.log('Instance already terminated, deleting DynamoDB record...');
      
      const { DeleteItemCommand } = await import('@aws-sdk/client-dynamodb');
      const deleteCommand = new DeleteItemCommand({
        TableName: WORKSTATIONS_TABLE,
        Key: marshall({
          PK: `WORKSTATION#${workstationId}`,
          SK: 'METADATA',
        }),
      });

      await dynamoClient.send(deleteCommand);
      console.log('✅ DynamoDB record deleted');

      await logAuditEvent(userId, 'DELETE_WORKSTATION_RECORD', 'workstation', workstationId);

      console.log('=== terminateWorkstation Completed (Record Deleted) ===\n');
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({
          status: 'deleted',
          message: 'Workstation record deleted successfully'
        }),
      };
    }

    // Terminate EC2 instance if not already terminated
    console.log('Terminating EC2 instance:', workstation.instanceId);
    try {
      const terminateCommand = new TerminateInstancesCommand({
        InstanceIds: [workstation.instanceId],
      });

      await ec2Client.send(terminateCommand);
      console.log('✅ Instance terminated');
    } catch (ec2Error: any) {
      // If instance doesn't exist, that's okay - mark as terminated
      if (ec2Error.name === 'InvalidInstanceID.NotFound' || ec2Error.Code === 'InvalidInstanceID.NotFound') {
        console.log('⚠️  Instance not found in EC2, marking as terminated');
      } else {
        throw ec2Error;
      }
    }

    // Update workstation status
    console.log('Updating workstation status in DynamoDB...');
    const updateCommand = new UpdateItemCommand({
      TableName: WORKSTATIONS_TABLE,
      Key: marshall({
        PK: `WORKSTATION#${workstationId}`,
        SK: 'METADATA',
      }),
      UpdateExpression: 'SET #status = :status, updatedAt = :timestamp',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: marshall({
        ':status': 'terminating',
        ':timestamp': new Date().toISOString(),
      }),
    });

    await dynamoClient.send(updateCommand);
    console.log('✅ Status updated');

    await logAuditEvent(userId, 'DELETE_WORKSTATION', 'workstation', workstationId);

    console.log('=== terminateWorkstation Completed Successfully ===\n');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        status: 'terminating',
        message: 'Workstation is being terminated'
      }),
    };

  } catch (error) {
    console.error('❌ Error terminating workstation:', error);
    console.error('Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Failed to terminate workstation',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

async function reconcileWorkstations(userId: string): Promise<APIGatewayProxyResult> {
  console.log('\n--- reconcileWorkstations Started ---');
  console.log('UserId:', userId);
  
  try {
    await logAuditEvent(userId, 'RECONCILE_WORKSTATIONS', 'workstations', 'all', { action: 'started' });
    
    // Get all EC2 instances with WorkstationId tag
    console.log('Fetching all EC2 instances with WorkstationId tag...');
    const describeCommand = new DescribeInstancesCommand({
      Filters: [
        { Name: 'tag-key', Values: ['WorkstationId'] },
        { Name: 'instance-state-name', Values: ['pending', 'running', 'stopping', 'stopped'] },
      ],
    });
    
    const ec2Result = await ec2Client.send(describeCommand);
    const ec2Instances = ec2Result.Reservations?.flatMap(r => r.Instances || []) || [];
    console.log(`Found ${ec2Instances.length} EC2 instances with WorkstationId tag`);
    
    // Get all workstation records from DynamoDB
    console.log('Fetching all workstation records from DynamoDB...');
    const { ScanCommand } = await import('@aws-sdk/client-dynamodb');
    const scanCommand = new ScanCommand({
      TableName: WORKSTATIONS_TABLE,
      FilterExpression: 'begins_with(PK, :pk)',
      ExpressionAttributeValues: marshall({
        ':pk': 'WORKSTATION#',
      }),
    });
    
    const dynamoResult = await dynamoClient.send(scanCommand);
    const dynamoWorkstations = (dynamoResult.Items || []).map(item => unmarshall(item) as WorkstationRecord);
    const dynamoInstanceIds = new Set(dynamoWorkstations.map(w => w.instanceId));
    console.log(`Found ${dynamoWorkstations.length} workstation records in DynamoDB`);
    
    // Find orphaned EC2 instances (in EC2 but not in DynamoDB)
    const orphanedInstances = ec2Instances.filter(instance =>
      instance.InstanceId && !dynamoInstanceIds.has(instance.InstanceId)
    );
    
    console.log(`Found ${orphanedInstances.length} orphaned EC2 instances`);
    
    const reconciledRecords = [];
    const errors = [];
    
    // Create DynamoDB records for orphaned instances
    for (const instance of orphanedInstances) {
      try {
        const workstationIdTag = instance.Tags?.find(t => t.Key === 'WorkstationId');
        const userIdTag = instance.Tags?.find(t => t.Key === 'UserId');
        
        if (!workstationIdTag?.Value || !instance.InstanceId) {
          console.warn(`Skipping instance ${instance.InstanceId} - missing WorkstationId tag`);
          continue;
        }
        
        const workstationId = workstationIdTag.Value;
        const ownerId = userIdTag?.Value || userId;
        
        console.log(`Creating DynamoDB record for orphaned instance ${instance.InstanceId} (${workstationId})`);
        
        const timestamp = new Date().toISOString();
        const workstationRecord: WorkstationRecord = {
          PK: `WORKSTATION#${workstationId}`,
          SK: 'METADATA',
          instanceId: instance.InstanceId,
          userId: ownerId,
          userRole: 'user',
          region: process.env.AWS_REGION || 'us-west-2',
          availabilityZone: instance.Placement?.AvailabilityZone || '',
          instanceType: instance.InstanceType || 'unknown',
          osVersion: 'Windows Server 2022', // Default assumption
          amiId: instance.ImageId || '',
          vpcId: instance.VpcId || VPC_ID,
          subnetId: instance.SubnetId || '',
          securityGroupId: instance.SecurityGroups?.[0]?.GroupId || '',
          publicIp: instance.PublicIpAddress,
          privateIp: instance.PrivateIpAddress,
          authMethod: 'local',
          status: mapEC2StatusToWorkstationStatus(instance.State?.Name || 'unknown'),
          launchTime: instance.LaunchTime?.toISOString() || timestamp,
          lastStatusCheck: timestamp,
          estimatedHourlyCost: getInstanceHourlyCost(instance.InstanceType || 'unknown'),
          estimatedMonthlyCost: getInstanceHourlyCost(instance.InstanceType || 'unknown') * 24 * 30,
          actualCostToDate: 0,
          tags: instance.Tags?.reduce((acc, tag) => {
            if (tag.Key && tag.Value) {
              acc[tag.Key] = tag.Value;
            }
            return acc;
          }, {} as Record<string, string>) || {},
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        
        const putCommand = new PutItemCommand({
          TableName: WORKSTATIONS_TABLE,
          Item: marshall(workstationRecord),
        });
        
        await dynamoClient.send(putCommand);
        
        reconciledRecords.push({
          workstationId,
          instanceId: instance.InstanceId,
          status: 'reconciled',
        });
        
        console.log(`✅ Reconciled workstation ${workstationId}`);
      } catch (error) {
        console.error(`Error reconciling instance ${instance.InstanceId}:`, error);
        errors.push({
          instanceId: instance.InstanceId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    
    await logAuditEvent(userId, 'RECONCILE_WORKSTATIONS', 'workstations', 'all', {
      reconciled: reconciledRecords.length,
      errors: errors.length,
    });
    
    console.log('=== reconcileWorkstations Completed ===\n');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Reconciliation completed',
        summary: {
          totalEC2Instances: ec2Instances.length,
          totalDynamoRecords: dynamoWorkstations.length,
          orphanedInstances: orphanedInstances.length,
          reconciledCount: reconciledRecords.length,
          errorCount: errors.length,
        },
        reconciledRecords,
        errors,
      }),
    };
    
  } catch (error) {
    console.error('❌ Error reconciling workstations:', error);
    console.error('Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Failed to reconcile workstations',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

async function updateWorkstation(workstationId: string, updateRequest: { friendlyName?: string }, userId: string): Promise<APIGatewayProxyResult> {
  console.log('\n--- updateWorkstation Started ---');
  console.log('WorkstationId:', workstationId);
  console.log('UpdateRequest:', JSON.stringify(updateRequest));
  console.log('UserId:', userId);
  
  try {
    // Get workstation record to verify it exists and check ownership
    const getCommand = new GetItemCommand({
      TableName: WORKSTATIONS_TABLE,
      Key: marshall({
        PK: `WORKSTATION#${workstationId}`,
        SK: 'METADATA',
      }),
    });

    const result = await dynamoClient.send(getCommand);
    
    if (!result.Item) {
      console.log('❌ Workstation not found');
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
        },
        body: JSON.stringify({ message: 'Workstation not found' }),
      };
    }

    const workstation = unmarshall(result.Item) as WorkstationRecord;
    console.log('✅ Workstation found');
    console.log('Workstation owner:', workstation.userId);

    // Check permissions - user can update their own, or admin can update any
    if (!(await canAccessWorkstation(userId, workstation.userId))) {
      console.log('❌ Access denied');
      await logAuditEvent(userId, 'DENIED_UPDATE', 'workstation', workstationId);
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
        },
        body: JSON.stringify({ message: 'Access denied' }),
      };
    }

    // Build update expression for allowed fields
    const updateExpressions: string[] = ['updatedAt = :timestamp'];
    const expressionAttributeValues: Record<string, any> = {
      ':timestamp': new Date().toISOString(),
    };

    if (updateRequest.friendlyName !== undefined) {
      updateExpressions.push('friendlyName = :friendlyName');
      expressionAttributeValues[':friendlyName'] = updateRequest.friendlyName;
    }

    // Perform the update
    console.log('Updating workstation in DynamoDB...');
    const updateCommand = new UpdateItemCommand({
      TableName: WORKSTATIONS_TABLE,
      Key: marshall({
        PK: `WORKSTATION#${workstationId}`,
        SK: 'METADATA',
      }),
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeValues: marshall(expressionAttributeValues),
      ReturnValues: 'ALL_NEW',
    });

    const updateResult = await dynamoClient.send(updateCommand);
    const updatedWorkstation = updateResult.Attributes ? unmarshall(updateResult.Attributes) : null;
    console.log('✅ Workstation updated');

    await logAuditEvent(userId, 'UPDATE_WORKSTATION', 'workstation', workstationId, updateRequest);

    console.log('=== updateWorkstation Completed Successfully ===\n');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Workstation updated successfully',
        workstation: updatedWorkstation,
      }),
    };

  } catch (error) {
    console.error('❌ Error updating workstation:', error);
    console.error('Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Failed to update workstation',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

// Helper functions
async function getAllowedInstanceTypes(): Promise<string[]> {
  try {
    const getCommand = new GetParameterCommand({
      Name: '/workstation/config/allowedInstanceTypes',
    });

    const result = await ssmClient.send(getCommand);
    return JSON.parse(result.Parameter?.Value || '[]');
  } catch (error) {
    console.warn('Could not fetch allowed instance types from SSM, using defaults');
    // Return default types if SSM parameter doesn't exist
    return ['g4dn.xlarge', 'g4dn.2xlarge', 'g5.xlarge', 'g5.2xlarge', 'g6.xlarge'];
  }
}

async function getLatestWindowsAMI(osVersion: string): Promise<string | null> {
  // Handle multiple format variations
  const versionMap: Record<string, string> = {
    // New frontend format (lowercase with dashes)
    'windows-server-2025': 'Windows_Server-2025-English-Full-Base-*',
    'windows-server-2022': 'Windows_Server-2022-English-Full-Base-*',
    'windows-server-2019': 'Windows_Server-2019-English-Full-Base-*',
    'windows-server-2016': 'Windows_Server-2016-English-Full-Base-*',
    // Display names
    'Windows Server 2025': 'Windows_Server-2025-English-Full-Base-*',
    'Windows Server 2022': 'Windows_Server-2022-English-Full-Base-*',
    'Windows Server 2019': 'Windows_Server-2019-English-Full-Base-*',
    'Windows Server 2016': 'Windows_Server-2016-English-Full-Base-*',
    // Old AMI name format (for backwards compatibility)
    'Windows_Server-2025-English-Full-Base': 'Windows_Server-2025-English-Full-Base-*',
    'Windows_Server-2022-English-Full-Base': 'Windows_Server-2022-English-Full-Base-*',
    'Windows_Server-2019-English-Full-Base': 'Windows_Server-2019-English-Full-Base-*',
    'Windows_Server-2016-English-Full-Base': 'Windows_Server-2016-English-Full-Base-*',
  };

  const namePattern = versionMap[osVersion];
  if (!namePattern) {
    console.error(`Unsupported OS version: ${osVersion}`);
    console.error(`Supported versions: ${Object.keys(versionMap).join(', ')}`);
    return null;
  }

  try {
    const describeCommand = new DescribeImagesCommand({
      Filters: [
        { Name: 'name', Values: [namePattern] },
        { Name: 'owner-id', Values: ['801119661308'] }, // Amazon's account ID
        { Name: 'state', Values: ['available'] },
      ],
    });

    const result = await ec2Client.send(describeCommand);
    const images = result.Images?.sort((a, b) =>
      new Date(b.CreationDate || '').getTime() - new Date(a.CreationDate || '').getTime()
    );

    if (!images || images.length === 0) {
      console.error(`No AMI found for OS version: ${osVersion}`);
      return null;
    }

    return images[0].ImageId || null;
  } catch (error) {
    console.error('Error retrieving Windows AMI:', error);
    return null;
  }
}

async function getNetworkConfiguration(excludeSubnetIds: string[] = []): Promise<{ subnetId: string; securityGroupId: string; availabilityZone: string }> {
  try {
    const vpcId = VPC_ID;
    console.log('Getting network configuration for VPC:', vpcId);
    if (excludeSubnetIds.length > 0) {
      console.log('Excluding subnets:', excludeSubnetIds.join(', '));
    }
    
    const ec2 = new EC2Client({});
    
    // Describe subnets in the VPC
    const subnetsResult = await ec2.send(new (await import('@aws-sdk/client-ec2')).DescribeSubnetsCommand({
      Filters: [
        { Name: 'vpc-id', Values: [vpcId] },
        { Name: 'state', Values: ['available'] },
      ],
    }));

    // Filter out excluded subnets
    const availableSubnets = subnetsResult.Subnets?.filter(subnet =>
      subnet.SubnetId && !excludeSubnetIds.includes(subnet.SubnetId)
    ) || [];

    if (availableSubnets.length === 0) {
      throw new Error('No suitable subnets available (all have been tried or excluded)');
    }

    // Prefer public subnets, but try any available subnet
    let publicSubnet = availableSubnets.find(subnet => subnet.MapPublicIpOnLaunch);
    
    if (!publicSubnet) {
      // Try any available subnet if no public subnet found
      publicSubnet = availableSubnets[0];
    }

    if (!publicSubnet?.SubnetId) {
      throw new Error('No suitable subnet found in VPC');
    }

    console.log(`Selected subnet ${publicSubnet.SubnetId} in AZ ${publicSubnet.AvailabilityZone}`);

    // Get security groups
    const securityGroupsResult = await ec2.send(new (await import('@aws-sdk/client-ec2')).DescribeSecurityGroupsCommand({
      Filters: [
        { Name: 'vpc-id', Values: [vpcId] },
        { Name: 'group-name', Values: ['*WorkstationSecurityGroup*'] },
      ],
    }));

    let workstationSG = securityGroupsResult.SecurityGroups?.find(sg =>
      sg.GroupName?.includes('WorkstationSecurityGroup') ||
      sg.Description?.includes('media workstation')
    );

    if (!workstationSG) {
      const defaultSGResult = await ec2.send(new (await import('@aws-sdk/client-ec2')).DescribeSecurityGroupsCommand({
        Filters: [
          { Name: 'vpc-id', Values: [vpcId] },
        ],
      }));
      workstationSG = defaultSGResult.SecurityGroups?.[0];
    }

    if (!workstationSG?.GroupId) {
      throw new Error('No suitable security group found in VPC');
    }

    return {
      subnetId: publicSubnet.SubnetId,
      securityGroupId: workstationSG.GroupId,
      availabilityZone: publicSubnet.AvailabilityZone || 'unknown',
    };
  } catch (error) {
    console.error('Error getting network configuration:', error);
    throw error;
  }
}

async function getInstanceProfileArn(): Promise<string> {
  try {
    const getCommand = new GetParameterCommand({
      Name: '/workstation/config/instanceProfileArn',
    });

    const result = await ssmClient.send(getCommand);
    return result.Parameter?.Value || '';
  } catch (error) {
    console.warn('Could not fetch instance profile from SSM');
    // Return empty string if parameter doesn't exist - instance will launch without profile
    return '';
  }
}

async function getBootstrapPackages(instanceType: string, osVersion: string, selectedPackageIds: string[]): Promise<BootstrapPackage[]> {
  try {
    // Scan all packages from DynamoDB
    const { ScanCommand } = await import('@aws-sdk/client-dynamodb');
    const result = await dynamoClient.send(new ScanCommand({
      TableName: BOOTSTRAP_PACKAGES_TABLE,
    }));

    const allPackages = (result.Items || [])
      .map(item => unmarshall(item) as BootstrapPackage)
      .filter(pkg => pkg.isEnabled); // Only enabled packages

    // Determine if this is a GPU instance
    const isGpuInstance = instanceType.startsWith('g4') || instanceType.startsWith('g5') || instanceType.startsWith('g6');
    const gpuFamily = isGpuInstance ? 'NVIDIA' : undefined;

    // Filter packages
    const packages: BootstrapPackage[] = [];

    for (const pkg of allPackages) {
      // Check if package supports this OS version
      if (!pkg.osVersions.includes(osVersion)) {
        continue;
      }

      // If package requires GPU, only include for GPU instances
      if (pkg.requiresGpu && !isGpuInstance) {
        continue;
      }

      // If package is GPU-specific, check GPU family
      if (pkg.supportedGpuFamilies && pkg.supportedGpuFamilies.length > 0) {
        if (!gpuFamily || !pkg.supportedGpuFamilies.includes(gpuFamily)) {
          continue;
        }
      }

      // Include if required OR if user selected it
      if (pkg.isRequired || selectedPackageIds.includes(pkg.packageId)) {
        packages.push(pkg);
      }
    }

    // Sort by installation order
    return packages.sort((a, b) => a.order - b.order);
  } catch (error) {
    console.error('Error fetching bootstrap packages:', error);
    return []; // Return empty array if bootstrap table doesn't exist yet
  }
}

function generateUserDataScript(request: LaunchWorkstationRequest, workstationId: string, packages: BootstrapPackage[], adminPassword?: string): string {
  // Generate package installation commands - handle database structure where installArgs contains full command
  const packageInstallCommands = packages.map(pkg => {
    const fileName = pkg.downloadUrl.split('/').pop() || 'download.exe';
    const downloadPath = `C:\\\\Temp\\\\${fileName}`;
    
    if (pkg.downloadUrl === 'none') {
      return `try { ${pkg.installArgs || pkg.installCommand} } catch { }`;
    }
    
    // Replace INSTALLER_PATH placeholder in installArgs with actual download path
    let installArgs = pkg.installArgs ? pkg.installArgs.replace(/INSTALLER_PATH/g, downloadPath) : '';
    
    // For msiexec commands, the installArgs should be quoted as a single string
    if (pkg.installCommand && pkg.installCommand.includes('msiexec') && installArgs && !installArgs.startsWith('"')) {
      installArgs = `"${installArgs}"`;
    }
    
    return `
try {
  Invoke-WebRequest -Uri "${pkg.downloadUrl}" -OutFile "${downloadPath}" -UseBasicParsing
  ${pkg.installCommand} ${installArgs}
  if (Test-Path "${downloadPath}") { Remove-Item "${downloadPath}" -Force }
} catch { }`;
  }).join('\n');

  const authConfig = request.authMethod === 'domain'
    ? ``
    : `$u="${request.localAdminConfig?.username || 'Administrator'}";$p=ConvertTo-SecureString "${adminPassword}" -AsPlainText -Force;Set-LocalUser -Name $u -Password $p;Enable-LocalUser -Name $u -EA SilentlyContinue`;

  const script = `<powershell>
$ErrorActionPreference="Continue";if(-not(Test-Path "C:\\\\Temp")){New-Item -ItemType Directory -Path "C:\\\\Temp" -Force};Start-Transcript -Path "C:\\\\WorkstationSetup.log" -Append
Set-ItemProperty -Path 'HKLM:\\\\System\\\\CurrentControlSet\\\\Control\\\\Terminal Server' -name "fDenyTSConnections" -value 0;Enable-NetFirewallRule -DisplayGroup "Remote Desktop";Set-Service -Name 'Audiosrv' -StartupType Automatic;Start-Service Audiosrv -EA SilentlyContinue;powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c
$ak="HKLM:\\\\SOFTWARE\\\\Microsoft\\\\Active Setup\\\\Installed Components\\\\{A509B1A7-37EF-4b3f-8CFC-4F3A74704073}";$uk="HKLM:\\\\SOFTWARE\\\\Microsoft\\\\Active Setup\\\\Installed Components\\\\{A509B1A8-37EF-4b3f-8CFC-4F3A74704073}";Set-ItemProperty -Path $ak -Name "IsInstalled" -Value 0 -EA SilentlyContinue;Set-ItemProperty -Path $uk -Name "IsInstalled" -Value 0 -EA SilentlyContinue
try{$au="https://s3.amazonaws.com/amazoncloudwatch-agent/windows/amd64/latest/amazon-cloudwatch-agent.msi";$ap="C:\\\\Temp\\\\amazon-cloudwatch-agent.msi";Invoke-WebRequest -Uri $au -OutFile $ap -UseBasicParsing;Start-Process msiexec.exe -ArgumentList "/i $ap /quiet /norestart" -Wait}catch{}
${authConfig}
${packageInstallCommands}
if(Test-Path "C:\\\\Program Files\\\\NICE\\\\DCV\\\\Server\\\\bin\\\\dcv.exe"){$d="C:\\\\Program Files\\\\NICE\\\\DCV\\\\Server\\\\bin\\\\dcv.exe";try{& $d set-config connectivity.enable-quic-frontend true;& $d set-config connectivity.quic-port 8443;& $d set-config security.authentication system;& $d set-config session-management.create-session true;& $d set-config session-management.automatic-console-session true;New-NetFirewallRule -DisplayName "DCV TCP" -Direction Inbound -LocalPort 8443 -Protocol TCP -Action Allow -EA SilentlyContinue;New-NetFirewallRule -DisplayName "DCV UDP" -Direction Inbound -LocalPort 8443 -Protocol UDP -Action Allow -EA SilentlyContinue;Restart-Service dcvserver -EA SilentlyContinue;& $d create-session console-session --type console}catch{}}
@{WorkstationId="${workstationId}";Status="Ready";Timestamp=(Get-Date).ToString("o");Packages=${packages.length}}|ConvertTo-Json|Out-File "C:\\\\WorkstationSetup-Complete.json" -Encoding UTF8;Stop-Transcript
</powershell>`;

  return script;
}

async function createLocalAdminCredentials(workstationId: string, username: string): Promise<{ arn: string; password: string }> {
  const password = generateSecurePassword();
  
  const secretName = `workstation/${workstationId}/local-admin`;
  const secretValue = {
    username,
    password,
    type: 'local-admin',
  };

  const createCommand = new CreateSecretCommand({
    Name: secretName,
    SecretString: JSON.stringify(secretValue),
    Description: `Local admin credentials for workstation ${workstationId}`,
    Tags: [
      { Key: 'WorkstationId', Value: workstationId },
      { Key: 'Type', Value: 'LocalAdmin' },
    ],
  });

  const result = await secretsClient.send(createCommand);
  return {
    arn: result.ARN || '',
    password: password
  };
}

function generateSecurePassword(length: number = 16): string {
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowercase = 'abcdefghjkmnpqrstuvwxyz';
  const numbers = '23456789';
  const special = '!@#$%^&*';
  
  const allChars = uppercase + lowercase + numbers + special;
  const crypto = require('crypto');
  
  // Ensure at least one of each type
  const randomBytes = crypto.randomBytes(length);
  let password = '';
  password += uppercase[randomBytes[0] % uppercase.length];
  password += lowercase[randomBytes[1] % lowercase.length];
  password += numbers[randomBytes[2] % numbers.length];
  password += special[randomBytes[3] % special.length];
  
  for (let i = 4; i < length; i++) {
    password += allChars[randomBytes[i] % allChars.length];
  }
  
  // Shuffle the password using Fisher-Yates
  const arr = password.split('');
  const shuffleBytes = crypto.randomBytes(arr.length);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = shuffleBytes[i] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  
  return arr.join('');
}

function getInstanceHourlyCost(instanceType: string): number {
  const costs: Record<string, number> = {
    'g4dn.xlarge': 0.526,
    'g4dn.2xlarge': 0.752,
    'g4dn.4xlarge': 1.204,
    'g5.xlarge': 1.006,
    'g5.2xlarge': 1.212,
    'g5.4xlarge': 2.03,
    'g6.xlarge': 0.7125,
    'g6.2xlarge': 1.425,
    'g6.4xlarge': 2.85,
  };
  
  return costs[instanceType] || 1.0;
}

function mapEC2StatusToWorkstationStatus(ec2Status: string): WorkstationRecord['status'] {
  const statusMap: Record<string, WorkstationRecord['status']> = {
    'pending': 'launching',
    'running': 'running',
    'stopping': 'stopping',
    'stopped': 'stopped',
    'shutting-down': 'stopping',
    'terminated': 'terminated',
  };
  
  return statusMap[ec2Status] || 'launching';
}

async function getUserIpAddress(event: APIGatewayProxyEvent): Promise<string | null> {
  // Try to get IP from various headers (API Gateway, CloudFront, direct)
  const sourceIp = event.requestContext?.identity?.sourceIp;
  const xForwardedFor = event.headers?.['X-Forwarded-For'] || event.headers?.['x-forwarded-for'];
  const xRealIp = event.headers?.['X-Real-IP'] || event.headers?.['x-real-ip'];
  
  // X-Forwarded-For can contain multiple IPs, take the first one (original client)
  if (xForwardedFor) {
    const ips = xForwardedFor.split(',');
    return ips[0].trim();
  }
  
  if (xRealIp) {
    return xRealIp;
  }
  
  if (sourceIp) {
    return sourceIp;
  }
  
  return null;
}

async function addIpToSecurityGroup(groupId: string, ipAddress: string, description: string): Promise<void> {
  try {
    // Normalize IP address - add /32 if not already CIDR notation
    const cidrIp = ipAddress.includes('/') ? ipAddress : `${ipAddress}/32`;
    
    // Add both RDP and DCV ports to support both protocols
    const portsToAdd = [
      { port: 3389, protocol: 'tcp', description: 'RDP' },
      { port: 8443, protocol: 'tcp', description: 'DCV HTTPS' },
      { port: 8443, protocol: 'udp', description: 'DCV QUIC' }
    ];
    
    for (const portConfig of portsToAdd) {
      try {
        const command = new AuthorizeSecurityGroupIngressCommand({
          GroupId: groupId,
          IpPermissions: [{
            IpProtocol: portConfig.protocol,
            FromPort: portConfig.port,
            ToPort: portConfig.port,
            IpRanges: [{
              CidrIp: cidrIp,
              Description: `${description} - ${portConfig.description}`,
            }],
          }],
        });
        
        await ec2Client.send(command);
        console.log(`Added ${portConfig.description} rule (${portConfig.protocol}:${portConfig.port}) for ${cidrIp} to security group ${groupId}`);
      } catch (error: any) {
        // If rule already exists, that's okay
        if (error.name === 'InvalidPermission.Duplicate') {
          console.log(`${portConfig.description} rule for ${ipAddress} already exists in security group ${groupId}`);
          continue;
        }
        // Log error but continue with other ports
        console.warn(`Failed to add ${portConfig.description} rule:`, error.message);
      }
    }
  } catch (error: any) {
    console.error('Error adding IP to security group:', error);
    throw error;
  }
}