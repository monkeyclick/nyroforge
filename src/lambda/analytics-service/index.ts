import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const ANALYTICS_TABLE = process.env.ANALYTICS_TABLE_NAME || '';
const FEEDBACK_TABLE = process.env.FEEDBACK_TABLE_NAME || '';

interface AnalyticsEvent {
  eventId: string;
  userId: string;
  userEmail?: string;
  eventType: string;
  eventCategory: string;
  eventAction: string;
  eventLabel?: string;
  eventValue?: number;
  metadata?: Record<string, any>;
  sessionId?: string;
  timestamp: string;
  userAgent?: string;
  ipAddress?: string;
}

interface FeedbackSubmission {
  feedbackId: string;
  userId: string;
  userEmail?: string;
  feedbackType: 'bug' | 'feature' | 'improvement' | 'other';
  title: string;
  description: string;
  rating?: number;
  page?: string;
  timestamp: string;
  status: 'new' | 'reviewed' | 'in-progress' | 'resolved' | 'closed';
  metadata?: Record<string, any>;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Analytics Service Event:', JSON.stringify(event, null, 2));

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;

    // Track analytics event
    if (path.endsWith('/analytics/track') && method === 'POST') {
      return await trackEvent(event, headers);
    }

    // Submit feedback
    if (path.endsWith('/analytics/feedback') && method === 'POST') {
      return await submitFeedback(event, headers);
    }

    // Get analytics summary (admin only)
    if (path.endsWith('/analytics/summary') && method === 'GET') {
      return await getAnalyticsSummary(event, headers);
    }

    // Get feedback list (admin only)
    if (path.endsWith('/analytics/feedback') && method === 'GET') {
      return await getFeedbackList(event, headers);
    }

    // Get user analytics (user's own data)
    if (path.match(/\/analytics\/user\/[^/]+$/) && method === 'GET') {
      return await getUserAnalytics(event, headers);
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Endpoint not found' })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error)
      })
    };
  }
};

async function trackEvent(event: APIGatewayProxyEvent, headers: Record<string, string>): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const userId = event.requestContext.authorizer?.claims?.sub || 'anonymous';
  const userEmail = event.requestContext.authorizer?.claims?.email;

  const analyticsEvent: AnalyticsEvent = {
    eventId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    userId,
    userEmail,
    eventType: body.eventType || 'click',
    eventCategory: body.eventCategory || 'general',
    eventAction: body.eventAction,
    eventLabel: body.eventLabel,
    eventValue: body.eventValue,
    metadata: body.metadata || {},
    sessionId: body.sessionId,
    timestamp: new Date().toISOString(),
    userAgent: event.headers['User-Agent'] || event.headers['user-agent'],
    ipAddress: event.requestContext.identity?.sourceIp
  };

  await docClient.send(new PutCommand({
    TableName: ANALYTICS_TABLE,
    Item: analyticsEvent
  }));

  return {
    statusCode: 201,
    headers,
    body: JSON.stringify({ 
      message: 'Event tracked successfully',
      eventId: analyticsEvent.eventId
    })
  };
}

