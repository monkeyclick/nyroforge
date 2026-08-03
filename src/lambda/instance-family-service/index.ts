import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { SSMClient } from '@aws-sdk/client-ssm';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { logEvent } from '../shared/logging';
import { corsHeaders } from '../shared/http';
import { getGroups, ADMIN_GROUP } from '../shared/auth';
import { DEFAULT_INSTANCE_TYPES, saveAllowedInstanceFamilies } from '../shared/instanceFamilies';

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({});
const ssmClient = new SSMClient({});

// Environment variables
const WORKSTATIONS_TABLE = process.env.WORKSTATIONS_TABLE_NAME!;
const USERS_TABLE = process.env.USERS_TABLE!;
const ROLES_TABLE = process.env.ROLES_TABLE!;
const GROUPS_TABLE = process.env.GROUPS_TABLE!;

// CORS headers
const CORS_HEADERS = corsHeaders();

// Types
type Permission =
  | 'workstations:create'
  | 'workstations:read'
  | 'workstations:update'
  | 'workstations:delete'
  | 'workstations:manage-all'
  | 'system:admin';

interface EnhancedUser {
  userId: string;
  email: string;
  roleIds: string[];
  groupIds: string[];
  directPermissions: Permission[];
}

interface Role {
  roleId: string;
  name: string;
  permissions: Permission[];
}

interface Group {
  groupId: string;
  name: string;
  roleIds: string[];
  permissions: Permission[];
}

interface InstanceFamilyConfig {
  PK: string;
  SK: string;
  allowedFamilies: string[];
  allowedTypes: Record<string, string[]>;
  updatedAt: string;
  updatedBy: string;
  createdAt: string;
}

interface SaveConfigRequest {
  allowedFamilies: string[];
  allowedTypes?: Record<string, string[]>;
}

// Permission checking functions
async function getUserPermissions(userId: string): Promise<Permission[]> {
  console.log(`[getUserPermissions] Fetching permissions for user: ${userId}`);
  
  try {
    const userResult = await dynamoClient.send(new GetItemCommand({
      TableName: USERS_TABLE,
      Key: marshall({ id: userId }),
    }));

    if (!userResult.Item) {
      console.log(`[getUserPermissions] User not found in Users table: ${userId}`);
      return [];
    }

    const user = unmarshall(userResult.Item) as EnhancedUser;
    const permissions = new Set<Permission>(user.directPermissions || []);

    // Get permissions from roles
    for (const roleId of user.roleIds || []) {
      const roleResult = await dynamoClient.send(new GetItemCommand({
        TableName: ROLES_TABLE,
        Key: marshall({ id: roleId }),
      }));

      if (roleResult.Item) {
        const role = unmarshall(roleResult.Item) as Role;
        role.permissions.forEach(p => permissions.add(p as Permission));
      }
    }

    // Get permissions from groups
    for (const groupId of user.groupIds || []) {
      const groupResult = await dynamoClient.send(new GetItemCommand({
        TableName: GROUPS_TABLE,
        Key: marshall({ id: groupId }),
      }));

      if (groupResult.Item) {
        const group = unmarshall(groupResult.Item) as Group;
        (group.permissions || []).forEach(p => permissions.add(p as Permission));

        for (const roleId of group.roleIds || []) {
          const roleResult = await dynamoClient.send(new GetItemCommand({
            TableName: ROLES_TABLE,
            Key: marshall({ id: roleId }),
          }));

          if (roleResult.Item) {
            const role = unmarshall(roleResult.Item) as Role;
            role.permissions.forEach(p => permissions.add(p as Permission));
          }
        }
      }
    }

    return Array.from(permissions);
  } catch (error) {
    console.error('[getUserPermissions] Error getting user permissions:', error);
    return [];
  }
}

async function hasPermission(userId: string, permission: Permission, cognitoGroups?: string[]): Promise<boolean> {
  // If user is in Cognito admin group (either 'admin' or 'workstation-admin'), they have all permissions
  if (cognitoGroups && (cognitoGroups.includes('admin') || cognitoGroups.includes(ADMIN_GROUP))) {
    console.log(`[hasPermission] User ${userId} is in Cognito admin group - granting permission`);
    return true;
  }

  // Cognito group membership is the authoritative admin signal. The legacy
  // DynamoDB permission fallback (getUserPermissions + 'system:admin') was
  // removed so a stale role/group record cannot grant admin-only instance
  // family management after the user leaves the Cognito admin group.
  return false;
}

