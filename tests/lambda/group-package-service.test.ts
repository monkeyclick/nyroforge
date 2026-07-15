import { marshall } from '@aws-sdk/util-dynamodb';

// Tables not covered by jest.setup.ts, needed before the handler module loads.
process.env.GROUP_PACKAGE_BINDINGS_TABLE = 'test-group-package-bindings-table';
process.env.PACKAGE_QUEUE_TABLE = 'test-package-queue-table';

// Mock AWS SDK clients - must be before imports
jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return { ...actual, DynamoDBClient: jest.fn() };
});

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const mockDynamoSend = jest.fn();

(DynamoDBClient as jest.MockedClass<typeof DynamoDBClient>).mockImplementation(() => ({ send: mockDynamoSend } as any));

// Import handler AFTER mock setup
import { handler } from '../../src/lambda/group-package-service/index';

function adminClaims() {
  return { email: 'admin@test.com', 'cognito:groups': 'workstation-admin' };
}

function makeEvent(overrides: Record<string, any> = {}) {
  return {
    httpMethod: 'GET',
    path: '/groups/group-1/packages',
    pathParameters: null,
    queryStringParameters: null,
    headers: {},
    body: null,
    requestContext: {
      authorizer: { claims: adminClaims() },
    },
    ...overrides,
  };
}

/** Default DynamoDB mock: empty Query results, successful writes. */
function defaultDynamoImplementation(command: any) {
  const name = command.constructor.name;
  if (name === 'QueryCommand') {
    return Promise.resolve({ Items: [] });
  }
  return Promise.resolve({});
}

describe('Group Package Service Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDynamoSend.mockImplementation(defaultDynamoImplementation);
  });

  // ── Regression: malformed JSON body must not throw ────────────────────────

  describe('Malformed request body', () => {
    it('returns 400 with CORS headers instead of throwing when the body is not valid JSON', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/groups/group-1/packages',
        body: '{not valid json',
      });

      await expect(handler(event)).resolves.not.toThrow();
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(result.headers['Access-Control-Allow-Origin']).toBeDefined();
      expect(JSON.parse(result.body).error).toBe('Request body is not valid JSON');
    });
  });

  // ── GET /workstations/{id}/packages ────────────────────────────────────────

  describe('GET /workstations/{id}/packages', () => {
    it('returns 200 with all items merged across a paginated Query (LastEvaluatedKey)', async () => {
      const item1 = marshall({
        PK: 'WORKSTATION#ws-001',
        SK: 'PACKAGE#pkg-1',
        workstationId: 'ws-001',
        packageId: 'pkg-1',
        packageName: 'Package One',
        status: 'completed',
        installOrder: 1,
      });
      const item2 = marshall({
        PK: 'WORKSTATION#ws-001',
        SK: 'PACKAGE#pkg-2',
        workstationId: 'ws-001',
        packageId: 'pkg-2',
        packageName: 'Package Two',
        status: 'pending',
        installOrder: 2,
      });
      const pageKey = marshall({ PK: 'WORKSTATION#ws-001', SK: 'PACKAGE#pkg-1' });

      mockDynamoSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'QueryCommand') {
          if (!command.input.ExclusiveStartKey) {
            return Promise.resolve({ Items: [item1], LastEvaluatedKey: pageKey });
          }
          return Promise.resolve({ Items: [item2] });
        }
        return Promise.resolve({});
      });

      const event = makeEvent({
        httpMethod: 'GET',
        path: '/workstations/ws-001/packages',
        pathParameters: { workstationId: 'ws-001' },
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.workstationId).toBe('ws-001');
      expect(body.packages).toHaveLength(2);
      const ids = body.packages.map((p: any) => p.packageId);
      expect(ids).toEqual(expect.arrayContaining(['pkg-1', 'pkg-2']));
      expect(body.summary.total).toBe(2);
      expect(body.summary.completed).toBe(1);
      expect(body.summary.pending).toBe(1);
    });
  });

  // ── POST addPackageToGroup: duplicate binding ──────────────────────────────

  describe('POST /groups/{id}/packages (addPackageToGroup)', () => {
    it('returns 409 with a client-safe message when the binding already exists', async () => {
      mockDynamoSend.mockImplementation((command: any) => {
        const name = command.constructor.name;
        if (name === 'GetItemCommand') {
          return Promise.resolve({
            Item: marshall({ packageId: 'pkg-1', name: 'Package One', description: 'A package' }),
          });
        }
        if (name === 'PutItemCommand') {
          return Promise.reject({ name: 'ConditionalCheckFailedException' });
        }
        return Promise.resolve({});
      });

      const event = makeEvent({
        httpMethod: 'POST',
        path: '/groups/group-1/packages',
        pathParameters: { groupId: 'group-1' },
        body: JSON.stringify({ packageId: 'pkg-1' }),
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(409);
      expect(JSON.parse(result.body).error).toBe('Package is already assigned to this group');
    });
  });

  // ── PUT updateGroupPackage: nonexistent binding ────────────────────────────

  describe('PUT /groups/{id}/packages/{packageId} (updateGroupPackage)', () => {
    it('returns 404 when the binding does not exist', async () => {
      mockDynamoSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'UpdateItemCommand') {
          return Promise.reject({ name: 'ConditionalCheckFailedException' });
        }
        return Promise.resolve({});
      });

      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/groups/group-1/packages/pkg-missing',
        pathParameters: { groupId: 'group-1', packageId: 'pkg-missing' },
        body: JSON.stringify({ autoInstall: true }),
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).error).toBe('Package binding not found');
    });
  });

  // ── Success path: GET /groups/{id}/packages ────────────────────────────────

  describe('GET /groups/{id}/packages (getGroupPackages)', () => {
    it('returns 200 with the group packages', async () => {
      const binding = marshall({
        PK: 'GROUP#group-1',
        SK: 'PACKAGE#pkg-1',
        packageId: 'pkg-1',
        packageName: 'Package One',
        autoInstall: 'true',
        isMandatory: false,
        installOrder: 10,
      });

      mockDynamoSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'QueryCommand') {
          return Promise.resolve({ Items: [binding] });
        }
        return Promise.resolve({});
      });

      const event = makeEvent({
        httpMethod: 'GET',
        path: '/groups/group-1/packages',
        pathParameters: { groupId: 'group-1' },
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.packages).toHaveLength(1);
      expect(body.packages[0]).toMatchObject({ packageId: 'pkg-1', packageName: 'Package One' });
    });

    it('returns 403 for a non-admin caller on the admin group-package-binding routes', async () => {
      const event = makeEvent({
        httpMethod: 'GET',
        path: '/groups/group-1/packages',
        pathParameters: { groupId: 'group-1' },
        requestContext: {
          authorizer: { claims: { email: 'user@test.com', 'cognito:groups': 'workstation-user' } },
        },
      });

      const result = await handler(event);
      expect(result.statusCode).toBe(403);
    });
  });
});
