import { handler } from '../../src/lambda/ec2-management/index';
import { APIGatewayProxyEvent, Context } from 'aws-lambda';

// Mock AWS SDK clients
jest.mock('@aws-sdk/client-ec2');
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/client-secrets-manager');
jest.mock('@aws-sdk/client-ssm');

const mockEC2Client = {
  send: jest.fn(),
};

const mockDynamoClient = {
  send: jest.fn(),
};

const mockSecretsClient = {
  send: jest.fn(),
};

const mockSSMClient = {
  send: jest.fn(),
};

describe('EC2 Management Lambda', () => {
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

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WORKSTATIONS_TABLE_NAME = 'test-workstations-table';
    process.env.VPC_ID = 'vpc-12345';
  });

  describe('GET /workstations', () => {
    it('should return list of workstations for admin user', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/workstations',
        requestContext: {
          authorizer: {
            claims: {
              email: 'admin@test.com',
              'cognito:groups': 'workstation-admin',
            },
          },
        } as any,
        queryStringParameters: null,
      };

      // Mock DynamoDB response
      mockDynamoClient.send.mockResolvedValueOnce({
        Items: [
          {
            PK: { S: 'WORKSTATION#ws-123' },
            SK: { S: 'METADATA' },
            instanceId: { S: 'i-123456' },
            userId: { S: 'user@test.com' },
            status: { S: 'running' },
            instanceType: { S: 'g4dn.xlarge' },
          },
        ],
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
            claims: {
              email: 'user@test.com',
              'cognito:groups': 'workstation-user',
            },
          },
        } as any,
        queryStringParameters: null,
      };

      mockDynamoClient.send.mockResolvedValueOnce({
        Items: [],
      });

      const result = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(result.statusCode).toBe(200);
      expect(mockDynamoClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          IndexName: 'UserIdIndex',
        })
      );
    });
  });

  describe('POST /workstations', () => {
    it('should launch a new workstation successfully', async () => {
      const launchRequest = {
        region: 'us-west-2',
        instanceType: 'g4dn.xlarge',
        osVersion: 'Windows Server 2019',
        authMethod: 'local',
        localAdminConfig: {
          username: 'Administrator',
        },
        autoTerminateHours: 24,
      };

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/workstations',
        body: JSON.stringify(launchRequest),
        requestContext: {
          authorizer: {
            claims: {
              email: 'user@test.com',
              'cognito:groups': 'workstation-user',
            },
          },
        } as any,
      };

      // Mock SSM parameter response
      mockSSMClient.send.mockResolvedValueOnce({
        Parameter: {
          Value: JSON.stringify(['g4dn.xlarge', 'g5.xlarge']),
        },
      });

      // Mock EC2 describe images
      mockEC2Client.send.mockResolvedValueOnce({
        Images: [
          {
            ImageId: 'ami-12345',
            CreationDate: '2024-01-01T00:00:00.000Z',
          },
        ],
      });

      // Mock instance profile parameter
      mockSSMClient.send.mockResolvedValueOnce({
        Parameter: {
          Value: 'arn:aws:iam::123456789012:instance-profile/WorkstationProfile',
        },
      });

      // Mock EC2 run instances
      mockEC2Client.send.mockResolvedValueOnce({
        Instances: [
          {
            InstanceId: 'i-newinstance123',
            Placement: {
              AvailabilityZone: 'us-west-2a',
            },
          },
        ],
      });

      // Mock Secrets Manager create secret
      mockSecretsClient.send.mockResolvedValueOnce({
        ARN: 'arn:aws:secretsmanager:us-west-2:123456789012:secret:workstation/ws-123/local-admin',
      });

      // Mock DynamoDB put item
      mockDynamoClient.send.mockResolvedValueOnce({});

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
        instanceType: 't2.micro', // Not allowed
        osVersion: 'Windows Server 2019',
        authMethod: 'local',
      };

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/workstations',
        body: JSON.stringify(launchRequest),
        requestContext: {
          authorizer: {
            claims: {
              email: 'user@test.com',
              'cognito:groups': 'workstation-user',
            },
          },
        } as any,
      };

      // Mock SSM parameter response with allowed types
      mockSSMClient.send.mockResolvedValueOnce({
        Parameter: {
          Value: JSON.stringify(['g4dn.xlarge', 'g5.xlarge']),
        },
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
        pathParameters: {
          workstationId: 'ws-123',
        },
        requestContext: {
          authorizer: {
            claims: {
              email: 'admin@test.com',
              'cognito:groups': 'workstation-admin',
            },
          },
        } as any,
      };

      // Mock DynamoDB get item
      mockDynamoClient.send.mockResolvedValueOnce({
        Item: {
          PK: { S: 'WORKSTATION#ws-123' },
          SK: { S: 'METADATA' },
          instanceId: { S: 'i-123456' },
          userId: { S: 'user@test.com' },
          status: { S: 'running' },
        },
      });

      // Mock EC2 terminate instances
      mockEC2Client.send.mockResolvedValueOnce({});

      // Mock DynamoDB update item
      mockDynamoClient.send.mockResolvedValueOnce({});

      const result = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.status).toBe('terminating');
    });

    it('should deny access for non-admin user to other users workstation', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'DELETE',
        path: '/workstations/ws-123',
        pathParameters: {
          workstationId: 'ws-123',
        },
        requestContext: {
          authorizer: {
            claims: {
              email: 'user@test.com',
              'cognito:groups': 'workstation-user',
            },
          },
        } as any,
      };

      // Mock DynamoDB get item - workstation belongs to different user
      mockDynamoClient.send.mockResolvedValueOnce({
        Item: {
          PK: { S: 'WORKSTATION#ws-123' },
          SK: { S: 'METADATA' },
          instanceId: { S: 'i-123456' },
          userId: { S: 'otheruser@test.com' },
          status: { S: 'running' },
        },
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
            claims: {
              email: 'admin@test.com',
              'cognito:groups': 'workstation-admin',
            },
          },
        } as any,
        queryStringParameters: null,
      };

      // Mock DynamoDB error
      mockDynamoClient.send.mockRejectedValueOnce(new Error('DynamoDB connection failed'));

      const result = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Internal server error');
      expect(body.error).toBe('DynamoDB connection failed');
    });

    it('should handle malformed request body', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/workstations',
        body: 'invalid json',
        requestContext: {
          authorizer: {
            claims: {
              email: 'user@test.com',
              'cognito:groups': 'workstation-user',
            },
          },
        } as any,
      };

      const result = await handler(event as APIGatewayProxyEvent, mockContext);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Internal server error');
    });
  });
});