import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { 
  EC2Client, 
  DescribeInstancesCommand, 
  CreateTagsCommand, 
  DeleteTagsCommand,
  Tag
} from '@aws-sdk/client-ec2';
import { DynamoDBClient, GetItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

// Initialize AWS clients
const ec2Client = new EC2Client({});
const dynamoClient = new DynamoDBClient({});

// Environment variables
const WORKSTATIONS_TABLE = process.env.WORKSTATIONS_TABLE_NAME!;
const USERS_TABLE = process.env.USERS_TABLE!;
const AUDIT_LOGS_TABLE = process.env.AUDIT_TABLE!;

// Required cost allocation tags for AWS Cost Explorer
const REQUIRED_COST_TAGS = [
  'CostCenter',
  'Environment',
  'Project',
  'Owner',
  'CreatedBy',
  'CreatedDate',
  'Application',
  'WorkstationId',
  'UserId'
] as const;

type CostAllocationTag = typeof REQUIRED_COST_TAGS[number];

interface TagComplianceStatus {
  instanceId: string;
  workstationId?: string;
  name?: string;
  userId?: string;
  state: string;
  launchTime?: string;
  instanceType: string;
  isCompliant: boolean;
  presentTags: string[];
  missingTags: string[];
  allTags: Record<string, string>;
}

interface RemediateTagsRequest {
  instanceIds: string[];
  tags: Record<string, string>;
}

interface BulkRemediateRequest {
  instanceIds: string[];
  tags: Record<string, string>;
}

interface AutoSyncRequest {
  instanceIds?: string[];
  includeTerminated?: boolean;
}

// CORS headers
const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
};