// Get instance family configuration
async function getInstanceFamilyConfig(): Promise<InstanceFamilyConfig | null> {
  try {
    const result = await dynamoClient.send(new GetItemCommand({
      TableName: WORKSTATIONS_TABLE,
      Key: marshall({
        PK: 'CONFIG#INSTANCE_FAMILIES',
        SK: 'METADATA',
      }),
    }));

    if (result.Item) {
      return unmarshall(result.Item) as InstanceFamilyConfig;
    }
    return null;
  } catch (error) {
    console.error('Error getting instance family config:', error);
    return null;
  }
}

// Save instance family configuration
async function saveInstanceFamilyConfig(
  request: SaveConfigRequest,
  userId: string
): Promise<APIGatewayProxyResult> {
  console.log('\n--- saveInstanceFamilyConfig Started ---');
  console.log('Request:', JSON.stringify(request, null, 2));

  try {
    const timestamp = new Date().toISOString();
    
    // Get existing config to preserve createdAt
    const existingConfig = await getInstanceFamilyConfig();
    
    // If allowedTypes is empty or not provided, auto-generate from allowed families
    let allowedTypes = request.allowedTypes || {};
    if (Object.keys(allowedTypes).length === 0 && request.allowedFamilies.length > 0) {
      console.log('Auto-generating allowedTypes from allowed families...');
      allowedTypes = {};
      for (const family of request.allowedFamilies) {
        const familyTypes = DEFAULT_INSTANCE_TYPES[family];
        if (familyTypes) {
          allowedTypes[family] = familyTypes;
        }
      }
      console.log('Generated allowedTypes:', JSON.stringify(allowedTypes, null, 2));
    }
    
    const configRecord: InstanceFamilyConfig = {
      PK: 'CONFIG#INSTANCE_FAMILIES',
      SK: 'METADATA',
      allowedFamilies: request.allowedFamilies,
      allowedTypes: allowedTypes,
      updatedAt: timestamp,
      updatedBy: userId,
      createdAt: existingConfig?.createdAt || timestamp,
    };

    await dynamoClient.send(new PutItemCommand({
      TableName: WORKSTATIONS_TABLE,
      Item: marshall(configRecord),
    }));

    // Publish the FAMILY list to SSM for config-service/ec2-management to read
    // (via shared getAllowedInstanceTypes, which expands it back to concrete
    // types). A failure here is NOT swallowed: the DynamoDB write above is the
    // audit-trail source of truth, but SSM is what actually makes the change
    // live for the launch wizard, so if it fails the admin needs to know the
    // save didn't fully take effect rather than being told it succeeded.
    console.log(`Writing ${request.allowedFamilies.length} allowed families to SSM parameter`);
    try {
      await saveAllowedInstanceFamilies(ssmClient, request.allowedFamilies);
      console.log('✅ Updated SSM parameter with allowed families:', request.allowedFamilies.slice(0, 10), '...');
    } catch (ssmError) {
      console.error('❌ Could not publish allowed families to SSM (launch wizard will not reflect this change):', ssmError);
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          message: 'Your selection was recorded, but could not be published for the launch wizard to use. Please try saving again.',
          config: {
            allowedFamilies: request.allowedFamilies,
            allowedTypes: allowedTypes,
            updatedAt: timestamp,
            updatedBy: userId,
          },
        }),
      };
    }

    console.log('=== saveInstanceFamilyConfig Completed Successfully ===\n');

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: 'Instance family configuration saved successfully',
        config: {
          allowedFamilies: request.allowedFamilies,
          allowedTypes: allowedTypes,
          updatedAt: timestamp,
          updatedBy: userId,
        },
        instanceTypesCount: Object.values(allowedTypes).flat().length,
      }),
    };
  } catch (error) {
    console.error('❌ Error saving instance family config:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: 'Failed to save instance family configuration',
      }),
    };
  }
}

