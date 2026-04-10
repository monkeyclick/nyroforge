import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { marshall } from '@aws-sdk/util-dynamodb';

// Mock AWS SDK clients - must be before imports
jest.mock('@aws-sdk/client-cost-explorer', () => {
  const actual = jest.requireActual('@aws-sdk/client-cost-explorer');
  return { ...actual, CostExplorerClient: jest.fn() };
});
jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return { ...actual, DynamoDBClient: jest.fn() };
});

import { CostExplorerClient } from '@aws-sdk/client-cost-explorer';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const mockCostExplorerSend = jest.fn();
const mockDynamoSend = jest.fn();

(CostExplorerClient as jest.MockedClass<typeof CostExplorerClient>).mockImplementation(() => ({ send: mockCostExplorerSend } as any));
(DynamoDBClient as jest.MockedClass<typeof DynamoDBClient>).mockImplementation(() => ({ send: mockDynamoSend } as any));

// Import handler AFTER mock setup
import { handler } from '../../src/lambda/cost-analytics/index';

const mockContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'test-cost-analytics',
  functionVersion: '1',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test',
  memoryLimitInMB: '128',
  awsRequestId: 'test-request-id',
  logGroupName: '/aws/lambda/test',
  logStreamName: 'test-stream',
  getRemainingTimeInMillis: () => 30000,
  done: jest.fn(),
  fail: jest.fn(),
  succeed: jest.fn(),
};

// Minimal Cost Explorer response
function buildCostExplorerResponse(totalCost = 0) {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  return {
    ResultsByTime: [
      {
        TimePeriod: { Start: yesterday, End: today },
        Groups: [
          {
            Keys: ['Amazon Elastic Compute Cloud - Compute'],
            Metrics: { BlendedCost: { Amount: String(totalCost), Unit: 'USD' } },
          },
        ],
      },
    ],
  };
}

// Workstation item in DynamoDB format for Scan results
function buildWorkstationItem(overrides: Record<string, any> = {}) {
  return marshall({
    PK: 'WORKSTATION#ws-001',
    SK: 'METADATA',
    workstationId: 'ws-001',
    userId: 'user@test.com',
    instanceType: 'g4dn.xlarge',
    region: 'us-east-1',
    status: 'running',
    estimatedMonthlyCost: 350.00,
    actualCostToDate: 120.00,
    tags: { Project: 'VFX' },
    ...overrides,
  });
}

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/costs',
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
        claims: { email: 'admin@test.com', 'cognito:groups': 'workstation-admin' },
      },
    } as any,
    ...overrides,
  };
}

