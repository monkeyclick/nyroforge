import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { DynamoDBClient, PutItemCommand, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

// Initialize AWS clients
const costExplorerClient = new CostExplorerClient({});
const dynamoClient = new DynamoDBClient({});

// Environment variables
const COSTS_TABLE = process.env.COSTS_TABLE_NAME!;
const WORKSTATIONS_TABLE = process.env.WORKSTATIONS_TABLE_NAME!;

interface CostBreakdown {
  byInstanceType: Record<string, number>;
  byUser: Record<string, number>;
  byRegion: Record<string, number>;
  byProject: Record<string, string>;
}

interface CostTrends {
  dailyAverage: number;
  weeklyAverage: number;
  monthlyTotal: number;
  projectedMonthly: number;
}

interface CostResponse {
  period: string;
  totalCost: number;
  breakdown: CostBreakdown;
  trends: CostTrends;
  costOptimizationSuggestions: string[];
  lastUpdated: string;
}

export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    const { queryStringParameters, requestContext } = event;
    const userId = requestContext.authorizer?.claims?.email || 'unknown';
    const userGroups = requestContext.authorizer?.claims?.['cognito:groups']?.split(',') || [];
    const isAdmin = userGroups.includes('workstation-admin');

    const period = queryStringParameters?.period || 'monthly';
    const targetUserId = queryStringParameters?.userId;

    // Validate permissions
    if (targetUserId && !isAdmin) {
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        body: JSON.stringify({ message: 'Access denied' }),
      };
    }

    const effectiveUserId = isAdmin ? (targetUserId || undefined) : userId;

    return await getCostAnalytics(period, effectiveUserId, isAdmin);

  } catch (error) {
    console.error('Error:', error);
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
};

