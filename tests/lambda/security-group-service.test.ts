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

import { EC2Client } from '@aws-sdk/client-ec2';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const mockEC2Send = jest.fn();
const mockDynamoSend = jest.fn();

(EC2Client as jest.MockedClass<typeof EC2Client>).mockImplementation(() => ({ send: mockEC2Send } as any));
(DynamoDBClient as jest.MockedClass<typeof DynamoDBClient>).mockImplementation(() => ({ send: mockDynamoSend } as any));

// Import handler AFTER mock setup
import { handler } from '../../src/lambda/security-group-service/index';

const mockContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'test-security-group-service',
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

function makeSG(overrides: Record<string, any> = {}) {
  return {
    GroupId: 'sg-12345',
    GroupName: 'workstation-sg',
    Description: 'Workstation security group',
    VpcId: 'vpc-12345',
    IpPermissions: [{ IpProtocol: 'tcp', FromPort: 3389, ToPort: 3389, IpRanges: [] }],
    IpPermissionsEgress: [],
    Tags: [{ Key: 'Name', Value: 'workstation-sg' }],
    ...overrides,
  };
}

// User with security:manage permission in DynamoDB format
function buildUserItemWithPermission(permission: string) {
  return marshall({
    userId: 'admin@test.com',
    status: 'active',
    roleIds: [],
    groupIds: [],
    directPermissions: [permission],
  });
}

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/security-groups',
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

