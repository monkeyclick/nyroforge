import { APIGatewayProxyEvent } from 'aws-lambda';

// Mock AWS SDK clients - must be before imports
jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return { ...actual, DynamoDBClient: jest.fn() };
});
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: { ...actual.DynamoDBDocumentClient, from: jest.fn() },
  };
});

import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const mockDocSend = jest.fn();
(DynamoDBDocumentClient.from as jest.Mock).mockReturnValue({ send: mockDocSend });

process.env.ANALYTICS_TABLE_NAME = 'UserAnalytics';
process.env.FEEDBACK_TABLE_NAME = 'UserFeedback';

// Import handler AFTER mock setup
import { handler } from '../../src/lambda/analytics-service/index';

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/analytics/summary',
    pathParameters: null,
    queryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    body: null,
    stageVariables: null,
    resource: '',
    requestContext: {
      authorizer: {
        claims: { sub: 'user-1', email: 'user@test.com' },
      },
      identity: { sourceIp: '10.0.0.1' },
    } as any,
    ...overrides,
  };
}

function makeAdminEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return makeEvent({
    requestContext: {
      authorizer: {
        claims: { sub: 'admin-1', email: 'admin@test.com', 'cognito:groups': 'workstation-admin' },
      },
      identity: { sourceIp: '10.0.0.1' },
    } as any,
    ...overrides,
  });
}

function commandsOfType(name: string) {
  return mockDocSend.mock.calls
    .map(([cmd]) => cmd)
    .filter((cmd) => cmd.constructor.name === name);
}