async function getCostAnalytics(period: string, userId?: string, isAdmin: boolean = false): Promise<APIGatewayProxyResult> {
  try {
    const now = new Date();
    let startDate: Date;
    let endDate: Date = now;

    // Determine date range based on period
    switch (period) {
      case 'daily':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
        break;
      case 'weekly':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
        break;
      case 'monthly':
      default:
        startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1); // Last 3 months
        break;
    }

    // Get cost data from Cost Explorer
    const costData = await getCostExplorerData(startDate, endDate, userId);
    
    // Get workstation data for detailed breakdown
    const workstationData = await getWorkstationCostData(userId, isAdmin);
    
    // Calculate breakdown and trends
    const breakdown = calculateCostBreakdown(workstationData, costData);
    const trends = calculateCostTrends(costData, period);
    
    // Generate cost optimization suggestions
    const suggestions = generateCostOptimizationSuggestions(workstationData, costData);

    const response: CostResponse = {
      period,
      totalCost: costData.totalCost,
      breakdown,
      trends,
      costOptimizationSuggestions: suggestions,
      lastUpdated: new Date().toISOString(),
    };

    // Cache the results in DynamoDB for faster subsequent requests
    await cacheCostData(userId || 'all', period, response);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300', // 5 minutes cache
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error('Error getting cost analytics:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Failed to get cost analytics',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

async function getCostExplorerData(startDate: Date, endDate: Date, userId?: string): Promise<{
  totalCost: number;
  dailyCosts: Array<{ date: string; amount: number }>;
  serviceCosts: Record<string, number>;
}> {
  try {
    const command = new GetCostAndUsageCommand({
      TimePeriod: {
        Start: startDate.toISOString().split('T')[0],
        End: endDate.toISOString().split('T')[0],
      },
      Granularity: 'DAILY',
      Metrics: ['BlendedCost'],
      GroupBy: [
        {
          Type: 'DIMENSION',
          Key: 'SERVICE',
        },
      ],
      Filter: {
        Dimensions: {
          Key: 'SERVICE',
          Values: ['Amazon Elastic Compute Cloud - Compute'],
        },
      },
    });

    const result = await costExplorerClient.send(command);
    
    let totalCost = 0;
    const dailyCosts: Array<{ date: string; amount: number }> = [];
    const serviceCosts: Record<string, number> = {};

    result.ResultsByTime?.forEach(timeResult => {
      const date = timeResult.TimePeriod?.Start || '';
      let dayTotal = 0;

      timeResult.Groups?.forEach(group => {
        const amount = parseFloat(group.Metrics?.BlendedCost?.Amount || '0');
        const service = group.Keys?.[0] || 'Unknown';
        
        dayTotal += amount;
        serviceCosts[service] = (serviceCosts[service] || 0) + amount;
      });

      dailyCosts.push({ date, amount: dayTotal });
      totalCost += dayTotal;
    });

    return {
      totalCost: Math.round(totalCost * 100) / 100,
      dailyCosts,
      serviceCosts,
    };

  } catch (error) {
    console.warn('Failed to get Cost Explorer data, using estimated costs:', error);
    
    // Fallback to estimated costs from workstation data
    return {
      totalCost: 0,
      dailyCosts: [],
      serviceCosts: {},
    };
  }
}

async function getWorkstationCostData(userId?: string, isAdmin: boolean = false): Promise<any[]> {
  try {
    let command;

    if (userId && !isAdmin) {
      // User querying their own workstations
      command = new QueryCommand({
        TableName: WORKSTATIONS_TABLE,
        IndexName: 'UserIdIndex',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: marshall({
          ':userId': userId,
        }),
      });
    } else if (userId && isAdmin) {
      // Admin querying specific user's workstations
      command = new QueryCommand({
        TableName: WORKSTATIONS_TABLE,
        IndexName: 'UserIdIndex',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: marshall({
          ':userId': userId,
        }),
      });
    } else {
      // Admin querying all workstations
      command = new ScanCommand({
        TableName: WORKSTATIONS_TABLE,
        FilterExpression: 'begins_with(PK, :pk)',
        ExpressionAttributeValues: marshall({
          ':pk': 'WORKSTATION#',
        }),
      });
    }

    const result = await dynamoClient.send(command);
    return (result.Items || []).map(item => unmarshall(item));

  } catch (error) {
    console.error('Failed to get workstation data:', error);
    return [];
  }
}

function calculateCostBreakdown(workstations: any[], costData: any): CostBreakdown {
  const breakdown: CostBreakdown = {
    byInstanceType: {},
    byUser: {},
    byRegion: {},
    byProject: {},
  };

  workstations.forEach(workstation => {
    const cost = workstation.actualCostToDate || workstation.estimatedMonthlyCost || 0;
    
    // By instance type
    const instanceType = workstation.instanceType || 'Unknown';
    breakdown.byInstanceType[instanceType] = (breakdown.byInstanceType[instanceType] || 0) + cost;
    
    // By user
    const user = workstation.userId || 'Unknown';
    breakdown.byUser[user] = (breakdown.byUser[user] || 0) + cost;
    
    // By region
    const region = workstation.region || 'Unknown';
    breakdown.byRegion[region] = (breakdown.byRegion[region] || 0) + cost;
    
    // By project (from tags)
    const project = workstation.tags?.Project || 'Untagged';
    breakdown.byProject[project] = (breakdown.byProject[project] || 0) + cost;
  });

  // Round all values
  Object.keys(breakdown).forEach(category => {
    Object.keys(breakdown[category as keyof CostBreakdown]).forEach(key => {
      const value = breakdown[category as keyof CostBreakdown][key];
      if (typeof value === 'number') {
        breakdown[category as keyof CostBreakdown][key] = Math.round(value * 100) / 100;
      }
    });
  });

  return breakdown;
}

function calculateCostTrends(costData: any, period: string): CostTrends {
  const dailyCosts = costData.dailyCosts || [];
  
  // Calculate daily average
  const dailyAverage = dailyCosts.length > 0 
    ? dailyCosts.reduce((sum: number, day: any) => sum + day.amount, 0) / dailyCosts.length
    : 0;

  // Calculate weekly average (last 7 days)
  const lastWeekCosts = dailyCosts.slice(-7);
  const weeklyAverage = lastWeekCosts.length > 0
    ? lastWeekCosts.reduce((sum: number, day: any) => sum + day.amount, 0) / lastWeekCosts.length
    : 0;

  // Calculate monthly total
  const monthlyTotal = costData.totalCost || 0;

  // Project monthly cost based on current trends
  const currentDate = new Date();
  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
  const dayOfMonth = currentDate.getDate();
  const projectedMonthly = dailyAverage * daysInMonth;

  return {
    dailyAverage: Math.round(dailyAverage * 100) / 100,
    weeklyAverage: Math.round(weeklyAverage * 100) / 100,
    monthlyTotal: Math.round(monthlyTotal * 100) / 100,
    projectedMonthly: Math.round(projectedMonthly * 100) / 100,
  };
}

function generateCostOptimizationSuggestions(workstations: any[], costData: any): string[] {
  const suggestions: string[] = [];

  // Check for idle instances
  const idleInstances = workstations.filter(ws => 
    ws.status === 'stopped' && 
    new Date(ws.lastStatusCheck) < new Date(Date.now() - 24 * 60 * 60 * 1000) // Stopped for more than 24 hours
  );

  if (idleInstances.length > 0) {
    suggestions.push(`Consider terminating ${idleInstances.length} instances that have been stopped for more than 24 hours`);
  }

  // Check for oversized instances
  const expensiveInstances = workstations.filter(ws => 
    ws.estimatedHourlyCost > 2.0 && ws.status === 'running'
  );

  if (expensiveInstances.length > 0) {
    suggestions.push(`Review ${expensiveInstances.length} high-cost instances (>$2/hour) for potential downsizing`);
  }

  // Check for instances running during off-hours
  const currentHour = new Date().getHours();
  if (currentHour < 6 || currentHour > 22) { // Outside 6 AM - 10 PM
    const runningInstances = workstations.filter(ws => ws.status === 'running');
    if (runningInstances.length > 0) {
      suggestions.push(`${runningInstances.length} instances are running outside business hours - consider implementing auto-shutdown policies`);
    }
  }

  // Check for untagged resources
  const untaggedInstances = workstations.filter(ws => 
    !ws.tags?.Project || !ws.tags?.Department
  );

  if (untaggedInstances.length > 0) {
    suggestions.push(`${untaggedInstances.length} instances lack proper cost allocation tags`);
  }

  // Suggest Reserved Instances for consistent usage
  const consistentUsers = Object.entries(
    workstations.reduce((acc: Record<string, number>, ws) => {
      acc[ws.userId] = (acc[ws.userId] || 0) + 1;
      return acc;
    }, {})
  ).filter(([_, count]) => count >= 3);

  if (consistentUsers.length > 0) {
    suggestions.push(`Consider Reserved Instances for ${consistentUsers.length} users with consistent workstation usage`);
  }

  return suggestions.length > 0 ? suggestions : ['No optimization opportunities identified at this time'];
}

async function cacheCostData(userId: string, period: string, data: CostResponse): Promise<void> {
  try {
    const cacheKey = `COST#${period}#${userId}`;
    const ttl = Math.floor(Date.now() / 1000) + 300; // 5 minutes TTL

    const putCommand = new PutItemCommand({
      TableName: COSTS_TABLE,
      Item: marshall({
        PK: cacheKey,
        SK: 'CACHE',
        data: JSON.stringify(data),
        ttl,
        createdAt: new Date().toISOString(),
      }),
    });

    await dynamoClient.send(putCommand);
  } catch (error) {
    console.warn('Failed to cache cost data:', error);
    // Non-critical error, continue execution
  }
}