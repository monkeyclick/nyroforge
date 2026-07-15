import { APIGatewayProxyEvent, Context, ScheduledEvent } from 'aws-lambda';
import { marshall } from '@aws-sdk/util-dynamodb';

// Mock AWS SDK clients - must be before imports
jest.mock('@aws-sdk/client-ec2', () => {
  const actual = jest.requireActual('@aws-sdk/client-ec2');
  return { ...actual, EC2Client: jest.fn() };
});
jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return { ...actual, DynamoDBClient: jest.fn() };
});
jest.mock('@aws-sdk/client-cloudwatch', () => {
  const actual = jest.requireActual('@aws-sdk/client-cloudwatch');
  return { ...actual, CloudWatchClient: jest.fn() };
});

import { EC2Client } from '@aws-sdk/client-ec2';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';

const mockEC2Send = jest.fn();
const mockDynamoSend = jest.fn();
const mockCloudWatchSend = jest.fn();

(EC2Client as jest.MockedClass<typeof EC2Client>).mockImplementation(() => ({ send: mockEC2Send } as any));
(DynamoDBClient as jest.MockedClass<typeof DynamoDBClient>).mockImplementation(() => ({ send: mockDynamoSend } as any));
(CloudWatchClient as jest.MockedClass<typeof CloudWatchClient>).mockImplementation(() => ({ send: mockCloudWatchSend } as any));

// Import handler AFTER mock setup
import { handler } from '../../src/lambda/status-monitor/index';

const mockContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'test-status-monitor',
  functionVersion: '1',
  invokedFunctionArn: 'arn:aws:lambda:us-west-2:123456789012:function:test',
  memoryLimitInMB: '128',
  awsRequestId: 'test-request-id',
  logGroupName: '/aws/lambda/test',
  logStreamName: 'test-stream',
  getRemainingTimeInMillis: () => 30000,
  done: jest.fn(),
  fail: jest.fn(),
  succeed: jest.fn(),
};

// Build a DynamoDB-marshalled workstation item
function buildWorkstationItem(overrides: Record<string, any> = {}) {
  const base = {
    PK: 'WORKSTATION#ws-001',
    SK: 'METADATA',
    workstationId: 'ws-001',
    instanceId: 'i-001',
    userId: 'user@test.com',
    status: 'running',
    instanceType: 'g4dn.xlarge',
    region: 'us-west-2',
    estimatedHourlyCost: 1.5,
    publicIp: '54.0.0.1',
    ...overrides,
  };
  const filtered = Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined));
  return marshall(filtered);
}

function buildEc2Instance(overrides: Record<string, any> = {}) {
  return {
    InstanceId: 'i-001',
    State: { Name: 'running' },
    PublicIpAddress: '54.0.0.1',
    PrivateIpAddress: '10.0.0.1',
    LaunchTime: new Date(Date.now() - 60 * 60 * 1000),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/dashboard/status',
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
        claims: { email: 'user@test.com', 'cognito:groups': 'workstation-user' },
      },
    } as any,
    ...overrides,
  } as APIGatewayProxyEvent;
}

function makeScheduledEvent(overrides: Partial<ScheduledEvent> = {}): ScheduledEvent {
  return {
    id: 'test-event-id',
    version: '0',
    account: '123456789012',
    time: new Date().toISOString(),
    region: 'us-west-2',
    resources: [],
    source: 'aws.events',
    'detail-type': 'Scheduled Event',
    detail: {},
    ...overrides,
  } as ScheduledEvent;
}

/** Default DynamoDB mock: empty Scan/Query results, successful writes. */
function defaultDynamoImplementation(command: any) {
  const name = command.constructor.name;
  if (name === 'ScanCommand' || name === 'QueryCommand') {
    return Promise.resolve({ Items: [] });
  }
  return Promise.resolve({});
}

