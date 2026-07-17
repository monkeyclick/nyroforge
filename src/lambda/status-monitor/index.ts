import { APIGatewayProxyEvent, APIGatewayProxyResult, Context, ScheduledEvent } from 'aws-lambda';
import { EC2Client, DescribeInstancesCommand, TerminateInstancesCommand, Instance } from '@aws-sdk/client-ec2';
import { DynamoDBClient, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { marshall } from '@aws-sdk/util-dynamodb';
import { logEvent } from '../shared/logging';
import { jsonResponse } from '../shared/http';
import { scanAllItems, queryAllItems } from '../shared/dynamo';
import { describeInstancesByIds } from '../shared/ec2';

// Initialize AWS clients
const ec2Client = new EC2Client({});
const dynamoClient = new DynamoDBClient({});
const cloudWatchClient = new CloudWatchClient({});
const sesClient = new SESClient({});

// Environment variables
const WORKSTATIONS_TABLE = process.env.WORKSTATIONS_TABLE_NAME!;
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@example.com';
// Warn owners this many minutes before their workstation is auto-terminated
const TERMINATION_WARNING_MINUTES = parseInt(process.env.TERMINATION_WARNING_MINUTES || '60', 10);

interface DashboardSummary {
  totalInstances: number;
  runningInstances: number;
  stoppedInstances: number;
  terminatingInstances: number;
  totalHourlyCost: number;
  estimatedMonthlyCost: number;
}

interface InstanceStatusInfo {
  workstationId: string;
  instanceId: string;
  userId: string;
  status: string;
  publicIp?: string;
  instanceType: string;
  region: string;
  runTime: string;
  hourlyCost: number;
  cpuUtilization?: number;
  networkIn?: number;
  networkOut?: number;
}

export const handler = async (event: APIGatewayProxyEvent | ScheduledEvent, context: Context): Promise<APIGatewayProxyResult | void> => {
  logEvent(event as APIGatewayProxyEvent);

  try {
    // Handle scheduled EventBridge events (for auto-termination)
    if ('source' in event && event.source === 'aws.events') {
      console.log('Processing scheduled auto-termination check...');
      await checkAndTerminateExpiredInstances();
      return;
    }

    // Handle API Gateway events
    const apiEvent = event as APIGatewayProxyEvent;
    const { httpMethod, requestContext } = apiEvent;
    const userId = requestContext.authorizer?.claims?.email || 'unknown';
    const userGroups = requestContext.authorizer?.claims?.['cognito:groups']?.split(',') || [];
    const isAdmin = userGroups.includes('workstation-admin');

    switch (httpMethod) {
      case 'GET':
        if (apiEvent.path.includes('/dashboard/status')) {
          return await getDashboardStatus(userId, isAdmin);
        } else if (apiEvent.path.includes('/health')) {
          return await getHealthStatus();
        }
        break;
    }

    return jsonResponse(400, { message: 'Invalid request' });

  } catch (error) {
    console.error('Error:', error);

    // Return error response for API Gateway calls
    if ('httpMethod' in event) {
      return jsonResponse(500, { message: 'Internal server error' });
    }

    // For scheduled events, just log the error
    throw error;
  }
};

/**
 * Fetch the caller-visible workstations. Admins see everything (paginated
 * scan); everyone else gets a Query on the UserIdIndex GSI instead of a
 * scan-and-filter over the whole table.
 */
async function getWorkstationsForCaller(userId: string, isAdmin: boolean): Promise<Record<string, any>[]> {
  if (isAdmin) {
    return scanAllItems(dynamoClient, {
      TableName: WORKSTATIONS_TABLE,
      FilterExpression: 'begins_with(PK, :pk)',
      ExpressionAttributeValues: marshall({
        ':pk': 'WORKSTATION#',
      }),
    });
  }
  return queryAllItems(dynamoClient, {
    TableName: WORKSTATIONS_TABLE,
    IndexName: 'UserIdIndex',
    KeyConditionExpression: 'userId = :userId',
    FilterExpression: 'begins_with(PK, :pk)',
    ExpressionAttributeValues: marshall({
      ':userId': userId,
      ':pk': 'WORKSTATION#',
    }),
  });
}

async function getDashboardStatus(userId: string, isAdmin: boolean): Promise<APIGatewayProxyResult> {
  try {
    const allWorkstations = await getWorkstationsForCaller(userId, isAdmin);

    // Get current EC2 instance statuses
    const instanceIds = allWorkstations.map((ws: any) => ws.instanceId).filter(Boolean);

    let ec2Instances: Instance[] = [];
    if (instanceIds.length > 0) {
      ec2Instances = await describeInstancesByIds(ec2Client, instanceIds);
    }

    // Update workstation statuses and collect metrics
    const statusUpdates: Promise<void>[] = [];
    const instanceStatusList: InstanceStatusInfo[] = [];

    for (const workstation of allWorkstations) {
      const ec2Instance = ec2Instances.find(i => i.InstanceId === workstation.instanceId);

      if (ec2Instance) {
        const currentStatus = mapEC2StatusToWorkstationStatus(ec2Instance.State?.Name || 'unknown');
        const publicIp = ec2Instance.PublicIpAddress;
        const launchTime = ec2Instance.LaunchTime;
        const runTime = calculateRunTime(launchTime);

        // Update status in DynamoDB if changed
        if (currentStatus !== workstation.status || publicIp !== workstation.publicIp) {
          statusUpdates.push(updateWorkstationStatus(workstation.PK, workstation.SK, {
            status: currentStatus,
            publicIp: publicIp,
            privateIp: ec2Instance.PrivateIpAddress,
            lastStatusCheck: new Date().toISOString(),
          }));
        }

        // Get CloudWatch metrics for running instances
        let cpuUtilization: number | undefined;
        let networkIn: number | undefined;
        let networkOut: number | undefined;

        if (currentStatus === 'running') {
          const metrics = await getInstanceMetrics(workstation.instanceId);
          cpuUtilization = metrics.cpuUtilization;
          networkIn = metrics.networkIn;
          networkOut = metrics.networkOut;
        }

        instanceStatusList.push({
          workstationId: workstation.PK.replace('WORKSTATION#', ''),
          instanceId: workstation.instanceId,
          userId: workstation.userId,
          status: currentStatus,
          publicIp: publicIp,
          instanceType: workstation.instanceType,
          region: workstation.region,
          runTime: runTime,
          hourlyCost: workstation.estimatedHourlyCost || 0,
          cpuUtilization,
          networkIn,
          networkOut,
        });

        // Update workstation object for summary calculations
        workstation.status = currentStatus;
        workstation.publicIp = publicIp;
      }
    }

    // A single failed status write must not fail the whole dashboard read.
    const updateResults = await Promise.allSettled(statusUpdates);
    for (const result of updateResults) {
      if (result.status === 'rejected') {
        console.warn('Failed to persist a workstation status update:', result.reason);
      }
    }

    // Calculate summary statistics
    const summary: DashboardSummary = {
      totalInstances: allWorkstations.length,
      runningInstances: allWorkstations.filter((ws: any) => ws.status === 'running').length,
      stoppedInstances: allWorkstations.filter((ws: any) => ws.status === 'stopped').length,
      terminatingInstances: allWorkstations.filter((ws: any) => ['terminating', 'shutting-down'].includes(ws.status)).length,
      totalHourlyCost: allWorkstations
        .filter((ws: any) => ws.status === 'running')
        .reduce((sum: number, ws: any) => sum + (ws.estimatedHourlyCost || 0), 0),
      estimatedMonthlyCost: 0,
    };

    summary.estimatedMonthlyCost = summary.totalHourlyCost * 24 * 30;

    return jsonResponse(200, {
      summary,
      instances: instanceStatusList,
      lastUpdated: new Date().toISOString(),
    }, {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });

  } catch (error) {
    console.error('Error getting dashboard status:', error);
    return jsonResponse(500, { message: 'Failed to get dashboard status' });
  }
}

async function getHealthStatus(): Promise<APIGatewayProxyResult> {
  try {
    const services = {
      dynamodb: 'healthy',
      ec2: 'healthy',
      cloudwatch: 'healthy',
    };

    // Test DynamoDB connection
    try {
      await dynamoClient.send(new ScanCommand({
        TableName: WORKSTATIONS_TABLE,
        Limit: 1,
      }));
    } catch (error) {
      services.dynamodb = 'unhealthy';
    }

    // Test EC2 connection
    try {
      await ec2Client.send(new DescribeInstancesCommand({
        MaxResults: 5,
      }));
    } catch (error) {
      services.ec2 = 'unhealthy';
    }

    // Test CloudWatch connection
    try {
      await cloudWatchClient.send(new GetMetricStatisticsCommand({
        Namespace: 'AWS/EC2',
        MetricName: 'CPUUtilization',
        StartTime: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
        EndTime: new Date(),
        Period: 300,
        Statistics: ['Average'],
      }));
    } catch (error) {
      services.cloudwatch = 'unhealthy';
    }

    const isHealthy = Object.values(services).every(status => status === 'healthy');

    return jsonResponse(isHealthy ? 200 : 503, {
      status: isHealthy ? 'healthy' : 'degraded',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      services,
    });

  } catch (error) {
    console.error('Error checking health:', error);
    return jsonResponse(503, {
      status: 'unhealthy',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    });
  }
}

async function updateWorkstationStatus(pk: string, sk: string, updates: any): Promise<void> {
  const updateExpressions: string[] = [];
  const attributeNames: Record<string, string> = {};
  const attributeValues: Record<string, any> = {};

  Object.entries(updates).forEach(([key, value], index) => {
    const nameKey = `#attr${index}`;
    const valueKey = `:val${index}`;

    updateExpressions.push(`${nameKey} = ${valueKey}`);
    attributeNames[nameKey] = key;
    attributeValues[valueKey] = value;
  });

  const updateCommand = new UpdateItemCommand({
    TableName: WORKSTATIONS_TABLE,
    Key: marshall({ PK: pk, SK: sk }),
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    // Without this, an update racing a delete resurrects the workstation as a
    // phantom item containing only the status fields.
    ConditionExpression: 'attribute_exists(PK)',
    ExpressionAttributeNames: attributeNames,
    ExpressionAttributeValues: marshall(attributeValues),
  });

  try {
    await dynamoClient.send(updateCommand);
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      console.warn(`Workstation ${pk} was deleted mid-update; skipping status write`);
      return;
    }
    throw error;
  }
}

