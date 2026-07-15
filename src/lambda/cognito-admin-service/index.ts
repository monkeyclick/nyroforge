import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminListGroupsForUserCommand,
  AdminUpdateUserAttributesCommand,
  ListGroupsCommand,
  CreateGroupCommand,
  DeleteGroupCommand,
  AdminEnableUserCommand,
  AdminDisableUserCommand,
  AdminSetUserPasswordCommand
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID, randomInt } from 'crypto';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { isAdmin, ADMIN_GROUP } from '../shared/auth';
import { logEvent } from '../shared/logging';
import { docScanAll } from '../shared/dynamo';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const ROLES_TABLE = process.env.ROLES_TABLE || 'UserRoles';
const AUDIT_TABLE = process.env.AUDIT_TABLE || 'AuditLogs';

const cognitoClient = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

const jwtVerifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: 'access',
  clientId: null,
});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logEvent(event);

  try {
    const { path, httpMethod } = event;
    const pathParts = path.split('/').filter(Boolean).map(p => decodeURIComponent(p));

    // Check if user has admin permissions from JWT
    const hasAdminPermission = await checkAdminPermission(event);
    if (!hasAdminPermission) {
      return createErrorResponse(403, 'Forbidden - Admin access required');
    }

    // Route handlers
    if (pathParts.includes('users')) {
      const usersIdx = pathParts.indexOf('users');
      const rawUsername = pathParts[usersIdx + 1]; // undefined for /users (list/create)
      // The frontend may address users by Cognito sub (the `id` field) or by
      // username/email — resolve subs to usernames once, up front.
      const username = rawUsername ? await resolveUsername(rawUsername) : undefined;

      // Handle group management sub-routes first (more specific)
      if (pathParts.includes('groups') && username) {
        if (httpMethod === 'GET') {
          return await getUserGroups(username);
        } else if (httpMethod === 'POST') {
          return await addToGroup(username, event);
        } else if (httpMethod === 'DELETE') {
          const groupName = pathParts[usersIdx + 3]; // /users/{user}/groups/{group}
          return await removeFromGroup(username, groupName);
        }
      }
      // Handle password reset route
      else if (pathParts.includes('reset-password') && httpMethod === 'POST' && username) {
        return await resetUserPassword(username, event);
      }
      // Handle activate (enable) / suspend (disable) routes
      else if (pathParts.includes('activate') && httpMethod === 'POST' && username) {
        return await enableUser(username);
      } else if (pathParts.includes('suspend') && httpMethod === 'POST' && username) {
        return await disableUser(username);
      }
      // Handle user CRUD routes
      else if (httpMethod === 'GET' && !username) {
        return await listUsers();
      } else if (httpMethod === 'GET' && username) {
        return await getUser(username);
      } else if (httpMethod === 'POST' && !username) {
        return await createUser(event);
      } else if (httpMethod === 'PUT' && username) {
        return await updateUser(username, event);
      } else if (httpMethod === 'DELETE' && username) {
        return await deleteUser(username);
      }
    } else if (pathParts.includes('roles')) {
      const rolesIdx = pathParts.indexOf('roles');
      const roleId = pathParts[rolesIdx + 1];
      if (httpMethod === 'GET' && !roleId) {
        return await listRoles();
      } else if (httpMethod === 'POST' && !roleId) {
        return await createRole(event);
      } else if (roleId) {
        if (httpMethod === 'GET') return await getRoleById(roleId);
        if (httpMethod === 'PUT') return await updateRole(roleId, event);
        if (httpMethod === 'DELETE') return await deleteRoleById(roleId);
      }
    } else if (pathParts.includes('permissions')) {
      if (httpMethod === 'GET') return await listPermissions();
    } else if (pathParts.includes('audit-logs')) {
      if (httpMethod === 'GET') return await listAuditLogs(event);
    } else if (pathParts.includes('cognito-groups')) {
      const groupsIdx = pathParts.indexOf('cognito-groups');
      const groupName = pathParts[groupsIdx + 1];
      if (httpMethod === 'GET' && !groupName) {
        return await listGroups();
      } else if (httpMethod === 'POST' && !groupName) {
        return await createGroup(event);
      } else if (httpMethod === 'DELETE' && groupName) {
        return await deleteGroup(groupName);
      }
    }

    return createErrorResponse(404, 'Route not found');

  } catch (error) {
    console.error('Internal error:', error);
    return createErrorResponse(500, 'An internal error occurred. Please try again later.');
  }
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The frontend uses the Cognito `sub` as the user id, but Cognito admin APIs
 * take the username (which is the email in this pool). Resolve a sub-shaped
 * id to its username; pass anything else straight through.
 */
