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
  ListGroupsCommand,
  CreateGroupCommand,
  DeleteGroupCommand,
  AdminEnableUserCommand,
  AdminDisableUserCommand,
  AdminSetUserPasswordCommand
} from '@aws-sdk/client-cognito-identity-provider';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

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
    if (pathParts.includes('cognito-users')) {
      // Handle group management routes first (more specific)
      if (pathParts.includes('groups')) {
        if (httpMethod === 'GET' && pathParts.length === 4) {
          const username = pathParts[2];
          return await getUserGroups(username);
        } else if (httpMethod === 'POST' && pathParts.length === 4) {
          const username = pathParts[2];
          return await addToGroup(username, event);
        } else if (httpMethod === 'DELETE' && pathParts.length === 5) {
          const username = pathParts[2];
          const groupName = pathParts[4];
          return await removeFromGroup(username, groupName);
        }
      }
      // Handle password reset route
      else if (pathParts.includes('reset-password') && httpMethod === 'POST') {
        const username = pathParts[2];
        return await resetUserPassword(username, event);
      }
      // Handle enable/disable routes
      else if (pathParts.includes('enable') && httpMethod === 'POST') {
        const username = pathParts[2];
        return await enableUser(username);
      } else if (pathParts.includes('disable') && httpMethod === 'POST') {
        const username = pathParts[2];
        return await disableUser(username);
      }
      // Handle user CRUD routes
      else if (httpMethod === 'GET' && pathParts.length === 2) {
        return await listUsers();
      } else if (httpMethod === 'POST' && pathParts.length === 2) {
        return await createUser(event);
      } else if (httpMethod === 'DELETE' && pathParts.length === 3) {
        const username = pathParts[2];
        return await deleteUser(username);
      }
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

async function listUsers(): Promise<APIGatewayProxyResult> {
  try {
    const command = new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Limit: 60
    });

    const response = await cognitoClient.send(command);
    
    // Get groups for each user
    const usersWithGroups = await Promise.all(
      (response.Users || []).map(async (user) => {
        try {
          const groupsCommand = new AdminListGroupsForUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: user.Username!
          });
          const groupsResponse = await cognitoClient.send(groupsCommand);
          
          return {
            ...user,
            Groups: groupsResponse.Groups || []
          };
        } catch (error) {
          console.error(`Error fetching groups for user ${user.Username}:`, error);
          return {
            ...user,
            Groups: []
          };
        }
      })
    );

    return createSuccessResponse({
      users: usersWithGroups,
      total: usersWithGroups.length
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

    // Support both password formats
    const userPassword = temporaryPassword || password;
    
    if (!email || !userPassword) {
      return createErrorResponse(400, 'Email and password are required');
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
      message: 'User created successfully'
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