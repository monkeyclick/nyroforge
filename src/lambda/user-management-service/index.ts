import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand
} from '@aws-sdk/client-cognito-identity-provider';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { randomUUID, randomBytes } from 'crypto';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

// Initialize clients
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const cognitoClient = new CognitoIdentityProviderClient({});
const sesClient = new SESClient({});

const USER_POOL_ID = process.env.USER_POOL_ID!;

const jwtVerifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: 'access',
  clientId: null,
});
const USERS_TABLE = process.env.USERS_TABLE || 'EnhancedUsers';
const ROLES_TABLE = process.env.ROLES_TABLE || 'UserRoles';
const GROUPS_TABLE = process.env.GROUPS_TABLE || 'UserGroups';
const AUDIT_TABLE = process.env.AUDIT_TABLE || 'AuditLogs';
const GROUP_MEMBERSHIPS_TABLE = process.env.GROUP_MEMBERSHIPS_TABLE || 'GroupMemberships';
const GROUP_AUDIT_LOGS_TABLE = process.env.GROUP_AUDIT_LOGS_TABLE || 'GroupAuditLogs';
const BOOTSTRAP_PACKAGES_TABLE = process.env.BOOTSTRAP_PACKAGES_TABLE || 'WorkstationBootstrapPackages';
const ANALYTICS_TABLE = process.env.ANALYTICS_TABLE || 'UserAnalytics';
const FEEDBACK_TABLE = process.env.FEEDBACK_TABLE || 'UserFeedback';
const DELETED_USERS_TABLE = process.env.DELETED_USERS_TABLE || 'DeletedUsers';
const PASSWORD_RESET_TABLE = process.env.PASSWORD_RESET_TABLE || 'PasswordResetRecords';
const PASSWORD_POLICY_TABLE = process.env.PASSWORD_POLICY_TABLE || 'PasswordPolicySettings';
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@example.com';

interface EnhancedUser {
  id: string;
  email: string;
  name: string;
  phone?: string;
  status: 'active' | 'suspended' | 'pending' | 'deleted';
  roleIds: string[];
  groupIds: string[];
  directPermissions: string[];
  attributes: Record<string, any>;
  preferences: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  createdBy?: string;
  deletedAt?: string;
  deletedBy?: string;
  deletionType?: 'soft' | 'hard';
  scheduledPurgeDate?: string;
  deletionReason?: string;
}

interface DeletedUser {
  id: string;
  email: string;
  name: string;
  deletionType: 'soft' | 'hard';
  deletedAt: string;
  deletedBy: string;
  reason?: string;
  notes?: string;
  scheduledPurgeDate?: string;
  originalData: {
    roleIds: string[];
    groupIds: string[];
    attributes: Record<string, any>;
    preferences: Record<string, any>;
    createdAt: string;
    lastLoginAt?: string;
  };
  restorable: boolean;
  ttl?: number;
}

interface PasswordResetRecord {
  id: string;
  userId: string;
  email: string;
  resetType: 'admin_set' | 'admin_generate' | 'user_reset';
  temporary: boolean;
  expiresAt?: string;
  forceChangeOnLogin: boolean;
  createdAt: string;
  createdBy: string;
  reason?: string;
  notifications: {
    userNotified: boolean;
    adminNotified: boolean;
    includePasswordInEmail: boolean;
  };
  status: 'active' | 'used' | 'expired' | 'revoked';
  usedAt?: string;
  ttl?: number;
}

interface PasswordPolicy {
  id: string;
  minLength: number;
  maxLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  allowedSpecialChars: string;
  preventCommonPasswords: boolean;
  preventUsernameInPassword: boolean;
  passwordHistoryCount: number;
  temporaryPasswordDefaults: {
    expiresIn: string;
    minLength: number;
    includeSpecialChars: boolean;
  };
  resetLimits: {
    maxPerDay: number;
    cooldownMinutes: number;
  };
  updatedAt: string;
  updatedBy: string;
}

// Default password policy
const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  id: 'default',
  minLength: 12,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  allowedSpecialChars: '!@#$%^&*()_+-=',
  preventCommonPasswords: true,
  preventUsernameInPassword: true,
  passwordHistoryCount: 5,
  temporaryPasswordDefaults: {
    expiresIn: '24h',
    minLength: 16,
    includeSpecialChars: true
  },
  resetLimits: {
    maxPerDay: 5,
    cooldownMinutes: 5
  },
  updatedAt: new Date().toISOString(),
  updatedBy: 'system'
};

// Common passwords list (abbreviated - in production use a larger list)
const COMMON_PASSWORDS = [
  'password', 'password123', '123456', '12345678', 'qwerty', 'abc123',
  'monkey', '1234567', 'letmein', 'trustno1', 'dragon', 'baseball',
  'iloveyou', 'master', 'sunshine', 'ashley', 'foobar', 'passw0rd',
  'shadow', '123123', '654321', 'superman', 'qazwsx', 'michael',
  'football', 'password1', 'password12', 'princess', 'admin', 'welcome'
];

interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

interface Group {
  id: string;
  name: string;
  description: string;
  roleIds: string[];
  members: string[]; // Deprecated - use GroupMemberships table
  tags: Record<string, string>;
  isDefault: string; // 'true' or 'false' for GSI
  membershipType?: 'static' | 'dynamic' | 'hybrid';
  parentGroupId?: string;
  hierarchyPath?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

interface GroupMembership {
  id: string; // Format: "user#<userId>#group#<groupId>"
  userId: string;
  groupId: string;
  membershipType: 'static' | 'dynamic' | 'nested';
  source?: string; // 'manual', 'rule', 'parent-group'
  addedAt: string;
  addedBy: string;
  expiresAt?: string; // TTL for temporary memberships
}

interface GroupAuditLog {
  id: string;
  groupId: string;
  action: 'created' | 'updated' | 'deleted' | 'member_added' | 'member_removed' | 'rule_evaluated' | 'hierarchy_changed';
  performedBy: string;
  timestamp: string;
  changes?: any;
  metadata?: Record<string, any>;
}

export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    const { path, httpMethod } = event;
    const pathParts = path.split('/').filter(Boolean);
    
    // Extract user ID from JWT token
    const currentUserId = await getCurrentUserId(event);
    if (!currentUserId) {
      return createErrorResponse(401, 'Unauthorized - Invalid token');
    }

    // Check if user has admin permissions
    const hasAdminPermission = await checkAdminPermission(currentUserId);
    if (!hasAdminPermission && !pathParts.includes('me')) {
      return createErrorResponse(403, 'Forbidden - Admin access required');
    }

    // Route handling
    if (pathParts.includes('users')) {
      return await handleUserRoutes(event, pathParts, currentUserId);
    }
    
    if (pathParts.includes('roles')) {
      return await handleRoleRoutes(event, pathParts, currentUserId);
    }
    
    if (pathParts.includes('groups')) {
      return await handleGroupRoutes(event, pathParts, currentUserId);
    }
    
    if (pathParts.includes('group-audit-logs')) {
      return await handleGroupAuditRoutes(event, pathParts, currentUserId);
    }

    if (pathParts.includes('permissions')) {
      return await handlePermissionRoutes(event, pathParts, currentUserId);
    }

    if (pathParts.includes('audit-logs')) {
      return await handleAuditRoutes(event, pathParts, currentUserId);
    }

    return createErrorResponse(404, 'Route not found');

  } catch (error) {
    console.error('Internal error:', error);
    return createErrorResponse(500, 'An internal error occurred. Please try again later.');
  }
};

// User management handlers
async function handleUserRoutes(event: APIGatewayProxyEvent, pathParts: string[], currentUserId: string): Promise<APIGatewayProxyResult> {
  const { httpMethod } = event;
  
  // Find the index of 'users' in the path to handle both /admin/users/... and /users/... patterns
  const usersIndex = pathParts.indexOf('users');
  
  // Extract userId from path - it comes after 'users'
  const getUserIdFromPath = () => {
    if (usersIndex >= 0 && usersIndex + 1 < pathParts.length) {
      const potentialUserId = pathParts[usersIndex + 1];
      // Make sure it's not a known action like 'deletion-preview', 'soft-delete', etc.
      const knownActions = ['deletion-preview', 'soft-delete', 'hard-delete', 'restore', 'password', 'suspend', 'activate', 'invite', 'generate'];
      if (!knownActions.includes(potentialUserId)) {
        return potentialUserId;
      }
    }
    return null;
  };
  
  const userId = getUserIdFromPath();
  
  switch (httpMethod) {
    case 'GET':
      // Handle /admin/users or /users - list all users
      if (!userId && !pathParts.includes('deletion-preview')) {
        return await getUsers(event);
      }
      // Handle /admin/users/{id}/deletion-preview or /users/{id}/deletion-preview
      if (pathParts.includes('deletion-preview') && userId) {
        return await getDeletionPreview(userId, currentUserId);
      }
      // Handle /admin/users/{id} or /users/{id} - get single user
      if (userId && !pathParts.includes('deletion-preview')) {
        return await getUserById(userId);
      }
      break;

    case 'POST':
      if (pathParts.includes('suspend') && userId) {
        return await suspendUser(userId, currentUserId);
      }
      if (pathParts.includes('activate') && userId) {
        return await activateUser(userId, currentUserId);
      }
      if (pathParts.includes('invite')) {
        return await inviteUser(event, currentUserId);
      }
      if (pathParts.includes('soft-delete') && userId) {
        return await softDeleteUser(userId, event, currentUserId);
      }
      if (pathParts.includes('restore') && userId) {
        return await restoreUser(userId, event, currentUserId);
      }
      if (pathParts.includes('password') && userId) {
        if (pathParts.includes('generate')) {
          return await generateUserPassword(userId, event, currentUserId);
        }
        return await setUserPassword(userId, event, currentUserId);
      }
      // If we have pathParts after 'users' and it includes 'hard-delete', handle it here for DELETE-as-POST
      if (pathParts.includes('hard-delete') && userId) {
        return await hardDeleteUser(userId, event, currentUserId);
      }
      // Create user - no userId in path
      if (!userId) {
        return await createUser(event, currentUserId);
      }
      break;

    case 'PUT':
      if (userId) {
        return await updateUser(userId, event, currentUserId);
      }
      break;

    case 'DELETE':
      if (userId) {
        return await hardDeleteUser(userId, event, currentUserId);
      }
      break;
  }
  
  return createErrorResponse(400, 'Invalid user route');
}

