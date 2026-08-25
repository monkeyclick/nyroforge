import { marshall } from '@aws-sdk/util-dynamodb';

// Tables not covered by jest.setup.ts, needed before the handler module loads.
process.env.GROUP_PACKAGE_BINDINGS_TABLE = 'test-group-package-bindings-table';
process.env.PACKAGE_QUEUE_TABLE = 'test-package-queue-table';
process.env.DEPLOY_ACCOUNT_ID = '111122223333';
process.env.AWS_REGION = 'us-west-2';

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
        PK: 'workstation#arn:aws:ec2:us-west-2:111122223333:instance/i-0abc123',
        SK: 'package#pkg-1#1',
        workstationId: 'i-0abc123',
        packageId: 'pkg-1',
        packageName: 'Package One',
        status: 'completed',
        installOrder: 1,
      });
      const item2 = marshall({
        PK: 'workstation#arn:aws:ec2:us-west-2:111122223333:instance/i-0abc123',
        SK: 'package#pkg-2#2',
        workstationId: 'i-0abc123',
        packageId: 'pkg-2',
        packageName: 'Package Two',
        status: 'pending',
        installOrder: 2,
      });
      const pageKey = marshall({ PK: 'workstation#arn:aws:ec2:us-west-2:111122223333:instance/i-0abc123', SK: 'package#pkg-1#1' });

      mockDynamoSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'GetItemCommand') {
          return Promise.resolve({
            Item: marshall({
              PK: 'WORKSTATION#ws-001',
              SK: 'METADATA',
              workstationId: 'ws-001',
              instanceId: 'i-0abc123',
            }),
          });
        }
        if (command.constructor.name === 'QueryCommand') {
          // Reads span two partitions: the current instance-ARN key and the
          // legacy bare-instance-id key, which still holds unexpired rows.
          if (command.input.ExpressionAttributeValues[':pk'].S !== 'workstation#arn:aws:ec2:us-west-2:111122223333:instance/i-0abc123') {
            return Promise.resolve({ Items: [] });
          }
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

    it('queries the instance-ARN partition the installer service actually reads', async () => {
      // The Windows service queries PK = "workstation#{instanceArn}", and the
      // instance role is scoped by ${ec2:SourceInstanceARN}. Reading
      // "WORKSTATION#{workstationId}" instead returns an empty, unrelated
      // partition, which is how launch-queued packages became invisible here.
      mockDynamoSend.mockImplementation((command: any) => {
        if (command.constructor.name === 'GetItemCommand') {
          return Promise.resolve({
            Item: marshall({
              PK: 'WORKSTATION#ws-001',
              SK: 'METADATA',
              workstationId: 'ws-001',
              instanceId: 'i-0abc123',
            }),
          });
        }
        return Promise.resolve({ Items: [] });
      });

      await handler(makeEvent({
        httpMethod: 'GET',
        path: '/workstations/ws-001/packages',
        pathParameters: { workstationId: 'ws-001' },
      }));

      const queried = mockDynamoSend.mock.calls
        .filter(([c]: any[]) => c.constructor.name === 'QueryCommand')
        .map(([c]: any[]) => c.input.ExpressionAttributeValues[':pk'].S);

      expect(queried).toContain('workstation#arn:aws:ec2:us-west-2:111122223333:instance/i-0abc123');
      // Legacy rows written before the re-keying are still read until they
      // age out under the queue table's 30-day TTL.
      expect(queried).toContain('workstation#i-0abc123');
    });

    it('404s when the workstation has no instance to read a queue for', async () => {
      mockDynamoSend.mockImplementation(() => Promise.resolve({}));
      const result = await handler(makeEvent({
        httpMethod: 'GET',
        path: '/workstations/ws-001/packages',
        pathParameters: { workstationId: 'ws-001' },
      }));
      expect(result.statusCode).toBe(404);
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

  // ── Post-launch queue management on the user API ────────────────────────────

  describe('POST/DELETE /workstations/{id}/packages (post-launch queue)', () => {
    const OWNER = 'owner@test.com';

    /** GetItem on the workstations table returns a workstation owned by OWNER;
     *  GetItem on the packages table returns a package definition. */
    function mockWorkstationAndPackage(
      assignedUsers: string[] = [],
      packageOverrides: Record<string, any> = {}
    ) {
      mockDynamoSend.mockImplementation((command: any) => {
        const name = command.constructor.name;
        if (name === 'GetItemCommand' && command.input.TableName === 'test-workstations-table') {
          return Promise.resolve({
            Item: marshall({
              PK: 'WORKSTATION#ws-001',
              SK: 'METADATA',
              workstationId: 'ws-001',
              // The package queue is partitioned by instance id, so every
              // queue operation resolves the workstation to its instance.
              instanceId: 'i-0abc123',
              userId: OWNER,
              assignedUsers,
            }),
          });
        }
        if (name === 'GetItemCommand' && command.input.TableName === 'test-bootstrap-packages-table') {
          return Promise.resolve({
            Item: marshall({
              packageId: 'pkg-1',
              name: 'Package One',
              downloadUrl: 'https://example.com/pkg1.exe',
              installCommand: 'pkg1.exe /S',
              order: 10,
              ...packageOverrides,
            }, { removeUndefinedValues: true }),
          });
        }
        if (name === 'QueryCommand') {
          // An existing queued item, so retry/remove have something to find.
          return Promise.resolve({
            Items: [marshall({
              PK: 'workstation#arn:aws:ec2:us-west-2:111122223333:instance/i-0abc123',
              SK: 'package#pkg-1#10',
              packageId: 'pkg-1',
              status: 'failed',
            })],
          });
        }
        return Promise.resolve({});
      });
    }

    function userEvent(email: string, overrides: Record<string, any> = {}) {
      return makeEvent({
        requestContext: {
          authorizer: { claims: { email, 'cognito:groups': 'workstation-user' } },
        },
        ...overrides,
      });
    }

    it('lets the owner queue packages on their own workstation (201, queue write)', async () => {
      mockWorkstationAndPackage();
      const result = await handler(userEvent(OWNER, {
        httpMethod: 'POST',
        path: '/workstations/ws-001/packages',
        pathParameters: { workstationId: 'ws-001' },
        body: JSON.stringify({ packageIds: ['pkg-1'] }),
      }));

      expect(result.statusCode).toBe(201);
      expect(JSON.parse(result.body).added).toBe(1);
      const put = mockDynamoSend.mock.calls.find(
        ([c]: any[]) => c.constructor.name === 'PutItemCommand' && c.input.TableName === 'test-package-queue-table'
      );
      expect(put).toBeDefined();
    });

    it('writes the queue item into the instance partition with the installer-service key shape', async () => {
      mockWorkstationAndPackage();
      await handler(userEvent(OWNER, {
        httpMethod: 'POST',
        path: '/workstations/ws-001/packages',
        pathParameters: { workstationId: 'ws-001' },
        body: JSON.stringify({ packageIds: ['pkg-1'] }),
      }));

      const put = mockDynamoSend.mock.calls.find(
        ([c]: any[]) => c.constructor.name === 'PutItemCommand'
          && c.input.TableName === 'test-package-queue-table'
      );
      const item = put![0].input.Item;
      expect(item.PK.S).toBe('workstation#arn:aws:ec2:us-west-2:111122223333:instance/i-0abc123');
      expect(item.SK.S).toBe('package#pkg-1#10');
    });

    it('carries S3 source fields through to the queue for uploaded packages', async () => {
      mockWorkstationAndPackage([], {
        source: 's3',
        s3Bucket: 'test-packages-bucket',
        s3Key: 'packages/pkg-1/Resolve.zip',
        downloadUrl: '',
        status: 'approved',
      });

      await handler(userEvent(OWNER, {
        httpMethod: 'POST',
        path: '/workstations/ws-001/packages',
        pathParameters: { workstationId: 'ws-001' },
        body: JSON.stringify({ packageIds: ['pkg-1'] }),
      }));

      const put = mockDynamoSend.mock.calls.find(
        ([c]: any[]) => c.constructor.name === 'PutItemCommand'
          && c.input.TableName === 'test-package-queue-table'
      );
      expect(put![0].input.Item.source.S).toBe('s3');
      expect(put![0].input.Item.s3Key.S).toBe('packages/pkg-1/Resolve.zip');
    });

    it.each(['uploading', 'analyzing', 'needs_review', 'rejected', 'analysis_failed'])(
      'refuses to queue a package in status %s',
      async (status) => {
        mockWorkstationAndPackage([], { status });

        const result = await handler(userEvent(OWNER, {
          httpMethod: 'POST',
          path: '/workstations/ws-001/packages',
          pathParameters: { workstationId: 'ws-001' },
          body: JSON.stringify({ packageIds: ['pkg-1'] }),
        }));

        // Reported rather than silently dropped, but nothing is queued: an
        // unapproved binary must never reach a workstation.
        expect(result.statusCode).toBe(201);
        const body = JSON.parse(result.body);
        expect(body.added).toBe(0);
        expect(body.skipped[0].reason).toContain(status);

        const put = mockDynamoSend.mock.calls.find(
          ([c]: any[]) => c.constructor.name === 'PutItemCommand'
            && c.input.TableName === 'test-package-queue-table'
        );
        expect(put).toBeUndefined();
      }
    );

    it('still queues a legacy package that has no status field', async () => {
      // Packages predating uploads carry no status and were curated by an
      // admin at creation; they must keep working untouched.
      mockWorkstationAndPackage([], { status: undefined });
      const result = await handler(userEvent(OWNER, {
        httpMethod: 'POST',
        path: '/workstations/ws-001/packages',
        pathParameters: { workstationId: 'ws-001' },
        body: JSON.stringify({ packageIds: ['pkg-1'] }),
      }));
      expect(JSON.parse(result.body).added).toBe(1);
    });

    it('rejects another non-admin user with 403 and writes nothing', async () => {
      mockWorkstationAndPackage();
      const result = await handler(userEvent('stranger@test.com', {
        httpMethod: 'POST',
        path: '/workstations/ws-001/packages',
        pathParameters: { workstationId: 'ws-001' },
        body: JSON.stringify({ packageIds: ['pkg-1'] }),
      }));

      expect(result.statusCode).toBe(403);
      const put = mockDynamoSend.mock.calls.find(
        ([c]: any[]) => c.constructor.name === 'PutItemCommand'
      );
      expect(put).toBeUndefined();
    });

    it('lets a shared user manage the queue', async () => {
      mockWorkstationAndPackage(['shared@test.com']);
      const result = await handler(userEvent('shared@test.com', {
        httpMethod: 'POST',
        path: '/workstations/ws-001/packages',
        pathParameters: { workstationId: 'ws-001' },
        body: JSON.stringify({ packageIds: ['pkg-1'] }),
      }));
      expect(result.statusCode).toBe(201);
    });

    it('returns 400 when packageIds is missing', async () => {
      mockWorkstationAndPackage();
      const result = await handler(userEvent(OWNER, {
        httpMethod: 'POST',
        path: '/workstations/ws-001/packages',
        pathParameters: { workstationId: 'ws-001' },
        body: JSON.stringify({}),
      }));
      expect(result.statusCode).toBe(400);
    });

    it('lets the owner remove a queued package (DELETE → 200)', async () => {
      mockWorkstationAndPackage();
      const result = await handler(userEvent(OWNER, {
        httpMethod: 'DELETE',
        path: '/workstations/ws-001/packages/pkg-1',
        pathParameters: { workstationId: 'ws-001', packageId: 'pkg-1' },
      }));

      expect(result.statusCode).toBe(200);
      const del = mockDynamoSend.mock.calls.find(
        ([c]: any[]) => c.constructor.name === 'DeleteItemCommand'
      );
      expect(del).toBeDefined();
      expect(del![0].input.TableName).toBe('test-package-queue-table');
    });

    it('still routes POST .../packages/{id}/retry to the retry handler, not the queue-add handler', async () => {
      mockWorkstationAndPackage();
      const result = await handler(userEvent(OWNER, {
        httpMethod: 'POST',
        path: '/workstations/ws-001/packages/pkg-1/retry',
        pathParameters: { workstationId: 'ws-001', packageId: 'pkg-1' },
        body: null,
      }));

      // Retry issues an UpdateItem on the queue table (never a PutItem)
      expect(result.statusCode).toBe(200);
      const update = mockDynamoSend.mock.calls.find(
        ([c]: any[]) => c.constructor.name === 'UpdateItemCommand'
      );
      expect(update).toBeDefined();
      const put = mockDynamoSend.mock.calls.find(
        ([c]: any[]) => c.constructor.name === 'PutItemCommand'
      );
      expect(put).toBeUndefined();
    });
  });
});
