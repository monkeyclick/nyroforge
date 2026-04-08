import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { EC2Client, DescribeInstancesCommand, DescribeInstanceTypesCommand, Instance, Filter } from '@aws-sdk/client-ec2';
import { DynamoDBClient, PutItemCommand, GetItemCommand, ScanCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { v4 as uuidv4 } from 'uuid';

// Initialize AWS clients
const ec2Client = new EC2Client({});
const dynamoClient = new DynamoDBClient({});

// Environment variables
const WORKSTATIONS_TABLE = process.env.WORKSTATIONS_TABLE_NAME!;
const USERS_TABLE = process.env.USERS_TABLE!;
const ROLES_TABLE = process.env.ROLES_TABLE!;
const GROUPS_TABLE = process.env.GROUPS_TABLE!;
const AUDIT_LOGS_TABLE = process.env.AUDIT_TABLE!;
const VPC_ID = process.env.VPC_ID!;

// Types
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

interface DiscoverRequest {
  searchType: 'name' | 'family' | 'type' | 'all';
  searchValue?: string;
  page?: number;
  pageSize?: number;
  filters?: {
    states?: string[];
    vpcId?: string;
    excludeManaged?: boolean;
    scopeFilter?: 'all' | 'in-scope' | 'out-of-scope' | 'unassigned';
  };
}

interface ScopeRequest {
  instanceIds: string[];
  scope: 'in-scope' | 'out-of-scope';
  assignToUserId?: string;
}

interface ScopeStatusRequest {
  page?: number;
  pageSize?: number;
  scopeFilter?: 'all' | 'in-scope' | 'out-of-scope' | 'unassigned';
  states?: string[];
  searchValue?: string;
}

interface ImportRequest {
  instances: {
    instanceId: string;
    assignToUserId?: string;
    tags?: Record<string, string>;
  }[];
}

interface DiscoveredInstance {
  instanceId: string;
  name: string;
  instanceType: string;
  instanceFamily: string;
  state: string;
  publicIp?: string;
  privateIp?: string;
  vpcId?: string;
  subnetId?: string;
  availabilityZone?: string;
  launchTime?: string;
  platform?: string;
  tags: Record<string, string>;
  isManaged: boolean;
  workstationId?: string;
  scope: 'in-scope' | 'out-of-scope' | 'unassigned';
  scopeSetAt?: string;
  scopeSetBy?: string;
}

// Excluded instances record in DynamoDB
interface ExcludedInstance {
  instanceId: string;
  excludedAt: string;
  excludedBy: string;
  reason?: string;
}

// Instance family definitions for search
const INSTANCE_FAMILIES: Record<string, { name: string; description: string; types: string[] }> = {
  'c5': { name: 'C5 (Compute Optimized)', description: 'Intel Xeon compute optimized', types: ['c5.large', 'c5.xlarge', 'c5.2xlarge', 'c5.4xlarge', 'c5.9xlarge', 'c5.12xlarge', 'c5.18xlarge', 'c5.24xlarge'] },
  'c6i': { name: 'C6i (Compute Optimized)', description: '3rd gen Intel Xeon compute optimized', types: ['c6i.large', 'c6i.xlarge', 'c6i.2xlarge', 'c6i.4xlarge', 'c6i.8xlarge', 'c6i.12xlarge', 'c6i.16xlarge', 'c6i.24xlarge', 'c6i.32xlarge'] },
  'm5': { name: 'M5 (General Purpose)', description: 'Intel Xeon general purpose', types: ['m5.large', 'm5.xlarge', 'm5.2xlarge', 'm5.4xlarge', 'm5.8xlarge', 'm5.12xlarge', 'm5.16xlarge', 'm5.24xlarge'] },
  'm6i': { name: 'M6i (General Purpose)', description: '3rd gen Intel Xeon general purpose', types: ['m6i.large', 'm6i.xlarge', 'm6i.2xlarge', 'm6i.4xlarge', 'm6i.8xlarge', 'm6i.12xlarge', 'm6i.16xlarge', 'm6i.24xlarge', 'm6i.32xlarge'] },
  'r5': { name: 'R5 (Memory Optimized)', description: 'Intel Xeon memory optimized', types: ['r5.large', 'r5.xlarge', 'r5.2xlarge', 'r5.4xlarge', 'r5.8xlarge', 'r5.12xlarge', 'r5.16xlarge', 'r5.24xlarge'] },
  'r6i': { name: 'R6i (Memory Optimized)', description: '3rd gen Intel Xeon memory optimized', types: ['r6i.large', 'r6i.xlarge', 'r6i.2xlarge', 'r6i.4xlarge', 'r6i.8xlarge', 'r6i.12xlarge', 'r6i.16xlarge', 'r6i.24xlarge', 'r6i.32xlarge'] },
  'g4dn': { name: 'G4dn (GPU - NVIDIA T4)', description: 'NVIDIA T4 GPU instances', types: ['g4dn.xlarge', 'g4dn.2xlarge', 'g4dn.4xlarge', 'g4dn.8xlarge', 'g4dn.12xlarge', 'g4dn.16xlarge'] },
  'g5': { name: 'G5 (GPU - NVIDIA A10G)', description: 'NVIDIA A10G GPU instances', types: ['g5.xlarge', 'g5.2xlarge', 'g5.4xlarge', 'g5.8xlarge', 'g5.12xlarge', 'g5.16xlarge', 'g5.24xlarge', 'g5.48xlarge'] },
  'g6': { name: 'G6 (GPU - NVIDIA L4)', description: 'NVIDIA L4 GPU instances', types: ['g6.xlarge', 'g6.2xlarge', 'g6.4xlarge', 'g6.8xlarge', 'g6.12xlarge', 'g6.16xlarge', 'g6.24xlarge', 'g6.48xlarge'] },
  'p4d': { name: 'P4d (GPU - NVIDIA A100)', description: 'NVIDIA A100 GPU instances', types: ['p4d.24xlarge'] },
  'p5': { name: 'P5 (GPU - NVIDIA H100)', description: 'NVIDIA H100 GPU instances', types: ['p5.48xlarge'] },
  't3': { name: 'T3 (Burstable)', description: 'Intel Xeon burstable', types: ['t3.micro', 't3.small', 't3.medium', 't3.large', 't3.xlarge', 't3.2xlarge'] },
  't3a': { name: 'T3a (Burstable AMD)', description: 'AMD EPYC burstable', types: ['t3a.micro', 't3a.small', 't3a.medium', 't3a.large', 't3a.xlarge', 't3a.2xlarge'] },
  'i3': { name: 'I3 (Storage Optimized)', description: 'NVMe SSD storage optimized', types: ['i3.large', 'i3.xlarge', 'i3.2xlarge', 'i3.4xlarge', 'i3.8xlarge', 'i3.16xlarge'] },
  'i4i': { name: 'I4i (Storage Optimized)', description: 'Intel Ice Lake with NVMe storage', types: ['i4i.large', 'i4i.xlarge', 'i4i.2xlarge', 'i4i.4xlarge', 'i4i.8xlarge', 'i4i.16xlarge', 'i4i.32xlarge'] },
};

// CORS headers
const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
};

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
      return ['workstations:read', 'workstations:create', 'workstations:update', 'workstations:delete'];
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
        role.permissions.forEach(p => permissions.add(p));
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
        group.permissions.forEach(p => permissions.add(p));

        for (const roleId of group.roleIds || []) {
          const roleResult = await dynamoClient.send(new GetItemCommand({
            TableName: ROLES_TABLE,
            Key: marshall({ id: roleId }),
          }));

          if (roleResult.Item) {
            const role = unmarshall(roleResult.Item) as Role;
            role.permissions.forEach(p => permissions.add(p));
          }
        }
      }
    }

    return Array.from(permissions);
  } catch (error) {
    console.error('[getUserPermissions] Error getting user permissions:', error);
    return ['workstations:read', 'workstations:create', 'workstations:update', 'workstations:delete'];
  }
}

