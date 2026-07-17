import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { logEvent } from '../shared/logging';
import { corsHeaders, errorResponse, jsonResponse } from '../shared/http';
import { isAdmin, requireAdmin } from '../shared/auth';
import { docQueryAll, docScanAll } from '../shared/dynamo';

const client = new DynamoDBClient({});
// Optional fields (eventLabel, rating, ...) are frequently absent; without
// removeUndefinedValues the marshaller rejects the whole item.
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const ANALYTICS_TABLE = process.env.ANALYTICS_TABLE_NAME || '';
const FEEDBACK_TABLE = process.env.FEEDBACK_TABLE_NAME || '';
// Events expire via the table's TTL attribute after this many days.
const RETENTION_DAYS = parseInt(process.env.ANALYTICS_RETENTION_DAYS || '90', 10);

const FEEDBACK_TYPES = ['bug', 'feature', 'improvement', 'other'] as const;
const FEEDBACK_STATUSES = ['new', 'reviewed', 'in-progress', 'resolved', 'closed'] as const;
const TIMEFRAME_DAYS: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };

const MAX_METADATA_BYTES = 4096;

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
  eventDate: string; // YYYY-MM-DD daily bucket for the DateIndex GSI
  ttl: number;
  userAgent?: string;
  ipAddress?: string;
}

interface FeedbackSubmission {
  feedbackId: string;
  userId: string;
  userEmail?: string;
  feedbackType: (typeof FEEDBACK_TYPES)[number];
  title: string;
  description: string;
  rating?: number;
  page?: string;
  timestamp: string;
  status: (typeof FEEDBACK_STATUSES)[number];
  metadata?: Record<string, any>;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logEvent(event, 'Analytics Service Event');

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;

    // Track analytics event
    if (path.endsWith('/analytics/track') && method === 'POST') {
      return await trackEvent(event);
    }

    // Submit feedback
    if (path.endsWith('/analytics/feedback') && method === 'POST') {
      return await submitFeedback(event);
    }

    // Get feedback list (admin only)
    if (path.endsWith('/analytics/feedback') && method === 'GET') {
      return await getFeedbackList(event);
    }

    // Update feedback triage status (admin only)
    if (path.match(/\/analytics\/feedback\/[^/]+$/) && method === 'PATCH') {
      return await updateFeedbackStatus(event);
    }

    // Get analytics summary (admin only)
    if (path.endsWith('/analytics/summary') && method === 'GET') {
      return await getAnalyticsSummary(event);
    }

    // Get user analytics (user's own data, or any user for admins)
    if (path.match(/\/analytics\/user\/[^/]+$/) && method === 'GET') {
      return await getUserAnalytics(event);
    }

    return errorResponse(404, 'Endpoint not found');
  } catch (error) {
    return errorResponse(500, 'Internal server error', error);
  }
};

function parseBody(event: APIGatewayProxyEvent): Record<string, any> | null {
  try {
    const body = JSON.parse(event.body || '{}');
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

/** Optional bounded string field: undefined if absent, null if invalid. */
function optionalString(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > maxLength) return null;
  return value;
}

/** Optional metadata object, bounded by serialized size. Null if invalid. */
function optionalMetadata(value: unknown): Record<string, any> | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  if (JSON.stringify(value).length > MAX_METADATA_BYTES) return null;
  return value as Record<string, any>;
}

function getCaller(event: APIGatewayProxyEvent): { userId: string; userEmail?: string } | null {
  const claims = event.requestContext.authorizer?.claims;
  if (!claims?.sub) return null;
  return { userId: claims.sub, userEmail: claims.email };
}