describe('Security Group Service Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: DynamoDB returns empty (user not found → security:read permission)
    mockDynamoSend.mockResolvedValue({});
    mockEC2Send.mockResolvedValue({});
  });

  // ── GET /common-ports (no permission check) ──────────────────────────────

  describe('GET /common-ports', () => {
    it('returns 200 with list of common ports', async () => {
      const event = makeEvent({ path: '/security-groups/common-ports' });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.ports).toBeDefined();
      expect(body.ports.rdp).toBeDefined();
      expect(body.ports.rdp.port).toBe(3389);
      expect(body.ports.ssh).toBeDefined();
      expect(body.ports.ssh.port).toBe(22);
    });
  });

  // ── GET list security groups ─────────────────────────────────────────────

  describe('GET /security-groups (list)', () => {
    it('returns 200 with security groups list for user with security:read', async () => {
      const event = makeEvent();
      // User not found in DynamoDB → default security:read permission
      mockDynamoSend.mockResolvedValue({});
      mockEC2Send.mockResolvedValue({
        SecurityGroups: [makeSG()],
      });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.securityGroups).toBeInstanceOf(Array);
      expect(body.securityGroups).toHaveLength(1);
      expect(body.securityGroups[0].groupId).toBe('sg-12345');
    });

    it('returns 200 with empty array when no security groups exist', async () => {
      const event = makeEvent();
      mockEC2Send.mockResolvedValue({ SecurityGroups: [] });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).securityGroups).toHaveLength(0);
    });

    it('returns 403 when user has no permissions at all (simulated by system:read-only)', async () => {
      // Mock user with no valid permissions (not in DynamoDB, so gets default security:read)
      // To test 403, we need to simulate a case where hasPermission returns false
      // This requires the user to have directPermissions that DON'T include security:read
      const event = makeEvent({
        requestContext: {
          authorizer: { claims: { email: 'noperm@test.com' } },
        } as any,
      });
      mockDynamoSend.mockResolvedValue({
        Item: marshall({
          userId: 'noperm@test.com',
          status: 'active',
          directPermissions: [], // no permissions
          roleIds: [],
          groupIds: [],
        }),
      });
      // Since getUserPermissions only returns security:read if user NOT found,
      // but user IS found with empty permissions → returns []
      // hasPermission('security:read') → false → 403
      mockEC2Send.mockResolvedValue({});

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(403);
    });

    it('maps EC2 security group fields correctly', async () => {
      const event = makeEvent();
      mockEC2Send.mockResolvedValue({
        SecurityGroups: [
          makeSG({
            GroupId: 'sg-abc',
            GroupName: 'vfx-sg',
            IpPermissions: [{ IpProtocol: 'tcp', FromPort: 3389, ToPort: 3389, IpRanges: [] }],
          }),
        ],
      });

      const result = await handler(event, mockContext);
      const { securityGroups } = JSON.parse(result.body);
      expect(securityGroups[0].groupId).toBe('sg-abc');
      expect(securityGroups[0].groupName).toBe('vfx-sg');
      expect(securityGroups[0].ingressRules).toBe(1);
    });
  });

  // ── GET /security-groups/{groupId} ──────────────────────────────────────

  describe('GET /security-groups/{groupId} (single)', () => {
    it('returns 200 for existing security group', async () => {
      const event = makeEvent({
        path: '/security-groups/sg-12345',
        pathParameters: { groupId: 'sg-12345' },
      });
      mockEC2Send.mockResolvedValue({ SecurityGroups: [makeSG()] });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.groupId).toBe('sg-12345');
    });

    it('returns 404 when security group does not exist in EC2', async () => {
      const event = makeEvent({
        path: '/security-groups/sg-missing',
        pathParameters: { groupId: 'sg-missing' },
      });
      mockEC2Send.mockResolvedValue({ SecurityGroups: [] });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(404);
    });
  });

  // ── GET /security-groups?groupId=... (workstations for a SG) ─────────────

  describe('GET /security-groups/workstations?groupId=...', () => {
    it('returns 400 when groupId query parameter is missing', async () => {
      const event = makeEvent({
        path: '/security-groups/workstations',
        queryStringParameters: null,
      });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toBe('groupId query parameter required');
    });
  });

  // ── POST create security group ───────────────────────────────────────────

  describe('POST /security-groups (create)', () => {
    it('returns 403 when user lacks security:manage permission', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/security-groups',
        body: JSON.stringify({ groupName: 'new-sg', description: 'New SG' }),
      });
      // User not found in DynamoDB → security:read only (no manage)
      mockDynamoSend.mockResolvedValue({});

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).message).toContain('Insufficient permissions');
    });

    it('returns 200 when user has security:manage permission', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/security-groups',
        body: JSON.stringify({ groupName: 'new-vfx-sg', description: 'VFX workstation SG' }),
      });
      // User found with security:manage
      mockDynamoSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'GetItemCommand') {
          return Promise.resolve({ Item: buildUserItemWithPermission('security:manage') });
        }
        return Promise.resolve({});
      });
      mockEC2Send.mockResolvedValue({ GroupId: 'sg-new123' });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Security group created successfully');
      expect(body.groupId).toBe('sg-new123');
    });
  });

  // ── POST /add-rule ────────────────────────────────────────────────────────

  describe('POST /security-groups/add-rule', () => {
    it('returns 200 when adding an ingress rule with manage permission', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/security-groups/add-rule',
        body: JSON.stringify({
          groupId: 'sg-12345',
          port: 3389,
          protocol: 'tcp',
          cidrIp: '10.0.0.0/24',
          description: 'RDP from office',
        }),
      });
      mockDynamoSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'GetItemCommand') {
          return Promise.resolve({ Item: buildUserItemWithPermission('security:manage') });
        }
        return Promise.resolve({});
      });
      mockEC2Send.mockResolvedValue({});

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('Rule added successfully');
    });

    it('uses applicationName to resolve port for known applications', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/security-groups/add-rule',
        body: JSON.stringify({
          groupId: 'sg-12345',
          applicationName: 'rdp',
          protocol: 'tcp',
          cidrIp: '0.0.0.0/0',
        }),
      });
      mockDynamoSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'GetItemCommand') {
          return Promise.resolve({ Item: buildUserItemWithPermission('security:manage') });
        }
        return Promise.resolve({});
      });
      mockEC2Send.mockResolvedValue({});

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.rule.FromPort).toBe(3389);
    });
  });

  // ── DELETE remove rule ───────────────────────────────────────────────────

  describe('DELETE /security-groups/remove-rule', () => {
    it('returns 403 when user lacks manage permission', async () => {
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/security-groups/remove-rule',
        body: JSON.stringify({ groupId: 'sg-12345', port: 3389, protocol: 'tcp', cidrIp: '0.0.0.0/0' }),
      });
      mockDynamoSend.mockResolvedValue({}); // user not found → security:read only

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(403);
    });

    it('returns 200 when admin removes a rule', async () => {
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/security-groups/remove-rule',
        body: JSON.stringify({ groupId: 'sg-12345', port: 22, protocol: 'tcp', cidrIp: '0.0.0.0/0' }),
      });
      mockDynamoSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'GetItemCommand') {
          return Promise.resolve({ Item: buildUserItemWithPermission('security:manage') });
        }
        return Promise.resolve({});
      });
      mockEC2Send.mockResolvedValue({});

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('Rule removed successfully');
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  describe('Error handling', () => {
    it('returns 500 when EC2 DescribeSecurityGroups throws', async () => {
      const event = makeEvent();
      mockEC2Send.mockRejectedValue(new Error('EC2 API unavailable'));

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(500);
    });

    it('returns 500 when EC2 CreateSecurityGroup throws', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/security-groups',
        body: JSON.stringify({ groupName: 'bad-sg', description: 'Will fail' }),
      });
      mockDynamoSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'GetItemCommand') {
          return Promise.resolve({ Item: buildUserItemWithPermission('security:manage') });
        }
        return Promise.resolve({});
      });
      mockEC2Send.mockRejectedValue(new Error('VPC does not exist'));

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(500);
    });
  });
});