async function hasPermission(userId: string, permission: Permission, cognitoGroups?: string[]): Promise<boolean> {
  // If user is in Cognito admin group (either 'admin' or 'workstation-admin'), they have all permissions
  if (cognitoGroups && (cognitoGroups.includes('admin') || cognitoGroups.includes('workstation-admin'))) {
    console.log(`[hasPermission] User ${userId} is in Cognito admin group (${cognitoGroups.join(', ')}) - granting permission`);
    return true;
  }
  
  const permissions = await getUserPermissions(userId);
  return permissions.includes(permission) || permissions.includes('system:admin');
}

async function logAuditEvent(userId: string, action: string, resourceType: string, resourceId: string, details?: any): Promise<void> {
  try {
    const timestamp = new Date().toISOString();
    const auditLog = {
      id: userId,
      timestamp,
      auditId: uuidv4(),
      action,
      resourceType,
      resourceId,
      details: details ? JSON.stringify(details) : undefined,
      ipAddress: 'unknown',
    };

    await dynamoClient.send(new PutItemCommand({
      TableName: AUDIT_LOGS_TABLE,
      Item: marshall(auditLog),
    }));
  } catch (error) {
    console.error('[logAuditEvent] Error logging audit event:', error);
  }
}

// Get managed instance IDs from DynamoDB
async function getManagedInstanceIds(): Promise<Map<string, { workstationId: string; userId: string }>> {
  try {
    const scanResult = await dynamoClient.send(new ScanCommand({
      TableName: WORKSTATIONS_TABLE,
      FilterExpression: 'begins_with(PK, :pk)',
      ExpressionAttributeValues: marshall({
        ':pk': 'WORKSTATION#',
      }),
      ProjectionExpression: 'instanceId, PK, userId',
    }));

    const instanceMap = new Map<string, { workstationId: string; userId: string }>();
    (scanResult.Items || []).forEach(item => {
      const record = unmarshall(item);
      if (record.instanceId) {
        const workstationId = record.PK?.replace('WORKSTATION#', '') || '';
        instanceMap.set(record.instanceId, {
          workstationId,
          userId: record.userId || 'unknown',
        });
      }
    });

    return instanceMap;
  } catch (error) {
    console.error('Error fetching managed instance IDs:', error);
    return new Map();
  }
}

// Get excluded instance IDs from DynamoDB
async function getExcludedInstances(): Promise<Map<string, ExcludedInstance>> {
  try {
    const scanResult = await dynamoClient.send(new ScanCommand({
      TableName: WORKSTATIONS_TABLE,
      FilterExpression: 'begins_with(PK, :pk)',
      ExpressionAttributeValues: marshall({
        ':pk': 'EXCLUDED#',
      }),
    }));

    const excludedMap = new Map<string, ExcludedInstance>();
    (scanResult.Items || []).forEach(item => {
      const record = unmarshall(item);
      const instanceId = record.PK?.replace('EXCLUDED#', '') || '';
      if (instanceId) {
        excludedMap.set(instanceId, {
          instanceId,
          excludedAt: record.excludedAt,
          excludedBy: record.excludedBy,
          reason: record.reason,
        });
      }
    });

    return excludedMap;
  } catch (error) {
    console.error('Error fetching excluded instances:', error);
    return new Map();
  }
}