// Role management handlers
async function handleRoleRoutes(event: APIGatewayProxyEvent, pathParts: string[], currentUserId: string): Promise<APIGatewayProxyResult> {
  const { httpMethod } = event;
  
  switch (httpMethod) {
    case 'GET':
      if (pathParts.length === 2) {
        return await getRoles();
      } else if (pathParts.length === 3) {
        const roleId = pathParts[2];
        return await getRoleById(roleId);
      }
      break;

    case 'POST':
      return await createRole(event, currentUserId);

    case 'PUT':
      if (pathParts.length === 3) {
        const roleId = pathParts[2];
        return await updateRole(roleId, event, currentUserId);
      }
      break;

    case 'DELETE':
      if (pathParts.length === 3) {
        const roleId = pathParts[2];
        return await deleteRole(roleId, currentUserId);
      }
      break;
  }
  
  return createErrorResponse(400, 'Invalid role route');
}

// Group management handlers
async function handleGroupRoutes(event: APIGatewayProxyEvent, pathParts: string[], currentUserId: string): Promise<APIGatewayProxyResult> {
  const { httpMethod } = event;
  
  switch (httpMethod) {
    case 'GET':
      if (pathParts.length === 2) {
        return await getGroups();
      } else if (pathParts.length === 3) {
        const groupId = pathParts[2];
        return await getGroupById(groupId);
      }
      break;

    case 'POST':
      if (pathParts.includes('members') && pathParts.length >= 4) {
        const groupId = pathParts[2];
        return await addUserToGroup(groupId, event, currentUserId);
      }
      if (pathParts.includes('evaluate-rules')) {
        const groupId = pathParts[2];
        return await evaluateGroupRules(groupId, currentUserId);
      }
      return await createGroup(event, currentUserId);

    case 'PUT':
      if (pathParts.length === 3) {
        const groupId = pathParts[2];
        return await updateGroup(groupId, event, currentUserId);
      }
      break;

    case 'DELETE':
      if (pathParts.includes('members') && pathParts.length === 5) {
        const groupId = pathParts[2];
        const userId = pathParts[4];
        return await removeUserFromGroup(groupId, userId, currentUserId);
      } else if (pathParts.length === 3) {
        const groupId = pathParts[2];
        return await deleteGroup(groupId, currentUserId);
      }
      break;
  }
  
  return createErrorResponse(400, 'Invalid group route');
}

// Group audit log handlers
async function handleGroupAuditRoutes(event: APIGatewayProxyEvent, pathParts: string[], currentUserId: string): Promise<APIGatewayProxyResult> {
  const { httpMethod } = event;
  
  if (httpMethod === 'GET') {
    const params = event.queryStringParameters || {};
    const groupId = params.groupId;
    
    if (groupId) {
      return await getGroupAuditLogs(groupId, event);
    }
    return createErrorResponse(400, 'groupId parameter required');
  }
  
  return createErrorResponse(400, 'Invalid group audit route');
}

// Permission handlers
async function handlePermissionRoutes(event: APIGatewayProxyEvent, pathParts: string[], currentUserId: string): Promise<APIGatewayProxyResult> {
  const { httpMethod } = event;
  
  if (httpMethod === 'GET') {
    return await getAvailablePermissions();
  }
  
  return createErrorResponse(400, 'Invalid permission route');
}

// Audit handlers
async function handleAuditRoutes(event: APIGatewayProxyEvent, pathParts: string[], currentUserId: string): Promise<APIGatewayProxyResult> {
  const { httpMethod } = event;
  
  if (httpMethod === 'GET') {
    return await getAuditLogs(event);
  }
  
  return createErrorResponse(400, 'Invalid audit route');
}

// User operations
async function getUsers(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const params = event.queryStringParameters || {};
  const page = parseInt(params.page || '1');
  const limit = parseInt(params.limit || '20');
  const status = params.status;
  const search = params.search;
  const roleId = params.roleId;
  const groupId = params.groupId;

  try {
    // Get user data from DynamoDB (simplified without Cognito for now)
    const scanCommand = new ScanCommand({
      TableName: USERS_TABLE,
    });
    
    const userDataResult = await docClient.send(scanCommand);
    let users: EnhancedUser[] = (userDataResult.Items || []).map(item => ({
      id: item.id,
      email: item.email,
      name: item.name,
      phone: item.phone,
      status: item.status,
      roleIds: item.roleIds || [],
      groupIds: item.groupIds || [],
      directPermissions: item.directPermissions || [],
      attributes: item.attributes || {},
      preferences: item.preferences || {},
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      lastLoginAt: item.lastLoginAt,
      createdBy: item.createdBy,
    }));

    // Apply filters
    if (status) {
      users = users.filter((user: EnhancedUser) => user.status === status);
    }
    if (search) {
      const searchLower = search.toLowerCase();
      users = users.filter((user: EnhancedUser) =>
        user.name.toLowerCase().includes(searchLower) ||
        user.email.toLowerCase().includes(searchLower)
      );
    }
    if (roleId) {
      users = users.filter((user: EnhancedUser) => user.roleIds.includes(roleId));
    }
    if (groupId) {
      users = users.filter((user: EnhancedUser) => user.groupIds.includes(groupId));
    }

    // Pagination
    const total = users.length;
    const pages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const paginatedUsers = users.slice(offset, offset + limit);

    return createSuccessResponse({
      users: paginatedUsers,
      pagination: {
        total,
        page,
        limit,
        pages,
      },
    });

  } catch (error) {
    console.error('Error getting users:', error);
    return createErrorResponse(500, 'Failed to get users', error);
  }
}

async function createUser(event: APIGatewayProxyEvent, currentUserId: string): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const { email, name, phone, roleIds = [], groupIds = [], sendInvitation = true, attributes = {} } = body;

    if (!email || !name) {
      return createErrorResponse(400, 'Email and name are required');
    }

    const userId = randomUUID();
    const now = new Date().toISOString();

    // For now, create user directly in DynamoDB (Cognito integration can be added later)

    // Store additional data in DynamoDB
    const userData: EnhancedUser = {
      id: userId,
      email,
      name,
      phone,
      status: 'pending',
      roleIds,
      groupIds,
      directPermissions: [],
      attributes,
      preferences: {},
      createdAt: now,
      updatedAt: now,
      createdBy: currentUserId,
    };

    await docClient.send(new PutCommand({
      TableName: USERS_TABLE,
      Item: userData,
    }));

    // Update group memberships using new GroupMemberships table
    for (const groupId of groupIds) {
      await addGroupMembershipRecord(userId, groupId, 'static', currentUserId);
    }

    // Log audit event
    await logAuditEvent(currentUserId, 'CREATE_USER', 'user', userId, { userData });

    return createSuccessResponse(userData);

  } catch (error) {
    console.error('Error creating user:', error);
    return createErrorResponse(500, 'Failed to create user', error);
  }
}

// Role operations
async function getRoles(): Promise<APIGatewayProxyResult> {
  try {
    const scanCommand = new ScanCommand({
      TableName: ROLES_TABLE,
    });
    
    const result = await docClient.send(scanCommand);
    
    return createSuccessResponse({
      roles: result.Items || [],
    });

  } catch (error) {
    console.error('Error getting roles:', error);
    return createErrorResponse(500, 'Failed to get roles', error);
  }
}

async function createRole(event: APIGatewayProxyEvent, currentUserId: string): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const { name, description, permissions = [] } = body;

    if (!name || !description) {
      return createErrorResponse(400, 'Name and description are required');
    }

    const roleId = randomUUID();
    const now = new Date().toISOString();

    const role: Role = {
      id: roleId,
      name,
      description,
      permissions,
      isSystem: false,
      createdAt: now,
      updatedAt: now,
      createdBy: currentUserId,
    };

    await docClient.send(new PutCommand({
      TableName: ROLES_TABLE,
      Item: role,
    }));

    await logAuditEvent(currentUserId, 'CREATE_ROLE', 'role', roleId, { role });

    return createSuccessResponse(role);

  } catch (error) {
    console.error('Error creating role:', error);
    return createErrorResponse(500, 'Failed to create role', error);
  }
}

// Group operations
async function getGroups(): Promise<APIGatewayProxyResult> {
  try {
    const scanCommand = new ScanCommand({
      TableName: GROUPS_TABLE,
    });
    
    const result = await docClient.send(scanCommand);
    
    return createSuccessResponse({
      groups: result.Items || [],
    });

  } catch (error) {
    console.error('Error getting groups:', error);
    return createErrorResponse(500, 'Failed to get groups', error);
  }
}