async function getInstanceMetrics(instanceId: string): Promise<{
  cpuUtilization?: number;
  networkIn?: number;
  networkOut?: number;
}> {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 10 * 60 * 1000); // 10 minutes ago

  try {
    // Get CPU utilization
    const cpuCommand = new GetMetricStatisticsCommand({
      Namespace: 'AWS/EC2',
      MetricName: 'CPUUtilization',
      Dimensions: [
        {
          Name: 'InstanceId',
          Value: instanceId,
        },
      ],
      StartTime: startTime,
      EndTime: endTime,
      Period: 300, // 5 minutes
      Statistics: ['Average'],
    });

    const cpuResult = await cloudWatchClient.send(cpuCommand);
    const cpuUtilization = cpuResult.Datapoints?.[cpuResult.Datapoints.length - 1]?.Average;

    // Get network metrics
    const networkInCommand = new GetMetricStatisticsCommand({
      Namespace: 'AWS/EC2',
      MetricName: 'NetworkIn',
      Dimensions: [
        {
          Name: 'InstanceId',
          Value: instanceId,
        },
      ],
      StartTime: startTime,
      EndTime: endTime,
      Period: 300,
      Statistics: ['Sum'],
    });

    const networkOutCommand = new GetMetricStatisticsCommand({
      Namespace: 'AWS/EC2',
      MetricName: 'NetworkOut',
      Dimensions: [
        {
          Name: 'InstanceId',
          Value: instanceId,
        },
      ],
      StartTime: startTime,
      EndTime: endTime,
      Period: 300,
      Statistics: ['Sum'],
    });

    const [networkInResult, networkOutResult] = await Promise.all([
      cloudWatchClient.send(networkInCommand),
      cloudWatchClient.send(networkOutCommand),
    ]);

    const networkIn = networkInResult.Datapoints?.[networkInResult.Datapoints.length - 1]?.Sum;
    const networkOut = networkOutResult.Datapoints?.[networkOutResult.Datapoints.length - 1]?.Sum;

    return {
      cpuUtilization: cpuUtilization ? Math.round(cpuUtilization * 100) / 100 : undefined,
      networkIn: networkIn ? Math.round(networkIn / 1024 / 1024 * 100) / 100 : undefined, // Convert to MB
      networkOut: networkOut ? Math.round(networkOut / 1024 / 1024 * 100) / 100 : undefined, // Convert to MB
    };

  } catch (error) {
    console.warn(`Failed to get metrics for instance ${instanceId}:`, error);
    return {};
  }
}