// Set instance as excluded (out of scope)
async function setInstanceExcluded(instanceId: string, userId: string, reason?: string): Promise<void> {
  const timestamp = new Date().toISOString();
  
  await dynamoClient.send(new PutItemCommand({
    TableName: WORKSTATIONS_TABLE,
    Item: marshall({
      PK: `EXCLUDED#${instanceId}`,
      SK: 'METADATA',
      instanceId,
      excludedAt: timestamp,
      excludedBy: userId,
      reason: reason || 'Manually excluded by admin',
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  }));
}

// Remove instance from excluded list
async function removeInstanceFromExcluded(instanceId: string): Promise<void> {
  const { DeleteItemCommand } = await import('@aws-sdk/client-dynamodb');
  
  await dynamoClient.send(new DeleteItemCommand({
    TableName: WORKSTATIONS_TABLE,
    Key: marshall({
      PK: `EXCLUDED#${instanceId}`,
      SK: 'METADATA',
    }),
  }));
}

// Extract instance family from instance type
function getInstanceFamily(instanceType: string): string {
  const match = instanceType.match(/^([a-z]+\d+[a-z]*)/);
  return match ? match[1] : instanceType.split('.')[0];
}

// Convert EC2 instance to discovered instance format
function toDiscoveredInstance(
  instance: Instance,
  managedInstances: Map<string, { workstationId: string; userId: string }>,
  excludedInstances: Map<string, ExcludedInstance>
): DiscoveredInstance {
  const tags: Record<string, string> = {};
  (instance.Tags || []).forEach(tag => {
    if (tag.Key && tag.Value) {
      tags[tag.Key] = tag.Value;
    }
  });

  const instanceType = instance.InstanceType || 'unknown';
  const instanceId = instance.InstanceId || '';
  const managedInfo = managedInstances.get(instanceId);
  const excludedInfo = excludedInstances.get(instanceId);
  const isManaged = !!managedInfo;
  const isExcluded = !!excludedInfo;
  
  // Determine scope
  let scope: 'in-scope' | 'out-of-scope' | 'unassigned' = 'unassigned';
  let scopeSetAt: string | undefined;
  let scopeSetBy: string | undefined;
  
  if (isManaged) {
    scope = 'in-scope';
    scopeSetBy = managedInfo.userId;
  } else if (isExcluded) {
    scope = 'out-of-scope';
    scopeSetAt = excludedInfo.excludedAt;
    scopeSetBy = excludedInfo.excludedBy;
  }
  
  return {
    instanceId,
    name: tags['Name'] || instanceId,
    instanceType,
    instanceFamily: getInstanceFamily(instanceType),
    state: instance.State?.Name || 'unknown',
    publicIp: instance.PublicIpAddress,
    privateIp: instance.PrivateIpAddress,
    vpcId: instance.VpcId,
    subnetId: instance.SubnetId,
    availabilityZone: instance.Placement?.AvailabilityZone,
    launchTime: instance.LaunchTime?.toISOString(),
    platform: instance.Platform || 'linux',
    tags,
    isManaged,
    workstationId: managedInfo?.workstationId || tags['WorkstationId'],
    scope,
    scopeSetAt,
    scopeSetBy,
  };
}

// Discover EC2 instances
async function discoverInstances(request: DiscoverRequest, userId: string): Promise<APIGatewayProxyResult> {
  console.log('\n--- discoverInstances Started ---');
  console.log('Request:', JSON.stringify(request, null, 2));

  try {
    const { searchType, searchValue, page = 1, pageSize = 25, filters = {} } = request;
    const { states = ['running', 'stopped', 'pending', 'stopping'], vpcId, excludeManaged = true, scopeFilter = 'all' } = filters;

    // Build EC2 filters
    const ec2Filters: Filter[] = [
      { Name: 'instance-state-name', Values: states },
    ];

    // Filter by VPC if specified
    if (vpcId) {
      ec2Filters.push({ Name: 'vpc-id', Values: [vpcId] });
    }

    // Filter by search criteria
    if (searchType === 'name' && searchValue) {
      ec2Filters.push({ Name: 'tag:Name', Values: [`*${searchValue}*`] });
    } else if (searchType === 'type' && searchValue) {
      // Support wildcards like g4dn.* or *.xlarge
      const typePattern = searchValue.replace(/\*/g, '').trim();
      if (typePattern) {
        ec2Filters.push({ Name: 'instance-type', Values: [searchValue.includes('*') ? searchValue : `*${searchValue}*`] });
      }
    } else if (searchType === 'family' && searchValue) {
      // Get all instance types for this family
      const familyInfo = INSTANCE_FAMILIES[searchValue.toLowerCase()];
      if (familyInfo) {
        ec2Filters.push({ Name: 'instance-type', Values: familyInfo.types });
      } else {
        // Try prefix match
        ec2Filters.push({ Name: 'instance-type', Values: [`${searchValue}.*`] });
      }
    }

    console.log('EC2 Filters:', JSON.stringify(ec2Filters, null, 2));

    // Get managed and excluded instance IDs
    const managedInstances = await getManagedInstanceIds();
    const excludedInstances = await getExcludedInstances();
    console.log(`Found ${managedInstances.size} managed instances, ${excludedInstances.size} excluded instances`);

    // Describe EC2 instances
    const describeCommand = new DescribeInstancesCommand({
      Filters: ec2Filters,
      MaxResults: 1000, // Get more results to handle pagination
    });

    const ec2Result = await ec2Client.send(describeCommand);
    let instances = ec2Result.Reservations?.flatMap(r => r.Instances || []) || [];

    console.log(`Found ${instances.length} EC2 instances matching filters`);

    // Convert to discovered instance format
    let discoveredInstances = instances.map(i => toDiscoveredInstance(i, managedInstances, excludedInstances));

    // Apply post-fetch filtering for name search (EC2 tag filters don't support wildcards well)
    if (searchType === 'name' && searchValue) {
      const searchLower = searchValue.toLowerCase();
      discoveredInstances = discoveredInstances.filter(i =>
        i.name.toLowerCase().includes(searchLower) ||
        i.instanceId.toLowerCase().includes(searchLower)
      );
    }

    // Apply scope filtering
    if (scopeFilter !== 'all') {
      discoveredInstances = discoveredInstances.filter(i => i.scope === scopeFilter);
    } else if (excludeManaged) {
      // Legacy behavior: exclude managed instances when using old API
      discoveredInstances = discoveredInstances.filter(i => !i.isManaged);
    }

    // Sort by name
    discoveredInstances.sort((a, b) => a.name.localeCompare(b.name));

    // Pagination
    const totalCount = discoveredInstances.length;
    const totalPages = Math.ceil(totalCount / pageSize);
    const startIndex = (page - 1) * pageSize;
    const paginatedInstances = discoveredInstances.slice(startIndex, startIndex + pageSize);

    await logAuditEvent(userId, 'DISCOVER_INSTANCES', 'ec2', 'discover', {
      searchType,
      searchValue,
      resultCount: paginatedInstances.length,
      totalCount,
    });

    console.log('=== discoverInstances Completed Successfully ===\n');

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        instances: paginatedInstances,
        pagination: {
          page,
          pageSize,
          totalCount,
          totalPages,
          hasMore: page < totalPages,
        },
        filters: {
          searchType,
          searchValue,
          states,
          excludeManaged,
          scopeFilter,
        },
      }),
    };
  } catch (error) {
    console.error('❌ Error discovering instances:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: 'Failed to discover instances',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}

// Get all instances with their scope status (for scope management UI)
async function getInstanceScopeStatus(request: ScopeStatusRequest, userId: string): Promise<APIGatewayProxyResult> {
  console.log('\n--- getInstanceScopeStatus Started ---');
  console.log('Request:', JSON.stringify(request, null, 2));

  try {
    const { page = 1, pageSize = 50, scopeFilter = 'all', states = ['running', 'stopped'], searchValue } = request;

    // Build EC2 filters - only state filter
    const ec2Filters: Filter[] = [
      { Name: 'instance-state-name', Values: states },
    ];

    // Get managed and excluded instance IDs
    const managedInstances = await getManagedInstanceIds();
    const excludedInstances = await getExcludedInstances();
    console.log(`Found ${managedInstances.size} managed instances, ${excludedInstances.size} excluded instances`);

    // Describe EC2 instances
    const describeCommand = new DescribeInstancesCommand({
      Filters: ec2Filters,
      MaxResults: 1000,
    });

    const ec2Result = await ec2Client.send(describeCommand);
    let instances = ec2Result.Reservations?.flatMap(r => r.Instances || []) || [];

    console.log(`Found ${instances.length} EC2 instances`);

    // Convert to discovered instance format
    let discoveredInstances = instances.map(i => toDiscoveredInstance(i, managedInstances, excludedInstances));

    // Apply search filter if provided
    if (searchValue) {
      const searchLower = searchValue.toLowerCase();
      discoveredInstances = discoveredInstances.filter(i =>
        i.name.toLowerCase().includes(searchLower) ||
        i.instanceId.toLowerCase().includes(searchLower) ||
        i.instanceType.toLowerCase().includes(searchLower)
      );
    }

    // Apply scope filtering
    if (scopeFilter !== 'all') {
      discoveredInstances = discoveredInstances.filter(i => i.scope === scopeFilter);
    }

    // Sort: unassigned first, then by name
    discoveredInstances.sort((a, b) => {
      if (a.scope === 'unassigned' && b.scope !== 'unassigned') return -1;
      if (b.scope === 'unassigned' && a.scope !== 'unassigned') return 1;
      return a.name.localeCompare(b.name);
    });

    // Calculate scope summary
    const scopeSummary = {
      total: instances.length,
      inScope: discoveredInstances.filter(i => i.scope === 'in-scope').length,
      outOfScope: discoveredInstances.filter(i => i.scope === 'out-of-scope').length,
      unassigned: discoveredInstances.filter(i => i.scope === 'unassigned').length,
    };

    // Pagination
    const totalCount = discoveredInstances.length;
    const totalPages = Math.ceil(totalCount / pageSize);
    const startIndex = (page - 1) * pageSize;
    const paginatedInstances = discoveredInstances.slice(startIndex, startIndex + pageSize);

    await logAuditEvent(userId, 'GET_SCOPE_STATUS', 'ec2', 'scope', {
      scopeFilter,
      resultCount: paginatedInstances.length,
      totalCount,
      scopeSummary,
    });

    console.log('=== getInstanceScopeStatus Completed Successfully ===\n');

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        instances: paginatedInstances,
        pagination: {
          page,
          pageSize,
          totalCount,
          totalPages,
          hasMore: page < totalPages,
        },
        scopeSummary,
        filters: {
          scopeFilter,
          states,
          searchValue,
        },
      }),
    };
  } catch (error) {
    console.error('❌ Error getting scope status:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: 'Failed to get instance scope status',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}

// Set scope for instances (in-scope or out-of-scope)
async function setInstanceScope(request: ScopeRequest, userId: string): Promise<APIGatewayProxyResult> {
  console.log('\n--- setInstanceScope Started ---');
  console.log('Request:', JSON.stringify(request, null, 2));

  try {
    const { instanceIds, scope, assignToUserId } = request;

    if (!instanceIds || instanceIds.length === 0) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ message: 'No instance IDs provided' }),
      };
    }

    const results: Array<{ instanceId: string; status: string; error?: string }> = [];

    for (const instanceId of instanceIds) {
      try {
        if (scope === 'in-scope') {
          // Remove from excluded list if present
          await removeInstanceFromExcluded(instanceId);
          
          // Import as workstation (use the import function logic)
          const importResult = await importSingleInstance(instanceId, assignToUserId || userId, userId);
          results.push(importResult);
        } else if (scope === 'out-of-scope') {
          // Check if already managed
          const managedInstances = await getManagedInstanceIds();
          if (managedInstances.has(instanceId)) {
            // Cannot exclude a managed instance - need to remove from management first
            results.push({
              instanceId,
              status: 'error',
              error: 'Instance is currently managed. Remove from management before excluding.',
            });
          } else {
            // Add to excluded list
            await setInstanceExcluded(instanceId, userId);
            results.push({
              instanceId,
              status: 'excluded',
            });
          }
        }
      } catch (err) {
        console.error(`Error setting scope for ${instanceId}:`, err);
        results.push({
          instanceId,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter(r => r.status !== 'error').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    await logAuditEvent(userId, 'SET_INSTANCE_SCOPE', 'ec2', 'scope', {
      scope,
      requestedCount: instanceIds.length,
      successCount,
      errorCount,
      results,
    });

    console.log('=== setInstanceScope Completed ===\n');

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: `Updated scope for ${successCount} instance(s)`,
        summary: {
          requested: instanceIds.length,
          success: successCount,
          errors: errorCount,
        },
        results,
      }),
    };
  } catch (error) {
    console.error('❌ Error setting instance scope:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: 'Failed to set instance scope',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}

// Helper function to import a single instance
async function importSingleInstance(instanceId: string, ownerUserId: string, importedBy: string): Promise<{ instanceId: string; status: string; workstationId?: string; error?: string }> {
  try {
    // Get instance details
    const describeCommand = new DescribeInstancesCommand({
      InstanceIds: [instanceId],
    });

    const ec2Result = await ec2Client.send(describeCommand);
    const ec2Instance = ec2Result.Reservations?.[0]?.Instances?.[0];

    if (!ec2Instance) {
      return { instanceId, status: 'error', error: 'Instance not found' };
    }

    // Check if already managed
    const managedInstances = await getManagedInstanceIds();
    if (managedInstances.has(instanceId)) {
      const existing = managedInstances.get(instanceId);
      return { instanceId, status: 'already-managed', workstationId: existing?.workstationId };
    }

    // Generate workstation ID
    const workstationId = `ws-${uuidv4()}`;
    const timestamp = new Date().toISOString();

    // Extract tags
    const instanceTags: Record<string, string> = {};
    (ec2Instance.Tags || []).forEach(tag => {
      if (tag.Key && tag.Value) {
        instanceTags[tag.Key] = tag.Value;
      }
    });

    const instanceType = ec2Instance.InstanceType || 'unknown';
    const isWindows = ec2Instance.Platform === 'Windows' ||
                     instanceTags['Platform']?.toLowerCase().includes('windows') ||
                     instanceTags['OS']?.toLowerCase().includes('windows');

    const statusMap: Record<string, string> = {
      'pending': 'launching',
      'running': 'running',
      'stopping': 'stopping',
      'stopped': 'stopped',
      'shutting-down': 'stopping',
      'terminated': 'terminated',
    };
    const status = statusMap[ec2Instance.State?.Name || ''] || 'running';

    // Create workstation record
    const workstationRecord = {
      PK: `WORKSTATION#${workstationId}`,
      SK: 'METADATA',
      instanceId,
      userId: ownerUserId,
      userRole: 'user',
      region: process.env.AWS_REGION || 'us-west-2',
      availabilityZone: ec2Instance.Placement?.AvailabilityZone || '',
      instanceType,
      osVersion: isWindows ? 'Windows Server 2022' : 'Linux',
      amiId: ec2Instance.ImageId || '',
      vpcId: ec2Instance.VpcId || VPC_ID,
      subnetId: ec2Instance.SubnetId || '',
      securityGroupId: ec2Instance.SecurityGroups?.[0]?.GroupId || '',
      publicIp: ec2Instance.PublicIpAddress,
      privateIp: ec2Instance.PrivateIpAddress,
      authMethod: 'local',
      status,
      launchTime: ec2Instance.LaunchTime?.toISOString() || timestamp,
      lastStatusCheck: timestamp,
      estimatedHourlyCost: getInstanceHourlyCost(instanceType),
      estimatedMonthlyCost: getInstanceHourlyCost(instanceType) * 24 * 30,
      actualCostToDate: 0,
      tags: { ...instanceTags, WorkstationId: workstationId, UserId: ownerUserId },
      importedAt: timestamp,
      importedBy,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await dynamoClient.send(new PutItemCommand({
      TableName: WORKSTATIONS_TABLE,
      Item: marshall(workstationRecord, { removeUndefinedValues: true }),
    }));

    // Tag the EC2 instance
    const { CreateTagsCommand } = await import('@aws-sdk/client-ec2');
    await ec2Client.send(new CreateTagsCommand({
      Resources: [instanceId],
      Tags: [
        { Key: 'WorkstationId', Value: workstationId },
        { Key: 'UserId', Value: ownerUserId },
        { Key: 'ManagedBy', Value: 'ec2mgr4me' },
      ],
    }));

    // Remove from excluded list if present
    await removeInstanceFromExcluded(instanceId);

    console.log(`✅ Imported instance ${instanceId} as workstation ${workstationId}`);
    return { instanceId, status: 'imported', workstationId };
  } catch (error) {
    console.error(`Error importing instance ${instanceId}:`, error);
    return { instanceId, status: 'error', error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Remove instance from management (make it unassigned again)
async function removeFromManagement(instanceIds: string[], userId: string): Promise<APIGatewayProxyResult> {
  console.log('\n--- removeFromManagement Started ---');
  console.log('Instance IDs:', instanceIds);

  try {
    const results: Array<{ instanceId: string; status: string; error?: string }> = [];
    const { DeleteItemCommand } = await import('@aws-sdk/client-dynamodb');
    const { DeleteTagsCommand } = await import('@aws-sdk/client-ec2');

    // Get managed instances
    const managedInstances = await getManagedInstanceIds();

    for (const instanceId of instanceIds) {
      try {
        const managedInfo = managedInstances.get(instanceId);
        
        if (!managedInfo) {
          results.push({ instanceId, status: 'error', error: 'Instance is not managed' });
          continue;
        }

        // Delete workstation record
        await dynamoClient.send(new DeleteItemCommand({
          TableName: WORKSTATIONS_TABLE,
          Key: marshall({
            PK: `WORKSTATION#${managedInfo.workstationId}`,
            SK: 'METADATA',
          }),
        }));

        // Remove tags from EC2 instance
        try {
          await ec2Client.send(new DeleteTagsCommand({
            Resources: [instanceId],
            Tags: [
              { Key: 'WorkstationId' },
              { Key: 'UserId' },
              { Key: 'ManagedBy' },
            ],
          }));
        } catch (tagError) {
          console.warn(`Could not remove tags from ${instanceId}:`, tagError);
        }

        results.push({ instanceId, status: 'removed' });
        console.log(`✅ Removed instance ${instanceId} from management`);
      } catch (err) {
        console.error(`Error removing ${instanceId} from management:`, err);
        results.push({
          instanceId,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter(r => r.status === 'removed').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    await logAuditEvent(userId, 'REMOVE_FROM_MANAGEMENT', 'workstations', 'batch', {
      requestedCount: instanceIds.length,
      successCount,
      errorCount,
      results,
    });

    console.log('=== removeFromManagement Completed ===\n');

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: `Removed ${successCount} instance(s) from management`,
        summary: {
          requested: instanceIds.length,
          removed: successCount,
          errors: errorCount,
        },
        results,
      }),
    };
  } catch (error) {
    console.error('❌ Error removing from management:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: 'Failed to remove instances from management',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}

// Get instance families for UI dropdown
async function getInstanceFamilies(): Promise<APIGatewayProxyResult> {
  console.log('\n--- getInstanceFamilies ---');

  const families = Object.entries(INSTANCE_FAMILIES).map(([key, value]) => ({
    family: key,
    name: value.name,
    description: value.description,
    typeCount: value.types.length,
  }));

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ families }),
  };
}

// Get autocomplete suggestions for instance names
async function getNameSuggestions(prefix: string): Promise<APIGatewayProxyResult> {
  console.log('\n--- getNameSuggestions ---');
  console.log('Prefix:', prefix);

  try {
    // Get instances with matching names
    const describeCommand = new DescribeInstancesCommand({
      Filters: [
        { Name: 'instance-state-name', Values: ['running', 'stopped', 'pending', 'stopping'] },
      ],
      MaxResults: 500,
    });

    const ec2Result = await ec2Client.send(describeCommand);
    const instances = ec2Result.Reservations?.flatMap(r => r.Instances || []) || [];

    // Get managed instance IDs
    const managedInstanceIds = await getManagedInstanceIds();

    // Extract unique names that match prefix and aren't managed
    const suggestions = new Set<string>();
    const prefixLower = prefix.toLowerCase();

    instances.forEach(instance => {
      const nameTag = instance.Tags?.find(t => t.Key === 'Name');
      const name = nameTag?.Value || instance.InstanceId || '';
      const instanceId = instance.InstanceId || '';

      if (!managedInstanceIds.has(instanceId)) {
        if (name.toLowerCase().includes(prefixLower) || instanceId.toLowerCase().includes(prefixLower)) {
          suggestions.add(name);
        }
      }
    });

    // Convert to array and limit results
    const suggestionArray = Array.from(suggestions).slice(0, 20);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ suggestions: suggestionArray }),
    };
  } catch (error) {
    console.error('Error getting name suggestions:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: 'Failed to get name suggestions',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}

// Get instance type suggestions
async function getTypeSuggestions(prefix: string): Promise<APIGatewayProxyResult> {
  console.log('\n--- getTypeSuggestions ---');
  console.log('Prefix:', prefix);

  try {
    const prefixLower = prefix.toLowerCase();
    const suggestions: string[] = [];

    // Search through known instance types
    Object.values(INSTANCE_FAMILIES).forEach(family => {
      family.types.forEach(type => {
        if (type.toLowerCase().includes(prefixLower)) {
          suggestions.push(type);
        }
      });
    });

    // Sort and limit
    suggestions.sort();
    const limitedSuggestions = suggestions.slice(0, 30);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ suggestions: limitedSuggestions }),
    };
  } catch (error) {
    console.error('Error getting type suggestions:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: 'Failed to get type suggestions',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}

// Import instances to workstation management
async function importInstances(request: ImportRequest, userId: string): Promise<APIGatewayProxyResult> {
  console.log('\n--- importInstances Started ---');
  console.log('Request:', JSON.stringify(request, null, 2));

  try {
    const { instances } = request;

    if (!instances || instances.length === 0) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ message: 'No instances provided for import' }),
      };
    }

    // Validate instances exist and get their details
    const instanceIds = instances.map(i => i.instanceId);
    const describeCommand = new DescribeInstancesCommand({
      InstanceIds: instanceIds,
    });

    let ec2Instances: Instance[];
    try {
      const ec2Result = await ec2Client.send(describeCommand);
      ec2Instances = ec2Result.Reservations?.flatMap(r => r.Instances || []) || [];
    } catch (ec2Error: any) {
      if (ec2Error.name === 'InvalidInstanceID.NotFound') {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ message: 'One or more instance IDs not found' }),
        };
      }
      throw ec2Error;
    }

    // Check which instances are already managed
    const managedInstanceIds = await getManagedInstanceIds();
    const alreadyManaged = instanceIds.filter(id => managedInstanceIds.has(id));

    if (alreadyManaged.length > 0) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          message: 'Some instances are already managed',
          alreadyManaged,
        }),
      };
    }

    const importResults: Array<{ instanceId: string; workstationId: string; status: string; error?: string }> = [];
    const timestamp = new Date().toISOString();

    for (const importItem of instances) {
      const { instanceId, assignToUserId, tags: additionalTags } = importItem;
      const ec2Instance = ec2Instances.find(i => i.InstanceId === instanceId);

      if (!ec2Instance) {
        importResults.push({
          instanceId,
          workstationId: '',
          status: 'error',
          error: 'Instance not found',
        });
        continue;
      }

      try {
        // Generate workstation ID
        const workstationId = `ws-${uuidv4()}`;
        const ownerUserId = assignToUserId || userId;

        // Extract tags
        const instanceTags: Record<string, string> = {};
        (ec2Instance.Tags || []).forEach(tag => {
          if (tag.Key && tag.Value) {
            instanceTags[tag.Key] = tag.Value;
          }
        });

        // Merge with additional tags
        const finalTags = { ...instanceTags, ...additionalTags, WorkstationId: workstationId, UserId: ownerUserId };

        // Determine instance characteristics
        const instanceType = ec2Instance.InstanceType || 'unknown';
        const isWindows = ec2Instance.Platform === 'Windows' ||
                         instanceTags['Platform']?.toLowerCase().includes('windows') ||
                         instanceTags['OS']?.toLowerCase().includes('windows');

        // Map EC2 state to workstation status
        const statusMap: Record<string, string> = {
          'pending': 'launching',
          'running': 'running',
          'stopping': 'stopping',
          'stopped': 'stopped',
          'shutting-down': 'stopping',
          'terminated': 'terminated',
        };
        const status = statusMap[ec2Instance.State?.Name || ''] || 'running';

        // Create workstation record
        const workstationRecord = {
          PK: `WORKSTATION#${workstationId}`,
          SK: 'METADATA',
          instanceId,
          userId: ownerUserId,
          userRole: 'user',
          region: process.env.AWS_REGION || 'us-west-2',
          availabilityZone: ec2Instance.Placement?.AvailabilityZone || '',
          instanceType,
          osVersion: isWindows ? 'Windows Server 2022' : 'Linux',
          amiId: ec2Instance.ImageId || '',
          vpcId: ec2Instance.VpcId || VPC_ID,
          subnetId: ec2Instance.SubnetId || '',
          securityGroupId: ec2Instance.SecurityGroups?.[0]?.GroupId || '',
          publicIp: ec2Instance.PublicIpAddress,
          privateIp: ec2Instance.PrivateIpAddress,
          authMethod: 'local',
          status,
          launchTime: ec2Instance.LaunchTime?.toISOString() || timestamp,
          lastStatusCheck: timestamp,
          estimatedHourlyCost: getInstanceHourlyCost(instanceType),
          estimatedMonthlyCost: getInstanceHourlyCost(instanceType) * 24 * 30,
          actualCostToDate: 0,
          tags: finalTags,
          importedAt: timestamp,
          importedBy: userId,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        await dynamoClient.send(new PutItemCommand({
          TableName: WORKSTATIONS_TABLE,
          Item: marshall(workstationRecord, { removeUndefinedValues: true }),
        }));

        // Tag the EC2 instance with WorkstationId and UserId
        const { CreateTagsCommand } = await import('@aws-sdk/client-ec2');
        await ec2Client.send(new CreateTagsCommand({
          Resources: [instanceId],
          Tags: [
            { Key: 'WorkstationId', Value: workstationId },
            { Key: 'UserId', Value: ownerUserId },
            { Key: 'ManagedBy', Value: 'ec2mgr4me' },
          ],
        }));

        importResults.push({
          instanceId,
          workstationId,
          status: 'imported',
        });

        console.log(`✅ Imported instance ${instanceId} as workstation ${workstationId}`);
      } catch (importError) {
        console.error(`Error importing instance ${instanceId}:`, importError);
        importResults.push({
          instanceId,
          workstationId: '',
          status: 'error',
          error: importError instanceof Error ? importError.message : 'Unknown error',
        });
      }
    }

    const successCount = importResults.filter(r => r.status === 'imported').length;
    const errorCount = importResults.filter(r => r.status === 'error').length;

    await logAuditEvent(userId, 'IMPORT_INSTANCES', 'workstations', 'batch', {
      requestedCount: instances.length,
      successCount,
      errorCount,
      results: importResults,
    });

    console.log('=== importInstances Completed ===\n');

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: `Imported ${successCount} instance(s)`,
        summary: {
          requested: instances.length,
          imported: successCount,
          errors: errorCount,
        },
        results: importResults,
      }),
    };
  } catch (error) {
    console.error('❌ Error importing instances:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: 'Failed to import instances',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}

// Get instance hourly cost estimate
function getInstanceHourlyCost(instanceType: string): number {
  const costs: Record<string, number> = {
    // GPU instances
    'g4dn.xlarge': 0.526,
    'g4dn.2xlarge': 0.752,
    'g4dn.4xlarge': 1.204,
    'g4dn.8xlarge': 2.176,
    'g4dn.12xlarge': 3.912,
    'g4dn.16xlarge': 4.352,
    'g5.xlarge': 1.006,
    'g5.2xlarge': 1.212,
    'g5.4xlarge': 2.03,
    'g5.8xlarge': 3.888,
    'g5.12xlarge': 5.672,
    'g5.16xlarge': 4.096,
    'g5.24xlarge': 8.144,
    'g5.48xlarge': 16.288,
    'g6.xlarge': 0.7125,
    'g6.2xlarge': 1.425,
    'g6.4xlarge': 2.85,
    // Compute optimized
    'c5.large': 0.085,
    'c5.xlarge': 0.17,
    'c5.2xlarge': 0.34,
    'c5.4xlarge': 0.68,
    'c6i.large': 0.085,
    'c6i.xlarge': 0.17,
    'c6i.2xlarge': 0.34,
    'c6i.4xlarge': 0.68,
    // General purpose
    'm5.large': 0.096,
    'm5.xlarge': 0.192,
    'm5.2xlarge': 0.384,
    'm5.4xlarge': 0.768,
    'm6i.large': 0.096,
    'm6i.xlarge': 0.192,
    'm6i.2xlarge': 0.384,
    'm6i.4xlarge': 0.768,
    // Burstable
    't3.micro': 0.0104,
    't3.small': 0.0208,
    't3.medium': 0.0416,
    't3.large': 0.0832,
    't3.xlarge': 0.1664,
    't3.2xlarge': 0.3328,
  };
  
  return costs[instanceType] || 0.10;
}

// Main handler
export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  console.log('='.repeat(80));
  console.log('=== EC2 Discovery Service Handler Started ===');
  console.log('='.repeat(80));
  console.log('Request ID:', context.awsRequestId);
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    const { httpMethod, path, body, requestContext, queryStringParameters } = event;
    const userId = requestContext.authorizer?.claims?.email ||
                   requestContext.authorizer?.claims?.sub ||
                   requestContext.authorizer?.claims?.['cognito:username'] ||
                   'unknown';

    // Extract Cognito groups from JWT claims
    const cognitoGroupsClaim = requestContext.authorizer?.claims?.['cognito:groups'];
    let cognitoGroups: string[] = [];
    if (cognitoGroupsClaim) {
      if (typeof cognitoGroupsClaim === 'string') {
        // Could be comma-separated or JSON array
        try {
          cognitoGroups = JSON.parse(cognitoGroupsClaim);
        } catch {
          cognitoGroups = cognitoGroupsClaim.split(',').map(g => g.trim());
        }
      } else if (Array.isArray(cognitoGroupsClaim)) {
        cognitoGroups = cognitoGroupsClaim;
      }
    }

    console.log('UserId:', userId);
    console.log('Cognito Groups:', cognitoGroups);
    console.log('Path:', path);
    console.log('Method:', httpMethod);

    // Check admin permission (also check Cognito groups)
    if (!(await hasPermission(userId, 'workstations:manage-all', cognitoGroups))) {
      console.log('❌ Access denied - requires workstations:manage-all permission');
      await logAuditEvent(userId, 'DENIED_ACCESS', 'ec2-discovery', 'all');
      return {
        statusCode: 403,
        headers: CORS_HEADERS,
        body: JSON.stringify({ message: 'Admin access required' }),
      };
    }

    // Route handling
    if (httpMethod === 'GET') {
      if (path.includes('/families')) {
        return await getInstanceFamilies();
      } else if (path.includes('/suggestions/names')) {
        const prefix = queryStringParameters?.prefix || '';
        return await getNameSuggestions(prefix);
      } else if (path.includes('/suggestions/types')) {
        const prefix = queryStringParameters?.prefix || '';
        return await getTypeSuggestions(prefix);
      } else if (path.includes('/scope/status')) {
        // GET /ec2/scope/status with query params
        const request: ScopeStatusRequest = {
          page: parseInt(queryStringParameters?.page || '1'),
          pageSize: parseInt(queryStringParameters?.pageSize || '50'),
          scopeFilter: (queryStringParameters?.scopeFilter as ScopeStatusRequest['scopeFilter']) || 'all',
          states: queryStringParameters?.states?.split(',') || ['running', 'stopped'],
          searchValue: queryStringParameters?.search,
        };
        return await getInstanceScopeStatus(request, userId);
      }
    }

    if (httpMethod === 'POST') {
      if (path.includes('/scope/set')) {
        const request = JSON.parse(body || '{}') as ScopeRequest;
        return await setInstanceScope(request, userId);
      } else if (path.includes('/scope/remove')) {
        const { instanceIds } = JSON.parse(body || '{}');
        return await removeFromManagement(instanceIds, userId);
      } else if (path.includes('/discover')) {
        const request = JSON.parse(body || '{}') as DiscoverRequest;
        return await discoverInstances(request, userId);
      } else if (path.includes('/import')) {
        const request = JSON.parse(body || '{}') as ImportRequest;
        return await importInstances(request, userId);
      }
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
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: context.awsRequestId,
      }),
    };
  }
};