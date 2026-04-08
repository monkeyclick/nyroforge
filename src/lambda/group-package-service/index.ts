import { 
  DynamoDBClient, 
  QueryCommand, 
  PutItemCommand, 
  UpdateItemCommand, 
  DeleteItemCommand,
  GetItemCommand
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-west-2' });

const BINDINGS_TABLE = process.env.GROUP_PACKAGE_BINDINGS_TABLE || '';
const PACKAGES_TABLE = process.env.BOOTSTRAP_PACKAGES_TABLE || '';
const QUEUE_TABLE = process.env.PACKAGE_QUEUE_TABLE || '';

interface GroupPackageBinding {
  PK: string; // GROUP#<groupId>
  SK: string; // PACKAGE#<packageId>
  packageId: string;
  packageName: string;
  packageDescription?: string;
  autoInstall: string; // "true" or "false" - DynamoDB GSI requires string
  isMandatory: boolean;
  installOrder: number;
  createdAt: string;
  createdBy?: string;
  updatedAt?: string;
}

interface PackageQueueItem {
  PK: string; // WORKSTATION#<workstationId>
  SK: string; // PACKAGE#<packageId>
  workstationId: string;
  packageId: string;
  packageName: string;
  downloadUrl: string;
  installCommand: string;
  installArgs: string;
  status: 'pending' | 'installing' | 'completed' | 'failed';
  installOrder: number;
  required: boolean;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  estimatedInstallTimeMinutes?: number;
  ttl: number;
}

/**
 * Lambda handler for group package management operations
 */
export const handler = async (event: any) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const httpMethod = event.httpMethod || event.requestContext?.http?.method;
  const path = event.path || event.requestContext?.http?.path || '';
  const pathParams = event.pathParameters || {};
  const body = event.body ? JSON.parse(event.body) : {};
  const queryParams = event.queryStringParameters || {};

  try {
    // Extract user info from authorizer context
    const userEmail = event.requestContext?.authorizer?.claims?.email || 'system';
    const userId = event.requestContext?.authorizer?.claims?.sub || 'system';

    // Route to appropriate handler
    if (httpMethod === 'GET' && path.includes('/user/group-packages')) {
      return await getUserGroupPackages(event);
    }
    
    if (httpMethod === 'GET' && path.includes('/workstations/') && path.includes('/packages')) {
      const workstationId = pathParams.workstationId || extractFromPath(path, 'workstations');
      return await getPackageInstallationStatus(workstationId);
    }
    
    if (httpMethod === 'POST' && path.includes('/workstations/') && path.includes('/packages/') && path.includes('/retry')) {
      const workstationId = pathParams.workstationId || extractFromPath(path, 'workstations');
      const packageId = pathParams.packageId || extractFromPath(path, 'packages');
      return await retryPackageInstallation(workstationId, packageId);
    }
    
    if (httpMethod === 'GET' && path.includes('/admin/groups/') && path.includes('/packages')) {
      const groupId = pathParams.groupId || extractFromPath(path, 'groups');
      return await getGroupPackages(groupId);
    }
    
    if (httpMethod === 'POST' && path.includes('/admin/groups/') && path.includes('/packages')) {
      const groupId = pathParams.groupId || extractFromPath(path, 'groups');
      return await addPackageToGroup(groupId, body, userEmail);
    }
    
    if (httpMethod === 'PUT' && path.includes('/admin/groups/') && path.includes('/packages/')) {
      const groupId = pathParams.groupId || extractFromPath(path, 'groups');
      const packageId = pathParams.packageId || extractFromPath(path, 'packages');
      return await updateGroupPackage(groupId, packageId, body, userEmail);
    }
    
    if (httpMethod === 'DELETE' && path.includes('/admin/groups/') && path.includes('/packages/')) {
      const groupId = pathParams.groupId || extractFromPath(path, 'groups');
      const packageId = pathParams.packageId || extractFromPath(path, 'packages');
      return await removePackageFromGroup(groupId, packageId);
    }
    
    if (httpMethod === 'POST' && path.includes('/admin/workstations/') && path.includes('/packages')) {
      const workstationId = pathParams.workstationId || extractFromPath(path, 'workstations');
      return await addPackagesToWorkstation(workstationId, body);
    }
    
    if (httpMethod === 'DELETE' && path.includes('/admin/workstations/') && path.includes('/packages/')) {
      const workstationId = pathParams.workstationId || extractFromPath(path, 'workstations');
      const packageId = pathParams.packageId || extractFromPath(path, 'packages');
      return await removeQueuedPackage(workstationId, packageId);
    }

    return {
      statusCode: 404,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Not Found', path, method: httpMethod })
    };
  } catch (error: any) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ 
        error: 'Internal Server Error', 
        message: error.message 
      })
    };
  }
};