async function createGroup(event: APIGatewayProxyEvent, currentUserId: string): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const { name, description, roleIds = [], isDefault = false, tags = {} } = body;

    if (!name || !description) {
      return createErrorResponse(400, 'Name and description are required');
    }

    const groupId = randomUUID();
    const now = new Date().toISOString();

    const group: Group = {
      id: groupId,
      name,
      description,
      roleIds,
      members: [], // Deprecated - kept for backwards compatibility
      tags,
      isDefault: isDefault ? 'true' : 'false', // String for GSI
      membershipType: 'static',
      hierarchyPath: groupId,
      createdAt: now,
      updatedAt: now,
      createdBy: currentUserId,
    };

    await docClient.send(new PutCommand({
      TableName: GROUPS_TABLE,
      Item: group,
    }));

    await logAuditEvent(currentUserId, 'CREATE_GROUP', 'group', groupId, { group });
    await logGroupAuditEvent(groupId, 'created', currentUserId, { group });

    return createSuccessResponse(group);

  } catch (error) {
    console.error('Error creating group:', error);
    return createErrorResponse(500, 'Failed to create group', error);
  }
}

// Helper functions for Group Memberships
async function addGroupMembershipRecord(
  userId: string,
  groupId: string,
  membershipType: 'static' | 'dynamic' | 'nested',
  addedBy: string,
  source?: string,
  expiresAt?: string
): Promise<void> {
  try {
    const membershipId = `user#${userId}#group#${groupId}`;
    const now = new Date().toISOString();

    const membership: GroupMembership = {
      id: membershipId,
      userId,
      groupId,
      membershipType,
      source: source || 'manual',
      addedAt: now,
      addedBy,
    };

    if (expiresAt) {
      membership.expiresAt = expiresAt;
    }

    await docClient.send(new PutCommand({
      TableName: GROUP_MEMBERSHIPS_TABLE,
      Item: membership,
    }));

    await logGroupAuditEvent(groupId, 'member_added', addedBy, { userId, membershipType });
  } catch (error) {
    console.error('Error adding group membership record:', error);
    throw error;
  }
}

async function removeGroupMembershipRecord(
  userId: string,
  groupId: string,
  removedBy: string
): Promise<void> {
  try {
    const membershipId = `user#${userId}#group#${groupId}`;

    await docClient.send(new DeleteCommand({
      TableName: GROUP_MEMBERSHIPS_TABLE,
      Key: { id: membershipId },
    }));

    await logGroupAuditEvent(groupId, 'member_removed', removedBy, { userId });
  } catch (error) {
    console.error('Error removing group membership record:', error);
    throw error;
  }
}

async function getGroupMembers(groupId: string): Promise<GroupMembership[]> {
  try {
    const queryCommand = new QueryCommand({
      TableName: GROUP_MEMBERSHIPS_TABLE,
      IndexName: 'GroupMembersIndex',
      KeyConditionExpression: 'groupId = :groupId',
      ExpressionAttributeValues: {
        ':groupId': groupId,
      },
    });

    const result = await docClient.send(queryCommand);
    return (result.Items || []) as GroupMembership[];
  } catch (error) {
    console.error('Error getting group members:', error);
    return [];
  }
}

async function getUserGroups(userId: string): Promise<GroupMembership[]> {
  try {
    const queryCommand = new QueryCommand({
      TableName: GROUP_MEMBERSHIPS_TABLE,
      IndexName: 'UserGroupsIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
    });

    const result = await docClient.send(queryCommand);
    return (result.Items || []) as GroupMembership[];
  } catch (error) {
    console.error('Error getting user groups:', error);
    return [];
  }
}

async function logGroupAuditEvent(
  groupId: string,
  action: GroupAuditLog['action'],
  performedBy: string,
  changes?: any,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    const auditLog: GroupAuditLog = {
      id: randomUUID(),
      groupId,
      action,
      performedBy,
      timestamp: new Date().toISOString(),
      changes,
      metadata,
    };

    await docClient.send(new PutCommand({
      TableName: GROUP_AUDIT_LOGS_TABLE,
      Item: auditLog,
    }));
  } catch (error) {
    console.error('Error logging group audit event:', error);
  }
}

async function getGroupAuditLogs(groupId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const params = event.queryStringParameters || {};
    const limit = parseInt(params.limit || '50');

    const queryCommand = new QueryCommand({
      TableName: GROUP_AUDIT_LOGS_TABLE,
      IndexName: 'GroupActivityIndex',
      KeyConditionExpression: 'groupId = :groupId',
      ExpressionAttributeValues: {
        ':groupId': groupId,
      },
      Limit: limit,
      ScanIndexForward: false, // Most recent first
    });

    const result = await docClient.send(queryCommand);

    return createSuccessResponse({
      logs: result.Items || [],
      total: result.Count || 0,
    });
  } catch (error) {
    console.error('Error getting group audit logs:', error);
    return createErrorResponse(500, 'Failed to get group audit logs', error);
  }
}

async function evaluateGroupRules(groupId: string, currentUserId: string): Promise<APIGatewayProxyResult> {
  // Placeholder for Phase 2 - Dynamic rule evaluation
  return createErrorResponse(501, 'Dynamic rule evaluation not implemented yet (Phase 2 feature)');
}

async function getAvailablePermissions(): Promise<APIGatewayProxyResult> {
  const permissions = [
    'workstations:read',
    'workstations:write',
    'workstations:delete',
    'workstations:manage-all',
    'users:read',
    'users:write',
    'users:delete',
    'groups:read',
    'groups:write',
    'groups:delete',
    'roles:read',
    'roles:write',
    'roles:delete',
    'analytics:read',
    'settings:read',
    'settings:write',
    'admin:full-access',
  ];

  return createSuccessResponse(permissions);
}

async function getAuditLogs(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const params = event.queryStringParameters || {};
  const page = parseInt(params.page || '1');
  const limit = parseInt(params.limit || '50');

  try {
    const scanCommand = new ScanCommand({
      TableName: AUDIT_TABLE,
      Limit: limit,
    });
    
    const result = await docClient.send(scanCommand);
    
    return createSuccessResponse({
      logs: result.Items || [],
      pagination: {
        total: result.Count || 0,
        page,
        limit,
        pages: Math.ceil((result.Count || 0) / limit),
      },
    });

  } catch (error) {
    console.error('Error getting audit logs:', error);
    return createErrorResponse(500, 'Failed to get audit logs', error);
  }
}

async function logAuditEvent(
  userId: string,
  action: string,
  resource: string,
  resourceId: string,
  changes?: any
): Promise<void> {
  try {
    const auditLog = {
      id: randomUUID(),
      userId,
      userEmail: '', // Would need to fetch from user data
      action,
      resource,
      resourceId,
      changes,
      timestamp: new Date().toISOString(),
      ipAddress: '', // Would extract from event
      userAgent: '', // Would extract from event
    };

    await docClient.send(new PutCommand({
      TableName: AUDIT_TABLE,
      Item: auditLog,
    }));
  } catch (error) {
    console.error('Error logging audit event:', error);
  }
}

async function checkAdminPermission(userId: string): Promise<boolean> {
  try {
    // Get user data from DynamoDB
    const getCommand = new GetCommand({
      TableName: USERS_TABLE,
      Key: { id: userId },
    });

    const result = await docClient.send(getCommand);
    
    // If user not in DynamoDB, they might still have Cognito admin group
    // This allows for graceful handling during development
    if (!result.Item) {
      console.log('User not found in DynamoDB, denying admin access');
      return false;
    }

    const user = result.Item as EnhancedUser;
    
    // Check if user has admin permissions directly
    if (user.directPermissions?.includes('admin:full-access')) {
      return true;
    }

    // Check if user has admin role
    if (user.roleIds?.includes('admin')) {
      return true;
    }

    // Check roles for admin permissions
    for (const roleId of user.roleIds || []) {
      const roleResult = await docClient.send(new GetCommand({
        TableName: ROLES_TABLE,
        Key: { id: roleId },
      }));

      if (roleResult.Item) {
        const role = roleResult.Item as Role;
        if (role.permissions.includes('admin:full-access') ||
            role.permissions.includes('users:read') ||
            role.permissions.includes('users:write')) {
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    console.error('Error checking admin permission:', error);
    return false;
  }
}

async function getCurrentUserId(event: APIGatewayProxyEvent): Promise<string | null> {
  try {
    // When routed through API Gateway with a Cognito authorizer the token has
    // already been verified — trust the injected claims directly.
    const claims = event.requestContext.authorizer?.claims;
    if (claims) {
      return claims.sub || claims['cognito:username'] || null;
    }

    // No authorizer claims — verify the raw JWT from the Authorization header.
    const authHeader =
      event.headers?.['Authorization'] || event.headers?.['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    const token = authHeader.slice(7);
    const payload = await jwtVerifier.verify(token);
    return (payload.sub as string) || null;
  } catch (error) {
    console.error('Error extracting user ID:', error);
    return null;
  }
}

function createSuccessResponse(data: any): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
    },
    body: JSON.stringify(data),
  };
}

function createErrorResponse(statusCode: number, message: string, error?: any): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
    },
    body: JSON.stringify({
      message,
      error: error instanceof Error ? error.message : error
    }),
  };
}

// User operation implementations
async function getUserById(userId: string): Promise<APIGatewayProxyResult> {
  try {
    const getCommand = new GetCommand({
      TableName: USERS_TABLE,
      Key: { id: userId },
    });

    const result = await docClient.send(getCommand);
    
    if (!result.Item) {
      return createErrorResponse(404, 'User not found');
    }

    return createSuccessResponse(result.Item);

  } catch (error) {
    console.error('Error getting user:', error);
    return createErrorResponse(500, 'Failed to get user', error);
  }
}