async function resolveUsername(idOrUsername: string): Promise<string> {
  if (!UUID_RE.test(idOrUsername)) return idOrUsername;
  try {
    const res = await cognitoClient.send(new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Filter: `sub = "${idOrUsername}"`,
      Limit: 1,
    }));
    return res.Users?.[0]?.Username || idOrUsername;
  } catch (error) {
    console.error('Failed to resolve username from sub:', error);
    return idOrUsername;
  }
}

/**
 * Translate Cognito exceptions into actionable client errors instead of a
 * blanket 500. Anything unrecognized still becomes a 500.
 */
function mapCognitoError(error: any, fallbackMessage: string): APIGatewayProxyResult {
  const name = error?.name || '';
  switch (name) {
    case 'UsernameExistsException':
      return createErrorResponse(409, 'A user with this email already exists.');
    case 'UserNotFoundException':
      return createErrorResponse(404, 'User not found.');
    case 'GroupExistsException':
      return createErrorResponse(409, 'A group with this name already exists.');
    case 'ResourceNotFoundException':
      return createErrorResponse(404, error.message || 'Resource not found.');
    case 'InvalidPasswordException':
      return createErrorResponse(400, `Password does not meet requirements: ${error.message}`);
    case 'InvalidParameterException':
      return createErrorResponse(400, error.message || 'Invalid request parameters.');
    case 'NotAuthorizedException':
      return createErrorResponse(403, error.message || 'Not authorized to perform this action.');
    case 'TooManyRequestsException':
    case 'LimitExceededException':
      return createErrorResponse(429, 'Too many requests. Please wait a moment and try again.');
    case 'UserNotConfirmedException':
      return createErrorResponse(409, 'User has not confirmed their account yet.');
    default:
      console.error(fallbackMessage, error);
      return createErrorResponse(500, fallbackMessage, error);
  }
}

function generateTempPassword(): string {
  // Ambiguous characters (I, l, O, 0, 1) excluded — these get read to users
  // over chat/phone.
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*';
  const all = upper + lower + digits + symbols;
  const pick = (set: string, n: number) =>
    Array.from({ length: n }, () => set[randomInt(set.length)]);
  const chars = [
    ...pick(upper, 2),
    ...pick(lower, 2),
    ...pick(digits, 2),
    ...pick(symbols, 1),
    ...pick(all, 7),
  ];
  // Fisher-Yates shuffle so required characters aren't in predictable positions
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function mapCognitoUser(user: any, groups: string[] = []): Record<string, any> {
  const attrs: Record<string, string> = {};
  for (const a of (user.Attributes || user.UserAttributes || [])) {
    attrs[a.Name] = a.Value;
  }
  const givenName = attrs['given_name'] || '';
  const familyName = attrs['family_name'] || '';
  const name = [givenName, familyName].filter(Boolean).join(' ') || attrs['name'] || attrs['email']?.split('@')[0] || 'Unknown';
  const status = !user.Enabled ? 'suspended' :
    user.UserStatus === 'CONFIRMED' ? 'active' :
    user.UserStatus === 'FORCE_CHANGE_PASSWORD' ? 'pending' : 'pending';
  return {
    id: attrs['sub'] || user.Username,
    email: attrs['email'] || user.Username,
    name,
    status,
    username: user.Username,
    roleIds: groups.includes('workstation-admin') ? ['admin'] : [],
    groupIds: groups,
    directPermissions: groups.includes('workstation-admin') ? ['admin:full-access'] : [],
    attributes: attrs,
    preferences: {},
    createdAt: user.UserCreateDate,
    updatedAt: user.UserLastModifiedDate,
    lastLoginAt: undefined,
  };
}

async function getGroupNamesForUser(username: string, attempt = 0): Promise<string[]> {
  try {
    const res = await cognitoClient.send(new AdminListGroupsForUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
    }));
    return (res.Groups || []).map((g: any) => g.GroupName || '').filter(Boolean);
  } catch (error: any) {
    if ((error.name === 'TooManyRequestsException' || error.name === 'LimitExceededException') && attempt < 2) {
      await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
      return getGroupNamesForUser(username, attempt + 1);
    }
    console.error(`Failed to list groups for ${username}:`, error);
    return [];
  }
}

