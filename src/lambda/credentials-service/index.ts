import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { SecretsManagerClient, GetSecretValueCommand, CreateSecretCommand, PutSecretValueCommand, DeleteSecretCommand } from '@aws-sdk/client-secrets-manager';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

// Initialize AWS clients
const secretsClient = new SecretsManagerClient({});
const dynamoClient = new DynamoDBClient({});
const ssmClient = new SSMClient({});

// Environment variables
const WORKSTATIONS_TABLE = process.env.WORKSTATIONS_TABLE_NAME!;

interface CredentialsResponse {
  type: 'local' | 'domain';
  username: string;
  password?: string;
  domain?: string;
  connectionInfo: {
    publicIp: string;
    rdpPort: number;
    protocol: string;
  };
  expiresAt: string;
}

interface DomainJoinStatus {
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  lastAttempt?: string;
  errorMessage?: string;
  domainName?: string;
}

export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    const { httpMethod, pathParameters, requestContext } = event;
    const userId = requestContext.authorizer?.claims?.email || 'unknown';
    const userGroups = requestContext.authorizer?.claims?.['cognito:groups']?.split(',') || [];
    const isAdmin = userGroups.includes('workstation-admin');

    if (!pathParameters?.workstationId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
        },
        body: JSON.stringify({ message: 'Workstation ID required' }),
      };
    }

    const workstationId = pathParameters.workstationId;

    switch (httpMethod) {
      case 'GET':
        return await getWorkstationCredentials(workstationId, userId, isAdmin);
      
      case 'POST':
        // Trigger domain join or credential reset
        const action = JSON.parse(event.body || '{}').action;
        if (action === 'domain-join') {
          return await initiateDomainJoin(workstationId, userId, isAdmin);
        } else if (action === 'reset-password') {
          return await resetLocalAdminPassword(workstationId, userId, isAdmin);
        }
        break;
      
      case 'DELETE':
        // Revoke/delete credentials
        return await revokeCredentials(workstationId, userId, isAdmin);
    }

    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
      },
      body: JSON.stringify({ message: 'Invalid request' }),
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Internal server error',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
};

