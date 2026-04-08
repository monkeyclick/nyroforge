import { APIGatewayProxyEvent, APIGatewayProxyResult, Context, ScheduledEvent } from 'aws-lambda';
import { EC2Client, DescribeInstancesCommand, DescribeInstanceStatusCommand, TerminateInstancesCommand } from '@aws-sdk/client-ec2';
import { DynamoDBClient, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

// Initialize AWS clients
const ec2Client = new EC2Client({});
const dynamoClient = new DynamoDBClient({});
const cloudWatchClient = new CloudWatchClient({});

// Environment variables
const WORKSTATIONS_TABLE = process.env.WORKSTATIONS_TABLE_NAME!;

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
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    // Handle scheduled EventBridge events (for auto-termination)
    if ('source' in event && event.source === 'aws.events') {
      console.log('Processing scheduled auto-termination check...');
      await checkAndTerminateExpiredInstances();
      return;
    }

    // Handle API Gateway events
    const apiEvent = event as APIGatewayProxyEvent;
    const { httpMethod, pathParameters, requestContext } = apiEvent;
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

    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({ message: 'Invalid request' }),
    };

  } catch (error) {
    console.error('Error:', error);
    
    // Return error response for API Gateway calls
    if ('httpMethod' in event) {
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({
          message: 'Internal server error',
          error: error instanceof Error ? error.message : 'Unknown error'
        }),
      };
    }
    
    // For scheduled events, just log the error
    throw error;
  }
};

async function getDashboardStatus(userId: string, isAdmin: boolean): Promise<APIGatewayProxyResult> {
  try {
    // Get all workstations from DynamoDB
    const scanCommand = new ScanCommand({
      TableName: WORKSTATIONS_TABLE,
      FilterExpression: 'begins_with(PK, :pk)',
      ExpressionAttributeValues: marshall({
        ':pk': 'WORKSTATION#',
      }),
    });

    const dynamoResult = await dynamoClient.send(scanCommand);
    let allWorkstations = (dynamoResult.Items || []).map(item => unmarshall(item));

    // Filter by user if not admin
    if (!isAdmin) {
      allWorkstations = allWorkstations.filter((ws: any) => ws.userId === userId);
    }

    // Get current EC2 instance statuses
    const instanceIds = allWorkstations.map((ws: any) => ws.instanceId).filter(Boolean);
    
    let ec2Instances: any[] = [];
    if (instanceIds.length > 0) {
      const describeCommand = new DescribeInstancesCommand({
        InstanceIds: instanceIds,
      });

      const ec2Result = await ec2Client.send(describeCommand);
      ec2Instances = ec2Result.Reservations?.flatMap(r => r.Instances || []) || [];
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

    // Wait for all status updates to complete
    await Promise.all(statusUpdates);

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

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        summary,
        instances: instanceStatusList,
        lastUpdated: new Date().toISOString(),
      }),
    };

  } catch (error) {
    console.error('Error getting dashboard status:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Failed to get dashboard status',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
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

    return {
      statusCode: isHealthy ? 200 : 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        status: isHealthy ? 'healthy' : 'degraded',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        services,
      }),
    };

  } catch (error) {
    console.error('Error checking health:', error);
    return {
      statusCode: 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        status: 'unhealthy',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
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
    ExpressionAttributeNames: attributeNames,
    ExpressionAttributeValues: marshall(attributeValues),
  });

  await dynamoClient.send(updateCommand);
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

/**
 * Check for workstations that have exceeded their autoTerminateAt time
 * and terminate them automatically
 */
async function checkAndTerminateExpiredInstances(): Promise<void> {
  console.log('='.repeat(80));
  console.log('Starting auto-termination check...');
  console.log('='.repeat(80));
  
  try {
    // Get all workstations from DynamoDB
    const scanCommand = new ScanCommand({
      TableName: WORKSTATIONS_TABLE,
      FilterExpression: 'begins_with(PK, :pk) AND attribute_exists(autoTerminateAt)',
      ExpressionAttributeValues: marshall({
        ':pk': 'WORKSTATION#',
      }),
    });

    const result = await dynamoClient.send(scanCommand);
    const workstations = (result.Items || []).map(item => unmarshall(item));
    
    console.log(`Found ${workstations.length} workstations with auto-termination configured`);
    
    const now = new Date();
    const expiredWorkstations = workstations.filter((ws: any) => {
      if (!ws.autoTerminateAt) return false;
      
      const terminateAt = new Date(ws.autoTerminateAt);
      const isExpired = terminateAt <= now;
      
      // Only terminate if instance is running or stopped (not already terminating/terminated)
      const shouldTerminate = isExpired &&
        ws.status &&
        !['terminating', 'terminated', 'shutting-down'].includes(ws.status);
      
      if (isExpired) {
        console.log(`Workstation ${ws.instanceId}: expired at ${ws.autoTerminateAt}, status: ${ws.status}, will terminate: ${shouldTerminate}`);
      }
      
      return shouldTerminate;
    });
    
    console.log(`Found ${expiredWorkstations.length} expired workstations to terminate`);
    
    if (expiredWorkstations.length === 0) {
      console.log('No workstations need termination at this time');
      return;
    }
    
    // Terminate expired instances
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
          
          // Update the status in DynamoDB
          const updateCommand = new UpdateItemCommand({
            TableName: WORKSTATIONS_TABLE,
            Key: marshall({
              PK: ws.PK,
              SK: ws.SK,
            }),
            UpdateExpression: 'SET #status = :status, updatedAt = :timestamp',
            ExpressionAttributeNames: {
              '#status': 'status',
            },
            ExpressionAttributeValues: marshall({
              ':status': 'terminating',
              ':timestamp': new Date().toISOString(),
            }),
          });
          
          await dynamoClient.send(updateCommand);
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
            
            const updateCommand = new UpdateItemCommand({
              TableName: WORKSTATIONS_TABLE,
              Key: marshall({
                PK: ws.PK,
                SK: ws.SK,
              }),
              UpdateExpression: 'SET #status = :status, updatedAt = :timestamp',
              ExpressionAttributeNames: {
                '#status': 'status',
              },
              ExpressionAttributeValues: marshall({
                ':status': 'terminated',
                ':timestamp': new Date().toISOString(),
              }),
            });
            
            await dynamoClient.send(updateCommand);
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