async function fetchMappedUser(username: string): Promise<Record<string, any>> {
  const response = await cognitoClient.send(new AdminGetUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: username,
  }));
  const groups = await getGroupNamesForUser(username);
  return mapCognitoUser(response, groups);
}

async function listUsers(): Promise<APIGatewayProxyResult> {
  try {
    const cognitoUsers: any[] = [];
    let paginationToken: string | undefined;
    let pages = 0;
    do {
      const response: any = await cognitoClient.send(new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Limit: 60,
        PaginationToken: paginationToken,
      }));
      cognitoUsers.push(...(response.Users || []));
      paginationToken = response.PaginationToken;
    } while (paginationToken && ++pages < 10);

    // Chunked group lookups — a full parallel burst trips Cognito admin-API
    // throttling, which used to silently drop group data (and the admin badge
    // derived from it) for random users.
    const usersWithGroups: Record<string, any>[] = [];
    const CHUNK_SIZE = 5;
    for (let i = 0; i < cognitoUsers.length; i += CHUNK_SIZE) {
      const chunk = cognitoUsers.slice(i, i + CHUNK_SIZE);
      const mapped = await Promise.all(
        chunk.map(async (user) => mapCognitoUser(user, await getGroupNamesForUser(user.Username!)))
      );
      usersWithGroups.push(...mapped);
    }

    return createSuccessResponse({
      users: usersWithGroups,
      pagination: { total: usersWithGroups.length, page: 1, limit: usersWithGroups.length, pages: 1 },
      total: usersWithGroups.length,
    });

  } catch (error) {
    return mapCognitoError(error, 'Failed to list users');
  }
}

async function createUser(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const {
      email,
      password,
      temporaryPassword,
      name,
      firstName,
      lastName,
      groups = [],
      groupName
    } = body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return createErrorResponse(400, 'A valid email address is required.');
    }

    // Password semantics:
    //  - `password`          → permanent, user logs straight in
    //  - `temporaryPassword` → user must set their own password on first login
    //  - neither             → auto-generate a temporary one and return it once
    const isPermanent = !!password && !temporaryPassword;
    const isAutoGenerated = !password && !temporaryPassword;
    const userPassword = temporaryPassword || password || generateTempPassword();

    const userAttributes = [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'true' }
    ];

    // Support combined name or separate firstName/lastName
    if (name) {
      const nameParts = name.split(' ');
      if (nameParts.length > 1) {
        userAttributes.push({ Name: 'given_name', Value: nameParts[0] });
        userAttributes.push({ Name: 'family_name', Value: nameParts.slice(1).join(' ') });
      } else {
        userAttributes.push({ Name: 'given_name', Value: name });
      }
    } else {
      if (firstName) {
        userAttributes.push({ Name: 'given_name', Value: firstName });
      }
      if (lastName) {
        userAttributes.push({ Name: 'family_name', Value: lastName });
      }
    }

    const response = await cognitoClient.send(new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: userAttributes,
      TemporaryPassword: userPassword,
      MessageAction: 'SUPPRESS'
    }));

    if (isPermanent) {
      await cognitoClient.send(new AdminSetUserPasswordCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        Password: userPassword,
        Permanent: true
      }));
    }

    // Add to groups - support both array and single group
    const groupsToAdd: string[] = [...new Set<string>([...(groupName ? [groupName] : []), ...groups])];
    const addedGroups: string[] = [];
    const groupErrors: string[] = [];
    for (const group of groupsToAdd) {
      try {
        await cognitoClient.send(new AdminAddUserToGroupCommand({
          UserPoolId: USER_POOL_ID,
          Username: email,
          GroupName: group
        }));
        addedGroups.push(group);
      } catch (error: any) {
        console.error(`Error adding user to group ${group}:`, error);
        groupErrors.push(`${group}: ${error.name === 'ResourceNotFoundException' ? 'group does not exist' : error.message}`);
      }
    }

    return createSuccessResponse({
      user: mapCognitoUser(response.User, addedGroups),
      message: groupErrors.length
        ? `User created, but some group assignments failed — ${groupErrors.join('; ')}`
        : 'User created successfully',
      ...(isAutoGenerated && {
        temporaryPassword: userPassword,
        note: 'A temporary password was auto-generated. Share it with the user; they must set a new password on first login.',
      }),
    });

  } catch (error) {
    return mapCognitoError(error, 'Failed to create user');
  }
}

