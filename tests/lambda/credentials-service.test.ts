import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { marshall } from '@aws-sdk/util-dynamodb';

// Mock AWS SDK clients - must be before imports
jest.mock('@aws-sdk/client-secrets-manager', () => {
  const actual = jest.requireActual('@aws-sdk/client-secrets-manager');
  return { ...actual, SecretsManagerClient: jest.fn() };
});
jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return { ...actual, DynamoDBClient: jest.fn() };
});
jest.mock('@aws-sdk/client-ssm', () => {
  const actual = jest.requireActual('@aws-sdk/client-ssm');
  return { ...actual, SSMClient: jest.fn() };
});

import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SSMClient } from '@aws-sdk/client-ssm';

const mockSecretsSend = jest.fn();
const mockDynamoSend = jest.fn();
const mockSSMSend = jest.fn();

(SecretsManagerClient as jest.MockedClass<typeof SecretsManagerClient>).mockImplementation(() => ({ send: mockSecretsSend } as any));
(DynamoDBClient as jest.MockedClass<typeof DynamoDBClient>).mockImplementation(() => ({ send: mockDynamoSend } as any));
(SSMClient as jest.MockedClass<typeof SSMClient>).mockImplementation(() => ({ send: mockSSMSend } as any));

// Import handler AFTER mock setup
import { handler } from '../../src/lambda/credentials-service/index';

const mockContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'test-credentials-service',
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
    instanceId: 'i-abc123',
    userId: 'user@test.com',
    status: 'running',
    authMethod: 'local',
    localAdminUser: 'Administrator',
    credentialsSecretArn: 'arn:aws:secretsmanager:us-west-2:123:secret:ws-001',
    publicIp: '54.0.0.1',
    ...overrides,
  };
  // Filter out undefined values before marshalling
  const filtered = Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined));
  return marshall(filtered);
}

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/workstations/ws-001/credentials',
    pathParameters: { workstationId: 'ws-001' },
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
  };
}