describe('Cost Analytics Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: Cost Explorer returns some cost data, DynamoDB returns empty
    mockCostExplorerSend.mockResolvedValue(buildCostExplorerResponse(125.50));
    mockDynamoSend.mockResolvedValue({ Items: [] });
  });

  // ── Admin access ─────────────────────────────────────────────────────────

  describe('Admin cost queries', () => {
    it('returns 200 with monthly cost breakdown for admin', async () => {
      const event = makeEvent({ queryStringParameters: { period: 'monthly' } });
      mockDynamoSend.mockResolvedValue({
        Items: [buildWorkstationItem()],
      });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.period).toBe('monthly');
      expect(body.totalCost).toBeDefined();
      expect(body.breakdown).toBeDefined();
      expect(body.breakdown.byInstanceType).toBeDefined();
      expect(body.breakdown.byUser).toBeDefined();
      expect(body.breakdown.byRegion).toBeDefined();
      expect(body.trends).toBeDefined();
      expect(body.costOptimizationSuggestions).toBeInstanceOf(Array);
    });

    it('returns 200 with daily cost breakdown', async () => {
      const event = makeEvent({ queryStringParameters: { period: 'daily' } });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).period).toBe('daily');
    });

    it('returns 200 with weekly cost breakdown', async () => {
      const event = makeEvent({ queryStringParameters: { period: 'weekly' } });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).period).toBe('weekly');
    });

    it('defaults to monthly when period is not specified', async () => {
      const event = makeEvent({ queryStringParameters: null });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).period).toBe('monthly');
    });

    it('admin can query a specific user cost with userId param', async () => {
      const event = makeEvent({
        queryStringParameters: { userId: 'target@test.com', period: 'monthly' },
      });
      mockDynamoSend.mockResolvedValue({
        Items: [buildWorkstationItem({ userId: 'target@test.com' })],
      });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(200);
    });

    it('response includes lastUpdated timestamp', async () => {
      const event = makeEvent();
      const result = await handler(event, mockContext);
      const body = JSON.parse(result.body);
      expect(body.lastUpdated).toBeDefined();
      expect(new Date(body.lastUpdated).getTime()).not.toBeNaN();
    });
  });

  // ── Regular user access ───────────────────────────────────────────────────

  describe('Regular user cost queries', () => {
    const userEvent = makeEvent({
      requestContext: {
        authorizer: {
          claims: { email: 'user@test.com', 'cognito:groups': 'workstation-user' },
        },
      } as any,
    });

    it('returns 200 with own cost data for regular user', async () => {
      mockDynamoSend.mockResolvedValue({
        Items: [buildWorkstationItem({ userId: 'user@test.com' })],
      });

      const result = await handler(userEvent, mockContext);
      expect(result.statusCode).toBe(200);
    });

    it('returns 403 when regular user queries another user cost with userId param', async () => {
      const event = makeEvent({
        queryStringParameters: { userId: 'admin@test.com' },
        requestContext: {
          authorizer: {
            claims: { email: 'user@test.com', 'cognito:groups': 'workstation-user' },
          },
        } as any,
      });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).message).toBe('Access denied');
    });
  });

  // ── Cost breakdown calculations ───────────────────────────────────────────

  describe('Cost breakdown accuracy', () => {
    it('aggregates cost breakdown by instance type', async () => {
      const event = makeEvent();
      mockDynamoSend.mockResolvedValue({
        Items: [
          buildWorkstationItem({ instanceType: 'g4dn.xlarge', estimatedMonthlyCost: 300 }),
          buildWorkstationItem({ workstationId: 'ws-002', instanceType: 'g5.xlarge', estimatedMonthlyCost: 500 }),
        ],
      });

      const result = await handler(event, mockContext);
      const body = JSON.parse(result.body);
      expect(body.breakdown.byInstanceType['g4dn.xlarge']).toBeDefined();
      expect(body.breakdown.byInstanceType['g5.xlarge']).toBeDefined();
    });

    it('aggregates cost breakdown by region', async () => {
      const event = makeEvent();
      mockDynamoSend.mockResolvedValue({
        Items: [
          buildWorkstationItem({ region: 'us-east-1', estimatedMonthlyCost: 200 }),
          buildWorkstationItem({ workstationId: 'ws-002', region: 'us-west-2', estimatedMonthlyCost: 400 }),
        ],
      });

      const result = await handler(event, mockContext);
      const body = JSON.parse(result.body);
      expect(body.breakdown.byRegion['us-east-1']).toBeDefined();
      expect(body.breakdown.byRegion['us-west-2']).toBeDefined();
    });

    it('rounds cost values to 2 decimal places', async () => {
      const event = makeEvent();
      mockDynamoSend.mockResolvedValue({
        Items: [buildWorkstationItem({ estimatedMonthlyCost: 123.456789 })],
      });

      const result = await handler(event, mockContext);
      const body = JSON.parse(result.body);
      const instanceCost = body.breakdown.byInstanceType['g4dn.xlarge'];
      if (instanceCost !== undefined) {
        const decimalPlaces = (instanceCost.toString().split('.')[1] || '').length;
        expect(decimalPlaces).toBeLessThanOrEqual(2);
      }
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  describe('Error handling', () => {
    it('returns 200 (graceful degradation) when Cost Explorer fails', async () => {
      const event = makeEvent();
      // Cost Explorer failure should be caught internally and return default zeros
      mockCostExplorerSend.mockRejectedValue(new Error('Cost Explorer not available'));
      mockDynamoSend.mockResolvedValue({ Items: [] });

      const result = await handler(event, mockContext);
      // Handler catches Cost Explorer errors internally and falls back
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).totalCost).toBe(0);
    });

    it('returns 200 (graceful degradation) when DynamoDB workstation query fails', async () => {
      const event = makeEvent();
      mockDynamoSend.mockImplementation((command: any) => {
        const cmdName = command.constructor.name;
        if (cmdName === 'ScanCommand') {
          return Promise.reject(new Error('DynamoDB scan failed'));
        }
        return Promise.resolve({});
      });

      const result = await handler(event, mockContext);
      // getWorkstationCostData catches errors and returns []
      expect(result.statusCode).toBe(200);
    });
  });
});