async function submitFeedback(event: APIGatewayProxyEvent, headers: Record<string, string>): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const userId = event.requestContext.authorizer?.claims?.sub || 'anonymous';
  const userEmail = event.requestContext.authorizer?.claims?.email;

  const feedback: FeedbackSubmission = {
    feedbackId: `fb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    userId,
    userEmail,
    feedbackType: body.feedbackType || 'other',
    title: body.title,
    description: body.description,
    rating: body.rating,
    page: body.page,
    timestamp: new Date().toISOString(),
    status: 'new',
    metadata: body.metadata || {}
  };

  await docClient.send(new PutCommand({
    TableName: FEEDBACK_TABLE,
    Item: feedback
  }));

  return {
    statusCode: 201,
    headers,
    body: JSON.stringify({ 
      message: 'Feedback submitted successfully',
      feedbackId: feedback.feedbackId
    })
  };
}

async function getAnalyticsSummary(event: APIGatewayProxyEvent, headers: Record<string, string>): Promise<APIGatewayProxyResult> {
  // Check if user is admin
  const groups = event.requestContext.authorizer?.claims?.['cognito:groups'];
  if (!groups || !groups.includes('workstation-admin')) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: 'Admin access required' })
    };
  }

  const timeframe = event.queryStringParameters?.timeframe || '7d';
  const now = new Date();
  const startDate = new Date(now);
  
  // Calculate start date based on timeframe
  if (timeframe === '24h') startDate.setHours(now.getHours() - 24);
  else if (timeframe === '7d') startDate.setDate(now.getDate() - 7);
  else if (timeframe === '30d') startDate.setDate(now.getDate() - 30);
  else if (timeframe === '90d') startDate.setDate(now.getDate() - 90);

  // Scan analytics table (in production, use GSI with date filtering)
  const result = await docClient.send(new ScanCommand({
    TableName: ANALYTICS_TABLE,
    FilterExpression: '#timestamp >= :startDate',
    ExpressionAttributeNames: {
      '#timestamp': 'timestamp'
    },
    ExpressionAttributeValues: {
      ':startDate': startDate.toISOString()
    }
  }));

  const events = result.Items || [];

  // Aggregate analytics
  const summary = {
    totalEvents: events.length,
    uniqueUsers: new Set(events.map(e => e.userId)).size,
    eventsByCategory: {} as Record<string, number>,
    eventsByType: {} as Record<string, number>,
    topActions: {} as Record<string, number>,
    timeframe,
    startDate: startDate.toISOString(),
    endDate: now.toISOString()
  };

  events.forEach((event: any) => {
    // Count by category
    summary.eventsByCategory[event.eventCategory] = (summary.eventsByCategory[event.eventCategory] || 0) + 1;
    
    // Count by type
    summary.eventsByType[event.eventType] = (summary.eventsByType[event.eventType] || 0) + 1;
    
    // Count top actions
    summary.topActions[event.eventAction] = (summary.topActions[event.eventAction] || 0) + 1;
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ summary, events: events.slice(0, 100) })
  };
}

async function getFeedbackList(event: APIGatewayProxyEvent, headers: Record<string, string>): Promise<APIGatewayProxyResult> {
  // Check if user is admin
  const groups = event.requestContext.authorizer?.claims?.['cognito:groups'];
  if (!groups || !groups.includes('workstation-admin')) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: 'Admin access required' })
    };
  }

  const status = event.queryStringParameters?.status;

  const params: any = {
    TableName: FEEDBACK_TABLE
  };

  if (status) {
    params.FilterExpression = '#status = :status';
    params.ExpressionAttributeNames = { '#status': 'status' };
    params.ExpressionAttributeValues = { ':status': status };
  }

  const result = await docClient.send(new ScanCommand(params));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ 
      feedback: result.Items || [],
      count: result.Items?.length || 0
    })
  };
}

async function getUserAnalytics(event: APIGatewayProxyEvent, headers: Record<string, string>): Promise<APIGatewayProxyResult> {
  const userId = event.requestContext.authorizer?.claims?.sub;
  const requestedUserId = event.pathParameters?.userId;

  // Users can only see their own analytics unless they're admin
  const groups = event.requestContext.authorizer?.claims?.['cognito:groups'];
  const isAdmin = groups && groups.includes('workstation-admin');

  if (userId !== requestedUserId && !isAdmin) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: 'Access denied' })
    };
  }

  const result = await docClient.send(new QueryCommand({
    TableName: ANALYTICS_TABLE,
    IndexName: 'UserIndex',
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': requestedUserId
    },
    Limit: 100,
    ScanIndexForward: false // Most recent first
  }));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ 
      events: result.Items || [],
      count: result.Items?.length || 0
    })
  };
}