// Permission checking
async function hasAdminPermission(userId: string): Promise<boolean> {
  try {
    const result = await dynamoClient.send(new GetItemCommand({
      TableName: USERS_TABLE,
      Key: marshall({ id: userId }),
    }));
    
    if (!result.Item) {
      console.log('User not found:', userId);
      return false;
    }
    
    const user = unmarshall(result.Item);
    const roleIds = user.roleIds || [];
    const directPermissions = user.directPermissions || [];
    
    // Check if user is admin
    if (roleIds.includes('admin') || directPermissions.includes('system:admin')) {
      return true;
    }
    
    // Check for workstations:manage-all permission
    if (directPermissions.includes('workstations:manage-all')) {
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error checking admin permission:', error);
    return false;
  }
}

// Log audit event
async function logAuditEvent(
  userId: string, 
  action: string, 
  resourceType: string, 
  resourceId: string, 
  details?: any
): Promise<void> {
  try {
    const { PutItemCommand } = await import('@aws-sdk/client-dynamodb');
    const { v4: uuidv4 } = await import('uuid');
    
    const timestamp = new Date().toISOString();
    const auditLog = {
      id: userId,
      timestamp,
      auditId: uuidv4(),
      action,
      resourceType,
      resourceId,
      details: details ? JSON.stringify(details) : undefined,
    };

    await dynamoClient.send(new PutItemCommand({
      TableName: AUDIT_LOGS_TABLE,
      Item: marshall(auditLog, { removeUndefinedValues: true }),
    }));
  } catch (error) {
    console.error('Error logging audit event:', error);
  }
}

export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  console.log('=== Tag Compliance Service ===');
  console.log('Request:', JSON.stringify(event, null, 2));
  
  try {
    const { httpMethod, path, body, requestContext } = event;
    const userId = requestContext.authorizer?.claims?.email || 
                   requestContext.authorizer?.claims?.sub ||
                   'unknown';
    
    // Check admin permission
    const isAdmin = await hasAdminPermission(userId);
    if (!isAdmin) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Insufficient permissions. Admin access required.' }),
      };
    }

    // Route based on path and method
    if (httpMethod === 'GET' && path.includes('/tag-compliance')) {
      return await getTagComplianceStatus();
    }
    
    if (httpMethod === 'POST' && path.includes('/tags/remediate')) {
      const request = JSON.parse(body || '{}') as RemediateTagsRequest;
      return await remediateTags(request, userId);
    }
    
    if (httpMethod === 'POST' && path.includes('/tags/bulk-remediate')) {
      const request = JSON.parse(body || '{}') as BulkRemediateRequest;
      return await bulkRemediateTags(request, userId);
    }
    
    if (httpMethod === 'POST' && path.includes('/tags/auto-sync')) {
      const request = JSON.parse(body || '{}') as AutoSyncRequest;
      return await autoSyncTags(request, userId);
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Not found', path, method: httpMethod }),
    };
    
  } catch (error) {
    console.error('Error in tag compliance service:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Internal server error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

/**
 * Get tag compliance status for all EC2 instances
 */
async function getTagComplianceStatus(): Promise<APIGatewayProxyResult> {
  console.log('Getting tag compliance status...');
  
  try {
    // Get all EC2 instances (filter out terminated)
    const describeResult = await ec2Client.send(new DescribeInstancesCommand({
      Filters: [
        { Name: 'instance-state-name', Values: ['pending', 'running', 'stopping', 'stopped'] },
        { Name: 'tag-key', Values: ['WorkstationId'] }, // Only get workstation instances
      ],
    }));

    const instances = describeResult.Reservations?.flatMap(r => r.Instances || []) || [];
    console.log(`Found ${instances.length} workstation instances`);

    const complianceStatuses: TagComplianceStatus[] = [];
    let compliantCount = 0;
    let nonCompliantCount = 0;

    for (const instance of instances) {
      const instanceId = instance.InstanceId || '';
      const tags = instance.Tags || [];
      const tagMap: Record<string, string> = {};
      
      for (const tag of tags) {
        if (tag.Key && tag.Value) {
          tagMap[tag.Key] = tag.Value;
        }
      }

      // Check which required tags are present
      const presentTags: string[] = [];
      const missingTags: string[] = [];
      
      for (const requiredTag of REQUIRED_COST_TAGS) {
        if (tagMap[requiredTag] && tagMap[requiredTag].trim() !== '') {
          presentTags.push(requiredTag);
        } else {
          missingTags.push(requiredTag);
        }
      }

      const isCompliant = missingTags.length === 0;
      if (isCompliant) {
        compliantCount++;
      } else {
        nonCompliantCount++;
      }

      complianceStatuses.push({
        instanceId,
        workstationId: tagMap['WorkstationId'],
        name: tagMap['Name'],
        userId: tagMap['UserId'],
        state: instance.State?.Name || 'unknown',
        launchTime: instance.LaunchTime?.toISOString(),
        instanceType: instance.InstanceType || 'unknown',
        isCompliant,
        presentTags,
        missingTags,
        allTags: tagMap,
      });
    }

    // Sort by compliance status (non-compliant first)
    complianceStatuses.sort((a, b) => {
      if (a.isCompliant === b.isCompliant) {
        return (b.launchTime || '').localeCompare(a.launchTime || '');
      }
      return a.isCompliant ? 1 : -1;
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        summary: {
          totalInstances: instances.length,
          compliantCount,
          nonCompliantCount,
          compliancePercentage: instances.length > 0 
            ? Math.round((compliantCount / instances.length) * 100) 
            : 100,
          requiredTags: REQUIRED_COST_TAGS,
        },
        instances: complianceStatuses,
      }),
    };
  } catch (error) {
    console.error('Error getting tag compliance status:', error);
    throw error;
  }
}

/**
 * Remediate tags for specified instances
 */
async function remediateTags(request: RemediateTagsRequest, userId: string): Promise<APIGatewayProxyResult> {
  console.log('Remediating tags for instances:', request.instanceIds);
  
  if (!request.instanceIds || request.instanceIds.length === 0) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'No instance IDs provided' }),
    };
  }

  if (!request.tags || Object.keys(request.tags).length === 0) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'No tags provided' }),
    };
  }

  const results: { instanceId: string; success: boolean; error?: string }[] = [];

  for (const instanceId of request.instanceIds) {
    try {
      const tags: Tag[] = Object.entries(request.tags).map(([key, value]) => ({
        Key: key,
        Value: value,
      }));

      await ec2Client.send(new CreateTagsCommand({
        Resources: [instanceId],
        Tags: tags,
      }));

      results.push({ instanceId, success: true });
      console.log(`✅ Tags applied to ${instanceId}`);
      
      await logAuditEvent(userId, 'REMEDIATE_TAGS', 'ec2-instance', instanceId, {
        tags: request.tags,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Failed to apply tags to ${instanceId}:`, errorMessage);
      results.push({ instanceId, success: false, error: errorMessage });
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      message: `Remediation completed. ${successCount} succeeded, ${failCount} failed.`,
      results,
    }),
  };
}

/**
 * Bulk remediate tags for multiple instances
 */
async function bulkRemediateTags(request: BulkRemediateRequest, userId: string): Promise<APIGatewayProxyResult> {
  console.log('Bulk remediating tags for', request.instanceIds.length, 'instances');
  
  // Reuse the same logic as remediateTags
  return await remediateTags(request, userId);
}

/**
 * Auto-sync tags from DynamoDB workstation records to EC2 instances
 */
async function autoSyncTags(request: AutoSyncRequest, userId: string): Promise<APIGatewayProxyResult> {
  console.log('Auto-syncing tags from DynamoDB to EC2...');
  
  try {
    // Get all workstation records from DynamoDB
    const scanResult = await dynamoClient.send(new ScanCommand({
      TableName: WORKSTATIONS_TABLE,
      FilterExpression: 'begins_with(PK, :pk)',
      ExpressionAttributeValues: marshall({
        ':pk': 'WORKSTATION#',
      }),
    }));

    const workstations = (scanResult.Items || []).map(item => unmarshall(item));
    console.log(`Found ${workstations.length} workstation records in DynamoDB`);

    const results: { 
      instanceId: string; 
      workstationId: string; 
      success: boolean; 
      tagsApplied?: string[];
      error?: string 
    }[] = [];

    for (const workstation of workstations) {
      const instanceId = workstation.instanceId;
      const workstationId = workstation.PK?.replace('WORKSTATION#', '') || workstation.workstationId;
      
      // Skip if specific instances requested and this isn't one of them
      if (request.instanceIds && request.instanceIds.length > 0) {
        if (!request.instanceIds.includes(instanceId)) {
          continue;
        }
      }

      try {
        // Build tags from workstation record
        const tagsToApply: Record<string, string> = {
          WorkstationId: workstationId,
          UserId: workstation.userId || '',
          CostCenter: workstation.tags?.CostCenter || workstation.costCenter || 'default',
          Environment: workstation.tags?.Environment || workstation.environment || 'prod',
          Project: workstation.tags?.Project || 'MediaWorkstationAutomation',
          Owner: workstation.userId || '',
          Application: 'VDI-Workstation',
          CreatedDate: workstation.createdAt || workstation.launchTime || new Date().toISOString(),
          CreatedBy: 'auto-sync',
        };

        // Filter out empty values
        const filteredTags: Tag[] = Object.entries(tagsToApply)
          .filter(([_, value]) => value && value.trim() !== '')
          .map(([key, value]) => ({ Key: key, Value: value }));

        if (filteredTags.length > 0) {
          await ec2Client.send(new CreateTagsCommand({
            Resources: [instanceId],
            Tags: filteredTags,
          }));

          results.push({ 
            instanceId, 
            workstationId,
            success: true, 
            tagsApplied: filteredTags.map(t => t.Key || ''),
          });
          console.log(`✅ Auto-synced tags for ${instanceId} (${workstationId})`);
        } else {
          results.push({
            instanceId,
            workstationId,
            success: false,
            error: 'No valid tags to apply',
          });
        }
      } catch (error: any) {
        // Instance might not exist anymore
        if (error.name === 'InvalidInstanceID.NotFound') {
          console.log(`Instance ${instanceId} not found, skipping`);
          results.push({
            instanceId,
            workstationId,
            success: false,
            error: 'Instance not found',
          });
        } else {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`❌ Failed to sync tags for ${instanceId}:`, errorMessage);
          results.push({
            instanceId,
            workstationId,
            success: false,
            error: errorMessage,
          });
        }
      }
    }

    await logAuditEvent(userId, 'AUTO_SYNC_TAGS', 'ec2-instances', 'bulk', {
      totalWorkstations: workstations.length,
      successCount: results.filter(r => r.success).length,
      failCount: results.filter(r => !r.success).length,
    });

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: `Auto-sync completed. ${successCount} succeeded, ${failCount} failed.`,
        summary: {
          totalWorkstations: workstations.length,
          processed: results.length,
          successCount,
          failCount,
        },
        results,
      }),
    };
  } catch (error) {
    console.error('Error in auto-sync:', error);
    throw error;
  }
}