describe('Status Monitor Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDynamoSend.mockImplementation(defaultDynamoImplementation);
    mockEC2Send.mockResolvedValue({ Reservations: [] });
    mockCloudWatchSend.mockResolvedValue({ Datapoints: [] });
  });

  // ── GET /dashboard/status ─────────────────────────────────────────────────

  describe('GET /dashboard/status', () => {
    it('admin: returns all workstations with correctly computed summary counts, 200, no error key', async () => {
      const ws1 = buildWorkstationItem({ workstationId: 'ws-001', instanceId: 'i-001', status: 'running' });
      const ws2 = buildWorkstationItem({ workstationId: 'ws-002', instanceId: 'i-002', status: 'stopped', publicIp: undefined });
      const ws3 = buildWorkstationItem({ workstationId: 'ws-003', instanceId: 'i-003', status: 'terminating', publicIp: undefined });

      mockDynamoSend.mockImplementation((command: any) => {
        const name = command.constructor.name;
        if (name === 'ScanCommand') {
          return Promise.resolve({ Items: [ws1, ws2, ws3] });
        }
        return Promise.resolve({});
      });

      mockEC2Send.mockResolvedValue({
        Reservations: [
          {
            Instances: [
              buildEc2Instance({ InstanceId: 'i-001', State: { Name: 'running' }, PublicIpAddress: '54.0.0.1' }),
              buildEc2Instance({ InstanceId: 'i-002', State: { Name: 'stopped' }, PublicIpAddress: undefined }),
              buildEc2Instance({ InstanceId: 'i-003', State: { Name: 'shutting-down' }, PublicIpAddress: undefined }),
            ],
          },
        ],
      });

      const event = makeEvent({
        requestContext: {
          authorizer: { claims: { email: 'admin@test.com', 'cognito:groups': 'workstation-admin' } },
        } as any,
      });

      const result = await handler(event, mockContext);
      expect(result).toBeDefined();
      expect(result!.statusCode).toBe(200);
      const body = JSON.parse(result!.body);
      expect(body.error).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('"error"');
      expect(body.summary.totalInstances).toBe(3);
      expect(body.summary.runningInstances).toBe(1);
      expect(body.summary.stoppedInstances).toBe(1);
      expect(body.summary.terminatingInstances).toBe(1);
      expect(body.instances).toHaveLength(3);
    });

    it('non-admin: queries UserIdIndex GSI instead of scanning the whole table', async () => {
      const ws1 = buildWorkstationItem({ workstationId: 'ws-001', instanceId: 'i-001', userId: 'user@test.com' });

      mockDynamoSend.mockImplementation((command: any) => {
        const name = command.constructor.name;
        if (name === 'QueryCommand') {
          return Promise.resolve({ Items: [ws1] });
        }
        return Promise.resolve({});
      });

      const event = makeEvent({
        requestContext: {
          authorizer: { claims: { email: 'user@test.com', 'cognito:groups': 'workstation-user' } },
        } as any,
      });

      const result = await handler(event, mockContext);
      expect(result!.statusCode).toBe(200);

      const queryCall = mockDynamoSend.mock.calls.find(
        ([command]: any[]) => command.constructor.name === 'QueryCommand'
      );
      expect(queryCall).toBeDefined();
      expect(queryCall![0].input.IndexName).toBe('UserIdIndex');
      expect(queryCall![0].input.TableName).toBe('test-workstations-table');
    });
  });

  // ── GET /health ────────────────────────────────────────────────────────────

  describe('GET /health', () => {
    function healthEvent(): APIGatewayProxyEvent {
      return makeEvent({ path: '/health' });
    }

    it('returns 200 with all services healthy when every client call succeeds', async () => {
      const result = await handler(healthEvent(), mockContext);
      expect(result!.statusCode).toBe(200);
      const body = JSON.parse(result!.body);
      expect(body.status).toBe('healthy');
      expect(body.services).toEqual({
        dynamodb: 'healthy',
        ec2: 'healthy',
        cloudwatch: 'healthy',
      });
    });

    it('returns 503 with dynamodb marked unhealthy when the DynamoDB call rejects', async () => {
      mockDynamoSend.mockRejectedValue(new Error('DynamoDB unreachable'));

      const result = await handler(healthEvent(), mockContext);
      expect(result!.statusCode).toBe(503);
      const body = JSON.parse(result!.body);
      expect(body.status).toBe('degraded');
      expect(body.services.dynamodb).toBe('unhealthy');
      expect(body.services.ec2).toBe('healthy');
      expect(body.services.cloudwatch).toBe('healthy');
    });
  });

  // ── Unknown routes ─────────────────────────────────────────────────────────

  describe('Invalid requests', () => {
    it('returns 400 for a GET to an unrecognized path', async () => {
      const event = makeEvent({ path: '/some/unknown/path' });
      const result = await handler(event, mockContext);
      expect(result!.statusCode).toBe(400);
      expect(JSON.parse(result!.body).message).toBe('Invalid request');
    });

    it('returns 400 for an unsupported httpMethod', async () => {
      const event = makeEvent({ httpMethod: 'PATCH' as any });
      const result = await handler(event, mockContext);
      expect(result!.statusCode).toBe(400);
      expect(JSON.parse(result!.body).message).toBe('Invalid request');
    });
  });

  // ── Scheduled auto-termination event ───────────────────────────────────────

  describe('Scheduled event (aws.events)', () => {
    it('terminates an expired workstation via TerminateInstancesCommand and resolves without throwing', async () => {
      const expiredWs = buildWorkstationItem({
        workstationId: 'ws-expired',
        instanceId: 'i-expired',
        status: 'running',
        autoTerminateAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      });

      mockDynamoSend.mockImplementation((command: any) => {
        const name = command.constructor.name;
        if (name === 'ScanCommand') {
          return Promise.resolve({ Items: [expiredWs] });
        }
        return Promise.resolve({});
      });

      mockEC2Send.mockImplementation((command: any) => {
        if (command.constructor.name === 'TerminateInstancesCommand') {
          return Promise.resolve({ TerminatingInstances: [{ InstanceId: 'i-expired' }] });
        }
        return Promise.resolve({ Reservations: [] });
      });

      const result = await handler(makeScheduledEvent(), mockContext);
      expect(result).toBeUndefined();

      const terminateCall = mockEC2Send.mock.calls.find(
        ([command]: any[]) => command.constructor.name === 'TerminateInstancesCommand'
      );
      expect(terminateCall).toBeDefined();
      expect(terminateCall![0].input.InstanceIds).toEqual(['i-expired']);

      const updateCall = mockDynamoSend.mock.calls.find(
        ([command]: any[]) => command.constructor.name === 'UpdateItemCommand'
      );
      expect(updateCall).toBeDefined();
    });

    it('does not throw when the per-item terminate call rejects (Promise.allSettled isolation)', async () => {
      const expiredWs = buildWorkstationItem({
        workstationId: 'ws-expired-2',
        instanceId: 'i-expired-2',
        status: 'running',
        autoTerminateAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      });

      mockDynamoSend.mockImplementation((command: any) => {
        const name = command.constructor.name;
        if (name === 'ScanCommand') {
          return Promise.resolve({ Items: [expiredWs] });
        }
        return Promise.resolve({});
      });

      mockEC2Send.mockImplementation((command: any) => {
        if (command.constructor.name === 'TerminateInstancesCommand') {
          return Promise.reject(new Error('EC2 terminate failed'));
        }
        return Promise.resolve({ Reservations: [] });
      });

      await expect(handler(makeScheduledEvent(), mockContext)).resolves.toBeUndefined();
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────────

  describe('Error handling', () => {
    it('returns 500 without leaking the raw error message when the dashboard Scan rejects unexpectedly', async () => {
      const adminEvent = makeEvent({
        requestContext: {
          authorizer: { claims: { email: 'admin@test.com', 'cognito:groups': 'workstation-admin' } },
        } as any,
      });

      mockDynamoSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'ScanCommand') {
          return Promise.reject(new Error('super-secret-internal-detail-12345'));
        }
        return Promise.resolve({});
      });

      const result = await handler(adminEvent, mockContext);
      expect(result!.statusCode).toBe(500);
      const body = JSON.parse(result!.body);
      expect(body.message).toBeDefined();
      expect(JSON.stringify(body)).not.toContain('super-secret-internal-detail-12345');
    });
  });
});