async function updateUser(userId: string, event: APIGatewayProxyEvent, currentUserId: string): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const { name, phone, roleIds, groupIds, directPermissions, attributes, preferences } = body;

    // Get existing user
    const getCommand = new GetCommand({
      TableName: USERS_TABLE,
      Key: { id: userId },
    });

    const result = await docClient.send(getCommand);
    if (!result.Item) {
      return createErrorResponse(404, 'User not found');
    }

    const user = result.Item as EnhancedUser;
    const now = new Date().toISOString();

    // Update only provided fields
    if (name !== undefined) user.name = name;
    if (phone !== undefined) user.phone = phone;
    if (roleIds !== undefined) user.roleIds = roleIds;
    if (groupIds !== undefined) user.groupIds = groupIds;
    if (directPermissions !== undefined) user.directPermissions = directPermissions;
    if (attributes !== undefined) user.attributes = { ...user.attributes, ...attributes };
    if (preferences !== undefined) user.preferences = { ...user.preferences, ...preferences };
    user.updatedAt = now;

    await docClient.send(new PutCommand({
      TableName: USERS_TABLE,
      Item: user,
    }));

    await logAuditEvent(currentUserId, 'UPDATE_USER', 'user', userId, { updates: body });

    return createSuccessResponse(user);

  } catch (error) {
    console.error('Error updating user:', error);
    return createErrorResponse(500, 'Failed to update user', error);
  }
}

async function suspendUser(userId: string, currentUserId: string): Promise<APIGatewayProxyResult> {
  try {
    const getCommand = new GetCommand({
      TableName: USERS_TABLE,
      Key: { id: userId },
    });

    const result = await docClient.send(getCommand);
    if (!result.Item) {
      return createErrorResponse(404, 'User not found');
    }

    const user = result.Item as EnhancedUser;
    user.status = 'suspended';
    user.updatedAt = new Date().toISOString();

    await docClient.send(new PutCommand({
      TableName: USERS_TABLE,
      Item: user,
    }));

    await logAuditEvent(currentUserId, 'SUSPEND_USER', 'user', userId, { previousStatus: result.Item.status });

    return createSuccessResponse(user);

  } catch (error) {
    console.error('Error suspending user:', error);
    return createErrorResponse(500, 'Failed to suspend user', error);
  }
}

async function activateUser(userId: string, currentUserId: string): Promise<APIGatewayProxyResult> {
  try {
    const getCommand = new GetCommand({
      TableName: USERS_TABLE,
      Key: { id: userId },
    });

    const result = await docClient.send(getCommand);
    if (!result.Item) {
      return createErrorResponse(404, 'User not found');
    }

    const user = result.Item as EnhancedUser;
    user.status = 'active';
    user.updatedAt = new Date().toISOString();

    await docClient.send(new PutCommand({
      TableName: USERS_TABLE,
      Item: user,
    }));

    await logAuditEvent(currentUserId, 'ACTIVATE_USER', 'user', userId, { previousStatus: result.Item.status });

    return createSuccessResponse(user);

  } catch (error) {
    console.error('Error activating user:', error);
    return createErrorResponse(500, 'Failed to activate user', error);
  }
}

async function deleteUser(userId: string, currentUserId: string): Promise<APIGatewayProxyResult> {
  try {
    // Get user first to log details
    const getCommand = new GetCommand({
      TableName: USERS_TABLE,
      Key: { id: userId },
    });

    const result = await docClient.send(getCommand);
    if (!result.Item) {
      return createErrorResponse(404, 'User not found');
    }

    // Delete from DynamoDB
    await docClient.send(new DeleteCommand({
      TableName: USERS_TABLE,
      Key: { id: userId },
    }));

    await logAuditEvent(currentUserId, 'DELETE_USER', 'user', userId, { deletedUser: result.Item });

    return createSuccessResponse({ message: 'User deleted successfully' });

  } catch (error) {
    console.error('Error deleting user:', error);
    return createErrorResponse(500, 'Failed to delete user', error);
  }
}

async function inviteUser(event: APIGatewayProxyEvent, currentUserId: string): Promise<APIGatewayProxyResult> {
  // For now, same as createUser - can be enhanced later with email invitations
  return await createUser(event, currentUserId);
}

async function getRoleById(roleId: string): Promise<APIGatewayProxyResult> {
  try {
    const getCommand = new GetCommand({
      TableName: ROLES_TABLE,
      Key: { id: roleId },
    });

    const result = await docClient.send(getCommand);
    
    if (!result.Item) {
      return createErrorResponse(404, 'Role not found');
    }

    return createSuccessResponse(result.Item);
  } catch (error) {
    console.error('Error getting role:', error);
    return createErrorResponse(500, 'Failed to get role', error);
  }
}

async function updateRole(roleId: string, event: APIGatewayProxyEvent, currentUserId: string): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const { name, description, permissions } = body;

    const getCommand = new GetCommand({
      TableName: ROLES_TABLE,
      Key: { id: roleId },
    });

    const result = await docClient.send(getCommand);
    if (!result.Item) {
      return createErrorResponse(404, 'Role not found');
    }

    const role = result.Item as Role;
    
    // Don't allow updating system roles
    if (role.isSystem) {
      return createErrorResponse(403, 'Cannot update system roles');
    }

    const now = new Date().toISOString();

    if (name !== undefined) role.name = name;
    if (description !== undefined) role.description = description;
    if (permissions !== undefined) role.permissions = permissions;
    role.updatedAt = now;

    await docClient.send(new PutCommand({
      TableName: ROLES_TABLE,
      Item: role,
    }));

    await logAuditEvent(currentUserId, 'UPDATE_ROLE', 'role', roleId, { updates: body });

    return createSuccessResponse(role);
  } catch (error) {
    console.error('Error updating role:', error);
    return createErrorResponse(500, 'Failed to update role', error);
  }
}

async function deleteRole(roleId: string, currentUserId: string): Promise<APIGatewayProxyResult> {
  try {
    const getCommand = new GetCommand({
      TableName: ROLES_TABLE,
      Key: { id: roleId },
    });

    const result = await docClient.send(getCommand);
    if (!result.Item) {
      return createErrorResponse(404, 'Role not found');
    }

    const role = result.Item as Role;
    
    if (role.isSystem) {
      return createErrorResponse(403, 'Cannot delete system roles');
    }

    await docClient.send(new DeleteCommand({
      TableName: ROLES_TABLE,
      Key: { id: roleId },
    }));

    await logAuditEvent(currentUserId, 'DELETE_ROLE', 'role', roleId, { deletedRole: role });

    return createSuccessResponse({ message: 'Role deleted successfully' });
  } catch (error) {
    console.error('Error deleting role:', error);
    return createErrorResponse(500, 'Failed to delete role', error);
  }
}

async function getGroupById(groupId: string): Promise<APIGatewayProxyResult> {
  try {
    const getCommand = new GetCommand({
      TableName: GROUPS_TABLE,
      Key: { id: groupId },
    });

    const result = await docClient.send(getCommand);
    
    if (!result.Item) {
      return createErrorResponse(404, 'Group not found');
    }

    const group = result.Item;
    
    // Get current members from GroupMemberships table
    const members = await getGroupMembers(groupId);
    
    return createSuccessResponse({
      ...group,
      memberCount: members.length,
      members: members.map(m => ({ userId: m.userId, membershipType: m.membershipType, addedAt: m.addedAt })),
    });
  } catch (error) {
    console.error('Error getting group:', error);
    return createErrorResponse(500, 'Failed to get group', error);
  }
}

async function updateGroup(groupId: string, event: APIGatewayProxyEvent, currentUserId: string): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const { name, description, roleIds, tags, parentGroupId } = body;

    const getCommand = new GetCommand({
      TableName: GROUPS_TABLE,
      Key: { id: groupId },
    });

    const result = await docClient.send(getCommand);
    if (!result.Item) {
      return createErrorResponse(404, 'Group not found');
    }

    const group = result.Item as Group;
    const now = new Date().toISOString();
    const previousState = { ...group };

    if (name !== undefined) group.name = name;
    if (description !== undefined) group.description = description;
    if (roleIds !== undefined) group.roleIds = roleIds;
    if (tags !== undefined) group.tags = { ...group.tags, ...tags };
    if (parentGroupId !== undefined) {
      group.parentGroupId = parentGroupId;
      // Update hierarchy path
      if (parentGroupId) {
        const parent = await docClient.send(new GetCommand({
          TableName: GROUPS_TABLE,
          Key: { id: parentGroupId },
        }));
        if (parent.Item) {
          group.hierarchyPath = `${parent.Item.hierarchyPath}/${groupId}`;
        }
      } else {
        group.hierarchyPath = groupId;
      }
      await logGroupAuditEvent(groupId, 'hierarchy_changed', currentUserId, { previousParent: previousState.parentGroupId, newParent: parentGroupId });
    }
    
    group.updatedAt = now;

    await docClient.send(new PutCommand({
      TableName: GROUPS_TABLE,
      Item: group,
    }));

    await logAuditEvent(currentUserId, 'UPDATE_GROUP', 'group', groupId, { updates: body, previousState });
    await logGroupAuditEvent(groupId, 'updated', currentUserId, { updates: body });

    return createSuccessResponse(group);
  } catch (error) {
    console.error('Error updating group:', error);
    return createErrorResponse(500, 'Failed to update group', error);
  }
}

async function deleteGroup(groupId: string, currentUserId: string): Promise<APIGatewayProxyResult> {
  try {
    const getCommand = new GetCommand({
      TableName: GROUPS_TABLE,
      Key: { id: groupId },
    });

    const result = await docClient.send(getCommand);
    if (!result.Item) {
      return createErrorResponse(404, 'Group not found');
    }

    // Delete all group memberships first
    const members = await getGroupMembers(groupId);
    for (const membership of members) {
      await docClient.send(new DeleteCommand({
        TableName: GROUP_MEMBERSHIPS_TABLE,
        Key: { id: membership.id },
      }));
    }

    // Delete the group
    await docClient.send(new DeleteCommand({
      TableName: GROUPS_TABLE,
      Key: { id: groupId },
    }));

    await logAuditEvent(currentUserId, 'DELETE_GROUP', 'group', groupId, { deletedGroup: result.Item, memberCount: members.length });
    await logGroupAuditEvent(groupId, 'deleted', currentUserId, { memberCount: members.length });

    return createSuccessResponse({ message: 'Group deleted successfully', membershipsRemoved: members.length });
  } catch (error) {
    console.error('Error deleting group:', error);
    return createErrorResponse(500, 'Failed to delete group', error);
  }
}

