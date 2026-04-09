import { APIGatewayProxyEvent, Context } from 'aws-lambda';

// Mock AWS SDK clients - keep real Command classes so we can inspect command.input
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

const WORKSTATIONS_TABLE = 'test-workstations-table';

const mockContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'test-function',
  functionVersion: '1',
  invokedFunctionArn: 'arn:aws:lambda:us-west-2:123456789012:function:test-function',
  memoryLimitInMB: '128',
  awsRequestId: 'test-request-id',
  logGroupName: '/aws/lambda/test-function',
  logStreamName: 'test-stream',
  getRemainingTimeInMillis: () => 30000,
  done: jest.fn(),
  fail: jest.fn(),
  succeed: jest.fn(),
};

// Helper: returns workstation item keyed by workstationId
function workstationItem(workstationId: string, userId: string, status = 'running') {
  return {
    PK: { S: `WORKSTATION#${workstationId}` },
    SK: { S: 'METADATA' },
    instanceId: { S: 'i-123456' },
    userId: { S: userId },
    status: { S: status },
    instanceType: { S: 'g4dn.xlarge' },
    workstationId: { S: workstationId },
  };
}

describe('EC2 Management Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: all AWS calls return empty success (no item = backwards compat permissions mode)
    mockDynamoSend.mockResolvedValue({});
    mockEC2Send.mockResolvedValue({});
    mockSecretsSend.mockResolvedValue({});
    mockSSMSend.mockResolvedValue({});
  });

  describe('GET /workstations', () => {
    it('should return list of workstations for admin user', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/workstations',
        requestContext: {
          authorizer: {
            claims: { email: 'admin@test.com', 'cognito:groups': 'workstation-admin' },
          },
        } as any,
        queryStringParameters: null,
      };

      // Admin path uses ScanCommand on workstations table
      mockDynamoSend.mockImplementation((command: any) => {
        const table = command.input?.TableName;
        const cmdName = command.constructor.name;
        if (table === WORKSTATIONS_TABLE && (cmdName === 'ScanCommand' || cmdName === 'QueryCommand')) {
          return Promise.resolve({ Items: [workstationItem('ws-123', 'admin@test.com')] });
        }
        return Promise.resolve({});
      });

      const result = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.workstations).toBeDefined();
      expect(body.summary).toBeDefined();
    });

    it('should filter workstations for regular user', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/workstations',
        requestContext: {
          authorizer: {
            claims: { email: 'user@test.com', 'cognito:groups': 'workstation-user' },
          },
        } as any,
        queryStringParameters: null,
      };

      mockDynamoSend.mockImplementation((command: any) => {
        const table = command.input?.TableName;
        const cmdName = command.constructor.name;
        if (table === WORKSTATIONS_TABLE && (cmdName === 'QueryCommand' || cmdName === 'ScanCommand')) {
          return Promise.resolve({ Items: [] });
        }
        return Promise.resolve({});
      });

      const result = await handler(event as APIGatewayProxyEvent, mockContext);
      expect(result.statusCode).toBe(200);
    });
  });

  describe('POST /workstations', () => {
    it('should launch a new workstation successfully', async () => {
      const launchRequest = {
        region: 'us-west-2',
        instanceType: 'g4dn.xlarge',
        osVersion: 'Windows Server 2019',
        authMethod: 'local',
        localAdminConfig: { username: 'Administrator' },
        autoTerminateHours: 24,
      };

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/workstations',
        body: JSON.stringify(launchRequest),
        requestContext: {
          authorizer: {
            claims: { email: 'user@test.com', 'cognito:groups': 'workstation-user' },
          },
        } as any,
        headers: { 'X-Forwarded-For': '1.2.3.4' },
      };

      // SSM: allowed instance types, then instance profile ARN
      mockSSMSend
        .mockResolvedValueOnce({ Parameter: { Value: JSON.stringify(['g4dn.xlarge', 'g5.xlarge']) } })
        .mockResolvedValueOnce({ Parameter: { Value: 'arn:aws:iam::123456789012:instance-profile/WorkstationProfile' } });

      // EC2: subnets, security groups, AMIs, then run instances
      mockEC2Send.mockImplementation((command: any) => {
        const cmdName = command.constructor.name;
        if (cmdName === 'DescribeSubnetsCommand') {
          return Promise.resolve({
            Subnets: [{ SubnetId: 'subnet-12345', AvailabilityZone: 'us-west-2a', State: 'available' }],
          });
        }
        if (cmdName === 'DescribeSecurityGroupsCommand') {
          return Promise.resolve({
            SecurityGroups: [{ GroupId: 'sg-12345', GroupName: 'default' }],
          });
        }
        if (cmdName === 'DescribeImagesCommand') {
          return Promise.resolve({
            Images: [{ ImageId: 'ami-12345', CreationDate: '2024-01-01T00:00:00.000Z' }],
          });
        }
        if (cmdName === 'RunInstancesCommand') {
          return Promise.resolve({
            Instances: [{ InstanceId: 'i-newinstance123', Placement: { AvailabilityZone: 'us-west-2a' } }],
          });
        }
        return Promise.resolve({});
      });

      mockSecretsSend.mockResolvedValueOnce({
        ARN: 'arn:aws:secretsmanager:us-west-2:123456789012:secret:workstation/ws-123/local-admin',
      });

      const result = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.workstationId).toBeDefined();
      expect(body.instanceId).toBe('i-newinstance123');
      expect(body.status).toBe('launching');
    });

    it('should reject invalid instance type', async () => {
      const launchRequest = {
        region: 'us-west-2',
        instanceType: 't2.micro',
        osVersion: 'Windows Server 2019',
        authMethod: 'local',
      };

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/workstations',
        body: JSON.stringify(launchRequest),
        requestContext: {
          authorizer: {
            claims: { email: 'user@test.com', 'cognito:groups': 'workstation-user' },
          },
        } as any,
      };

      mockSSMSend.mockResolvedValueOnce({
        Parameter: { Value: JSON.stringify(['g4dn.xlarge', 'g5.xlarge']) },
      });

      const result = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Invalid instance type');
    });
  });

  describe('DELETE /workstations/{id}', () => {
    it('should terminate workstation successfully', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'DELETE',
        path: '/workstations/ws-123',
        pathParameters: { workstationId: 'ws-123' },
        requestContext: {
          authorizer: {
            claims: { email: 'admin@test.com', 'cognito:groups': 'workstation-admin' },
          },
        } as any,
      };

      mockDynamoSend.mockImplementation((command: any) => {
        const table = command.input?.TableName;
        const cmdName = command.constructor.name;
        if (table === WORKSTATIONS_TABLE && cmdName === 'GetItemCommand') {
          return Promise.resolve({ Item: workstationItem('ws-123', 'admin@test.com') });
        }
        return Promise.resolve({});
      });

      mockEC2Send.mockImplementation((command: any) => {
        if (command.constructor.name === 'TerminateInstancesCommand') {
          return Promise.resolve({ TerminatingInstances: [{ InstanceId: 'i-123456' }] });
        }
        return Promise.resolve({});
      });

      const result = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.status).toBe('terminating');
    });

    it('should deny access for non-admin user to other users workstation', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'DELETE',
        path: '/workstations/ws-123',
        pathParameters: { workstationId: 'ws-123' },
        requestContext: {
          authorizer: {
            claims: { email: 'user@test.com', 'cognito:groups': 'workstation-user' },
          },
        } as any,
      };

      mockDynamoSend.mockImplementation((command: any) => {
        const table = command.input?.TableName;
        const cmdName = command.constructor.name;
        if (table === WORKSTATIONS_TABLE && cmdName === 'GetItemCommand') {
          // workstation belongs to a different user
          return Promise.resolve({ Item: workstationItem('ws-123', 'otheruser@test.com') });
        }
        return Promise.resolve({});
      });

      const result = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Access denied');
    });
  });

  describe('Error handling', () => {
    it('should handle DynamoDB errors gracefully', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/workstations',
        requestContext: {
          authorizer: {
            claims: { email: 'admin@test.com', 'cognito:groups': 'workstation-admin' },
          },
        } as any,
        queryStringParameters: null,
      };

      // Reject on the workstations table scan/query, allow user lookups
      mockDynamoSend.mockImplementation((command: any) => {
        const table = command.input?.TableName;
        const cmdName = command.constructor.name;
        if (table === WORKSTATIONS_TABLE && (cmdName === 'ScanCommand' || cmdName === 'QueryCommand')) {
          return Promise.reject(new Error('DynamoDB connection failed'));
        }
        return Promise.resolve({});
      });

      const result = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.message).toBeDefined();
    });

    it('should handle malformed request body', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/workstations',
        body: 'invalid json',
        requestContext: {
          authorizer: {
            claims: { email: 'user@test.com', 'cognito:groups': 'workstation-user' },
          },
        } as any,
      };

      // SSM for allowed instance types check
      mockSSMSend.mockResolvedValueOnce({
        Parameter: { Value: JSON.stringify(['g4dn.xlarge', 'g5.xlarge']) },
      });

      const result = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error ?? body.message).toBeDefined();
    });
  });
});
