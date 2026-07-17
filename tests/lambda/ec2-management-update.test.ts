import { APIGatewayProxyEvent, Context } from 'aws-lambda';
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
jest.mock('@aws-sdk/client-secrets-manager', () => {
  const actual = jest.requireActual('@aws-sdk/client-secrets-manager');
  return { ...actual, SecretsManagerClient: jest.fn() };
});
jest.mock('@aws-sdk/client-ssm', () => {
  const actual = jest.requireActual('@aws-sdk/client-ssm');
  return { ...actual, SSMClient: jest.fn() };
});

import { EC2Client } from '@aws-sdk/client-ec2';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SSMClient } from '@aws-sdk/client-ssm';

const mockEC2Send = jest.fn();
const mockDynamoSend = jest.fn();
const mockSecretsSend = jest.fn();
const mockSSMSend = jest.fn();

(EC2Client as jest.MockedClass<typeof EC2Client>).mockImplementation(() => ({ send: mockEC2Send } as any));
(DynamoDBClient as jest.MockedClass<typeof DynamoDBClient>).mockImplementation(() => ({ send: mockDynamoSend } as any));
(SecretsManagerClient as jest.MockedClass<typeof SecretsManagerClient>).mockImplementation(() => ({ send: mockSecretsSend } as any));
(SSMClient as jest.MockedClass<typeof SSMClient>).mockImplementation(() => ({ send: mockSSMSend } as any));

// Import handler AFTER mock setup
import { handler } from '../../src/lambda/ec2-management/index';

const mockContext = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'test-ec2-management',
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
} as Context;

const OWNER = 'owner@test.com';

/** Wire the DynamoDB mock for a PATCH flow: unknown user in the users table
 *  (backwards-compat default permissions), one workstation record, successful
 *  audit writes and updates. */
function mockWorkstation(overrides: Record<string, any> = {}) {
  const workstation = {
    PK: 'WORKSTATION#ws-001',
    SK: 'METADATA',
    workstationId: 'ws-001',
    instanceId: 'i-001',
    userId: OWNER,
    status: 'running',
    instanceType: 'g4dn.xlarge',
    region: 'us-west-2',
    ...overrides,
  };
  const filtered = Object.fromEntries(Object.entries(workstation).filter(([, v]) => v !== undefined));

  mockDynamoSend.mockImplementation((command: any) => {
    const name = command.constructor.name;
    if (name === 'GetItemCommand' && command.input.TableName === 'test-workstations-table') {
      return Promise.resolve({ Item: marshall(filtered) });
    }
    if (name === 'GetItemCommand') {
      // users / roles tables: not found → default permission set
      return Promise.resolve({});
    }
    if (name === 'UpdateItemCommand') {
      return Promise.resolve({ Attributes: marshall(filtered) });
    }
    return Promise.resolve({ Items: [] });
  });

  return workstation;
}

function makePatchEvent(body: Record<string, any>, email = OWNER, groups?: string): APIGatewayProxyEvent {
  const claims: Record<string, string> = { email, sub: 'sub-123' };
  if (groups) claims['cognito:groups'] = groups;
  return {
    httpMethod: 'PATCH',
    path: '/workstations/ws-001',
    pathParameters: { workstationId: 'ws-001' },
    queryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    body: JSON.stringify(body),
    stageVariables: null,
    resource: '',
    requestContext: { authorizer: { claims } } as any,
  } as APIGatewayProxyEvent;
}

function findWorkstationUpdate() {
  return mockDynamoSend.mock.calls.find(
    ([c]: any[]) =>
      c.constructor.name === 'UpdateItemCommand' &&
      c.input.TableName === 'test-workstations-table'
  );
}