async function addUserToGroup(groupId: string, event: APIGatewayProxyEvent, currentUserId: string): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const { userId, membershipType = 'static', expiresAt } = body;

    if (!userId) {
      return createErrorResponse(400, 'userId is required');
    }

    // Verify group exists
    const groupResult = await docClient.send(new GetCommand({
      TableName: GROUPS_TABLE,
      Key: { id: groupId },
    }));

    if (!groupResult.Item) {
      return createErrorResponse(404, 'Group not found');
    }

    // Verify user exists
    const userResult = await docClient.send(new GetCommand({
      TableName: USERS_TABLE,
      Key: { id: userId },
    }));

    if (!userResult.Item) {
      return createErrorResponse(404, 'User not found');
    }

    // Add membership record
    await addGroupMembershipRecord(userId, groupId, membershipType, currentUserId, 'manual', expiresAt);

    return createSuccessResponse({
      message: 'User added to group successfully',
      userId,
      groupId,
      membershipType,
    });
  } catch (error) {
    console.error('Error adding user to group:', error);
    return createErrorResponse(500, 'Failed to add user to group', error);
  }
}

async function removeUserFromGroup(groupId: string, userId: string, currentUserId: string): Promise<APIGatewayProxyResult> {
  try {
    // Verify membership exists
    const membershipId = `user#${userId}#group#${groupId}`;
    const result = await docClient.send(new GetCommand({
      TableName: GROUP_MEMBERSHIPS_TABLE,
      Key: { id: membershipId },
    }));

    if (!result.Item) {
      return createErrorResponse(404, 'Membership not found');
    }

    await removeGroupMembershipRecord(userId, groupId, currentUserId);

    return createSuccessResponse({
      message: 'User removed from group successfully',
      userId,
      groupId,
    });
  } catch (error) {
    console.error('Error removing user from group:', error);
    return createErrorResponse(500, 'Failed to remove user from group', error);
  }
}

// =====================================
// User Deletion & Password Management
// =====================================

// Helper function to find user by ID or email in DynamoDB, or fallback to Cognito
async function findUserForDeletion(userId: string): Promise<{
  user: EnhancedUser | null;
  source: 'dynamodb' | 'cognito' | null;
  cognitoGroups?: string[];
}> {
  console.log(`Looking up user: ${userId}`);
  
  // First, try to find by ID in DynamoDB
  try {
    const userResult = await docClient.send(new GetCommand({
      TableName: USERS_TABLE,
      Key: { id: userId },
    }));
    
    if (userResult.Item) {
      console.log('Found user by ID in DynamoDB');
      return { user: userResult.Item as EnhancedUser, source: 'dynamodb' };
    }
  } catch (error) {
    console.warn('Error looking up user by ID:', error);
  }
  
  // If the userId looks like an email, try to find by email in DynamoDB
  if (userId.includes('@')) {
    try {
      const scanResult = await docClient.send(new ScanCommand({
        TableName: USERS_TABLE,
        FilterExpression: 'email = :email',
        ExpressionAttributeValues: {
          ':email': userId,
        },
        Limit: 1,
      }));
      
      if (scanResult.Items && scanResult.Items.length > 0) {
        console.log('Found user by email in DynamoDB');
        return { user: scanResult.Items[0] as EnhancedUser, source: 'dynamodb' };
      }
    } catch (error) {
      console.warn('Error scanning for user by email:', error);
    }
    
    // Try to find the user in Cognito by username (email)
    try {
      const cognitoUser = await cognitoClient.send(new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: userId,
      }));
      
      if (cognitoUser.Username) {
        console.log('Found user in Cognito');
        
        // Get user groups from Cognito
        let cognitoGroups: string[] = [];
        try {
          const groupsResult = await cognitoClient.send(new AdminListGroupsForUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: userId,
          }));
          cognitoGroups = (groupsResult.Groups || []).map(g => g.GroupName || '').filter(Boolean);
        } catch (groupError) {
          console.warn('Failed to get Cognito groups:', groupError);
        }
        
        // Create a synthetic EnhancedUser from Cognito data
        const email = cognitoUser.UserAttributes?.find(a => a.Name === 'email')?.Value || userId;
        const givenName = cognitoUser.UserAttributes?.find(a => a.Name === 'given_name')?.Value || '';
        const familyName = cognitoUser.UserAttributes?.find(a => a.Name === 'family_name')?.Value || '';
        const name = `${givenName} ${familyName}`.trim() || email.split('@')[0];
        
        // Check if user is admin (in workstation-admin group)
        const isAdmin = cognitoGroups.includes('workstation-admin');
        
        const syntheticUser: EnhancedUser = {
          id: userId, // Use the email/username as ID for Cognito-only users
          email,
          name,
          status: cognitoUser.Enabled ? 'active' : 'suspended',
          roleIds: isAdmin ? ['admin'] : [],
          groupIds: [],
          directPermissions: isAdmin ? ['admin:full-access'] : [],
          attributes: {},
          preferences: {},
          createdAt: cognitoUser.UserCreateDate?.toISOString() || new Date().toISOString(),
          updatedAt: cognitoUser.UserLastModifiedDate?.toISOString() || new Date().toISOString(),
          lastLoginAt: undefined,
        };
        
        return { user: syntheticUser, source: 'cognito', cognitoGroups };
      }
    } catch (cognitoError: any) {
      if (cognitoError.name !== 'UserNotFoundException') {
        console.warn('Error looking up user in Cognito:', cognitoError);
      }
    }
  }
  
  return { user: null, source: null };
}

// Get deletion preview - shows user data and associated resources
async function getDeletionPreview(userId: string, currentUserId: string): Promise<APIGatewayProxyResult> {
  try {
    // Find user in DynamoDB or Cognito
    const { user, source, cognitoGroups } = await findUserForDeletion(userId);

    if (!user) {
      return createErrorResponse(404, 'User not found', { code: 'USER_NOT_FOUND' });
    }

    console.log(`User found via ${source}: ${user.email}`);

    // Get group memberships from DynamoDB
    const groupMemberships = source === 'dynamodb' ? await getUserGroups(user.id) : [];

    // Get audit log count for this user
    let auditLogCount = 0;
    try {
      const auditScanResult = await docClient.send(new ScanCommand({
        TableName: AUDIT_TABLE,
        FilterExpression: 'userId = :userId OR resourceId = :userId',
        ExpressionAttributeValues: {
          ':userId': user.id,
        },
        Select: 'COUNT',
      }));
      auditLogCount = auditScanResult.Count || 0;
    } catch (error) {
      console.warn('Error getting audit logs:', error);
    }

    // Check if user is an admin
    const isAdmin = user.roleIds?.includes('admin') ||
                    user.directPermissions?.includes('admin:full-access') ||
                    (cognitoGroups && cognitoGroups.includes('workstation-admin'));

    // Count active admins to check if this is the last one
    let adminCount = 0;
    if (isAdmin) {
      // Check DynamoDB admins
      try {
        const usersResult = await docClient.send(new ScanCommand({
          TableName: USERS_TABLE,
          FilterExpression: 'contains(roleIds, :admin) OR contains(directPermissions, :fullAccess)',
          ExpressionAttributeValues: {
            ':admin': 'admin',
            ':fullAccess': 'admin:full-access',
          },
        }));
        adminCount = (usersResult.Items || []).filter(u => u.status === 'active').length;
      } catch (error) {
        console.warn('Error counting admins:', error);
      }
      
      // If no DynamoDB admins found but user is Cognito admin, assume at least 1
      if (adminCount === 0 && isAdmin) {
        adminCount = 1;
      }
    }

    // Check restrictions
    const restrictions: string[] = [];
    const warnings: string[] = [];
    
    // Check if trying to delete self (compare by email since IDs might differ)
    const currentUserEmail = await getCurrentUserEmail(currentUserId);
    if (user.email === currentUserEmail || userId === currentUserId) {
      restrictions.push('Cannot delete your own account');
    }
    
    if (isAdmin && adminCount <= 1) {
      restrictions.push('Cannot delete the last administrator');
    }

    if (isAdmin) {
      warnings.push('User is an administrator. Ensure another admin exists before deletion.');
    }

    if (groupMemberships.length > 0) {
      warnings.push(`User is a member of ${groupMemberships.length} group(s). Memberships will be removed.`);
    }
    
    if (cognitoGroups && cognitoGroups.length > 0) {
      warnings.push(`User is in ${cognitoGroups.length} Cognito group(s): ${cognitoGroups.join(', ')}`);
    }
    
    if (source === 'cognito') {
      warnings.push('User exists only in Cognito (not in application database). Deletion will remove from Cognito.');
    }

    // Log that preview was viewed
    await logAuditEvent(currentUserId, 'DELETION_PREVIEW_VIEWED', 'user', userId, { source });

    return createSuccessResponse({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
      source,
      associatedData: {
        groupMemberships: {
          count: groupMemberships.length,
          items: groupMemberships.map(m => ({
            groupId: m.groupId,
            membershipType: m.membershipType,
          })),
        },
        cognitoGroups: cognitoGroups || [],
        auditLogEntries: auditLogCount,
        savedPreferences: Object.keys(user.preferences || {}).length,
      },
      deletionRestrictions: {
        canSoftDelete: restrictions.length === 0,
        canHardDelete: restrictions.length === 0,
        restrictions,
        warnings,
      },
    });

  } catch (error) {
    console.error('Error getting deletion preview:', error);
    return createErrorResponse(500, 'Failed to get deletion preview', error);
  }
}