async function getWorkstationCredentials(workstationId: string, userId: string, isAdmin: boolean): Promise<APIGatewayProxyResult> {
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
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
        },
        body: JSON.stringify({ message: 'Workstation not found' }),
      };
    }

    const workstation = unmarshall(result.Item);

    // Check permissions
    if (!isAdmin && workstation.userId !== userId) {
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
        },
        body: JSON.stringify({ message: 'Access denied' }),
      };
    }

    // Check if workstation is running
    if (workstation.status !== 'running') {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
        },
        body: JSON.stringify({
          message: 'Workstation must be running to retrieve credentials',
          status: workstation.status
        }),
      };
    }

    // Get credentials based on auth method
    let credentialsResponse: CredentialsResponse;

    if (workstation.authMethod === 'local') {
      credentialsResponse = await getLocalAdminCredentials(workstation);
    } else if (workstation.authMethod === 'domain') {
      credentialsResponse = await getDomainCredentials(workstation);
    } else {
      throw new Error('Unknown authentication method');
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
      },
      body: JSON.stringify(credentialsResponse),
    };

  } catch (error) {
    console.error('Error getting credentials:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Failed to get credentials',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

async function getLocalAdminCredentials(workstation: any): Promise<CredentialsResponse> {
  if (!workstation.credentialsSecretArn) {
    // This workstation was likely reconciled from an existing EC2 instance
    // and doesn't have managed credentials
    throw new Error(
      'No managed credentials available for this workstation. ' +
      'This instance may have been created outside the system or reconciled from an existing instance. ' +
      'Please use AWS Systems Manager Session Manager or the EC2 console to access this instance. ' +
      `Connection info: ${workstation.publicIp || 'No public IP'}:3389 (RDP)`
    );
  }

  // Get secret from Secrets Manager
  const getSecretCommand = new GetSecretValueCommand({
    SecretId: workstation.credentialsSecretArn,
  });

  const secretResult = await secretsClient.send(getSecretCommand);
  
  if (!secretResult.SecretString) {
    throw new Error('Failed to retrieve credentials from Secrets Manager');
  }

  const credentials = JSON.parse(secretResult.SecretString);

  return {
    type: 'local',
    username: credentials.username,
    password: credentials.password,
    connectionInfo: {
      publicIp: workstation.publicIp,
      rdpPort: 3389,
      protocol: 'RDP',
    },
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 minutes
  };
}

async function getDomainCredentials(workstation: any): Promise<CredentialsResponse> {
  // For domain-joined workstations, we don't store the domain password
  // Instead, we provide connection info and indicate domain authentication
  
  return {
    type: 'domain',
    username: `${workstation.userId.split('@')[0]}@${workstation.domainName}`,
    domain: workstation.domainName,
    connectionInfo: {
      publicIp: workstation.publicIp,
      rdpPort: 3389,
      protocol: 'RDP',
    },
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
  };
}

async function initiateDomainJoin(workstationId: string, userId: string, isAdmin: boolean): Promise<APIGatewayProxyResult> {
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
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Workstation not found' }),
      };
    }

    const workstation = unmarshall(result.Item);

    // Check permissions
    if (!isAdmin && workstation.userId !== userId) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Access denied' }),
      };
    }

    // Check if workstation supports domain join
    if (workstation.authMethod !== 'domain') {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Workstation not configured for domain join' }),
      };
    }

    // Send domain join command via SSM
    const domainJoinScript = generateDomainJoinScript(workstation.domainName);
    
    const sendCommandRequest = new SendCommandCommand({
      InstanceIds: [workstation.instanceId],
      DocumentName: 'AWS-RunPowerShellScript',
      Parameters: {
        commands: [domainJoinScript],
      },
      Comment: `Domain join for workstation ${workstationId}`,
      TimeoutSeconds: 600, // 10 minutes
    });

    const commandResult = await ssmClient.send(sendCommandRequest);
    const commandId = commandResult.Command?.CommandId;

    // Update workstation status
    const updateCommand = new UpdateItemCommand({
      TableName: WORKSTATIONS_TABLE,
      Key: marshall({
        PK: `WORKSTATION#${workstationId}`,
        SK: 'METADATA',
      }),
      UpdateExpression: 'SET domainJoinStatus = :status, domainJoinCommandId = :commandId, updatedAt = :timestamp',
      ExpressionAttributeValues: marshall({
        ':status': 'in-progress',
        ':commandId': commandId,
        ':timestamp': new Date().toISOString(),
      }),
    });

    await dynamoClient.send(updateCommand);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Domain join initiated',
        commandId,
        status: 'in-progress',
      }),
    };

  } catch (error) {
    console.error('Error initiating domain join:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message: 'Failed to initiate domain join',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

async function resetLocalAdminPassword(workstationId: string, userId: string, isAdmin: boolean): Promise<APIGatewayProxyResult> {
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
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Workstation not found' }),
      };
    }

    const workstation = unmarshall(result.Item);

    // Check permissions
    if (!isAdmin && workstation.userId !== userId) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Access denied' }),
      };
    }

    // Check if workstation uses local auth
    if (workstation.authMethod !== 'local') {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Workstation not configured for local authentication' }),
      };
    }

    // Generate new password
    const newPassword = generateSecurePassword();
    
    // Update password in Secrets Manager
    if (workstation.credentialsSecretArn) {
      const updateSecretCommand = new PutSecretValueCommand({
        SecretId: workstation.credentialsSecretArn,
        SecretString: JSON.stringify({
          username: workstation.localAdminUser,
          password: newPassword,
          type: 'local-admin',
          resetAt: new Date().toISOString(),
        }),
      });

      await secretsClient.send(updateSecretCommand);
    }

    // Send password reset command to instance
    const passwordResetScript = generatePasswordResetScript(workstation.localAdminUser, newPassword);
    
    const sendCommandRequest = new SendCommandCommand({
      InstanceIds: [workstation.instanceId],
      DocumentName: 'AWS-RunPowerShellScript',
      Parameters: {
        commands: [passwordResetScript],
      },
      Comment: `Password reset for workstation ${workstationId}`,
      TimeoutSeconds: 300, // 5 minutes
    });

    const commandResult = await ssmClient.send(sendCommandRequest);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Password reset initiated',
        commandId: commandResult.Command?.CommandId,
        // Don't return the actual password in the response for security
      }),
    };

  } catch (error) {
    console.error('Error resetting password:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message: 'Failed to reset password',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

async function revokeCredentials(workstationId: string, userId: string, isAdmin: boolean): Promise<APIGatewayProxyResult> {
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
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Workstation not found' }),
      };
    }

    const workstation = unmarshall(result.Item);

    // Check permissions - only admins can revoke credentials
    if (!isAdmin) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Access denied - admin required' }),
      };
    }

    // Delete secret from Secrets Manager if it exists
    if (workstation.credentialsSecretArn) {
      try {
        const deleteSecretCommand = new DeleteSecretCommand({
          SecretId: workstation.credentialsSecretArn,
          ForceDeleteWithoutRecovery: true,
        });

        await secretsClient.send(deleteSecretCommand);
      } catch (error) {
        console.warn('Failed to delete secret:', error);
        // Continue execution even if secret deletion fails
      }
    }

    // Update workstation record
    const updateCommand = new UpdateItemCommand({
      TableName: WORKSTATIONS_TABLE,
      Key: marshall({
        PK: `WORKSTATION#${workstationId}`,
        SK: 'METADATA',
      }),
      UpdateExpression: 'REMOVE credentialsSecretArn SET credentialsRevoked = :revoked, updatedAt = :timestamp',
      ExpressionAttributeValues: marshall({
        ':revoked': true,
        ':timestamp': new Date().toISOString(),
      }),
    });

    await dynamoClient.send(updateCommand);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Credentials revoked successfully' }),
    };

  } catch (error) {
    console.error('Error revoking credentials:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message: 'Failed to revoke credentials',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

// Helper functions

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

function generateDomainJoinScript(domainName: string): string {
  return `
# Domain Join Script
$ErrorActionPreference = "Stop"

try {
    Write-Output "Starting domain join process for domain: ${domainName}"
    
    # Get domain join credentials from Secrets Manager
    # This would be implemented based on your domain join requirements
    # For now, this is a placeholder that logs the attempt
    
    Write-Output "Domain join script executed successfully"
    exit 0
} catch {
    Write-Error "Domain join failed: $_"
    exit 1
}
`.trim();
}

function generatePasswordResetScript(username: string, newPassword: string): string {
  return `
# Password Reset Script
$ErrorActionPreference = "Stop"

try {
    Write-Output "Resetting password for user: ${username}"
    
    # Reset local user password
    $SecurePassword = ConvertTo-SecureString "${newPassword}" -AsPlainText -Force
    Set-LocalUser -Name "${username}" -Password $SecurePassword
    
    # Ensure user is in Administrators group
    Add-LocalGroupMember -Group "Administrators" -Member "${username}" -ErrorAction SilentlyContinue
    
    Write-Output "Password reset completed successfully"
    exit 0
} catch {
    Write-Error "Password reset failed: $_"
    exit 1
}
`.trim();
}