import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

// Initialize DynamoDB client
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const USER_PROFILES_TABLE = process.env.USER_PROFILES_TABLE || 'UserProfiles';
const USER_POOL_ID = process.env.USER_POOL_ID!;

const jwtVerifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: 'access',
  clientId: null,
});

interface UserProfile {
  userId: string;
  defaultRegion?: string;
  defaultInstanceType?: string;
  defaultAutoTerminateHours?: number;
  preferredWindowsVersion?: string;
  theme?: 'light' | 'dark';
  notifications?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface UserPreferences {
  defaultRegion?: string;
  defaultInstanceType?: string;
  defaultAutoTerminateHours?: number;
  preferredWindowsVersion?: string;
  theme?: 'light' | 'dark';
  notifications?: boolean;
}

export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    const { path, httpMethod } = event;
    const pathParts = path.split('/').filter(Boolean);

    // Extract user ID from JWT token
    const userId = await getUserIdFromEvent(event);
    if (!userId) {
      return createErrorResponse(401, 'Unauthorized - Invalid token');
    }

    switch (httpMethod) {
      case 'GET':
        if (pathParts.includes('profile')) {
          return await getUserProfile(userId);
        }
        break;

      case 'PUT':
        if (pathParts.includes('profile')) {
          const body = JSON.parse(event.body || '{}');
          return await updateUserProfile(userId, body);
        }
        break;

      case 'PATCH':
        if (pathParts.includes('preferences')) {
          const body = JSON.parse(event.body || '{}');
          return await updateUserPreferences(userId, body);
        }
        break;
    }

    return createErrorResponse(400, 'Invalid request');

  } catch (error) {
    console.error('Error:', error);
    return createErrorResponse(500, 'Internal server error', error);
  }
};

async function getUserProfile(userId: string): Promise<APIGatewayProxyResult> {
  try {
    const getCommand = new GetCommand({
      TableName: USER_PROFILES_TABLE,
      Key: { userId }
    });

    const result = await docClient.send(getCommand);

    if (!result.Item) {
      // Create default profile if none exists
      const defaultProfile = await createDefaultUserProfile(userId);
      return createSuccessResponse(defaultProfile);
    }

    return createSuccessResponse(result.Item as UserProfile);

  } catch (error) {
    console.error('Error getting user profile:', error);
    return createErrorResponse(500, 'Failed to get user profile', error);
  }
}

async function createDefaultUserProfile(userId: string): Promise<UserProfile> {
  const now = new Date().toISOString();
  const defaultProfile: UserProfile = {
    userId,
    defaultRegion: 'us-west-2', // Default region
    defaultInstanceType: 'g4dn.xlarge',
    defaultAutoTerminateHours: 8,
    preferredWindowsVersion: 'Windows_Server-2022-English-Full-Base',
    theme: 'light',
    notifications: true,
    createdAt: now,
    updatedAt: now,
  };

  const putCommand = new PutCommand({
    TableName: USER_PROFILES_TABLE,
    Item: defaultProfile,
    ConditionExpression: 'attribute_not_exists(userId)' // Only create if doesn't exist
  });

  try {
    await docClient.send(putCommand);
    console.log(`Created default profile for user: ${userId}`);
    return defaultProfile;
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      // Profile was created by another request, fetch it
      const getCommand = new GetCommand({
        TableName: USER_PROFILES_TABLE,
        Key: { userId }
      });
      
      const result = await docClient.send(getCommand);
      return result.Item as UserProfile;
    }
    throw error;
  }
}

async function updateUserProfile(userId: string, profileData: Partial<UserProfile>): Promise<APIGatewayProxyResult> {
  try {
    // Remove fields that shouldn't be updated directly
    const { userId: _, createdAt, ...updateData } = profileData;
    
    const now = new Date().toISOString();
    updateData.updatedAt = now;

    // Build update expression
    const updateExpressionParts: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {};

    Object.entries(updateData).forEach(([key, value], index) => {
      const nameKey = `#${key}`;
      const valueKey = `:val${index}`;
      
      updateExpressionParts.push(`${nameKey} = ${valueKey}`);
      expressionAttributeNames[nameKey] = key;
      expressionAttributeValues[valueKey] = value;
    });

    const updateCommand = new UpdateCommand({
      TableName: USER_PROFILES_TABLE,
      Key: { userId },
      UpdateExpression: `SET ${updateExpressionParts.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    });

    const result = await docClient.send(updateCommand);
    
    return createSuccessResponse({
      message: 'Profile updated successfully',
      profile: result.Attributes
    });

  } catch (error) {
    console.error('Error updating user profile:', error);
    return createErrorResponse(500, 'Failed to update user profile', error);
  }
}

async function updateUserPreferences(userId: string, preferences: UserPreferences): Promise<APIGatewayProxyResult> {
  try {
    const validPreferences = validatePreferences(preferences);
    
    // Check if profile exists, create if not
    let profile: UserProfile;
    try {
      const getCommand = new GetCommand({
        TableName: USER_PROFILES_TABLE,
        Key: { userId }
      });
      
      const result = await docClient.send(getCommand);
      if (!result.Item) {
        profile = await createDefaultUserProfile(userId);
      } else {
        profile = result.Item as UserProfile;
      }
    } catch (error) {
      profile = await createDefaultUserProfile(userId);
    }

    // Update only the preferences
    const updateData = {
      ...validPreferences,
      updatedAt: new Date().toISOString()
    };

    return await updateUserProfile(userId, updateData);

  } catch (error) {
    console.error('Error updating user preferences:', error);
    return createErrorResponse(500, 'Failed to update user preferences', error);
  }
}

function validatePreferences(preferences: UserPreferences): UserPreferences {
  const validated: UserPreferences = {};

  if (preferences.defaultRegion) {
    // Basic region validation (should be valid AWS region format)
    if (/^[a-z]{2}-[a-z]+-\d+$/.test(preferences.defaultRegion)) {
      validated.defaultRegion = preferences.defaultRegion;
    }
  }

  if (preferences.defaultInstanceType) {
    // Validate instance type format
    if (/^[gm]\d+[a-z]*\.(nano|micro|small|medium|large|xlarge|\d+xlarge)$/.test(preferences.defaultInstanceType)) {
      validated.defaultInstanceType = preferences.defaultInstanceType;
    }
  }

  if (preferences.defaultAutoTerminateHours !== undefined) {
    // Validate auto-terminate hours (0-168 hours = 7 days max)
    const hours = Number(preferences.defaultAutoTerminateHours);
    if (Number.isInteger(hours) && hours >= 0 && hours <= 168) {
      validated.defaultAutoTerminateHours = hours;
    }
  }

  if (preferences.preferredWindowsVersion) {
    // Validate Windows version format
    if (preferences.preferredWindowsVersion.startsWith('Windows_Server-')) {
      validated.preferredWindowsVersion = preferences.preferredWindowsVersion;
    }
  }

  if (preferences.theme) {
    if (['light', 'dark'].includes(preferences.theme)) {
      validated.theme = preferences.theme as 'light' | 'dark';
    }
  }

  if (preferences.notifications !== undefined) {
    validated.notifications = Boolean(preferences.notifications);
  }

  return validated;
}

async function getUserIdFromEvent(event: APIGatewayProxyEvent): Promise<string | null> {
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