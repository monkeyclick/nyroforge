import { APIGatewayProxyEvent } from 'aws-lambda';

// Mock AWS SDK clients - must be before imports
jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return { ...actual, S3Client: jest.fn() };
});
jest.mock('@aws-sdk/client-ssm', () => {
  const actual = jest.requireActual('@aws-sdk/client-ssm');
  return { ...actual, SSMClient: jest.fn() };
});
jest.mock('@aws-sdk/client-efs', () => {
  const actual = jest.requireActual('@aws-sdk/client-efs');
  return { ...actual, EFSClient: jest.fn() };
});
jest.mock('@aws-sdk/client-fsx', () => {
  const actual = jest.requireActual('@aws-sdk/client-fsx');
  return { ...actual, FSxClient: jest.fn() };
});
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.example.com/url'),
}));

import { S3Client } from '@aws-sdk/client-s3';
import { SSMClient } from '@aws-sdk/client-ssm';
import { EFSClient } from '@aws-sdk/client-efs';
import { FSxClient } from '@aws-sdk/client-fsx';

const mockS3Send = jest.fn();
const mockSsmSend = jest.fn();
const mockEfsSend = jest.fn();
const mockFsxSend = jest.fn();

(S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(() => ({ send: mockS3Send } as any));
(SSMClient as jest.MockedClass<typeof SSMClient>).mockImplementation(() => ({ send: mockSsmSend } as any));
(EFSClient as jest.MockedClass<typeof EFSClient>).mockImplementation(() => ({ send: mockEfsSend } as any));
(FSxClient as jest.MockedClass<typeof FSxClient>).mockImplementation(() => ({ send: mockFsxSend } as any));

// Import handler AFTER mock setup
import { handler } from '../../src/lambda/storage-service/index';

const USER_SUB = 'user-abc';

function makeEvent(
  overrides: Partial<APIGatewayProxyEvent> = {},
  opts: { admin?: boolean } = {}
): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/storage/list',
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
          sub: USER_SUB,
          email: 'user@test.com',
          ...(opts.admin ? { 'cognito:groups': 'workstation-admin' } : {}),
        },
      },
    } as any,
    ...overrides,
  } as APIGatewayProxyEvent;
}

describe('Storage Service Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // SSM config: transfer bucket configured
    mockSsmSend.mockResolvedValue({ Parameter: { Value: 'test-transfer-bucket' } });
    mockS3Send.mockResolvedValue({ Contents: [], CommonPrefixes: [], KeyCount: 0 });
  });

  describe('authentication', () => {
    it('returns 401 without authorizer claims', async () => {
      const event = makeEvent({ requestContext: {} as any });
      const result = await handler(event);
      expect(result.statusCode).toBe(401);
    });
  });

  describe('GET /storage/download', () => {
    it('returns 403 when a non-admin requests a key outside their prefix', async () => {
      const event = makeEvent({
        path: '/storage/download',
        queryStringParameters: { key: 'users/other-user/secret.txt' },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
    });

    it('allows a non-admin to download within their own prefix', async () => {
      const event = makeEvent({
        path: '/storage/download',
        queryStringParameters: { key: `users/${USER_SUB}/mine.txt` },
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).url).toContain('https://');
    });

    it('allows an admin to download any key', async () => {
      const event = makeEvent(
        { path: '/storage/download', queryStringParameters: { key: 'users/other-user/file.txt' } },
        { admin: true }
      );
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });

    it('returns 400 for a path-traversal key', async () => {
      const event = makeEvent(
        { path: '/storage/download', queryStringParameters: { key: '../etc/passwd' } },
        { admin: true }
      );
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });
  });

  describe('GET /storage/list', () => {
    it('scopes a non-admin list to their own prefix', async () => {
      const event = makeEvent({ path: '/storage/list', queryStringParameters: { prefix: 'photos/' } });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const listCall = mockS3Send.mock.calls.find(
        ([cmd]) => cmd.constructor.name === 'ListObjectsV2Command' && cmd.input.Prefix !== undefined
      );
      expect(listCall![0].input.Prefix).toBe(`users/${USER_SUB}/photos/`);
    });

    it('does not rescope an admin list', async () => {
      const event = makeEvent(
        { path: '/storage/list', queryStringParameters: { prefix: 'users/other/' } },
        { admin: true }
      );
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const listCall = mockS3Send.mock.calls.find(
        ([cmd]) => cmd.constructor.name === 'ListObjectsV2Command' && cmd.input.Prefix !== undefined
      );
      expect(listCall![0].input.Prefix).toBe('users/other/');
    });
  });

  describe('POST /storage/upload-url', () => {
    it('returns 403 when a non-admin uploads outside their prefix', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        path: '/storage/upload-url',
        body: JSON.stringify({ key: 'users/other-user/upload.bin' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
    });
  });

  describe('DELETE /storage/delete', () => {
    it('returns 403 when any key in the batch is outside a non-admin prefix', async () => {
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/storage/delete',
        body: JSON.stringify({ keys: [`users/${USER_SUB}/a.txt`, 'users/other-user/b.txt'] }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(mockS3Send).not.toHaveBeenCalledWith(
        expect.objectContaining({ constructor: expect.objectContaining({ name: 'DeleteObjectsCommand' }) })
      );
    });

    it('returns 400 when a key contains path traversal', async () => {
      const event = makeEvent(
        {
          httpMethod: 'DELETE',
          path: '/storage/delete',
          body: JSON.stringify({ keys: ['users/../secret'] }),
        },
        { admin: true }
      );
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });

    it('deletes own keys for a non-admin', async () => {
      mockS3Send.mockResolvedValue({});
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/storage/delete',
        body: JSON.stringify({ keys: [`users/${USER_SUB}/a.txt`] }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });
  });

  describe('admin-only routes', () => {
    it('returns 403 for non-admin GET /storage/config', async () => {
      const event = makeEvent({ path: '/storage/config' });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
    });

    it('returns 403 for non-admin GET /storage/filesystems', async () => {
      const event = makeEvent({ path: '/storage/filesystems' });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
    });

    it('returns 403 for non-admin DELETE /storage/filesystem', async () => {
      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/storage/filesystem',
        body: JSON.stringify({ fileSystemId: 'fs-123', fileSystemType: 'efs' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(403);
      expect(mockEfsSend).not.toHaveBeenCalled();
    });

    it('allows admin GET /storage/filesystems', async () => {
      mockEfsSend.mockResolvedValue({ FileSystems: [] });
      mockFsxSend.mockResolvedValue({ FileSystems: [] });
      mockS3Send.mockResolvedValue({ Buckets: [] });
      const event = makeEvent({ path: '/storage/filesystems' }, { admin: true });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
    });
  });
});