// Helper to get current user's email
async function getCurrentUserEmail(userId: string): Promise<string | null> {
  try {
    // Try DynamoDB first
    const result = await docClient.send(new GetCommand({
      TableName: USERS_TABLE,
      Key: { id: userId },
    }));
    if (result.Item) {
      return result.Item.email;
    }
    
    // If userId looks like an email, return it
    if (userId.includes('@')) {
      return userId;
    }
    
    return null;
  } catch {
    return null;
  }
}

// Soft delete user - disable account but preserve data
async function softDeleteUser(userId: string, event: APIGatewayProxyEvent, currentUserId: string): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const { reason, notes, notifyUser = false, retentionDays = 90 } = body;

    // Validate not deleting self
    const currentUserEmail = await getCurrentUserEmail(currentUserId);
    if (userId === currentUserId || (currentUserEmail && userId === currentUserEmail)) {
      return createErrorResponse(400, 'Cannot delete your own account', { code: 'SELF_DELETION' });
    }

    // Find user in DynamoDB or Cognito
    const { user, source, cognitoGroups } = await findUserForDeletion(userId);

    if (!user) {
      return createErrorResponse(404, 'User not found', { code: 'USER_NOT_FOUND' });
    }

    // Check if already deleted
    if (user.status === 'deleted') {
      return createErrorResponse(409, 'User is already deleted', { code: 'ALREADY_DELETED' });
    }

    // Check if last admin
    const isAdmin = user.roleIds?.includes('admin') ||
                    user.directPermissions?.includes('admin:full-access');
    
    if (isAdmin) {
      const usersResult = await docClient.send(new ScanCommand({
        TableName: USERS_TABLE,
        FilterExpression: '(contains(roleIds, :admin) OR contains(directPermissions, :fullAccess)) AND #status = :active',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':admin': 'admin',
          ':fullAccess': 'admin:full-access',
          ':active': 'active',
        },
      }));
      
      const activeAdmins = (usersResult.Items || []).filter(u => u.id !== userId);
      if (activeAdmins.length === 0) {
        return createErrorResponse(400, 'Cannot delete the last administrator', { code: 'LAST_ADMIN' });
      }
    }

    const now = new Date().toISOString();
    const purgeDate = new Date();
    purgeDate.setDate(purgeDate.getDate() + retentionDays);
    const scheduledPurgeDate = purgeDate.toISOString();

    // Create deleted user record for audit trail
    const deletedUserRecord: DeletedUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      deletionType: 'soft',
      deletedAt: now,
      deletedBy: currentUserId,
      reason,
      notes,
      scheduledPurgeDate,
      originalData: {
        roleIds: user.roleIds || [],
        groupIds: user.groupIds || [],
        attributes: user.attributes || {},
        preferences: user.preferences || {},
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
      restorable: source === 'dynamodb', // Only DynamoDB users can be restored
      ttl: Math.floor(purgeDate.getTime() / 1000), // DynamoDB TTL
    };

    // Save to DeletedUsers table for audit trail
    await docClient.send(new PutCommand({
      TableName: DELETED_USERS_TABLE,
      Item: deletedUserRecord,
    }));

    const previousStatus = user.status;

    // Update DynamoDB record only if user exists there
    if (source === 'dynamodb') {
      user.status = 'deleted';
      user.deletedAt = now;
      user.deletedBy = currentUserId;
      user.deletionType = 'soft';
      user.scheduledPurgeDate = scheduledPurgeDate;
      user.deletionReason = reason;
      user.updatedAt = now;

      await docClient.send(new PutCommand({
        TableName: USERS_TABLE,
        Item: user,
      }));
    }

    // Disable user in Cognito
    let cognitoDisabled = false;
    try {
      await cognitoClient.send(new AdminDisableUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: user.email,
      }));
      cognitoDisabled = true;
    } catch (cognitoError: any) {
      // If user not found in Cognito, that's ok for DynamoDB-only users
      if (cognitoError.name !== 'UserNotFoundException') {
        console.warn('Failed to disable Cognito user:', cognitoError);
      }
    }

    // Remove group memberships (for DynamoDB users)
    let groupMemberships: GroupMembership[] = [];
    if (source === 'dynamodb') {
      groupMemberships = await getUserGroups(user.id);
      for (const membership of groupMemberships) {
        await removeGroupMembershipRecord(user.id, membership.groupId, currentUserId);
      }
    }

    // Log audit event
    await logAuditEvent(currentUserId, 'USER_SOFT_DELETE', 'user', userId, {
      previousStatus,
      reason,
      notes,
      groupMembershipsRemoved: groupMemberships.length,
    });

    // Send notification email if requested
    if (notifyUser && user.email) {
      try {
        await sendUserNotificationEmail(user.email, 'account_disabled', {
          userName: user.name,
          reason,
        });
      } catch (emailError) {
        console.warn('Failed to send notification email:', emailError);
      }
    }

    return createSuccessResponse({
      success: true,
      message: 'User successfully disabled',
      deletedUser: {
        id: userId,
        email: user.email,
        previousStatus,
        newStatus: 'deleted',
        deletionType: 'soft',
        deletedAt: now,
        deletedBy: currentUserId,
        scheduledPurgeDate,
        canRestore: true,
      },
      actions: {
        groupMembershipsRemoved: groupMemberships.length,
        cognitoUserDisabled: cognitoDisabled,
        notificationsSent: notifyUser ? ['user'] : [],
      },
      auditLogId: randomUUID(),
    });

  } catch (error) {
    console.error('Error soft deleting user:', error);
    return createErrorResponse(500, 'Failed to soft delete user', error);
  }
}

// Hard delete user - permanently remove all data
async function hardDeleteUser(userId: string, event: APIGatewayProxyEvent, currentUserId: string): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const { confirmationEmail, reason, acknowledgements } = body;

    // Validate acknowledgements
    if (!acknowledgements?.understandIrreversible || !acknowledgements?.verifiedDeletion) {
      return createErrorResponse(400, 'Required acknowledgements not provided', { code: 'ACKNOWLEDGEMENT_REQUIRED' });
    }

    // Validate not deleting self
    const currentUserEmail = await getCurrentUserEmail(currentUserId);
    if (userId === currentUserId || (currentUserEmail && userId === currentUserEmail)) {
      return createErrorResponse(400, 'Cannot delete your own account', { code: 'SELF_DELETION' });
    }

    // Find user in DynamoDB or Cognito
    const { user, source, cognitoGroups } = await findUserForDeletion(userId);

    if (!user) {
      return createErrorResponse(404, 'User not found', { code: 'USER_NOT_FOUND' });
    }

    // Validate confirmation email matches
    if (confirmationEmail && confirmationEmail !== user.email) {
      return createErrorResponse(400, 'Confirmation email does not match', { code: 'EMAIL_MISMATCH' });
    }

    // Check if last admin
    const isAdmin = user.roleIds?.includes('admin') ||
                    user.directPermissions?.includes('admin:full-access') ||
                    (cognitoGroups && cognitoGroups.includes('workstation-admin'));
    
    if (isAdmin) {
      // Count DynamoDB admins
      const usersResult = await docClient.send(new ScanCommand({
        TableName: USERS_TABLE,
        FilterExpression: '(contains(roleIds, :admin) OR contains(directPermissions, :fullAccess)) AND #status = :active',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':admin': 'admin',
          ':fullAccess': 'admin:full-access',
          ':active': 'active',
        },
      }));
      
      const activeAdmins = (usersResult.Items || []).filter(u => u.id !== userId && u.email !== userId);
      // If Cognito-only admin with no DynamoDB admins, allow only if there are other Cognito admins
      if (activeAdmins.length === 0 && source === 'cognito') {
        // TODO: Could check Cognito workstation-admin group for other admins
        // For now, prevent deletion of what appears to be the last admin
        return createErrorResponse(400, 'Cannot delete the last administrator', { code: 'LAST_ADMIN' });
      }
      if (activeAdmins.length === 0) {
        return createErrorResponse(400, 'Cannot delete the last administrator', { code: 'LAST_ADMIN' });
      }
    }

    const now = new Date().toISOString();

    // Remove group memberships (only for DynamoDB users)
    let groupMemberships: GroupMembership[] = [];
    if (source === 'dynamodb') {
      groupMemberships = await getUserGroups(user.id);
      for (const membership of groupMemberships) {
        try {
          await docClient.send(new DeleteCommand({
            TableName: GROUP_MEMBERSHIPS_TABLE,
            Key: { id: membership.id },
          }));
        } catch (err) {
          console.warn(`Failed to delete group membership ${membership.id}:`, err);
        }
      }
    }

    // Delete from Cognito
    let cognitoDeleted = false;
    try {
      await cognitoClient.send(new AdminDeleteUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: user.email,
      }));
      cognitoDeleted = true;
    } catch (cognitoError: any) {
      if (cognitoError.name !== 'UserNotFoundException') {
        console.warn('Failed to delete Cognito user:', cognitoError);
      }
    }

    // Delete from Users table (only if exists in DynamoDB)
    if (source === 'dynamodb') {
      await docClient.send(new DeleteCommand({
        TableName: USERS_TABLE,
        Key: { id: user.id },
      }));
    }

    // Delete from DeletedUsers table if exists
    try {
      await docClient.send(new DeleteCommand({
        TableName: DELETED_USERS_TABLE,
        Key: { id: user.id },
      }));
    } catch (err) {
      // Ignore - may not exist
    }

    // Log audit event (anonymize user data in log)
    await logAuditEvent(currentUserId, 'USER_HARD_DELETE', 'user', userId, {
      deletedEmail: user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3'),
      reason,
      acknowledgements,
      groupMembershipsRemoved: groupMemberships.length,
      cognitoDeleted,
    });

    return createSuccessResponse({
      success: true,
      message: 'User permanently deleted',
      deletedUser: {
        id: userId,
        email: user.email,
        deletionType: 'hard',
        deletedAt: now,
        deletedBy: currentUserId,
      },
      actions: {
        groupMembershipsRemoved: groupMemberships.length,
        cognitoUserDeleted: cognitoDeleted,
        dynamoDBRecordsDeleted: 1,
      },
      auditLogId: randomUUID(),
    });

  } catch (error) {
    console.error('Error hard deleting user:', error);
    return createErrorResponse(500, 'Failed to hard delete user', error);
  }
}