async function trackEvent(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse(400, 'Request body is not a valid JSON object');
  }

  const caller = getCaller(event);
  if (!caller) {
    return errorResponse(401, 'Unauthorized');
  }

  if (typeof body.eventAction !== 'string' || !body.eventAction.trim() || body.eventAction.length > 200) {
    return errorResponse(400, 'eventAction is required (string, max 200 characters)');
  }

  const eventType = optionalString(body.eventType, 100);
  const eventCategory = optionalString(body.eventCategory, 100);
  const eventLabel = optionalString(body.eventLabel, 500);
  const sessionId = optionalString(body.sessionId, 100);
  const metadata = optionalMetadata(body.metadata);
  if (eventType === null || eventCategory === null || eventLabel === null || sessionId === null) {
    return errorResponse(400, 'eventType, eventCategory, eventLabel, and sessionId must be strings within length limits');
  }
  if (metadata === null) {
    return errorResponse(400, `metadata must be an object under ${MAX_METADATA_BYTES} bytes`);
  }
  if (body.eventValue !== undefined && (typeof body.eventValue !== 'number' || !Number.isFinite(body.eventValue))) {
    return errorResponse(400, 'eventValue must be a finite number');
  }

  const now = new Date();
  const timestamp = now.toISOString();

  const analyticsEvent: AnalyticsEvent = {
    eventId: randomUUID(),
    userId: caller.userId,
    userEmail: caller.userEmail,
    eventType: eventType || 'click',
    eventCategory: eventCategory || 'general',
    eventAction: body.eventAction.trim(),
    eventLabel,
    eventValue: body.eventValue,
    metadata: metadata || {},
    sessionId,
    timestamp,
    eventDate: timestamp.slice(0, 10),
    ttl: Math.floor(now.getTime() / 1000) + RETENTION_DAYS * 24 * 60 * 60,
    userAgent: event.headers?.['User-Agent'] || event.headers?.['user-agent'],
    ipAddress: event.requestContext.identity?.sourceIp
  };

  await docClient.send(new PutCommand({
    TableName: ANALYTICS_TABLE,
    Item: analyticsEvent
  }));

  return jsonResponse(201, {
    message: 'Event tracked successfully',
    eventId: analyticsEvent.eventId
  });
}

async function submitFeedback(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody(event);
  if (!body) {
    return errorResponse(400, 'Request body is not a valid JSON object');
  }

  const caller = getCaller(event);
  if (!caller) {
    return errorResponse(401, 'Unauthorized');
  }

  if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200) {
    return errorResponse(400, 'title is required (string, max 200 characters)');
  }
  if (typeof body.description !== 'string' || !body.description.trim() || body.description.length > 2000) {
    return errorResponse(400, 'description is required (string, max 2000 characters)');
  }
  const feedbackType = body.feedbackType ?? 'other';
  if (!FEEDBACK_TYPES.includes(feedbackType)) {
    return errorResponse(400, `feedbackType must be one of: ${FEEDBACK_TYPES.join(', ')}`);
  }
  if (body.rating !== undefined && (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5)) {
    return errorResponse(400, 'rating must be an integer between 1 and 5');
  }
  const page = optionalString(body.page, 500);
  const metadata = optionalMetadata(body.metadata);
  if (page === null) {
    return errorResponse(400, 'page must be a string (max 500 characters)');
  }
  if (metadata === null) {
    return errorResponse(400, `metadata must be an object under ${MAX_METADATA_BYTES} bytes`);
  }

  const feedback: FeedbackSubmission = {
    feedbackId: `fb-${randomUUID()}`,
    userId: caller.userId,
    userEmail: caller.userEmail,
    feedbackType,
    title: body.title.trim(),
    description: body.description.trim(),
    rating: body.rating,
    page,
    timestamp: new Date().toISOString(),
    status: 'new',
    metadata: metadata || {}
  };

  await docClient.send(new PutCommand({
    TableName: FEEDBACK_TABLE,
    Item: feedback
  }));

  return jsonResponse(201, {
    message: 'Feedback submitted successfully',
    feedbackId: feedback.feedbackId
  });
}