describe('EC2 Management Lambda - PATCH /workstations/{id}', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEC2Send.mockResolvedValue({});
  });

  // ── extendAutoTerminateHours ────────────────────────────────────────────────

  describe('extendAutoTerminateHours', () => {
    it('lets the owner push the deadline out from the current deadline', async () => {
      const currentDeadline = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      mockWorkstation({ autoTerminateAt: currentDeadline });

      const result = await handler(makePatchEvent({ extendAutoTerminateHours: 4 }), mockContext);
      expect(result.statusCode).toBe(200);

      const update = findWorkstationUpdate();
      expect(update).toBeDefined();
      expect(update![0].input.UpdateExpression).toContain('autoTerminateAt = :autoTerminateAt');
      const newDeadline = update![0].input.ExpressionAttributeValues[':autoTerminateAt'].S;
      const expected = new Date(currentDeadline).getTime() + 4 * 60 * 60 * 1000;
      expect(Math.abs(new Date(newDeadline).getTime() - expected)).toBeLessThan(5000);
    });

    it('extends from NOW when the previous deadline has already passed', async () => {
      const passedDeadline = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      mockWorkstation({ autoTerminateAt: passedDeadline });

      const result = await handler(makePatchEvent({ extendAutoTerminateHours: 1 }), mockContext);
      expect(result.statusCode).toBe(200);

      const newDeadline = findWorkstationUpdate()![0].input.ExpressionAttributeValues[':autoTerminateAt'].S;
      const expected = Date.now() + 60 * 60 * 1000;
      expect(Math.abs(new Date(newDeadline).getTime() - expected)).toBeLessThan(5000);
    });

    it.each([[0], [-3], [999], ['4' as any]])('rejects invalid hours value %p with 400', async (hours) => {
      mockWorkstation({ autoTerminateAt: new Date(Date.now() + 3600_000).toISOString() });
      const result = await handler(makePatchEvent({ extendAutoTerminateHours: hours }), mockContext);
      expect(result.statusCode).toBe(400);
      expect(findWorkstationUpdate()).toBeUndefined();
    });

    it('returns 400 when the workstation has no auto-termination schedule', async () => {
      mockWorkstation({ autoTerminateAt: undefined });
      const result = await handler(makePatchEvent({ extendAutoTerminateHours: 4 }), mockContext);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toContain('no auto-termination schedule');
    });

    it('denies a stranger extending someone else’s workstation', async () => {
      mockWorkstation({ autoTerminateAt: new Date(Date.now() + 3600_000).toISOString() });
      const result = await handler(
        makePatchEvent({ extendAutoTerminateHours: 4 }, 'stranger@test.com'),
        mockContext
      );
      expect(result.statusCode).toBe(403);
    });
  });

  // ── Self-service sharing (assignedUsers) ────────────────────────────────────

  describe('assignedUsers (sharing)', () => {
    it('lets the OWNER set assignedUsers, deduped and without the owner', async () => {
      mockWorkstation();
      const result = await handler(
        makePatchEvent({ assignedUsers: ['a@test.com', 'a@test.com', OWNER, 'b@test.com'] }),
        mockContext
      );
      expect(result.statusCode).toBe(200);

      const update = findWorkstationUpdate();
      expect(update).toBeDefined();
      const list = update![0].input.ExpressionAttributeValues[':assignedUsers'].L.map((v: any) => v.S);
      expect(list).toEqual(['a@test.com', 'b@test.com']);
    });

    it('denies a non-owner non-admin changing sharing (403)', async () => {
      mockWorkstation({ assignedUsers: ['shared@test.com'] });
      const result = await handler(
        makePatchEvent({ assignedUsers: ['shared@test.com', 'friend@test.com'] }, 'shared@test.com'),
        mockContext
      );
      expect(result.statusCode).toBe(403);
      expect(findWorkstationUpdate()).toBeUndefined();
    });

    it('still denies OWNER reassignment for non-admins (owner field is admin-only)', async () => {
      mockWorkstation();
      const result = await handler(
        makePatchEvent({ owner: 'newowner@test.com' }),
        mockContext
      );
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).message).toContain('administrators');
    });

    it('lets an ADMIN reassign the owner', async () => {
      mockWorkstation();
      const result = await handler(
        makePatchEvent({ owner: 'newowner@test.com' }, 'admin@test.com', 'workstation-admin'),
        mockContext
      );
      expect(result.statusCode).toBe(200);
      const update = findWorkstationUpdate();
      expect(update![0].input.UpdateExpression).toContain('userId = :owner');
    });
  });
});