// Restore soft-deleted user
async function restoreUser(userId: string, event: APIGatewayProxyEvent, currentUserId: string): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const { restoreGroupMemberships = true, notifyUser = true } = body;

    // Get user data
    const userResult = await docClient.send(new GetCommand({
      TableName: USERS_TABLE,
      Key: { id: userId },
    }));

    if (!userResult.Item) {
      return createErrorResponse(404, 'User not found', { code: 'USER_NOT_FOUND' });
    }

    const user = userResult.Item as EnhancedUser;

    // Check if user is soft-deleted and can be restored
    if (user.status !== 'deleted' || user.deletionType !== 'soft') {
      return createErrorResponse(400, 'User is not soft-deleted and cannot be restored', { code: 'NOT_RESTORABLE' });
    }

    // Get deleted user record for original data
    const deletedUserResult = await docClient.send(new GetCommand({
      TableName: DELETED_USERS_TABLE,
      Key: { id: userId },
    }));

    if (!deletedUserResult.Item) {
      return createErrorResponse(400, 'Deleted user record not found - retention period may have expired', { code: 'RESTORE_EXPIRED' });
    }

    const deletedUser = deletedUserResult.Item as DeletedUser;
    const now = new Date().toISOString();

    // Restore user
    user.status = 'active';
    user.deletedAt = undefined;
    user.deletedBy = undefined;
    user.deletionType = undefined;
    user.scheduledPurgeDate = undefined;
    user.deletionReason = undefined;
    user.updatedAt = now;

    await docClient.send(new PutCommand({
      TableName: USERS_TABLE,
      Item: user,
    }));

    // Enable user in Cognito
    let cognitoEnabled = false;
    try {
      await cognitoClient.send(new AdminEnableUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: user.email,
      }));
      cognitoEnabled = true;
    } catch (cognitoError) {
      console.warn('Failed to enable Cognito user:', cognitoError);
    }

    // Restore group memberships if requested
    let membershipsRestored = 0;
    if (restoreGroupMemberships && deletedUser.originalData.groupIds) {
      for (const groupId of deletedUser.originalData.groupIds) {
        try {
          await addGroupMembershipRecord(userId, groupId, 'static', currentUserId, 'restored');
          membershipsRestored++;
        } catch (err) {
          console.warn(`Failed to restore group membership ${groupId}:`, err);
        }
      }
    }

    // Delete from DeletedUsers table
    await docClient.send(new DeleteCommand({
      TableName: DELETED_USERS_TABLE,
      Key: { id: userId },
    }));

    // Log audit event
    await logAuditEvent(currentUserId, 'USER_RESTORED', 'user', userId, {
      restoreGroupMemberships,
      membershipsRestored,
    });

    // Send notification email if requested
    if (notifyUser && user.email) {
      try {
        await sendUserNotificationEmail(user.email, 'account_restored', {
          userName: user.name,
        });
      } catch (emailError) {
        console.warn('Failed to send notification email:', emailError);
      }
    }

    return createSuccessResponse({
      success: true,
      message: 'User successfully restored',
      restoredUser: {
        id: userId,
        email: user.email,
        status: 'active',
        restoredAt: now,
        restoredBy: currentUserId,
      },
      actions: {
        groupMembershipsRestored: membershipsRestored,
        cognitoUserEnabled: cognitoEnabled,
        notificationsSent: notifyUser ? ['user'] : [],
      },
      auditLogId: randomUUID(),
    });

  } catch (error) {
    console.error('Error restoring user:', error);
    return createErrorResponse(500, 'Failed to restore user', error);
  }
}

// Set user password
async function setUserPassword(userId: string, event: APIGatewayProxyEvent, currentUserId: string): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const {
      password,
      forceChangeOnLogin = true,
      temporary = false,
      expiresIn,
      notifications = { notifyUser: true, includePasswordInEmail: false, notifyAdmin: false },
      reason
    } = body;

    // Validate not resetting own password through admin
    const currentUserEmail = await getCurrentUserEmail(currentUserId);
    if (userId === currentUserId || (currentUserEmail && userId === currentUserEmail)) {
      return createErrorResponse(400, 'Cannot reset your own password through admin interface', { code: 'SELF_PASSWORD_RESET' });
    }

    // Validate password is provided
    if (!password) {
      return createErrorResponse(400, 'Password is required', { code: 'INVALID_REQUEST' });
    }

    // Find user in DynamoDB or Cognito
    const { user, source } = await findUserForDeletion(userId);

    if (!user) {
      return createErrorResponse(404, 'User not found', { code: 'USER_NOT_FOUND' });
    }

    // Validate password strength
    const policy = await getPasswordPolicy();
    const validation = validatePassword(password, policy, user.email);
    
    if (!validation.valid) {
      return createErrorResponse(400, 'Password does not meet requirements', {
        code: 'INVALID_PASSWORD',
        details: validation
      });
    }

    // Set password in Cognito
    try {
      await cognitoClient.send(new AdminSetUserPasswordCommand({
        UserPoolId: USER_POOL_ID,
        Username: user.email,
        Password: password,
        Permanent: !temporary,
      }));
    } catch (cognitoError: any) {
      console.error('Failed to set Cognito password:', cognitoError);
      return createErrorResponse(500, 'Failed to update password in authentication system', {
        code: 'COGNITO_ERROR',
        error: cognitoError.message
      });
    }

    const now = new Date().toISOString();
    let expiresAt: string | undefined;
    
    if (temporary && expiresIn) {
      const expDate = new Date();
      const hours = parseInt(expiresIn.replace('h', ''));
      expDate.setHours(expDate.getHours() + (hours || 24));
      expiresAt = expDate.toISOString();
    }

    // Create password reset record
    const resetRecord: PasswordResetRecord = {
      id: randomUUID(),
      userId,
      email: user.email,
      resetType: 'admin_set',
      temporary,
      expiresAt,
      forceChangeOnLogin,
      createdAt: now,
      createdBy: currentUserId,
      reason,
      notifications: {
        userNotified: notifications.notifyUser,
        adminNotified: notifications.notifyAdmin,
        includePasswordInEmail: notifications.includePasswordInEmail,
      },
      status: 'active',
    };

    await docClient.send(new PutCommand({
      TableName: PASSWORD_RESET_TABLE,
      Item: resetRecord,
    }));

    // Log audit event
    await logAuditEvent(currentUserId, 'PASSWORD_SET', 'user', userId, {
      passwordType: 'custom',
      temporary,
      forceChangeOnLogin,
      reason,
    });

    // Send notifications
    let userNotified = false;
    const adminNotified = false;

    if (notifications.notifyUser && user.email) {
      try {
        await sendUserNotificationEmail(user.email, 'password_reset', {
          userName: user.name,
          includePassword: notifications.includePasswordInEmail,
          password: notifications.includePasswordInEmail ? password : undefined,
          forceChangeOnLogin,
          temporary,
          expiresAt,
        });
        userNotified = true;
      } catch (emailError) {
        console.warn('Failed to send user notification email:', emailError);
      }
    }

    return createSuccessResponse({
      success: true,
      message: 'Password updated successfully',
      details: {
        userId,
        email: user.email,
        passwordType: 'custom',
        temporary,
        expiresAt,
        forceChangeOnLogin,
        updatedAt: now,
        updatedBy: currentUserId,
      },
      notifications: {
        userNotified,
        adminNotified,
      },
      auditLogId: resetRecord.id,
    });

  } catch (error) {
    console.error('Error setting user password:', error);
    return createErrorResponse(500, 'Failed to set user password', error);
  }
}