/**
 * Get packages from user's groups that have autoInstall=true
 */
async function getUserGroupPackages(event: any): Promise<any> {
  try {
    // Extract user groups from token claims
    const groups = event.requestContext?.authorizer?.claims?.['cognito:groups'];
    const userGroups = groups ? (typeof groups === 'string' ? [groups] : groups) : [];

    if (userGroups.length === 0) {
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ packages: [] })
      };
    }

    const allPackages: any[] = [];

    // Query each group for packages
    for (const groupId of userGroups) {
      const command = new QueryCommand({
        TableName: BINDINGS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: marshall({
          ':pk': `GROUP#${groupId}`,
          ':sk': 'PACKAGE#'
        })
      });

      const result = await dynamodb.send(command);
      
      if (result.Items) {
        const packages = result.Items.map(item => unmarshall(item));
        
        // Filter for auto-install packages (autoInstall is stored as string)
        const autoInstallPackages = packages.filter((pkg: any) => pkg.autoInstall === 'true' || pkg.autoInstall === true);
        
        allPackages.push(...autoInstallPackages.map((pkg: any) => ({
          packageId: pkg.packageId,
          packageName: pkg.packageName,
          isMandatory: pkg.isMandatory || false,
          autoInstall: pkg.autoInstall,
          installOrder: pkg.installOrder,
          groupName: groupId
        })));
      }
    }

    // Remove duplicates (if package is in multiple groups, keep the one with lowest install order)
    const uniquePackages = Array.from(
      allPackages.reduce((map, pkg) => {
        const existing = map.get(pkg.packageId);
        if (!existing || pkg.installOrder < existing.installOrder) {
          map.set(pkg.packageId, pkg);
        }
        return map;
      }, new Map<string, any>()).values()
    );

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ packages: uniquePackages })
    };
  } catch (error: any) {
    console.error('Error getting user group packages:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: error.message })
    };
  }
}

/**
 * Get installation status for a workstation's packages
 */
async function getPackageInstallationStatus(workstationId: string): Promise<any> {
  try {
    const command = new QueryCommand({
      TableName: QUEUE_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: marshall({
        ':pk': `WORKSTATION#${workstationId}`,
        ':sk': 'PACKAGE#'
      })
    });

    const result = await dynamodb.send(command);
    const packages = result.Items ? result.Items.map(item => unmarshall(item)) : [];

    // Calculate summary
    const summary = {
      total: packages.length,
      pending: packages.filter((p: any) => p.status === 'pending').length,
      installing: packages.filter((p: any) => p.status === 'installing').length,
      completed: packages.filter((p: any) => p.status === 'completed').length,
      failed: packages.filter((p: any) => p.status === 'failed').length
    };

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        workstationId,
        packages,
        summary
      })
    };
  } catch (error: any) {
    console.error('Error getting package installation status:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: error.message })
    };
  }
}

/**
 * Retry a failed package installation
 */
