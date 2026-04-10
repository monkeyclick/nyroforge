import { APIGatewayProxyEvent, Context } from 'aws-lambda';

// Mock AWS SDK clients - must be before imports.
// @aws-sdk/client-cognito-identity-provider and @aws-sdk/client-ses are not
// installed at the project root (they're Lambda-bundled only), so we provide
// full mock factories without importing the real modules.

jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return { ...actual, DynamoDBClient: jest.fn() };
});
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: jest.fn(),
    },
  };
});
jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({ send: jest.fn().mockResolvedValue({}) })),
  AdminDisableUserCommand: jest.fn(),
  AdminEnableUserCommand: jest.fn(),
  AdminDeleteUserCommand: jest.fn(),
  AdminSetUserPasswordCommand: jest.fn(),
  AdminGetUserCommand: jest.fn(),
  AdminListGroupsForUserCommand: jest.fn(),
}), { virtual: true });
jest.mock('@aws-sdk/client-ses', () => ({
  SESClient: jest.fn().mockImplementation(() => ({ send: jest.fn().mockResolvedValue({}) })),
  SendEmailCommand: jest.fn(),
}), { virtual: true });
jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: jest.fn(() => ({
      verify: jest.fn().mockResolvedValue({ sub: 'jwt-user-id' }),
    })),
  },
}));

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const mockDynamoRawSend = jest.fn();
const mockDocClientSend = jest.fn();

(DynamoDBClient as jest.MockedClass<typeof DynamoDBClient>).mockImplementation(
  () => ({ send: mockDynamoRawSend } as any),
);
(DynamoDBDocumentClient.from as jest.Mock).mockReturnValue({ send: mockDocClientSend });

// Import handler AFTER mock setup
import { handler } from '../../src/lambda/user-management-service/index';

const mockContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'test-user-management',
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

// Plain JS object as returned by DynamoDBDocumentClient (already unmarshalled)
function buildUserDoc(overrides: Record<string, any> = {}) {
  return {
    id: 'admin-user-id',
    email: 'admin@test.com',
    name: 'Admin User',
    status: 'active',
    roleIds: [],
    groupIds: [],
    directPermissions: ['admin:full-access'],
    attributes: {},
    preferences: {},
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/admin/users',
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
        // Provide claims.sub so getCurrentUserId skips JWT verification
        claims: { sub: 'admin-user-id', email: 'admin@test.com' },
      },
    } as any,
    ...overrides,
  };
}