describe('Analytics Service Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDocSend.mockResolvedValue({ Items: [] });
  });

  it('handles OPTIONS preflight', async () => {
    const result = await handler(makeEvent({ httpMethod: 'OPTIONS' }));
    expect(result.statusCode).toBe(200);
  });

  it('returns 404 for unknown endpoints', async () => {
    const result = await handler(makeEvent({ path: '/analytics/nope', httpMethod: 'GET' }));
    expect(result.statusCode).toBe(404);
  });

  // ── POST /analytics/track ────────────────────────────────────────────────

  describe('trackEvent', () => {
    const trackEvent = (body: any, overrides: Partial<APIGatewayProxyEvent> = {}) =>
      handler(makeEvent({
        httpMethod: 'POST',
        path: '/analytics/track',
        body: JSON.stringify(body),
        ...overrides,
      }));

    it('stores an event with identity, daily bucket, and TTL', async () => {
      const result = await trackEvent({
        eventType: 'action',
        eventCategory: 'workstation',
        eventAction: 'launch',
        eventLabel: 'i-123',
      });

      expect(result.statusCode).toBe(201);
      const [put] = commandsOfType('PutCommand');
      expect(put.input.TableName).toBe('UserAnalytics');
      const item = put.input.Item;
      expect(item.userId).toBe('user-1');
      expect(item.userEmail).toBe('user@test.com');
      expect(item.eventAction).toBe('launch');
      expect(item.eventDate).toBe(item.timestamp.slice(0, 10));
      // TTL defaults to 90 days out, expressed in epoch seconds
      const expectedTtl = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;
      expect(item.ttl).toBeGreaterThan(expectedTtl - 60);
      expect(item.ttl).toBeLessThan(expectedTtl + 60);
      expect(JSON.parse(result.body).eventId).toBe(item.eventId);
    });

    it('rejects a missing eventAction', async () => {
      const result = await trackEvent({ eventCategory: 'workstation' });
      expect(result.statusCode).toBe(400);
      expect(commandsOfType('PutCommand')).toHaveLength(0);
    });

    it('rejects malformed JSON', async () => {
      const result = await handler(makeEvent({
        httpMethod: 'POST',
        path: '/analytics/track',
        body: '{not json',
      }));
      expect(result.statusCode).toBe(400);
    });

    it('rejects unauthenticated calls', async () => {
      const result = await trackEvent(
        { eventAction: 'launch' },
        { requestContext: { authorizer: {} } as any }
      );
      expect(result.statusCode).toBe(401);
    });

    it('rejects oversized metadata', async () => {
      const result = await trackEvent({
        eventAction: 'launch',
        metadata: { blob: 'x'.repeat(5000) },
      });
      expect(result.statusCode).toBe(400);
    });

    it('rejects a non-numeric eventValue', async () => {
      const result = await trackEvent({ eventAction: 'launch', eventValue: 'high' });
      expect(result.statusCode).toBe(400);
    });
  });

  // ── POST /analytics/feedback ─────────────────────────────────────────────

  describe('submitFeedback', () => {
    const submit = (body: any) =>
      handler(makeEvent({
        httpMethod: 'POST',
        path: '/analytics/feedback',
        body: JSON.stringify(body),
      }));

    it('stores feedback with status new', async () => {
      const result = await submit({
        feedbackType: 'bug',
        title: '  Broken button  ',
        description: 'The launch button does nothing',
        rating: 4,
      });

      expect(result.statusCode).toBe(201);
      const [put] = commandsOfType('PutCommand');
      expect(put.input.TableName).toBe('UserFeedback');
      const item = put.input.Item;
      expect(item.status).toBe('new');
      expect(item.title).toBe('Broken button');
      expect(item.userId).toBe('user-1');
      expect(item.feedbackId).toMatch(/^fb-/);
    });

    it('rejects missing title or description', async () => {
      expect((await submit({ description: 'no title' })).statusCode).toBe(400);
      expect((await submit({ title: 'no description' })).statusCode).toBe(400);
    });

    it('rejects an invalid feedbackType', async () => {
      const result = await submit({ feedbackType: 'rant', title: 't', description: 'd' });
      expect(result.statusCode).toBe(400);
    });

    it('rejects an out-of-range rating', async () => {
      const result = await submit({ title: 't', description: 'd', rating: 7 });
      expect(result.statusCode).toBe(400);
    });
  });

  // ── GET /analytics/summary ───────────────────────────────────────────────

  describe('getAnalyticsSummary', () => {
    it('rejects non-admins', async () => {
      const result = await handler(makeEvent({ path: '/analytics/summary' }));
      expect(result.statusCode).toBe(403);
    });

    it('rejects an unknown timeframe', async () => {
      const result = await handler(makeAdminEvent({
        path: '/analytics/summary',
        queryStringParameters: { timeframe: '1y' },
      }));
      expect(result.statusCode).toBe(400);
    });

    it('aggregates events queried per day from the DateIndex', async () => {
      mockDocSend.mockResolvedValue({
        Items: [
          { userId: 'u1', eventCategory: 'workstation', eventType: 'action', eventAction: 'launch', timestamp: '2026-07-15T01:00:00.000Z' },
        ],
      });

      const result = await handler(makeAdminEvent({
        path: '/analytics/summary',
        queryStringParameters: { timeframe: '24h' },
      }));

      expect(result.statusCode).toBe(200);
      const queries = commandsOfType('QueryCommand');
      expect(queries.length).toBeGreaterThanOrEqual(1);
      for (const q of queries) {
        expect(q.input.IndexName).toBe('DateIndex');
        expect(q.input.ExpressionAttributeValues[':date']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      // A 24h window spans at most two UTC daily buckets
      expect(queries.length).toBeLessThanOrEqual(2);

      const body = JSON.parse(result.body);
      expect(body.summary.totalEvents).toBe(queries.length); // one item per queried day
      expect(body.summary.uniqueUsers).toBe(1);
      expect(body.summary.topActions.launch).toBe(queries.length);
      expect(body.summary.timeframe).toBe('24h');
    });
  });

  // ── GET /analytics/feedback ──────────────────────────────────────────────

  describe('getFeedbackList', () => {
    it('rejects non-admins', async () => {
      const result = await handler(makeEvent({ path: '/analytics/feedback' }));
      expect(result.statusCode).toBe(403);
    });

    it('scans all feedback when no status filter is given', async () => {
      mockDocSend.mockResolvedValue({
        Items: [
          { feedbackId: 'fb-1', timestamp: '2026-07-01T00:00:00.000Z' },
          { feedbackId: 'fb-2', timestamp: '2026-07-10T00:00:00.000Z' },
        ],
      });
      const result = await handler(makeAdminEvent({ path: '/analytics/feedback' }));
      expect(result.statusCode).toBe(200);
      expect(commandsOfType('ScanCommand')).toHaveLength(1);
      const body = JSON.parse(result.body);
      expect(body.count).toBe(2);
      // Most recent first
      expect(body.feedback[0].feedbackId).toBe('fb-2');
    });

    it('queries the StatusIndex when filtering by status', async () => {
      const result = await handler(makeAdminEvent({
        path: '/analytics/feedback',
        queryStringParameters: { status: 'new' },
      }));
      expect(result.statusCode).toBe(200);
      const [query] = commandsOfType('QueryCommand');
      expect(query.input.IndexName).toBe('StatusIndex');
      expect(query.input.ExpressionAttributeValues[':status']).toBe('new');
    });

    it('rejects an invalid status filter', async () => {
      const result = await handler(makeAdminEvent({
        path: '/analytics/feedback',
        queryStringParameters: { status: 'bogus' },
      }));
      expect(result.statusCode).toBe(400);
    });
  });

  // ── PATCH /analytics/feedback/{feedbackId} ───────────────────────────────

  describe('updateFeedbackStatus', () => {
    const patch = (feedbackId: string, body: any, admin = true) =>
      handler((admin ? makeAdminEvent : makeEvent)({
        httpMethod: 'PATCH',
        path: `/analytics/feedback/${feedbackId}`,
        pathParameters: { feedbackId },
        body: JSON.stringify(body),
      }));

    it('rejects non-admins', async () => {
      const result = await patch('fb-1', { status: 'reviewed' }, false);
      expect(result.statusCode).toBe(403);
    });

    it('rejects an invalid status', async () => {
      const result = await patch('fb-1', { status: 'done' });
      expect(result.statusCode).toBe(400);
    });

    it('returns 404 when the feedback does not exist', async () => {
      mockDocSend.mockResolvedValue({ Items: [] });
      const result = await patch('fb-missing', { status: 'reviewed' });
      expect(result.statusCode).toBe(404);
    });

    it('updates status keyed by feedbackId + timestamp and stamps the actor', async () => {
      const stored = { feedbackId: 'fb-1', timestamp: '2026-07-10T00:00:00.000Z', status: 'new' };
      mockDocSend.mockImplementation((cmd: any) => {
        if (cmd.constructor.name === 'QueryCommand') return Promise.resolve({ Items: [stored] });
        if (cmd.constructor.name === 'UpdateCommand') {
          return Promise.resolve({ Attributes: { ...stored, status: cmd.input.ExpressionAttributeValues[':status'] } });
        }
        return Promise.resolve({ Items: [] });
      });

      const result = await patch('fb-1', { status: 'in-progress' });
      expect(result.statusCode).toBe(200);

      const [update] = commandsOfType('UpdateCommand');
      expect(update.input.Key).toEqual({ feedbackId: 'fb-1', timestamp: '2026-07-10T00:00:00.000Z' });
      expect(update.input.ExpressionAttributeValues[':status']).toBe('in-progress');
      expect(update.input.ExpressionAttributeValues[':updatedBy']).toBe('admin@test.com');
      expect(JSON.parse(result.body).feedback.status).toBe('in-progress');
    });
  });

  // ── GET /analytics/user/{userId} ─────────────────────────────────────────

  describe('getUserAnalytics', () => {
    const getUser = (userId: string, asAdmin = false) =>
      handler((asAdmin ? makeAdminEvent : makeEvent)({
        path: `/analytics/user/${userId}`,
        pathParameters: { userId },
      }));

    it('lets a user read their own events via the UserIndex', async () => {
      mockDocSend.mockResolvedValue({ Items: [{ eventId: 'e1' }] });
      const result = await getUser('user-1');
      expect(result.statusCode).toBe(200);
      const [query] = commandsOfType('QueryCommand');
      expect(query.input.IndexName).toBe('UserIndex');
      expect(query.input.ExpressionAttributeValues[':userId']).toBe('user-1');
      expect(JSON.parse(result.body).count).toBe(1);
    });

    it("blocks a non-admin from another user's events", async () => {
      const result = await getUser('someone-else');
      expect(result.statusCode).toBe(403);
    });

    it("lets an admin read any user's events", async () => {
      const result = await getUser('someone-else', true);
      expect(result.statusCode).toBe(200);
    });
  });
});
