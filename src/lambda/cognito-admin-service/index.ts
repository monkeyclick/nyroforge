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
import { randomUUID } from 'crypto';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

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
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    const { path, httpMethod } = event;
    const pathParts = path.split('/').filter(Boolean);

    // Check if user has admin permissions from JWT
    const hasAdminPermission = await checkAdminPermission(event);
    if (!hasAdminPermission) {
      return createErrorResponse(403, 'Forbidden - Admin access required');
    }

    // Route handlers
    // Support both /users and legacy /cognito-users path prefixes
    if (pathParts.includes('users')) {
      const usersIdx = pathParts.indexOf('users');
      const username = pathParts[usersIdx + 1]; // undefined for /users (list/create)

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
      if (httpMethod === 'GET' && pathParts.length === 1) {
        return await listRoles();
      } else if (httpMethod === 'POST' && pathParts.length === 1) {
        return await createRole(event);
      } else if (pathParts.length >= 2) {
        const roleId = pathParts[pathParts.indexOf('roles') + 1];
        if (httpMethod === 'GET') return await getRoleById(roleId);
        if (httpMethod === 'PUT') return await updateRole(roleId, event);
        if (httpMethod === 'DELETE') return await deleteRoleById(roleId);
      }
    } else if (pathParts.includes('permissions')) {
      if (httpMethod === 'GET') return await listPermissions();
    } else if (pathParts.includes('audit-logs')) {
      if (httpMethod === 'GET') return await listAuditLogs(event);
    } else if (pathParts.includes('cognito-groups')) {
      if (httpMethod === 'GET' && pathParts.length === 2) {
        return await listGroups();
      } else if (httpMethod === 'POST' && pathParts.length === 2) {
        return await createGroup(event);
      } else if (httpMethod === 'DELETE' && pathParts.length === 3) {
        const groupName = pathParts[2];
        return await deleteGroup(groupName);
      }
    }

    return createErrorResponse(404, 'Route not found');

  } catch (error) {
    console.error('Internal error:', error);
    return createErrorResponse(500, 'An internal error occurred. Please try again later.');
  }
};

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

async function listUsers(): Promise<APIGatewayProxyResult> {
  try {
    const command = new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Limit: 60
    });

    const response = await cognitoClient.send(command);

    const usersWithGroups = await Promise.all(
      (response.Users || []).map(async (user) => {
        let groupNames: string[] = [];
        try {
          const groupsResponse = await cognitoClient.send(new AdminListGroupsForUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: user.Username!
          }));
          groupNames = (groupsResponse.Groups || []).map((g: any) => g.GroupName || '').filter(Boolean);
        } catch (e) {
          // ignore
        }
        return mapCognitoUser(user, groupNames);
      })
    );

    return createSuccessResponse({
      users: usersWithGroups,
      pagination: { total: usersWithGroups.length, page: 1, limit: 60, pages: 1 },
      total: usersWithGroups.length,
    });

  } catch (error) {
    console.error('Error listing users:', error);
    return createErrorResponse(500, 'Failed to list users', error);
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

    // Support both password formats; auto-generate a temp password if none provided
    // (admin creates the account; user will be prompted to set their own password on first login)
    const autoGenPassword = !temporaryPassword && !password
      ? `Tmp-${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 8).toUpperCase()}!1`
      : null;
    const userPassword = temporaryPassword || password || autoGenPassword;
    const isAutoGenerated = !!autoGenPassword;

    if (!email) {
      return createErrorResponse(400, 'Email is required');
    }

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

    const command = new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: userAttributes,
      TemporaryPassword: userPassword,
      MessageAction: 'SUPPRESS'
    });

    const response = await cognitoClient.send(command);

    // Set permanent password if not temporary
    if (!temporaryPassword) {
      const setPasswordCommand = new AdminSetUserPasswordCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        Password: userPassword,
        Permanent: true
      });
      await cognitoClient.send(setPasswordCommand);
    }

    // Add to groups - support both array and single group
    const groupsToAdd = groupName ? [groupName] : groups;
    for (const group of groupsToAdd) {
      try {
        const addToGroupCommand = new AdminAddUserToGroupCommand({
          UserPoolId: USER_POOL_ID,
          Username: email,
          GroupName: group
        });
        await cognitoClient.send(addToGroupCommand);
      } catch (error) {
        console.error(`Error adding user to group ${group}:`, error);
      }
    }

    return createSuccessResponse({
      user: response.User,
      message: 'User created successfully',
      ...(isAutoGenerated && { temporaryPassword: userPassword, note: 'A temporary password was auto-generated. Share it with the user and have them change it on first login.' }),
    });

  } catch (error) {
    console.error('Error creating user:', error);
    return createErrorResponse(500, 'Failed to create user', error);
  }
}

