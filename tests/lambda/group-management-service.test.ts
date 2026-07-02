import { APIGatewayProxyEvent } from 'aws-lambda';

// Mock AWS SDK clients - must be before imports
jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return { ...actual, DynamoDBClient: jest.fn() };
});

const mockDocSend = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDocSend })) },
  };
});

// Import handler AFTER mock setup
import { handler } from '../../src/lambda/group-management-service/index';

function makeEvent(
  overrides: Partial<APIGatewayProxyEvent> = {},
  opts: { admin?: boolean } = { admin: true }
): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/groups',
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
        claims: {
          sub: 'admin-sub',
          email: 'admin@test.com',
          ...(opts.admin ? { 'cognito:groups': 'workstation-admin' } : {}),
        },
      },
    } as any,
    ...overrides,
  } as APIGatewayProxyEvent;
}

describe('Group Management Service Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDocSend.mockResolvedValue({ Items: [] });
  });

  describe('routing (paths must match the admin API, which has no /admin prefix)', () => {
    it('GET /groups returns 200 for an admin', async () => {
      const result = await handler(makeEvent());
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({ groups: [] });
    });

    it('GET /group-audit-logs returns 200 for an admin', async () => {
      const result = await handler(makeEvent({ path: '/group-audit-logs' }));
      expect(result.statusCode).toBe(200);
    });

    it('GET /groups/{groupId} routes to the single-group handler', async () => {
      mockDocSend.mockResolvedValue({ Item: { id: 'group-1', name: 'Editors' }, Items: [] });
      const result = await handler(
        makeEvent({ path: '/groups/group-1', pathParameters: { groupId: 'group-1' } })
      );
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).id).toBe('group-1');
    });

    it('DELETE /groups/{groupId}/members/{userId} routes to member removal', async () => {
      mockDocSend.mockResolvedValue({ Items: [] });
      const result = await handler(
        makeEvent({
          httpMethod: 'DELETE',
          path: '/groups/group-1/members/user-9',
          pathParameters: { groupId: 'group-1', userId: 'user-9' },
        })
      );
      // Routed (not 404); exact status depends on membership lookup
      expect(result.statusCode).not.toBe(404);
    });

    it('unknown paths still return 404', async () => {
      const result = await handler(makeEvent({ path: '/nope' }));
      expect(result.statusCode).toBe(404);
    });
  });

  describe('authorization', () => {
    it('returns 403 for a non-admin on every route', async () => {
      const result = await handler(makeEvent({}, { admin: false }));
      expect(result.statusCode).toBe(403);
      expect(mockDocSend).not.toHaveBeenCalled();
    });

    it('returns 403 for a non-admin DELETE /groups/{groupId}', async () => {
      const result = await handler(
        makeEvent(
          { httpMethod: 'DELETE', path: '/groups/group-1', pathParameters: { groupId: 'group-1' } },
          { admin: false }
        )
      );
      expect(result.statusCode).toBe(403);
      expect(mockDocSend).not.toHaveBeenCalled();
    });

    it('lets OPTIONS preflight through without auth', async () => {
      const result = await handler(makeEvent({ httpMethod: 'OPTIONS' }, { admin: false }));
      expect(result.statusCode).toBe(200);
    });
  });

  describe('error hygiene', () => {
    it('returns a generic message when DynamoDB throws', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      mockDocSend.mockRejectedValue(new Error('ConnectionError: secret internals'));
      const result = await handler(makeEvent());
      expect(result.statusCode).toBe(500);
      expect(result.body).not.toContain('secret internals');
      expect(JSON.parse(result.body).error).toBe('Internal server error');
      consoleSpy.mockRestore();
    });
  });
});