async function deleteUser(username: string): Promise<APIGatewayProxyResult> {
  try {
    await cognitoClient.send(new AdminDeleteUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username
    }));

    return createSuccessResponse({
      message: `User ${username} deleted successfully`
    });

  } catch (error) {
    return mapCognitoError(error, 'Failed to delete user');
  }
}

async function getUser(username: string): Promise<APIGatewayProxyResult> {
  try {
    return createSuccessResponse(await fetchMappedUser(username));
  } catch (error: any) {
    return mapCognitoError(error, 'Failed to get user');
  }
}

async function updateUser(username: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const { name, firstName, lastName, email, groupIds } = body;

    const userAttributes: { Name: string; Value: string }[] = [];
    if (email) {
      userAttributes.push({ Name: 'email', Value: email });
      userAttributes.push({ Name: 'email_verified', Value: 'true' });
    }
    if (name) {
      const parts = name.split(' ');
      userAttributes.push({ Name: 'given_name', Value: parts[0] });
      if (parts.length > 1) userAttributes.push({ Name: 'family_name', Value: parts.slice(1).join(' ') });
    } else {
      if (firstName) userAttributes.push({ Name: 'given_name', Value: firstName });
      if (lastName) userAttributes.push({ Name: 'family_name', Value: lastName });
    }

    if (userAttributes.length === 0 && !Array.isArray(groupIds)) {
      return createErrorResponse(400, 'No updatable attributes provided');
    }

    if (userAttributes.length > 0) {
      await cognitoClient.send(new AdminUpdateUserAttributesCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        UserAttributes: userAttributes
      }));
    }

    // Sync Cognito group membership to the requested set (group names)
    const groupErrors: string[] = [];
    if (Array.isArray(groupIds)) {
      const current = await getGroupNamesForUser(username);
      const toAdd = groupIds.filter((g: string) => !current.includes(g));
      const toRemove = current.filter((g) => !groupIds.includes(g));
      for (const group of toAdd) {
        try {
          await cognitoClient.send(new AdminAddUserToGroupCommand({
            UserPoolId: USER_POOL_ID, Username: username, GroupName: group
          }));
        } catch (error: any) {
          groupErrors.push(`add ${group}: ${error.name === 'ResourceNotFoundException' ? 'group does not exist' : error.message}`);
        }
      }
      for (const group of toRemove) {
        try {
          await cognitoClient.send(new AdminRemoveUserFromGroupCommand({
            UserPoolId: USER_POOL_ID, Username: username, GroupName: group
          }));
        } catch (error: any) {
          groupErrors.push(`remove ${group}: ${error.message}`);
        }
      }
    }

    const updated = await fetchMappedUser(username);
    if (groupErrors.length) {
      return createSuccessResponse({
        ...updated,
        warning: `Some group changes failed — ${groupErrors.join('; ')}`,
      });
    }
    return createSuccessResponse(updated);
  } catch (error: any) {
    return mapCognitoError(error, 'Failed to update user');
  }
}

// DynamoDB-backed role management (roles are stored in UserRoles table)
async function listRoles(): Promise<APIGatewayProxyResult> {
  try {
    const roles = await docScanAll(docClient, { TableName: ROLES_TABLE });
    return createSuccessResponse({ roles });
  } catch (error) {
    console.error('Error listing roles:', error);
    return createErrorResponse(500, 'Failed to list roles', error);
  }
}

async function getRoleById(roleId: string): Promise<APIGatewayProxyResult> {
  try {
    const result = await docClient.send(new GetCommand({ TableName: ROLES_TABLE, Key: { id: roleId } }));
    if (!result.Item) return createErrorResponse(404, 'Role not found');
    return createSuccessResponse(result.Item);
  } catch (error) {
    console.error('Error getting role:', error);
    return createErrorResponse(500, 'Failed to get role', error);
  }
}