async function deleteUser(username: string): Promise<APIGatewayProxyResult> {
  try {
    const command = new AdminDeleteUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username
    });

    await cognitoClient.send(command);

    return createSuccessResponse({
      message: `User ${username} deleted successfully`
    });

  } catch (error) {
    console.error('Error deleting user:', error);
    return createErrorResponse(500, 'Failed to delete user', error);
  }
}

async function getUser(username: string): Promise<APIGatewayProxyResult> {
  try {
    const response = await cognitoClient.send(new AdminGetUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username
    }));

    let groupNames: string[] = [];
    try {
      const groupsResponse = await cognitoClient.send(new AdminListGroupsForUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: username
      }));
      groupNames = (groupsResponse.Groups || []).map((g: any) => g.GroupName || '').filter(Boolean);
    } catch (e) {
      // ignore
    }

    return createSuccessResponse(mapCognitoUser(response, groupNames));
  } catch (error: any) {
    if (error.name === 'UserNotFoundException') {
      return createErrorResponse(404, 'User not found');
    }
    console.error('Error getting user:', error);
    return createErrorResponse(500, 'Failed to get user', error);
  }
}

async function updateUser(username: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const { name, firstName, lastName, email } = body;

    const userAttributes: { Name: string; Value: string }[] = [];
    if (email) userAttributes.push({ Name: 'email', Value: email });
    if (name) {
      const parts = name.split(' ');
      userAttributes.push({ Name: 'given_name', Value: parts[0] });
      if (parts.length > 1) userAttributes.push({ Name: 'family_name', Value: parts.slice(1).join(' ') });
    } else {
      if (firstName) userAttributes.push({ Name: 'given_name', Value: firstName });
      if (lastName) userAttributes.push({ Name: 'family_name', Value: lastName });
    }

    if (userAttributes.length === 0) {
      return createErrorResponse(400, 'No updatable attributes provided');
    }

    await cognitoClient.send(new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      UserAttributes: userAttributes
    }));

    return createSuccessResponse({ message: `User ${username} updated successfully` });
  } catch (error: any) {
    if (error.name === 'UserNotFoundException') {
      return createErrorResponse(404, 'User not found');
    }
    console.error('Error updating user:', error);
    return createErrorResponse(500, 'Failed to update user', error);
  }
}

// DynamoDB-backed role management (roles are stored in UserRoles table)
async function listRoles(): Promise<APIGatewayProxyResult> {
  try {
    const result = await docClient.send(new ScanCommand({ TableName: ROLES_TABLE }));
    return createSuccessResponse({ roles: result.Items || [] });
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
    const command = new AdminEnableUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username
    });

    await cognitoClient.send(command);

    return createSuccessResponse({
      message: `User ${username} enabled successfully`
    });

  } catch (error) {
    console.error('Error enabling user:', error);
    return createErrorResponse(500, 'Failed to enable user', error);
  }
}

async function disableUser(username: string): Promise<APIGatewayProxyResult> {
  try {
    const command = new AdminDisableUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username
    });

    await cognitoClient.send(command);

    return createSuccessResponse({
      message: `User ${username} disabled successfully`
    });

  } catch (error) {
    console.error('Error disabling user:', error);
    return createErrorResponse(500, 'Failed to disable user', error);
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

    const command = new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      Password: password,
      Permanent: permanent !== false // Default to permanent
    });

    await cognitoClient.send(command);

    return createSuccessResponse({
      message: `Password reset successfully for user ${username}`
    });

  } catch (error: any) {
    console.error('Error resetting password:', error);
    return createErrorResponse(500, 'Failed to reset password', error);
  }
}

