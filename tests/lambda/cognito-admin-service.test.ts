import { APIGatewayProxyEvent } from 'aws-lambda';

// Mock AWS SDK clients / aws-jwt-verify - must be before imports.
jest.mock('@aws-sdk/client-cognito-identity-provider', () => {
  const actual = jest.requireActual('@aws-sdk/client-cognito-identity-provider');
  return { ...actual, CognitoIdentityProviderClient: jest.fn() };
});
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
// The module calls CognitoJwtVerifier.create(...) at import time, so this
// must resolve to something with a `.verify` method before the handler loads.
jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: jest.fn().mockReturnValue({ verify: jest.fn() }),
  },
}));

import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const mockCognitoSend = jest.fn();
const mockDynamoSend = jest.fn();
const mockDocSend = jest.fn();

(CognitoIdentityProviderClient as jest.MockedClass<typeof CognitoIdentityProviderClient>).mockImplementation(
  () => ({ send: mockCognitoSend } as any)
);
(DynamoDBClient as jest.MockedClass<typeof DynamoDBClient>).mockImplementation(() => ({ send: mockDynamoSend } as any));
(DynamoDBDocumentClient.from as jest.Mock).mockReturnValue({ send: mockDocSend });

// Import handler AFTER mock setup
import { handler } from '../../src/lambda/cognito-admin-service/index';

function makeCognitoUser(overrides: Record<string, any> = {}) {
  return {
    Username: overrides.Username || 'user1@test.com',
    Attributes: [
      { Name: 'sub', Value: overrides.sub || 'sub-001' },
      { Name: 'email', Value: overrides.email || overrides.Username || 'user1@test.com' },
    ],
    Enabled: overrides.Enabled !== undefined ? overrides.Enabled : true,
    UserStatus: overrides.UserStatus || 'CONFIRMED',
    UserCreateDate: new Date('2024-01-01T00:00:00.000Z'),
    UserLastModifiedDate: new Date('2024-01-02T00:00:00.000Z'),
  };
}

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/users',
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
  } as APIGatewayProxyEvent;
}

function nonAdminEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return makeEvent({
    requestContext: {
      authorizer: { claims: { email: 'user@test.com', 'cognito:groups': 'workstation-user' } },
    } as any,
    ...overrides,
  });
}