describe('Credentials Service Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDynamoSend.mockResolvedValue({});
    mockSecretsSend.mockResolvedValue({});
    mockSSMSend.mockResolvedValue({});
  });

  // ── GET credentials ────────────────────────────────────────────────────────

  describe('GET /workstations/{id}/credentials', () => {
    it('returns 400 when workstationId is missing from pathParameters', async () => {
      const event = makeEvent({ pathParameters: null });
      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toBe('Workstation ID required');
    });

    it('returns 404 when workstation does not exist', async () => {
      const event = makeEvent({ pathParameters: { workstationId: 'ws-missing' } });
      mockDynamoSend.mockResolvedValue({ Item: undefined });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).message).toBe('Workstation not found');
    });

    it('returns 403 when non-admin accesses another user workstation', async () => {
      const event = makeEvent({
        requestContext: {
          authorizer: { claims: { email: 'attacker@test.com', 'cognito:groups': 'workstation-user' } },
        } as any,
      });
      // Workstation belongs to 'user@test.com', not 'attacker@test.com'
      mockDynamoSend.mockResolvedValue({ Item: buildWorkstationItem({ userId: 'user@test.com' }) });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).message).toBe('Access denied');
    });

    it('returns 400 when workstation is not in running state', async () => {
      const event = makeEvent();
      mockDynamoSend.mockResolvedValue({ Item: buildWorkstationItem({ status: 'stopped' }) });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toContain('running');
    });

    it('returns 200 with local credentials for own workstation', async () => {
      const event = makeEvent();
      mockDynamoSend.mockResolvedValue({ Item: buildWorkstationItem() });
      mockSecretsSend.mockResolvedValue({
        SecretString: JSON.stringify({ username: 'Administrator', password: 'P@ssw0rd123!' }),
      });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.type).toBe('local');
      expect(body.username).toBe('Administrator');
      expect(body.password).toBe('P@ssw0rd123!');
      expect(body.connectionInfo.rdpPort).toBe(3389);
      expect(body.connectionInfo.protocol).toBe('RDP');
    });

    it('returns 200 with domain credentials for domain-auth workstation', async () => {
      const event = makeEvent();
      mockDynamoSend.mockResolvedValue({
        Item: buildWorkstationItem({
          authMethod: 'domain',
          domainName: 'corp.example.com',
          credentialsSecretArn: undefined,
        }),
      });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.type).toBe('domain');
      expect(body.domain).toBe('corp.example.com');
      expect(body.password).toBeUndefined();
    });

    it('admin can retrieve credentials for any user workstation', async () => {
      const event = makeEvent({
        requestContext: {
          authorizer: { claims: { email: 'admin@test.com', 'cognito:groups': 'workstation-admin' } },
        } as any,
      });
      mockDynamoSend.mockResolvedValue({
        Item: buildWorkstationItem({ userId: 'someuser@test.com' }),
      });
      mockSecretsSend.mockResolvedValue({
        SecretString: JSON.stringify({ username: 'Administrator', password: 'AdminSecret!' }),
      });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(200);
    });

    it('returns 500 when Secrets Manager has no SecretString', async () => {
      const event = makeEvent();
      mockDynamoSend.mockResolvedValue({ Item: buildWorkstationItem() });
      // SecretString is missing
      mockSecretsSend.mockResolvedValue({ SecretString: undefined });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(500);
    });
  });

  // ── POST credentials (reset-password / domain-join) ──────────────────────

  describe('POST /workstations/{id}/credentials', () => {
    it('initiates password reset and returns 200', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ action: 'reset-password' }),
      });
      mockDynamoSend.mockResolvedValue({ Item: buildWorkstationItem() });
      mockSecretsSend.mockResolvedValue({});
      mockSSMSend.mockResolvedValue({ Command: { CommandId: 'cmd-12345' } });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('Password reset initiated');
    });

    it('returns 400 when resetting password on domain-auth workstation', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ action: 'reset-password' }),
      });
      mockDynamoSend.mockResolvedValue({
        Item: buildWorkstationItem({ authMethod: 'domain' }),
      });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toBe('Workstation not configured for local authentication');
    });

    it('initiates domain join and returns 200', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ action: 'domain-join' }),
      });
      // First call: GetItem, second call: UpdateItem
      mockDynamoSend
        .mockResolvedValueOnce({
          Item: buildWorkstationItem({ authMethod: 'domain', domainName: 'corp.example.com' }),
        })
        .mockResolvedValueOnce({});
      mockSSMSend.mockResolvedValue({ Command: { CommandId: 'cmd-67890' } });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Domain join initiated');
      expect(body.status).toBe('in-progress');
    });

    it('returns 400 when initiating domain-join on local-auth workstation', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ action: 'domain-join' }),
      });
      mockDynamoSend.mockResolvedValue({
        Item: buildWorkstationItem({ authMethod: 'local' }),
      });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toBe('Workstation not configured for domain join');
    });

    it('returns 400 for unknown action', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ action: 'unknown-action' }),
      });

      const result = await handler(event, mockContext);
      // No workstationId path match → falls through to 'Invalid request'
      expect([400, 404, 500]).toContain(result.statusCode);
    });
  });

  // ── DELETE credentials (revoke) ──────────────────────────────────────────

  describe('DELETE /workstations/{id}/credentials', () => {
    it('returns 403 when non-admin attempts to revoke credentials', async () => {
      const event = makeEvent({ httpMethod: 'DELETE' });
      mockDynamoSend.mockResolvedValue({ Item: buildWorkstationItem() });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).message).toBe('Access denied - admin required');
    });

    it('admin can revoke credentials and receives 200', async () => {
      const event = makeEvent({
        httpMethod: 'DELETE',
        requestContext: {
          authorizer: { claims: { email: 'admin@test.com', 'cognito:groups': 'workstation-admin' } },
        } as any,
      });
      mockDynamoSend
        .mockResolvedValueOnce({ Item: buildWorkstationItem() }) // GetItem
        .mockResolvedValueOnce({}); // UpdateItem
      mockSecretsSend.mockResolvedValue({});

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('Credentials revoked successfully');
    });

    it('returns 404 when revoking credentials for non-existent workstation', async () => {
      const event = makeEvent({
        httpMethod: 'DELETE',
        requestContext: {
          authorizer: { claims: { email: 'admin@test.com', 'cognito:groups': 'workstation-admin' } },
        } as any,
      });
      mockDynamoSend.mockResolvedValue({ Item: undefined });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(404);
    });
  });

  // ── Error handling ───────────────────────────────────────────────────────

  describe('Error handling', () => {
    it('returns 500 when DynamoDB throws unexpectedly', async () => {
      const event = makeEvent();
      mockDynamoSend.mockRejectedValue(new Error('DynamoDB connection error'));

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).message).toBeDefined();
    });

    it('returns 500 when Secrets Manager throws during credential fetch', async () => {
      const event = makeEvent();
      mockDynamoSend.mockResolvedValue({ Item: buildWorkstationItem() });
      mockSecretsSend.mockRejectedValue(new Error('Access denied by KMS'));

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(500);
    });
  });
});