async function getUserGroups(username: string): Promise<APIGatewayProxyResult> {
  try {
    const command = new AdminListGroupsForUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username
    });

    const response = await cognitoClient.send(command);

    return createSuccessResponse({
      groups: response.Groups || []
    });

  } catch (error) {
    console.error('Error getting user groups:', error);
    return createErrorResponse(500, 'Failed to get user groups', error);
  }
}

async function addToGroup(username: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const { groupName } = body;

    if (!groupName) {
      return createErrorResponse(400, 'Group name is required');
    }

    const command = new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      GroupName: groupName
    });

    await cognitoClient.send(command);

    return createSuccessResponse({
      message: `User ${username} added to group ${groupName} successfully`
    });

  } catch (error) {
    console.error('Error adding user to group:', error);
    return createErrorResponse(500, 'Failed to add user to group', error);
  }
}

async function removeFromGroup(username: string, groupName: string): Promise<APIGatewayProxyResult> {
  try {
    const command = new AdminRemoveUserFromGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      GroupName: groupName
    });

    await cognitoClient.send(command);

    return createSuccessResponse({
      message: `User ${username} removed from group ${groupName} successfully`
    });

  } catch (error) {
    console.error('Error removing user from group:', error);
    return createErrorResponse(500, 'Failed to remove user from group', error);
  }
}

async function listGroups(): Promise<APIGatewayProxyResult> {
  try {
    const command = new ListGroupsCommand({
      UserPoolId: USER_POOL_ID,
      Limit: 60
    });

    const response = await cognitoClient.send(command);

    return createSuccessResponse({
      groups: response.Groups || []
    });

  } catch (error) {
    console.error('Error listing groups:', error);
    return createErrorResponse(500, 'Failed to list groups', error);
  }
}

async function createGroup(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const { groupName, description, precedence } = body;

    if (!groupName) {
      return createErrorResponse(400, 'Group name is required');
    }

    const command = new CreateGroupCommand({
      UserPoolId: USER_POOL_ID,
      GroupName: groupName,
      Description: description,
      Precedence: precedence !== undefined ? precedence : undefined
    });

    const response = await cognitoClient.send(command);

    return createSuccessResponse({
      group: response.Group,
      message: `Group ${groupName} created successfully`
    });

  } catch (error: any) {
    console.error('Error creating group:', error);
    if (error.name === 'GroupExistsException') {
      return createErrorResponse(409, 'Group already exists');
    }
    return createErrorResponse(500, 'Failed to create group', error);
  }
}

async function deleteGroup(groupName: string): Promise<APIGatewayProxyResult> {
  try {
    const command = new DeleteGroupCommand({
      UserPoolId: USER_POOL_ID,
      GroupName: groupName
    });

    await cognitoClient.send(command);

    return createSuccessResponse({
      message: `Group ${groupName} deleted successfully`
    });

  } catch (error: any) {
    console.error('Error deleting group:', error);
    return createErrorResponse(500, 'Failed to delete group', error);
  }
}

async function checkAdminPermission(event: APIGatewayProxyEvent): Promise<boolean> {
  try {
    // When routed through API Gateway with a Cognito authorizer the token has
    // already been verified — trust the injected claims directly.
    const claims = event.requestContext.authorizer?.claims;
    if (claims) {
      const groups = claims['cognito:groups'];
      if (groups && (groups.includes('workstation-admin') || groups === 'workstation-admin')) {
        return true;
      }
      // Claims present but user is not in the admin group.
      return false;
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
    if (
      Array.isArray(groups)
        ? groups.includes('workstation-admin')
        : groups === 'workstation-admin'
    ) {
      return true;
    }
    return false;
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
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
    },
    body: JSON.stringify({
      message,
      error: error instanceof Error ? error.message : String(error)
    }),
  };
}