async function retryPackageInstallation(workstationId: string, packageId: string): Promise<any> {
  try {
    const command = new UpdateItemCommand({
      TableName: QUEUE_TABLE,
      Key: marshall({
        PK: `WORKSTATION#${workstationId}`,
        SK: `PACKAGE#${packageId}`
      }),
      UpdateExpression: 'SET #status = :pending, #errorMessage = :empty, #startedAt = :empty, #completedAt = :empty',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#errorMessage': 'errorMessage',
        '#startedAt': 'startedAt',
        '#completedAt': 'completedAt'
      },
      ExpressionAttributeValues: marshall({
        ':pending': 'pending',
        ':empty': null
      }),
      ConditionExpression: '#status = :failed',
      ReturnValues: 'ALL_NEW'
    });

    const result = await dynamodb.send(command);

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        package: result.Attributes ? unmarshall(result.Attributes) : null
      })
    };
  } catch (error: any) {
    console.error('Error retrying package installation:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: error.message })
    };
  }
}

/**
 * Get all packages for a group (admin)
 */
async function getGroupPackages(groupId: string): Promise<any> {
  try {
    const command = new QueryCommand({
      TableName: BINDINGS_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: marshall({
        ':pk': `GROUP#${groupId}`,
        ':sk': 'PACKAGE#'
      })
    });

    const result = await dynamodb.send(command);
    const packages = result.Items ? result.Items.map(item => unmarshall(item)) : [];

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ packages })
    };
  } catch (error: any) {
    console.error('Error getting group packages:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: error.message })
    };
  }
}

/**
 * Add a package to a group (admin)
 */
async function addPackageToGroup(groupId: string, data: any, userEmail: string): Promise<any> {
  try {
    const { packageId, autoInstall, isMandatory, installOrder } = data;

    if (!packageId) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'packageId is required' })
      };
    }

    // Get package details from bootstrap packages table
    const packageCommand = new GetItemCommand({
      TableName: PACKAGES_TABLE,
      Key: marshall({
        packageId: packageId
      })
    });

    const packageResult = await dynamodb.send(packageCommand);
    
    if (!packageResult.Item) {
      return {
        statusCode: 404,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Package not found' })
      };
    }

    const packageData = unmarshall(packageResult.Item);

    const binding: GroupPackageBinding = {
      PK: `GROUP#${groupId}`,
      SK: `PACKAGE#${packageId}`,
      packageId,
      packageName: packageData.name,
      packageDescription: packageData.description,
      autoInstall: autoInstall !== undefined ? String(autoInstall) : 'true', // Convert to string for DynamoDB GSI
      isMandatory: isMandatory !== undefined ? isMandatory : false,
      installOrder: installOrder !== undefined ? installOrder : 50,
      createdAt: new Date().toISOString(),
      createdBy: userEmail
    };

    const command = new PutItemCommand({
      TableName: BINDINGS_TABLE,
      Item: marshall(binding)
    });

    await dynamodb.send(command);

    return {
      statusCode: 201,
      headers: corsHeaders(),
      body: JSON.stringify({ success: true, binding })
    };
  } catch (error: any) {
    console.error('Error adding package to group:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: error.message })
    };
  }
}

/**
 * Update a group package binding (admin)
 */
async function updateGroupPackage(groupId: string, packageId: string, data: any, userEmail: string): Promise<any> {
  try {
    const updates: string[] = [];
    const attributeNames: Record<string, string> = {};
    const attributeValues: Record<string, any> = {};

    if (data.autoInstall !== undefined) {
      updates.push('#autoInstall = :autoInstall');
      attributeNames['#autoInstall'] = 'autoInstall';
      attributeValues[':autoInstall'] = String(data.autoInstall); // Convert to string for DynamoDB GSI
    }

    if (data.isMandatory !== undefined) {
      updates.push('#isMandatory = :isMandatory');
      attributeNames['#isMandatory'] = 'isMandatory';
      attributeValues[':isMandatory'] = data.isMandatory;
    }

    if (data.installOrder !== undefined) {
      updates.push('#installOrder = :installOrder');
      attributeNames['#installOrder'] = 'installOrder';
      attributeValues[':installOrder'] = data.installOrder;
    }

    if (updates.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'No updates provided' })
      };
    }

    updates.push('#updatedAt = :updatedAt');
    attributeNames['#updatedAt'] = 'updatedAt';
    attributeValues[':updatedAt'] = new Date().toISOString();

    const command = new UpdateItemCommand({
      TableName: BINDINGS_TABLE,
      Key: marshall({
        PK: `GROUP#${groupId}`,
        SK: `PACKAGE#${packageId}`
      }),
      UpdateExpression: `SET ${updates.join(', ')}`,
      ExpressionAttributeNames: attributeNames,
      ExpressionAttributeValues: marshall(attributeValues),
      ReturnValues: 'ALL_NEW'
    });

    const result = await dynamodb.send(command);

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        binding: result.Attributes ? unmarshall(result.Attributes) : null
      })
    };
  } catch (error: any) {
    console.error('Error updating group package:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: error.message })
    };
  }
}