async function createRole(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const { name, description, permissions = [] } = body;
    if (!name || !description) return createErrorResponse(400, 'Name and description are required');
    const now = new Date().toISOString();
    const role = { id: randomUUID(), name, description, permissions, isSystem: 'false', createdAt: now, updatedAt: now };
    await docClient.send(new PutCommand({ TableName: ROLES_TABLE, Item: role }));
    return createSuccessResponse(role);
  } catch (error) {
    console.error('Error creating role:', error);
    return createErrorResponse(500, 'Failed to create role', error);
  }
}

async function updateRole(roleId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const result = await docClient.send(new GetCommand({ TableName: ROLES_TABLE, Key: { id: roleId } }));
    if (!result.Item) return createErrorResponse(404, 'Role not found');
    if (result.Item.isSystem === true || result.Item.isSystem === 'true') return createErrorResponse(403, 'Cannot update system roles');
    const role = { ...result.Item };
    if (body.name !== undefined) role.name = body.name;
    if (body.description !== undefined) role.description = body.description;
    if (body.permissions !== undefined) role.permissions = body.permissions;
    role.updatedAt = new Date().toISOString();
    // GSI requires isSystem as string
    if (typeof role.isSystem === 'boolean') role.isSystem = String(role.isSystem);
    await docClient.send(new PutCommand({ TableName: ROLES_TABLE, Item: role }));
    return createSuccessResponse(role);
  } catch (error) {
    console.error('Error updating role:', error);
    return createErrorResponse(500, 'Failed to update role', error);
  }
}

async function deleteRoleById(roleId: string): Promise<APIGatewayProxyResult> {
  try {
    const result = await docClient.send(new GetCommand({ TableName: ROLES_TABLE, Key: { id: roleId } }));
    if (!result.Item) return createErrorResponse(404, 'Role not found');
    if (result.Item.isSystem === true || result.Item.isSystem === 'true') return createErrorResponse(403, 'Cannot delete system roles');
    await docClient.send(new DeleteCommand({ TableName: ROLES_TABLE, Key: { id: roleId } }));
    return createSuccessResponse({ message: 'Role deleted successfully' });
  } catch (error) {
    console.error('Error deleting role:', error);
    return createErrorResponse(500, 'Failed to delete role', error);
  }
}

async function listPermissions(): Promise<APIGatewayProxyResult> {
  const permissions = [
    'workstations:read', 'workstations:write', 'workstations:delete', 'workstations:manage-all',
    'users:read', 'users:write', 'users:delete',
    'groups:read', 'groups:write', 'groups:delete',
    'roles:read', 'roles:write', 'roles:delete',
    'analytics:read', 'settings:read', 'settings:write', 'admin:full-access',
  ];
  return createSuccessResponse(permissions);
}

async function listAuditLogs(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const params = event.queryStringParameters || {};
    const limit = Math.min(parseInt(params.limit || '50'), 100);
    const result = await docClient.send(new ScanCommand({ TableName: AUDIT_TABLE, Limit: limit }));
    return createSuccessResponse({
      logs: result.Items || [],
      pagination: { total: result.Count || 0, limit },
    });
  } catch (error) {
    console.error('Error listing audit logs:', error);
    return createErrorResponse(500, 'Failed to list audit logs', error);
  }
}

async function enableUser(username: string): Promise<APIGatewayProxyResult> {
  try {
    await cognitoClient.send(new AdminEnableUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username
    }));

    return createSuccessResponse(await fetchMappedUser(username));

  } catch (error) {
    return mapCognitoError(error, 'Failed to enable user');
  }
}

async function disableUser(username: string): Promise<APIGatewayProxyResult> {
  try {
    await cognitoClient.send(new AdminDisableUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username
    }));

    return createSuccessResponse(await fetchMappedUser(username));

  } catch (error) {
    return mapCognitoError(error, 'Failed to disable user');
  }
}

async function resetUserPassword(username: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const { password, permanent } = body;

    if (!password) {
      return createErrorResponse(400, 'Password is required');
    }

    if (password.length < 8) {
      return createErrorResponse(400, 'Password must be at least 8 characters long');
    }

    await cognitoClient.send(new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      Password: password,
      Permanent: permanent !== false // Default to permanent
    }));

    return createSuccessResponse({
      message: `Password reset successfully for user ${username}`
    });

  } catch (error: any) {
    return mapCognitoError(error, 'Failed to reset password');
  }
}

