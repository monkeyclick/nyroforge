import {
  DynamoDBClient,
  PutItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  GetItemCommand
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { corsHeaders } from '../shared/http';
import { requireAdmin, isAdmin } from '../shared/auth';
import { queryAllItems } from '../shared/dynamo';
import { logEvent } from '../shared/logging';
import {
  effectiveStatus,
  instanceArn,
  isInstallable,
  legacyQueuePartitionKey,
  queuePartitionKey,
} from '../shared/packages';

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-west-2' });

const BINDINGS_TABLE = process.env.GROUP_PACKAGE_BINDINGS_TABLE || '';
const PACKAGES_TABLE = process.env.BOOTSTRAP_PACKAGES_TABLE || '';
const QUEUE_TABLE = process.env.PACKAGE_QUEUE_TABLE || '';
const WORKSTATIONS_TABLE = process.env.WORKSTATIONS_TABLE_NAME || '';

/**
 * Authorize access to a specific workstation's package queue. Returns an error
 * response to return to the caller, or null when access is granted. Access is
 * limited to admins, the workstation owner (userId), and users the workstation
 * has been shared with (assignedUsers). Fails closed: any lookup problem or
 * missing identity denies access. Without this, any authenticated user could
 * read or re-trigger installs on another user's workstation (IDOR).
 */
async function requireWorkstationAccess(event: any, workstationId: string): Promise<any | null> {
  const deny = () => ({
    statusCode: 403,
    headers: corsHeaders(),
    body: JSON.stringify({ error: 'Forbidden' }),
  });

  if (isAdmin(event)) {
    return null;
  }

  // Resolve the caller identity the same way ec2-management does when it stores
  // workstation.userId / assignedUsers (email first, then sub, then username);
  // comparing against the wrong claim would deny legitimate owners.
  const claims = event.requestContext?.authorizer?.claims || {};
  const callerId = claims.email || claims.sub || claims['cognito:username'];
  if (!callerId || !workstationId || !WORKSTATIONS_TABLE) {
    console.error('Cannot verify workstation ownership (missing caller id, workstation id, or table)');
    return deny();
  }

  let workstation: any;
  try {
    const res = await dynamodb.send(new GetItemCommand({
      TableName: WORKSTATIONS_TABLE,
      Key: marshall({ PK: `WORKSTATION#${workstationId}`, SK: 'METADATA' }),
    }));
    workstation = res.Item ? unmarshall(res.Item) : null;
  } catch (err) {
    console.error('Error loading workstation for access check:', err);
    return deny();
  }

  if (!workstation) {
    return {
      statusCode: 404,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Workstation not found' }),
    };
  }

  const isOwner = workstation.userId === callerId;
  const isShared = Array.isArray(workstation.assignedUsers) && workstation.assignedUsers.includes(callerId);
  return isOwner || isShared ? null : deny();
}

/**
 * The package queue is partitioned by EC2 instance ARN, not workstation id.
 *
 * The Windows installer service (PackageQueueService.cs) builds the same key
 * from its own instance identity, and the workstation instance role is scoped
 * with a `dynamodb:LeadingKeys` condition on `${ec2:SourceInstanceARN}` — which
 * only lines up if the key is the ARN.
 *
 * This service previously wrote and read `WORKSTATION#{workstationId}`, a
 * different partition entirely from what the installer service polls, so
 * packages an admin added were queued where no workstation ever looked while
 * packages queued at launch were invisible to this API.
 */
const REGION = process.env.AWS_REGION || 'us-west-2';

/**
 * Every key shape a queue row for this workstation might carry: the current
 * ARN form first, then the two legacy ones.
 *
 * Rows written before the ARN re-keying live up to 30 days under the table
 * TTL, so both older shapes stay readable until they age out:
 *   - `workstation#{instanceId}` — what ec2-management wrote originally.
 *   - `WORKSTATION#{workstationId}` — what this service wrote, and what
 *     ec2-management was changed to write on main before the two fixes met.
 */
function queuePartitionKeys(
  instanceId: string,
  workstationId: string,
  accountId: string
): string[] {
  return [
    queuePartitionKey(instanceArn(REGION, accountId, instanceId)),
    legacyQueuePartitionKey(instanceId),
    `WORKSTATION#${workstationId}`,
  ];
}

function resolveAccountId(event: any): string {
  return event?.requestContext?.accountId || process.env.DEPLOY_ACCOUNT_ID || '';
}

/** Resolve a workstation id to the EC2 instance id that owns its queue. */
async function resolveInstanceId(workstationId: string): Promise<string | null> {
  if (!WORKSTATIONS_TABLE) {
    console.error('WORKSTATIONS_TABLE_NAME is not configured');
    return null;
  }
  try {
    const res = await dynamodb.send(new GetItemCommand({
      TableName: WORKSTATIONS_TABLE,
      Key: marshall({ PK: `WORKSTATION#${workstationId}`, SK: 'METADATA' }),
    }));
    if (!res.Item) return null;
    const record = unmarshall(res.Item);
    return record.instanceId || null;
  } catch (err) {
    console.error('Error resolving instance id for workstation:', err);
    return null;
  }
}

/** Read every queue row for a workstation across all three key shapes. */
async function readQueueItems(
  instanceId: string,
  workstationId: string,
  accountId: string
): Promise<any[]> {
  const results = await Promise.all(
    queuePartitionKeys(instanceId, workstationId, accountId).map((pk) =>
      queryAllItems(dynamodb, {
        TableName: QUEUE_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: marshall({ ':pk': pk }),
      })
    )
  );
  return results.flat();
}

/**
 * Find a queued package by packageId within an instance's partition.
 *
 * The sort key is not a single fixed shape — ec2-management writes
 * `package#{packageId}#{order}` at launch while admin-queued items historically
 * used `package#{packageId}` — so retry/remove locate the item by attribute
 * rather than reconstructing a key that may not exist.
 */
async function findQueueItem(
  instanceId: string,
  workstationId: string,
  packageId: string,
  accountId: string
): Promise<any | null> {
  const items = await readQueueItems(instanceId, workstationId, accountId);
  return items.find((item: any) => item.packageId === packageId) || null;
}

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
  /** 'url' downloads over HTTPS; 's3' uses instance-profile credentials. */
  source?: 'url' | 's3';
  s3Bucket?: string;
  s3Key?: string;
  downloadUrl: string;
  installCommand: string;
  installArgs: string;
  expectedSha256?: string;
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
  logEvent(event);

  const httpMethod = event.httpMethod || event.requestContext?.http?.method;
  const path = event.path || event.requestContext?.http?.path || '';
  const pathParams = event.pathParameters || {};
  const queryParams = event.queryStringParameters || {};

  try {
    // Parse the body inside the try block: a malformed body must yield a
    // clean 400 (with CORS headers), not an unhandled exception that API
    // Gateway turns into a CORS-less 502.
    let body: any = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch {
        return {
          statusCode: 400,
          headers: corsHeaders(),
          body: JSON.stringify({ error: 'Request body is not valid JSON' })
        };
      }
    }

    // Extract user info from authorizer context
    const userEmail = event.requestContext?.authorizer?.claims?.email || 'system';
    const userId = event.requestContext?.authorizer?.claims?.sub || 'system';

    // Route to appropriate handler
    if (httpMethod === 'GET' && path.includes('/user/group-packages')) {
      return await getUserGroupPackages(event);
    }
    
    if (httpMethod === 'GET' && path.includes('/workstations/') && path.includes('/packages')) {
      const workstationId = pathParams.workstationId || extractFromPath(path, 'workstations');
      const denied = await requireWorkstationAccess(event, workstationId);
      if (denied) return denied;
      return await getPackageInstallationStatus(workstationId, resolveAccountId(event));
    }

    if (httpMethod === 'POST' && path.includes('/workstations/') && path.includes('/packages/') && path.includes('/retry')) {
      const workstationId = pathParams.workstationId || extractFromPath(path, 'workstations');
      const packageId = pathParams.packageId || extractFromPath(path, 'packages');
      const denied = await requireWorkstationAccess(event, workstationId);
      if (denied) return denied;
      return await retryPackageInstallation(workstationId, packageId, resolveAccountId(event));
    }
    
    // Group package-binding CRUD (admin API) is admin-only; the user-facing
    // routes above (/user/group-packages, /workstations/*/packages*) stay
    // available to any authenticated user.
    if (httpMethod === 'GET' && path.includes('/groups/') && path.includes('/packages')) {
      const denied = requireAdmin(event);
      if (denied) return denied;
      const groupId = pathParams.groupId || extractFromPath(path, 'groups');
      return await getGroupPackages(groupId);
    }

    if (httpMethod === 'POST' && path.includes('/groups/') && path.includes('/packages')) {
      const denied = requireAdmin(event);
      if (denied) return denied;
      const groupId = pathParams.groupId || extractFromPath(path, 'groups');
      return await addPackageToGroup(groupId, body, userEmail);
    }

    if (httpMethod === 'PUT' && path.includes('/groups/') && path.includes('/packages/')) {
      const denied = requireAdmin(event);
      if (denied) return denied;
      const groupId = pathParams.groupId || extractFromPath(path, 'groups');
      const packageId = pathParams.packageId || extractFromPath(path, 'packages');
      return await updateGroupPackage(groupId, packageId, body, userEmail);
    }

    if (httpMethod === 'DELETE' && path.includes('/groups/') && path.includes('/packages/')) {
      const denied = requireAdmin(event);
      if (denied) return denied;
      const groupId = pathParams.groupId || extractFromPath(path, 'groups');
      const packageId = pathParams.packageId || extractFromPath(path, 'packages');
      return await removePackageFromGroup(groupId, packageId);
    }
    
    // Post-launch queue management on the user API. Access is owner/shared/admin
    // (requireWorkstationAccess), so users can manage their own queues. The POST
    // condition also matches .../packages/{id}/retry, which is routed above.
    if (httpMethod === 'POST' && path.includes('/workstations/') && path.includes('/packages')) {
      const workstationId = pathParams.workstationId || extractFromPath(path, 'workstations');
      const denied = await requireWorkstationAccess(event, workstationId);
      if (denied) return denied;
      return await addPackagesToWorkstation(workstationId, body, resolveAccountId(event));
    }

    if (httpMethod === 'DELETE' && path.includes('/workstations/') && path.includes('/packages/')) {
      const workstationId = pathParams.workstationId || extractFromPath(path, 'workstations');
      const packageId = pathParams.packageId || extractFromPath(path, 'packages');
      const denied = await requireWorkstationAccess(event, workstationId);
      if (denied) return denied;
      return await removeQueuedPackage(workstationId, packageId, resolveAccountId(event));
    }

    return {
      statusCode: 404,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Not Found', path, method: httpMethod })
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Internal Server Error' })
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

    // Query each group for packages (paginated: a single Query page is
    // capped at 1 MB, so follow LastEvaluatedKey via the shared helper)
    for (const groupId of userGroups) {
      const packages = await queryAllItems(dynamodb, {
        TableName: BINDINGS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: marshall({
          ':pk': `GROUP#${groupId}`,
          ':sk': 'PACKAGE#'
        })
      });

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
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

/**
 * Get installation status for a workstation's packages
 */
async function getPackageInstallationStatus(workstationId: string, accountId: string): Promise<any> {
  try {
    const instanceId = await resolveInstanceId(workstationId);
    if (!instanceId) {
      return {
        statusCode: 404,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Workstation not found' })
      };
    }

    // Reads both partition shapes and follows LastEvaluatedKey, so neither a
    // large queue nor a pre-re-keying row goes missing. No SK filter — the
    // partition holds only package rows, and their sort keys come in more than
    // one historical shape.
    const packages = await readQueueItems(instanceId, workstationId, accountId);

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
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

/**
 * Retry a failed package installation
 */
async function retryPackageInstallation(workstationId: string, packageId: string, accountId: string): Promise<any> {
  try {
    const instanceId = await resolveInstanceId(workstationId);
    if (!instanceId) {
      return {
        statusCode: 404,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Workstation not found' })
      };
    }
    const existing = await findQueueItem(instanceId, workstationId, packageId, accountId);
    if (!existing) {
      return {
        statusCode: 404,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Queued package not found' })
      };
    }

    const command = new UpdateItemCommand({
      TableName: QUEUE_TABLE,
      Key: marshall({
        PK: existing.PK,
        SK: existing.SK
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
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

/**
 * Get all packages for a group (admin)
 */
async function getGroupPackages(groupId: string): Promise<any> {
  try {
    // Paginated query: follow LastEvaluatedKey so large groups are not truncated.
    const packages = await queryAllItems(dynamodb, {
      TableName: BINDINGS_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: marshall({
        ':pk': `GROUP#${groupId}`,
        ':sk': 'PACKAGE#'
      })
    });

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
      body: JSON.stringify({ error: 'Internal server error' })
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
      Item: marshall(binding),
      // Don't silently overwrite an existing binding (PK+SK already present).
      ConditionExpression: 'attribute_not_exists(PK)'
    });

    try {
      await dynamodb.send(command);
    } catch (err: any) {
      if (err?.name === 'ConditionalCheckFailedException') {
        return {
          statusCode: 409,
          headers: corsHeaders(),
          body: JSON.stringify({ error: 'Package is already assigned to this group' })
        };
      }
      throw err;
    }

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
      body: JSON.stringify({ error: 'Internal server error' })
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
      // Update must not upsert a phantom binding for a nonexistent pairing.
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: attributeNames,
      ExpressionAttributeValues: marshall(attributeValues),
      ReturnValues: 'ALL_NEW'
    });

    let result;
    try {
      result = await dynamodb.send(command);
    } catch (err: any) {
      if (err?.name === 'ConditionalCheckFailedException') {
        return {
          statusCode: 404,
          headers: corsHeaders(),
          body: JSON.stringify({ error: 'Package binding not found' })
        };
      }
      throw err;
    }

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
      body: JSON.stringify({ error: 'Internal server error' })
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
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

/**
 * Add packages to workstation queue (admin)
 */
async function addPackagesToWorkstation(workstationId: string, data: any, accountId: string): Promise<any> {
  try {
    const { packageIds } = data;

    if (!Array.isArray(packageIds) || packageIds.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'packageIds array is required' })
      };
    }

    const instanceId = await resolveInstanceId(workstationId);
    if (!instanceId) {
      return {
        statusCode: 404,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Workstation not found' })
      };
    }

    const ttl = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days
    const skipped: { packageId: string; reason: string }[] = [];
    let added = 0;

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

      // An uploaded package that no admin has approved must never reach a
      // workstation — approval is the only thing standing between a
      // user-supplied binary and SYSTEM-level execution.
      if (!isInstallable(packageData)) {
        skipped.push({
          packageId,
          reason: `Package is '${effectiveStatus(packageData)}', not approved`
        });
        continue;
      }

      const installOrder = packageData.order || 50;
      const queueItem: PackageQueueItem = {
        PK: queuePartitionKey(instanceArn(REGION, accountId, instanceId)),
        SK: `package#${packageId}#${installOrder}`,
        workstationId: instanceId,
        packageId,
        packageName: packageData.name,
        source: packageData.source === 's3' ? 's3' : 'url',
        s3Bucket: packageData.s3Bucket,
        s3Key: packageData.s3Key,
        downloadUrl: packageData.downloadUrl || '',
        installCommand: packageData.installCommand,
        installArgs: packageData.installArgs || '',
        expectedSha256: packageData.expectedSha256,
        status: 'pending',
        installOrder,
        required: false,
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date().toISOString(),
        estimatedInstallTimeMinutes: packageData.estimatedInstallTimeMinutes,
        ttl
      };

      const command = new PutItemCommand({
        TableName: QUEUE_TABLE,
        Item: marshall(queueItem, { removeUndefinedValues: true })
      });

      await dynamodb.send(command);
      added += 1;
    }

    return {
      statusCode: 201,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        added,
        skipped
      })
    };
  } catch (error: any) {
    console.error('Error adding packages to workstation:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

/**
 * Remove a queued package (admin)
 */
async function removeQueuedPackage(workstationId: string, packageId: string, accountId: string): Promise<any> {
  try {
    const instanceId = await resolveInstanceId(workstationId);
    if (!instanceId) {
      return {
        statusCode: 404,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Workstation not found' })
      };
    }
    const existing = await findQueueItem(instanceId, workstationId, packageId, accountId);
    if (!existing) {
      return {
        statusCode: 404,
        headers: corsHeaders(),
        body: JSON.stringify({ error: 'Queued package not found' })
      };
    }

    const command = new DeleteItemCommand({
      TableName: QUEUE_TABLE,
      Key: marshall({
        PK: existing.PK,
        SK: existing.SK
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
      body: JSON.stringify({ error: 'Internal server error' })
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