describe('Cognito Admin Service Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCognitoSend.mockResolvedValue({});
    mockDynamoSend.mockResolvedValue({});
    mockDocSend.mockResolvedValue({});
  });

  // ── Authorization ───────────────────────────────────────────────────────────

  describe('Authorization', () => {
    it('returns 403 for a non-admin caller on any route', async () => {
      const result = await handler(nonAdminEvent());
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).message).toBe('Forbidden - Admin access required');
    });
  });

  // ── GET /users ───────────────────────────────────────────────────────────────

  describe('GET /users', () => {
    it('returns 200 with mapped users for a single unpaginated page', async () => {
      mockCognitoSend.mockImplementation((command: any) => {
        const name = command.constructor.name;
        if (name === 'ListUsersCommand') {
          return Promise.resolve({ Users: [makeCognitoUser({ Username: 'user1@test.com', sub: 'sub-001' })] });
        }
        if (name === 'AdminListGroupsForUserCommand') {
          return Promise.resolve({ Groups: [{ GroupName: 'workstation-admin' }] });
        }
        return Promise.resolve({});
      });

      const result = await handler(makeEvent());
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.users).toHaveLength(1);
      expect(body.users[0]).toMatchObject({
        id: 'sub-001',
        email: 'user1@test.com',
        status: 'active',
        groupIds: ['workstation-admin'],
      });
    });

    it('follows Cognito PaginationToken across pages and merges both pages of users', async () => {
      mockCognitoSend.mockImplementation((command: any) => {
        const name = command.constructor.name;
        if (name === 'ListUsersCommand') {
          if (!command.input.PaginationToken) {
            return Promise.resolve({
              Users: [makeCognitoUser({ Username: 'user1@test.com', sub: 'sub-001' })],
              PaginationToken: 'page-2-token',
            });
          }
          return Promise.resolve({
            Users: [makeCognitoUser({ Username: 'user2@test.com', sub: 'sub-002' })],
          });
        }
        if (name === 'AdminListGroupsForUserCommand') {
          return Promise.resolve({ Groups: [] });
        }
        return Promise.resolve({});
      });

      const result = await handler(makeEvent());
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.users).toHaveLength(2);
      const ids = body.users.map((u: any) => u.id);
      expect(ids).toEqual(expect.arrayContaining(['sub-001', 'sub-002']));
    });
  });

  // ── POST /users ──────────────────────────────────────────────────────────────

  describe('POST /users', () => {
    it('returns 400 for an invalid email, without calling Cognito', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ email: 'not-an-email' }),
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toBe('A valid email address is required.');
      expect(mockCognitoSend).not.toHaveBeenCalled();
    });

    it('creates a user and returns a generated temporaryPassword when none was supplied', async () => {
      mockCognitoSend.mockImplementation((command: any) => {
        const name = command.constructor.name;
        if (name === 'AdminCreateUserCommand') {
          return Promise.resolve({
            User: makeCognitoUser({ Username: 'newuser@test.com', sub: 'sub-999', UserStatus: 'FORCE_CHANGE_PASSWORD' }),
          });
        }
        if (name === 'AdminAddUserToGroupCommand') {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      const event = makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ email: 'newuser@test.com', groups: ['workstation-user'] }),
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.temporaryPassword).toBeDefined();
      expect(typeof body.temporaryPassword).toBe('string');
      expect(body.user.email).toBe('newuser@test.com');
    });

    it('returns 409 with a client-safe message when Cognito throws UsernameExistsException', async () => {
      const rawMessage = 'raw-aws-internal-detail-should-not-leak';
      mockCognitoSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'AdminCreateUserCommand') {
          return Promise.reject({ name: 'UsernameExistsException', message: rawMessage });
        }
        return Promise.resolve({});
      });

      const event = makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ email: 'dupe@test.com' }),
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(409);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('A user with this email already exists.');
      expect(JSON.stringify(body)).not.toContain(rawMessage);
    });
  });

  // ── GET /roles ───────────────────────────────────────────────────────────────

  describe('GET /roles', () => {
    it('returns 200 with roles scanned from the DynamoDB document client', async () => {
      mockDocSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'ScanCommand') {
          return Promise.resolve({
            Items: [{ id: 'role-1', name: 'Admin', description: 'Full access', permissions: ['admin:full-access'] }],
          });
        }
        return Promise.resolve({});
      });

      const result = await handler(makeEvent({ path: '/roles' }));
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.roles).toEqual([
        { id: 'role-1', name: 'Admin', description: 'Full access', permissions: ['admin:full-access'] },
      ]);
    });
  });

  // ── GET /cognito-groups ───────────────────────────────────────────────────────

  describe('GET /cognito-groups', () => {
    it('follows NextToken and merges both pages of groups', async () => {
      mockCognitoSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'ListGroupsCommand') {
          if (!command.input.NextToken) {
            return Promise.resolve({ Groups: [{ GroupName: 'workstation-admin' }], NextToken: 'g-page-2' });
          }
          return Promise.resolve({ Groups: [{ GroupName: 'workstation-user' }] });
        }
        return Promise.resolve({});
      });

      const result = await handler(makeEvent({ path: '/cognito-groups' }));
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.groups).toHaveLength(2);
      const names = body.groups.map((g: any) => g.GroupName);
      expect(names).toEqual(expect.arrayContaining(['workstation-admin', 'workstation-user']));
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────────

  describe('Error handling', () => {
    it('returns 500 with a client-safe message (no raw error text) when the roles Scan rejects', async () => {
      const rawMessage = 'dynamo-table-arn-leak-xyz';
      mockDocSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'ScanCommand') {
          return Promise.reject(new Error(rawMessage));
        }
        return Promise.resolve({});
      });

      const result = await handler(makeEvent({ path: '/roles' }));
      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Failed to list roles');
      expect(JSON.stringify(body)).not.toContain(rawMessage);
    });
  });
});