async function getUserGroups(username: string): Promise<APIGatewayProxyResult> {
  try {
    const response = await cognitoClient.send(new AdminListGroupsForUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username
    }));

    return createSuccessResponse({
      groups: response.Groups || []
    });

  } catch (error) {
    return mapCognitoError(error, 'Failed to get user groups');
  }
}

async function addToGroup(username: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const { groupName } = body;

    if (!groupName) {
      return createErrorResponse(400, 'Group name is required');
    }

    await cognitoClient.send(new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      GroupName: groupName
    }));

    return createSuccessResponse({
      message: `User ${username} added to group ${groupName} successfully`
    });

  } catch (error) {
    return mapCognitoError(error, 'Failed to add user to group');
  }
}

async function removeFromGroup(username: string, groupName: string): Promise<APIGatewayProxyResult> {
  try {
    if (!groupName) {
      return createErrorResponse(400, 'Group name is required');
    }

    await cognitoClient.send(new AdminRemoveUserFromGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      GroupName: groupName
    }));

    return createSuccessResponse({
      message: `User ${username} removed from group ${groupName} successfully`
    });

  } catch (error) {
    return mapCognitoError(error, 'Failed to remove user from group');
  }
}

async function listGroups(): Promise<APIGatewayProxyResult> {
  try {
    // ListGroups returns at most 60 per page — follow NextToken so pools
    // with more groups don't silently truncate.
    const groups: any[] = [];
    let nextToken: string | undefined;
    let pages = 0;
    do {
      const response = await cognitoClient.send(new ListGroupsCommand({
        UserPoolId: USER_POOL_ID,
        Limit: 60,
        NextToken: nextToken,
      }));
      groups.push(...(response.Groups || []));
      nextToken = response.NextToken;
    } while (nextToken && ++pages < 10);

    return createSuccessResponse({ groups });

  } catch (error) {
    return mapCognitoError(error, 'Failed to list groups');
  }
}

async function createGroup(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const { groupName, description, precedence } = body;

    if (!groupName) {
      return createErrorResponse(400, 'Group name is required');
    }

    const response = await cognitoClient.send(new CreateGroupCommand({
      UserPoolId: USER_POOL_ID,
      GroupName: groupName,
      Description: description,
      Precedence: precedence !== undefined ? precedence : undefined
    }));

    return createSuccessResponse({
      group: response.Group,
      message: `Group ${groupName} created successfully`
    });

  } catch (error: any) {
    return mapCognitoError(error, 'Failed to create group');
  }
}

async function deleteGroup(groupName: string): Promise<APIGatewayProxyResult> {
  try {
    await cognitoClient.send(new DeleteGroupCommand({
      UserPoolId: USER_POOL_ID,
      GroupName: groupName
    }));

    return createSuccessResponse({
      message: `Group ${groupName} deleted successfully`
    });

  } catch (error: any) {
    return mapCognitoError(error, 'Failed to delete group');
  }
}

async function checkAdminPermission(event: APIGatewayProxyEvent): Promise<boolean> {
  try {
    // When routed through API Gateway with a Cognito authorizer the token has
    // already been verified — trust the injected claims directly.
    const claims = event.requestContext.authorizer?.claims;
    if (claims) {
      // Exact group membership via the shared helper. The previous
      // groups.includes('workstation-admin') was a SUBSTRING match, so a user
      // whose only group was e.g. 'workstation-admin-readonly' (or any other
      // superstring) escalated to full admin on this user-management service.
      return isAdmin(event);
    }

    // No authorizer claims — verify the raw JWT from the Authorization header.
    const authHeader =
      event.headers?.['Authorization'] || event.headers?.['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return false;
    }
    const token = authHeader.slice(7);
    const payload = await jwtVerifier.verify(token);
    const groups = (payload as Record<string, unknown>)['cognito:groups'];
    return Array.isArray(groups)
      ? groups.includes(ADMIN_GROUP)
      : groups === ADMIN_GROUP;
  } catch (error) {
    console.error('Error checking admin permission:', error);
    return false;
  }
}

function createSuccessResponse(data: any): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
    },
    body: JSON.stringify(data),
  };
}

function createErrorResponse(statusCode: number, message: string, error?: any): APIGatewayProxyResult {
  // The underlying error is logged server-side only — echoing error.message
  // to the client leaks table names, ARNs, and other internals.
  if (error !== undefined) {
    console.error(message, error);
  }
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
    },
    body: JSON.stringify({ message }),
  };
}