function calculateRunTime(launchTime: Date | undefined): string {
  if (!launchTime) return '0m';

  const now = new Date();
  const diffMs = now.getTime() - launchTime.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays}d ${diffHours % 24}h`;
  } else if (diffHours > 0) {
    return `${diffHours}h ${diffMinutes % 60}m`;
  } else {
    return `${diffMinutes}m`;
  }
}

function mapEC2StatusToWorkstationStatus(ec2Status: string): string {
  const statusMap: Record<string, string> = {
    'pending': 'launching',
    'running': 'running',
    'stopping': 'stopping',
    'stopped': 'stopped',
    'shutting-down': 'terminating',
    'terminated': 'terminated',
  };

  return statusMap[ec2Status] || 'launching';
}

/** Mark a workstation's status, tolerating the item having been deleted. */
async function markWorkstationStatus(pk: string, sk: string, status: string): Promise<void> {
  try {
    await dynamoClient.send(new UpdateItemCommand({
      TableName: WORKSTATIONS_TABLE,
      Key: marshall({ PK: pk, SK: sk }),
      UpdateExpression: 'SET #status = :status, updatedAt = :timestamp',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: marshall({
        ':status': status,
        ':timestamp': new Date().toISOString(),
      }),
    }));
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      console.warn(`Workstation ${pk} no longer exists; skipping status write`);
      return;
    }
    throw error;
  }
}

/**
 * Email the workstation owner that auto-termination is imminent, then stamp
 * the deadline we warned about so the next run doesn't re-send. The stamp is
 * written only after SES succeeds, so a failed send retries next run.
 */
async function sendTerminationWarning(ws: any): Promise<void> {
  const name = ws.friendlyName || ws.instanceId;
  const minutesLeft = Math.max(1, Math.round((new Date(ws.autoTerminateAt).getTime() - Date.now()) / 60000));

  const bodyText =
    `Your workstation "${name}" (${ws.instanceId}, ${ws.instanceType || 'unknown type'}, ${ws.region || 'unknown region'}) ` +
    `is scheduled to be automatically TERMINATED in about ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}, ` +
    `at ${ws.autoTerminateAt}.\n\n` +
    `Termination permanently destroys the instance and all data on it.\n\n` +
    `If you still need this workstation, open the dashboard and use the "Extend" button on the workstation card ` +
    `to push the deadline out. Otherwise, no action is needed.\n\n` +
    `Best regards,\nNyroForge`;

  await sesClient.send(new SendEmailCommand({
    Source: SES_FROM_EMAIL,
    Destination: { ToAddresses: [ws.userId] },
    Message: {
      Subject: { Data: `⏰ Workstation "${name}" terminates in ~${minutesLeft} min` },
      Body: { Text: { Data: bodyText } },
    },
  }));
  console.log(`✅ Sent termination warning for ${ws.instanceId} to ${ws.userId}`);

  await dynamoClient.send(new UpdateItemCommand({
    TableName: WORKSTATIONS_TABLE,
    Key: marshall({ PK: ws.PK, SK: ws.SK }),
    UpdateExpression: 'SET terminationWarnedFor = :deadline',
    ConditionExpression: 'attribute_exists(PK)',
    ExpressionAttributeValues: marshall({ ':deadline': ws.autoTerminateAt }),
  }));
}

/**
 * Check for workstations that have exceeded their autoTerminateAt time
 * and terminate them automatically
 */
async function checkAndTerminateExpiredInstances(): Promise<void> {
  console.log('='.repeat(80));
  console.log('Starting auto-termination check...');
  console.log('='.repeat(80));

  try {
    // Get all workstations with auto-termination configured. This must
    // paginate: with an unpaginated scan, expired workstations past the
    // first 1 MB page would never be terminated.
    const workstations = await scanAllItems(dynamoClient, {
      TableName: WORKSTATIONS_TABLE,
      FilterExpression: 'begins_with(PK, :pk) AND attribute_exists(autoTerminateAt)',
      ExpressionAttributeValues: marshall({
        ':pk': 'WORKSTATION#',
      }),
    });

    console.log(`Found ${workstations.length} workstations with auto-termination configured`);

    const now = new Date();
    // Ignore instances that are already on their way out
    const activeWorkstations = workstations.filter((ws: any) =>
      ws.autoTerminateAt &&
      ws.status &&
      !['terminating', 'terminated', 'shutting-down'].includes(ws.status)
    );

    const expiredWorkstations = activeWorkstations.filter((ws: any) => {
      const isExpired = new Date(ws.autoTerminateAt) <= now;
      if (isExpired) {
        console.log(`Workstation ${ws.instanceId}: expired at ${ws.autoTerminateAt}, status: ${ws.status}`);
      }
      return isExpired;
    });

    console.log(`Found ${expiredWorkstations.length} expired workstations to terminate`);

    // Warn owners whose deadline falls inside the warning window and who
    // haven't been warned about THIS deadline yet (extending the deadline
    // re-arms the warning automatically).
    const warningWindowMs = TERMINATION_WARNING_MINUTES * 60 * 1000;
    const workstationsToWarn = activeWorkstations.filter((ws: any) => {
      const deadline = new Date(ws.autoTerminateAt).getTime();
      return deadline > now.getTime() &&
        deadline - now.getTime() <= warningWindowMs &&
        ws.terminationWarnedFor !== ws.autoTerminateAt &&
        typeof ws.userId === 'string' && ws.userId.includes('@');
    });

    if (workstationsToWarn.length > 0) {
      console.log(`Sending termination warnings for ${workstationsToWarn.length} workstations`);
      const warningResults = await Promise.allSettled(
        workstationsToWarn.map((ws: any) => sendTerminationWarning(ws))
      );
      for (const result of warningResults) {
        if (result.status === 'rejected') {
          console.warn('Failed to send a termination warning:', result.reason);
        }
      }
    }

    if (expiredWorkstations.length === 0) {
      console.log('No workstations need termination at this time');
      return;
    }

    // Terminate expired instances — each workstation is handled in isolation
    // so one failure can't block the rest of the batch.
    const terminationResults = await Promise.allSettled(
      expiredWorkstations.map(async (ws: any) => {
        try {
          console.log(`Terminating expired workstation ${ws.instanceId} (${ws.PK})...`);

          // Terminate the EC2 instance
          const terminateCommand = new TerminateInstancesCommand({
            InstanceIds: [ws.instanceId],
          });

          await ec2Client.send(terminateCommand);
          console.log(`✅ Successfully initiated termination for ${ws.instanceId}`);

          await markWorkstationStatus(ws.PK, ws.SK, 'terminating');
          console.log(`✅ Updated status to terminating for ${ws.PK}`);

          return {
            success: true,
            workstationId: ws.PK.replace('WORKSTATION#', ''),
            instanceId: ws.instanceId,
          };

        } catch (error: any) {
          console.error(`❌ Failed to terminate ${ws.instanceId}:`, error);

          // If instance doesn't exist, update status to terminated
          if (error.name === 'InvalidInstanceID.NotFound' || error.Code === 'InvalidInstanceID.NotFound') {
            console.log(`Instance ${ws.instanceId} not found, marking as terminated`);
            try {
              await markWorkstationStatus(ws.PK, ws.SK, 'terminated');
            } catch (updateError) {
              console.error(`Failed to mark ${ws.PK} terminated:`, updateError);
            }
          }

          return {
            success: false,
            workstationId: ws.PK.replace('WORKSTATION#', ''),
            instanceId: ws.instanceId,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      })
    );

    // Log results
    const successful = terminationResults.filter(r => r.status === 'fulfilled' && (r.value as any).success).length;
    const failed = terminationResults.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !(r.value as any).success)).length;

    console.log('='.repeat(80));
    console.log('Auto-termination check completed:');
    console.log(`  Total checked: ${workstations.length}`);
    console.log(`  Expired found: ${expiredWorkstations.length}`);
    console.log(`  Successfully terminated: ${successful}`);
    console.log(`  Failed: ${failed}`);
    console.log('='.repeat(80));

  } catch (error) {
    console.error('❌ Error during auto-termination check:', error);
    console.error('Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}