// Generate temporary password for user
async function generateUserPassword(userId: string, event: APIGatewayProxyEvent, currentUserId: string): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const {
      expiresIn = '24h',
      length = 16,
      forceChangeOnLogin = true,
      notifications = { notifyUser: true, includePasswordInEmail: true, notifyAdmin: false },
      reason
    } = body;

    // Validate not resetting own password through admin
    const currentUserEmail = await getCurrentUserEmail(currentUserId);
    if (userId === currentUserId || (currentUserEmail && userId === currentUserEmail)) {
      return createErrorResponse(400, 'Cannot reset your own password through admin interface', { code: 'SELF_PASSWORD_RESET' });
    }

    // Find user in DynamoDB or Cognito
    const { user, source } = await findUserForDeletion(userId);

    if (!user) {
      return createErrorResponse(404, 'User not found', { code: 'USER_NOT_FOUND' });
    }

    // Generate secure password
    const generatedPassword = generateSecurePassword(length);

    // Set password in Cognito
    try {
      await cognitoClient.send(new AdminSetUserPasswordCommand({
        UserPoolId: USER_POOL_ID,
        Username: user.email,
        Password: generatedPassword,
        Permanent: false, // Temporary password
      }));
    } catch (cognitoError: any) {
      console.error('Failed to set Cognito password:', cognitoError);
      return createErrorResponse(500, 'Failed to update password in authentication system', {
        code: 'COGNITO_ERROR',
        error: cognitoError.message
      });
    }

    const now = new Date().toISOString();
    const expDate = new Date();
    const hours = parseInt(expiresIn.replace('h', ''));
    expDate.setHours(expDate.getHours() + (hours || 24));
    const expiresAt = expDate.toISOString();

    // Create password reset record
    const resetRecord: PasswordResetRecord = {
      id: randomUUID(),
      userId,
      email: user.email,
      resetType: 'admin_generate',
      temporary: true,
      expiresAt,
      forceChangeOnLogin,
      createdAt: now,
      createdBy: currentUserId,
      reason,
      notifications: {
        userNotified: notifications.notifyUser,
        adminNotified: notifications.notifyAdmin,
        includePasswordInEmail: notifications.includePasswordInEmail,
      },
      status: 'active',
    };

    await docClient.send(new PutCommand({
      TableName: PASSWORD_RESET_TABLE,
      Item: resetRecord,
    }));

    // Log audit event
    await logAuditEvent(currentUserId, 'PASSWORD_GENERATED', 'user', userId, {
      passwordType: 'generated',
      temporary: true,
      forceChangeOnLogin,
      reason,
    });

    // Send notifications
    let userNotified = false;
    const adminNotified = false;

    if (notifications.notifyUser && user.email) {
      try {
        await sendUserNotificationEmail(user.email, 'password_reset', {
          userName: user.name,
          includePassword: notifications.includePasswordInEmail,
          password: notifications.includePasswordInEmail ? generatedPassword : undefined,
          forceChangeOnLogin,
          temporary: true,
          expiresAt,
        });
        userNotified = true;
      } catch (emailError) {
        console.warn('Failed to send user notification email:', emailError);
      }
    }

    return createSuccessResponse({
      success: true,
      message: 'Temporary password generated',
      details: {
        userId,
        email: user.email,
        generatedPassword, // Only shown once in response
        passwordType: 'temporary',
        temporary: true,
        expiresAt,
        forceChangeOnLogin,
        generatedAt: now,
        generatedBy: currentUserId,
      },
      notifications: {
        userNotified,
        adminNotified,
      },
      auditLogId: resetRecord.id,
    });

  } catch (error) {
    console.error('Error generating user password:', error);
    return createErrorResponse(500, 'Failed to generate user password', error);
  }
}

// Helper function to get password policy
async function getPasswordPolicy(): Promise<PasswordPolicy> {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: PASSWORD_POLICY_TABLE,
      Key: { id: 'default' },
    }));
    
    return result.Item as PasswordPolicy || DEFAULT_PASSWORD_POLICY;
  } catch (error) {
    console.warn('Failed to get password policy, using default:', error);
    return DEFAULT_PASSWORD_POLICY;
  }
}

// Validate password against policy
function validatePassword(password: string, policy: PasswordPolicy, email?: string): {
  valid: boolean;
  strength: 'weak' | 'medium' | 'strong' | 'very_strong';
  score: number;
  requirements: Record<string, { required: boolean | number; met: boolean; message: string }>;
  suggestions: string[];
} {
  const requirements: Record<string, { required: boolean | number; met: boolean; message: string }> = {};
  const suggestions: string[] = [];
  let score = 0;

  // Check length
  const meetsMinLength = password.length >= policy.minLength;
  const meetsMaxLength = password.length <= policy.maxLength;
  requirements.minLength = { required: policy.minLength, met: meetsMinLength, message: `At least ${policy.minLength} characters` };
  requirements.maxLength = { required: policy.maxLength, met: meetsMaxLength, message: `No more than ${policy.maxLength} characters` };
  if (meetsMinLength) score += 20;
  if (password.length >= 16) score += 10;
  if (password.length >= 20) score += 10;

  // Check uppercase
  const hasUppercase = /[A-Z]/.test(password);
  requirements.uppercase = { required: policy.requireUppercase, met: hasUppercase || !policy.requireUppercase, message: 'Contains uppercase letter' };
  if (hasUppercase) score += 15;
  if (policy.requireUppercase && !hasUppercase) suggestions.push('Add an uppercase letter');

  // Check lowercase
  const hasLowercase = /[a-z]/.test(password);
  requirements.lowercase = { required: policy.requireLowercase, met: hasLowercase || !policy.requireLowercase, message: 'Contains lowercase letter' };
  if (hasLowercase) score += 15;
  if (policy.requireLowercase && !hasLowercase) suggestions.push('Add a lowercase letter');

  // Check numbers
  const hasNumbers = /[0-9]/.test(password);
  requirements.numbers = { required: policy.requireNumbers, met: hasNumbers || !policy.requireNumbers, message: 'Contains number' };
  if (hasNumbers) score += 15;
  if (policy.requireNumbers && !hasNumbers) suggestions.push('Add a number');

  // Check special characters
  const specialCharsRegex = new RegExp(`[${policy.allowedSpecialChars.replace(/[-\\^$*+?.()|[\]{}]/g, '\\$&')}]`);
  const hasSpecialChars = specialCharsRegex.test(password);
  requirements.specialChars = { required: policy.requireSpecialChars, met: hasSpecialChars || !policy.requireSpecialChars, message: `Contains special character (${policy.allowedSpecialChars})` };
  if (hasSpecialChars) score += 15;
  if (policy.requireSpecialChars && !hasSpecialChars) suggestions.push(`Add a special character like ${policy.allowedSpecialChars.slice(0, 5)}`);

  // Check common passwords
  const isCommon = COMMON_PASSWORDS.includes(password.toLowerCase());
  requirements.notCommon = { required: policy.preventCommonPasswords, met: !isCommon, message: 'Not a commonly used password' };
  if (isCommon) {
    score -= 30;
    suggestions.push('Choose a more unique password');
  }

  // Check username in password
  let containsUsername = false;
  if (email && policy.preventUsernameInPassword) {
    const username = email.split('@')[0].toLowerCase();
    containsUsername = password.toLowerCase().includes(username);
  }
  requirements.notUsername = { required: policy.preventUsernameInPassword, met: !containsUsername, message: 'Does not contain username or email' };
  if (containsUsername) {
    score -= 20;
    suggestions.push('Remove your username or email from the password');
  }

  // Calculate validity
  const valid = Object.values(requirements).every(r => r.met);

  // Determine strength
  let strength: 'weak' | 'medium' | 'strong' | 'very_strong';
  const clampedScore = Math.max(0, Math.min(100, score));
  if (clampedScore >= 90) strength = 'very_strong';
  else if (clampedScore >= 70) strength = 'strong';
  else if (clampedScore >= 50) strength = 'medium';
  else strength = 'weak';

  return {
    valid,
    strength,
    score: clampedScore,
    requirements,
    suggestions,
  };
}

// Generate secure random password
function generateSecurePassword(length: number = 16): string {
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowercase = 'abcdefghjkmnpqrstuvwxyz';
  const numbers = '23456789';
  const special = '!@#$%^&*';
  
  const allChars = uppercase + lowercase + numbers + special;
  
  // Ensure at least one of each type
  const bytes = randomBytes(length);
  let password = '';
  password += uppercase[bytes[0] % uppercase.length];
  password += lowercase[bytes[1] % lowercase.length];
  password += numbers[bytes[2] % numbers.length];
  password += special[bytes[3] % special.length];
  
  for (let i = 4; i < length; i++) {
    password += allChars[bytes[i] % allChars.length];
  }
  
  // Shuffle the password using Fisher-Yates
  const arr = password.split('');
  const shuffleBytes = randomBytes(arr.length);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = shuffleBytes[i] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  
  return arr.join('');
}

// Send user notification email
async function sendUserNotificationEmail(
  toEmail: string,
  templateType: 'password_reset' | 'account_disabled' | 'account_restored',
  data: Record<string, any>
): Promise<void> {
  const subjects: Record<string, string> = {
    password_reset: 'Your password has been reset',
    account_disabled: 'Your account has been disabled',
    account_restored: 'Your account has been restored',
  };

  let bodyText = '';
  
  switch (templateType) {
    case 'password_reset':
      bodyText = `Dear ${data.userName},\n\nYour password has been reset by an administrator.\n\n`;
      if (data.includePassword && data.password) {
        bodyText += `Your new password is: ${data.password}\n\n`;
        bodyText += `⚠️ Important: Please change this password after logging in.\n\n`;
      }
      if (data.temporary) {
        bodyText += `This is a temporary password that will expire on ${data.expiresAt}.\n\n`;
      }
      if (data.forceChangeOnLogin) {
        bodyText += `You will be required to change your password when you next log in.\n\n`;
      }
      break;
      
    case 'account_disabled':
      bodyText = `Dear ${data.userName},\n\nYour account has been disabled by an administrator.\n\n`;
      if (data.reason) {
        bodyText += `Reason: ${data.reason}\n\n`;
      }
      bodyText += `If you believe this is an error, please contact your administrator.\n\n`;
      break;
      
    case 'account_restored':
      bodyText = `Dear ${data.userName},\n\nYour account has been restored and is now active.\n\n`;
      bodyText += `You can now log in to the system.\n\n`;
      break;
  }

  bodyText += `Best regards,\nThe Admin Team`;

  try {
    await sesClient.send(new SendEmailCommand({
      Source: SES_FROM_EMAIL,
      Destination: {
        ToAddresses: [toEmail],
      },
      Message: {
        Subject: {
          Data: subjects[templateType],
        },
        Body: {
          Text: {
            Data: bodyText,
          },
        },
      },
    }));
  } catch (error) {
    console.error('Failed to send email:', error);
    throw error;
  }
}