async function getAnalyticsSummary(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const denied = requireAdmin(event);
  if (denied) return denied;

  const timeframe = event.queryStringParameters?.timeframe || '7d';
  const days = TIMEFRAME_DAYS[timeframe];
  if (!days) {
    return errorResponse(400, `timeframe must be one of: ${Object.keys(TIMEFRAME_DAYS).join(', ')}`);
  }

  const now = new Date();
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  // One DateIndex partition per UTC day in the window, queried in parallel.
  // The timestamp condition only trims the first (partial) day.
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
  while (cursor <= now) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const perDay = await Promise.all(dates.map(date =>
    docQueryAll(docClient, {
      TableName: ANALYTICS_TABLE,
      IndexName: 'DateIndex',
      KeyConditionExpression: 'eventDate = :date AND #timestamp >= :startDate',
      ExpressionAttributeNames: { '#timestamp': 'timestamp' },
      ExpressionAttributeValues: {
        ':date': date,
        ':startDate': startDate.toISOString()
      }
    })
  ));
  const events = perDay.flat();

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
    summary.eventsByCategory[event.eventCategory] = (summary.eventsByCategory[event.eventCategory] || 0) + 1;
    summary.eventsByType[event.eventType] = (summary.eventsByType[event.eventType] || 0) + 1;
    summary.topActions[event.eventAction] = (summary.topActions[event.eventAction] || 0) + 1;
  });

  const recentFirst = events
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, 100);

  return jsonResponse(200, { summary, events: recentFirst });
}

async function getFeedbackList(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const denied = requireAdmin(event);
  if (denied) return denied;

  const status = event.queryStringParameters?.status;

  let items: Record<string, any>[];
  if (status) {
    if (!FEEDBACK_STATUSES.includes(status as any)) {
      return errorResponse(400, `status must be one of: ${FEEDBACK_STATUSES.join(', ')}`);
    }
    items = await docQueryAll(docClient, {
      TableName: FEEDBACK_TABLE,
      IndexName: 'StatusIndex',
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': status },
      ScanIndexForward: false // Most recent first
    });
  } else {
    items = await docScanAll(docClient, { TableName: FEEDBACK_TABLE });
    items.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  }

  return jsonResponse(200, {
    feedback: items,
    count: items.length
  });
}

async function updateFeedbackStatus(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const denied = requireAdmin(event);
  if (denied) return denied;

  const feedbackId = event.pathParameters?.feedbackId
    || decodeURIComponent(event.path.split('/').pop() || '');
  if (!feedbackId) {
    return errorResponse(400, 'feedbackId is required');
  }

  const body = parseBody(event);
  if (!body) {
    return errorResponse(400, 'Request body is not a valid JSON object');
  }
  if (!FEEDBACK_STATUSES.includes(body.status)) {
    return errorResponse(400, `status must be one of: ${FEEDBACK_STATUSES.join(', ')}`);
  }

  // The table key is (feedbackId, timestamp), so resolve the sort key first.
  const existing = await docClient.send(new QueryCommand({
    TableName: FEEDBACK_TABLE,
    KeyConditionExpression: 'feedbackId = :id',
    ExpressionAttributeValues: { ':id': feedbackId },
    Limit: 1
  }));
  const item = existing.Items?.[0];
  if (!item) {
    return errorResponse(404, 'Feedback not found');
  }

  const caller = getCaller(event);
  const updated = await docClient.send(new UpdateCommand({
    TableName: FEEDBACK_TABLE,
    Key: { feedbackId: item.feedbackId, timestamp: item.timestamp },
    UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, updatedBy = :updatedBy',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': body.status,
      ':updatedAt': new Date().toISOString(),
      ':updatedBy': caller?.userEmail || caller?.userId || 'unknown'
    },
    ReturnValues: 'ALL_NEW'
  }));

  return jsonResponse(200, {
    message: 'Feedback status updated',
    feedback: updated.Attributes
  });
}

async function getUserAnalytics(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const caller = getCaller(event);
  if (!caller) {
    return errorResponse(401, 'Unauthorized');
  }

  const requestedUserId = event.pathParameters?.userId
    || decodeURIComponent(event.path.split('/').pop() || '');
  if (!requestedUserId) {
    return errorResponse(400, 'userId is required');
  }

  // Users can only see their own analytics unless they're admin
  if (caller.userId !== requestedUserId && !isAdmin(event)) {
    return errorResponse(403, 'Access denied');
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

  return jsonResponse(200, {
    events: result.Items || [],
    count: result.Items?.length || 0
  });
}