// Get allowed instance types for validation
async function getAllowedInstanceTypes(): Promise<APIGatewayProxyResult> {
  console.log('\n--- getAllowedInstanceTypes ---');

  try {
    const config = await getInstanceFamilyConfig();
    
    if (!config) {
      // Return default configuration
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          config: null,
          message: 'No configuration found, using defaults',
          defaults: {
            allowedFamilies: ['g4dn', 'g5', 'g6'],
            allowedTypes: {
              'g4dn': ['g4dn.xlarge', 'g4dn.2xlarge', 'g4dn.4xlarge'],
              'g5': ['g5.xlarge', 'g5.2xlarge', 'g5.4xlarge'],
              'g6': ['g6.xlarge', 'g6.2xlarge', 'g6.4xlarge'],
            },
          },
        }),
      };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        config: {
          allowedFamilies: config.allowedFamilies,
          allowedTypes: config.allowedTypes,
          updatedAt: config.updatedAt,
          updatedBy: config.updatedBy,
        },
      }),
    };
  } catch (error) {
    console.error('❌ Error getting allowed instance types:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: 'Failed to get instance family configuration',
      }),
    };
  }
}

// Validate if an instance type is allowed
async function validateInstanceType(instanceType: string): Promise<{ allowed: boolean; reason?: string }> {
  const config = await getInstanceFamilyConfig();
  
  if (!config) {
    // If no config exists, use defaults
    const defaultTypes = ['g4dn.xlarge', 'g4dn.2xlarge', 'g4dn.4xlarge', 'g5.xlarge', 'g5.2xlarge', 'g5.4xlarge', 'g6.xlarge', 'g6.2xlarge', 'g6.4xlarge'];
    return {
      allowed: defaultTypes.includes(instanceType),
      reason: defaultTypes.includes(instanceType) ? undefined : 'Instance type not in default allowed list',
    };
  }

  // Check if type is in any allowed family
  for (const family of config.allowedFamilies) {
    const familyTypes = config.allowedTypes[family] || [];
    if (familyTypes.includes(instanceType)) {
      return { allowed: true };
    }
  }

  return {
    allowed: false,
    reason: `Instance type ${instanceType} is not in the allowed list. Contact your administrator.`,
  };
}

// Main handler
export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  console.log('='.repeat(80));
  console.log('=== Instance Family Service Handler Started ===');
  console.log('='.repeat(80));
  console.log('Request ID:', context.awsRequestId);
  logEvent(event);

  try {
    const { httpMethod, path, body, requestContext } = event;
    const userId = requestContext.authorizer?.claims?.email || 
                   requestContext.authorizer?.claims?.sub || 
                   requestContext.authorizer?.claims?.['cognito:username'] ||
                   'unknown';

    // Extract Cognito groups from JWT claims (shared, handles array/CSV/single-value claims)
    const cognitoGroups = getGroups(event);

    console.log('UserId:', userId);
    console.log('Cognito Groups:', cognitoGroups);
    console.log('Path:', path);
    console.log('Method:', httpMethod);

    // Check admin permission for all operations
    if (!(await hasPermission(userId, 'workstations:manage-all', cognitoGroups))) {
      console.log('❌ Access denied - requires admin permission');
      return {
        statusCode: 403,
        headers: CORS_HEADERS,
        body: JSON.stringify({ message: 'Admin access required' }),
      };
    }

    // Route handling
    if (httpMethod === 'GET') {
      return await getAllowedInstanceTypes();
    }

    if (httpMethod === 'POST') {
      let request: SaveConfigRequest;
      try {
        request = JSON.parse(body || '{}') as SaveConfigRequest;
      } catch {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ message: 'Request body is not valid JSON' }),
        };
      }
      return await saveInstanceFamilyConfig(request, userId);
    }

    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: 'Invalid request', path, method: httpMethod }),
    };
  } catch (error) {
    console.error('='.repeat(80));
    console.error('❌ FATAL ERROR in handler');
    console.error('='.repeat(80));
    console.error('Error:', error);

    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: 'Internal server error',
      }),
    };
  }
};

// Export validation function for use by other services
export { validateInstanceType, getInstanceFamilyConfig };