/**
 * Remove a package from a group (admin)
 */
async function removePackageFromGroup(groupId: string, packageId: string): Promise<any> {
  try {
    const command = new DeleteItemCommand({
      TableName: BINDINGS_TABLE,
      Key: marshall({
        PK: `GROUP#${groupId}`,
        SK: `PACKAGE#${packageId}`
      })
    });

    await dynamodb.send(command);

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ success: true })
    };
  } catch (error: any) {
    console.error('Error removing package from group:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: error.message })
    };
  }
}

/**
 * Add packages to workstation queue (admin)
 */
async function addPackagesToWorkstation(workstationId: string, data: any): Promise<any> {
  try {
    const { packageIds } = data;

    if (!Array.isArray(packageIds) || packageIds.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'packageIds array is required' })
      };
    }

    const ttl = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days

    for (const packageId of packageIds) {
      // Get package details
      const packageCommand = new GetItemCommand({
        TableName: PACKAGES_TABLE,
        Key: marshall({
          packageId: packageId
        })
      });

      const packageResult = await dynamodb.send(packageCommand);
      
      if (!packageResult.Item) {
        console.warn(`Package ${packageId} not found, skipping`);
        continue;
      }

      const packageData = unmarshall(packageResult.Item);

      const queueItem: PackageQueueItem = {
        PK: `WORKSTATION#${workstationId}`,
        SK: `PACKAGE#${packageId}`,
        workstationId,
        packageId,
        packageName: packageData.name,
        downloadUrl: packageData.downloadUrl,
        installCommand: packageData.installCommand,
        installArgs: packageData.installArgs || '',
        status: 'pending',
        installOrder: packageData.order || 50,
        required: false,
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date().toISOString(),
        estimatedInstallTimeMinutes: packageData.estimatedInstallTimeMinutes,
        ttl
      };

      const command = new PutItemCommand({
        TableName: QUEUE_TABLE,
        Item: marshall(queueItem)
      });

      await dynamodb.send(command);
    }

    return {
      statusCode: 201,
      headers: corsHeaders(),
      body: JSON.stringify({ 
        success: true, 
        added: packageIds.length 
      })
    };
  } catch (error: any) {
    console.error('Error adding packages to workstation:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: error.message })
    };
  }
}

/**
 * Remove a queued package (admin)
 */
async function removeQueuedPackage(workstationId: string, packageId: string): Promise<any> {
  try {
    const command = new DeleteItemCommand({
      TableName: QUEUE_TABLE,
      Key: marshall({
        PK: `WORKSTATION#${workstationId}`,
        SK: `PACKAGE#${packageId}`
      })
    });

    await dynamodb.send(command);

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ success: true })
    };
  } catch (error: any) {
    console.error('Error removing queued package:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: error.message })
    };
  }
}

/**
 * Extract parameter from path
 */
function extractFromPath(path: string, prefix: string): string {
  const parts = path.split('/');
  const index = parts.indexOf(prefix);
  return index >= 0 && parts[index + 1] ? parts[index + 1] : '';
}

/**
 * CORS headers
 */
function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  };
}