describe('User Management Service Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDocClientSend.mockResolvedValue({});
    mockDynamoRawSend.mockResolvedValue({});
  });

  // ── Authentication / Authorization ────────────────────────────────────────

  describe('Authentication', () => {
    it('returns 401 when no auth claims and no Authorization header', async () => {
      const event = makeEvent({
        requestContext: { authorizer: undefined } as any,
        headers: {},
      });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).message).toContain('Unauthorized');
    });

    it('returns 403 when authenticated user lacks admin permission', async () => {
      const event = makeEvent({
        requestContext: {
          authorizer: { claims: { sub: 'regular-user-id', email: 'user@test.com' } },
        } as any,
      });
      // User found but with no admin permissions
      mockDocClientSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'GetCommand') {
          return Promise.resolve({
            Item: buildUserDoc({ id: 'regular-user-id', directPermissions: [], roleIds: [] }),
          });
        }
        return Promise.resolve({});
      });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).message).toContain('Forbidden');
    });

    it('returns 403 when user is not in DynamoDB (no implicit admin)', async () => {
      const event = makeEvent({
        requestContext: {
          authorizer: { claims: { sub: 'unknown-user', email: 'unknown@test.com' } },
        } as any,
      });
      // User not found → checkAdminPermission returns false
      mockDocClientSend.mockResolvedValue({ Item: undefined });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(403);
    });
  });

  // ── GET /admin/users (list) ───────────────────────────────────────────────

  describe('GET /admin/users', () => {
    it('returns 200 with user list for admin', async () => {
      const event = makeEvent();
      mockDocClientSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'GetCommand') {
          return Promise.resolve({ Item: buildUserDoc() }); // checkAdminPermission
        }
        if (command.constructor.name === 'ScanCommand') {
          return Promise.resolve({
            Items: [
              buildUserDoc(),
              buildUserDoc({ id: 'user-2', email: 'user2@test.com', directPermissions: [] }),
            ],
          });
        }
        return Promise.resolve({});
      });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.users).toBeInstanceOf(Array);
    });

    it('returns 200 with empty list when no users exist', async () => {
      const event = makeEvent();
      mockDocClientSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'GetCommand') {
          return Promise.resolve({ Item: buildUserDoc() });
        }
        if (command.constructor.name === 'ScanCommand') {
          return Promise.resolve({ Items: [] });
        }
        return Promise.resolve({});
      });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).users).toHaveLength(0);
    });
  });

  // ── GET /admin/users/:id ──────────────────────────────────────────────────

  describe('GET /admin/users/:id', () => {
    it('returns 200 with user data for valid userId', async () => {
      const event = makeEvent({ path: '/admin/users/target-user-id' });
      mockDocClientSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'GetCommand') {
          // Return the admin user for both permission check and user lookup
          return Promise.resolve({ Item: buildUserDoc({ id: 'target-user-id', email: 'target@test.com' }) });
        }
        return Promise.resolve({});
      });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(200);
    });

    it('returns 404 when target user does not exist', async () => {
      const event = makeEvent({ path: '/admin/users/non-existent-id' });
      mockDocClientSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'GetCommand') {
          const tableKey = command.input?.Key;
          // Admin check: return admin user; target user lookup: return undefined
          if (tableKey?.id === 'admin-user-id') {
            return Promise.resolve({ Item: buildUserDoc() });
          }
          return Promise.resolve({ Item: undefined });
        }
        return Promise.resolve({});
      });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(404);
    });
  });

  // ── Admin via role ────────────────────────────────────────────────────────

  describe('Admin permission via role', () => {
    it('grants admin access when user has roleIds: ["admin"]', async () => {
      const event = makeEvent({
        requestContext: {
          authorizer: { claims: { sub: 'role-admin-id', email: 'roleadmin@test.com' } },
        } as any,
      });
      mockDocClientSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'GetCommand') {
          const key = command.input?.Key;
          if (key?.id === 'role-admin-id') {
            return Promise.resolve({
              Item: buildUserDoc({ id: 'role-admin-id', directPermissions: [], roleIds: ['admin'] }),
            });
          }
          return Promise.resolve({ Item: undefined });
        }
        if (command.constructor.name === 'ScanCommand') {
          return Promise.resolve({ Items: [] });
        }
        return Promise.resolve({});
      });

      const result = await handler(event, mockContext);
      // roleIds includes 'admin' → checkAdminPermission returns true
      expect(result.statusCode).toBe(200);
    });
  });

  // ── POST /admin/users (create) ────────────────────────────────────────────

  describe('POST /admin/users (create)', () => {
    it('returns 200 or 201 when admin creates a new user', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/admin/users',
        body: JSON.stringify({ email: 'newuser@test.com', name: 'New User', roleIds: [] }),
      });
      mockDocClientSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'GetCommand') {
          return Promise.resolve({ Item: buildUserDoc() }); // admin check
        }
        if (command.constructor.name === 'ScanCommand') {
          return Promise.resolve({ Items: [] }); // no duplicate email
        }
        return Promise.resolve({});
      });

      const result = await handler(event, mockContext);
      expect([200, 201]).toContain(result.statusCode);
    });
  });

  // ── Route not found ───────────────────────────────────────────────────────

  describe('Route not found', () => {
    it('returns 404 for an unknown path segment', async () => {
      const event = makeEvent({ path: '/admin/unknown-resource' });
      mockDocClientSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'GetCommand') {
          return Promise.resolve({ Item: buildUserDoc() });
        }
        return Promise.resolve({});
      });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(404);
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  describe('Error handling', () => {
    it('returns 500 when DynamoDB throws during user list scan', async () => {
      const event = makeEvent();
      mockDocClientSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'GetCommand') {
          return Promise.resolve({ Item: buildUserDoc() }); // admin check passes
        }
        if (command.constructor.name === 'ScanCommand') {
          return Promise.reject(new Error('DynamoDB throughput exceeded'));
        }
        return Promise.resolve({});
      });

      const result = await handler(event, mockContext);
      expect(result.statusCode).toBe(500);
    });
  });
});
