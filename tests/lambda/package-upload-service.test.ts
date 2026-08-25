process.env.BOOTSTRAP_PACKAGES_TABLE = 'test-bootstrap-packages';
process.env.PACKAGE_QUEUE_TABLE = 'test-package-queue';
process.env.WORKSTATIONS_TABLE_NAME = 'test-workstations';
process.env.PACKAGES_BUCKET = 'test-packages-bucket';
process.env.ANALYZER_FUNCTION_NAME = 'test-analyzer';
process.env.DEPLOY_ACCOUNT_ID = '111122223333';
process.env.AWS_REGION = 'us-west-2';

jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return { ...actual, DynamoDBClient: jest.fn() };
});
jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return { ...actual, S3Client: jest.fn() };
});
jest.mock('@aws-sdk/client-lambda', () => {
  const actual = jest.requireActual('@aws-sdk/client-lambda');
  return { ...actual, LambdaClient: jest.fn() };
});
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  S3Client,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectTaggingCommand,
} from '@aws-sdk/client-s3';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { marshall } from '@aws-sdk/util-dynamodb';

const mockDynamoSend = jest.fn();
const mockS3Send = jest.fn();
const mockLambdaSend = jest.fn();

(DynamoDBClient as jest.MockedClass<typeof DynamoDBClient>).mockImplementation(
  () => ({ send: mockDynamoSend } as any)
);
(S3Client as jest.MockedClass<typeof S3Client>).mockImplementation(
  () => ({ send: mockS3Send } as any)
);
(LambdaClient as jest.MockedClass<typeof LambdaClient>).mockImplementation(
  () => ({ send: mockLambdaSend } as any)
);

import { handler, computePartPlan } from '../../src/lambda/package-upload-service/index';

const ADMIN = { email: 'admin@test.com', 'cognito:groups': 'workstation-admin' };
const UPLOADER = { email: 'artist@test.com', 'cognito:groups': 'workstation-user' };
const OTHER_USER = { email: 'someone-else@test.com', 'cognito:groups': 'workstation-user' };

function makeEvent(overrides: Record<string, any> = {}) {
  return {
    httpMethod: 'POST',
    resource: '/bootstrap-packages/uploads',
    path: '/bootstrap-packages/uploads',
    pathParameters: null,
    queryStringParameters: null,
    headers: {},
    body: null,
    requestContext: { authorizer: { claims: UPLOADER } },
    ...overrides,
  } as any;
}

/** A package row mid-upload. */
function uploadingPackage(overrides: Record<string, any> = {}) {
  return {
    packageId: 'pkg-1',
    name: 'Resolve',
    fileName: 'DaVinci_Resolve.zip',
    fileSizeBytes: 4_000_000_000,
    source: 's3',
    s3Bucket: 'test-packages-bucket',
    s3Key: 'quarantine/pkg-1/DaVinci_Resolve.zip',
    status: 'uploading',
    uploadId: 'upload-abc',
    uploadedBy: UPLOADER.email,
    ...overrides,
  };
}

/**
 * A package row waiting for an admin decision.
 *
 * Defaults to `high` confidence: only a structural identification (MSI, WiX)
 * can be approved without a passing trial install, so this is the shape that
 * exercises the plain approve path.
 */
function reviewablePackage(overrides: Record<string, any> = {}) {
  return uploadingPackage({
    status: 'needs_review',
    uploadId: undefined,
    expectedSha256: 'a'.repeat(64),
    installCommand: '{installer}',
    installArgs: '/S',
    analysis: {
      installerType: 'msi',
      confidence: 'high',
      suggestedInstallCommand: '{installer}',
      suggestedInstallArgs: '/S',
      warnings: [],
      analyzedAt: '2026-08-24T00:00:00.000Z',
    },
    ...overrides,
  });
}

/** Find the first S3 command of a given type, regardless of call order. */
function s3CallOf<T>(type: new (...args: any[]) => T): T | undefined {
  const call = mockS3Send.mock.calls.find(([c]: any[]) => c instanceof type);
  return call?.[0];
}

/**
 * Route mocks by command type rather than call sequence. The approve path now
 * runs a version check, a malware-tag read and a copy before it writes, and
 * sequencing those by index makes every test brittle to the next gate added.
 */
function mockReviewFlow(pkg: any, options: { scanTag?: string; queueRows?: any[] } = {}) {
  mockDynamoSend.mockImplementation((command: any) => {
    const name = command.constructor.name;
    if (name === 'GetItemCommand') {
      const key = command.input.Key;
      if (key?.PK?.S?.startsWith('WORKSTATION#')) {
        return Promise.resolve(
          dynamoGet({ instanceId: 'i-0abc123', workstationId: 'ws-1' })
        );
      }
      return Promise.resolve(dynamoGet(pkg));
    }
    if (name === 'ScanCommand') {
      // Installer-version check over the package queue.
      return Promise.resolve({
        Items: (options.queueRows || []).map((r) => marshall(r)),
      });
    }
    return Promise.resolve({});
  });

  mockS3Send.mockImplementation((command: any) => {
    const name = command.constructor.name;
    if (name === 'GetObjectTaggingCommand') {
      return Promise.resolve({
        TagSet: options.scanTag
          ? [{ Key: 'GuardDutyMalwareScanStatus', Value: options.scanTag }]
          : [],
      });
    }
    if (name === 'CreateMultipartUploadCommand') {
      return Promise.resolve({ UploadId: 'copy-upload' });
    }
    if (name === 'UploadPartCopyCommand') {
      return Promise.resolve({ CopyPartResult: { ETag: '"part"' } });
    }
    return Promise.resolve({});
  });
}

function dynamoGet(item: any) {
  return { Item: item ? marshall(item, { removeUndefinedValues: true }) : undefined };
}

beforeEach(() => {
  jest.clearAllMocks();
  (getSignedUrl as jest.Mock).mockResolvedValue('https://signed.example/part');
});

// ---------------------------------------------------------------------------

describe('computePartPlan', () => {
  it('uses 64 MiB parts for a typical multi-GB installer', () => {
    const plan = computePartPlan(4 * 1024 * 1024 * 1024);
    expect(plan.partSizeBytes).toBe(64 * 1024 * 1024);
    expect(plan.partCount).toBe(64);
  });

  it('keeps a single part for a small file', () => {
    const plan = computePartPlan(1024);
    expect(plan.partCount).toBe(1);
  });

  it('scales the part size so the count never exceeds S3\u2019s 10,000 limit', () => {
    for (const size of [
      5 * 1024 ** 3,
      100 * 1024 ** 3,
      1024 ** 4,
      5 * 1024 ** 4,
    ]) {
      const plan = computePartPlan(size);
      expect(plan.partCount).toBeLessThanOrEqual(10000);
      expect(plan.partSizeBytes).toBeGreaterThanOrEqual(5 * 1024 * 1024);
    }
  });
});

describe('POST /bootstrap-packages/uploads', () => {
  it('starts a multipart upload and records the package', async () => {
    mockS3Send.mockResolvedValueOnce({ UploadId: 'upload-abc' });
    mockDynamoSend.mockResolvedValueOnce({});

    const res = await handler(
      makeEvent({
        body: JSON.stringify({
          fileName: 'DaVinci_Resolve_19.1.4_Windows.zip',
          fileSizeBytes: 4_000_000_000,
        }),
      })
    );

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.uploadId).toBe('upload-abc');
    expect(body.partSizeBytes).toBe(64 * 1024 * 1024);
    expect(body.key).toMatch(/^quarantine\/.+\/DaVinci_Resolve_19.1.4_Windows.zip$/);

    const created = mockS3Send.mock.calls[0][0];
    expect(created).toBeInstanceOf(CreateMultipartUploadCommand);
    // Explicit SSE headers here would have to be mirrored in every presigned
    // part signature; the bucket default handles encryption instead.
    expect(created.input.ServerSideEncryption).toBeUndefined();
  });

  it('lands the object in quarantine, never the approved prefix', async () => {
    mockS3Send.mockResolvedValueOnce({ UploadId: 'upload-abc' });
    mockDynamoSend.mockResolvedValueOnce({});

    await handler(
      makeEvent({ body: JSON.stringify({ fileName: 'x.exe', fileSizeBytes: 100 }) })
    );

    const key = mockS3Send.mock.calls[0][0].input.Key;
    expect(key.startsWith('quarantine/')).toBe(true);
  });

  it('creates the package disabled and unapproved', async () => {
    mockS3Send.mockResolvedValueOnce({ UploadId: 'upload-abc' });
    mockDynamoSend.mockResolvedValueOnce({});

    await handler(
      makeEvent({ body: JSON.stringify({ fileName: 'x.exe', fileSizeBytes: 100 }) })
    );

    const item = mockDynamoSend.mock.calls[0][0].input.Item;
    expect(item.status.S).toBe('uploading');
    // Stored as strings: these are GSI key attributes.
    expect(item.isEnabled.S).toBe('false');
    expect(item.uploadedBy.S).toBe(UPLOADER.email);
  });

  it('sanitises a traversal attempt in the filename', async () => {
    mockS3Send.mockResolvedValueOnce({ UploadId: 'upload-abc' });
    mockDynamoSend.mockResolvedValueOnce({});

    const res = await handler(
      makeEvent({
        body: JSON.stringify({ fileName: '../../etc/evil.exe', fileSizeBytes: 100 }),
      })
    );

    const key = JSON.parse(res.body).key;
    expect(key).not.toContain('..');
    expect(key).toMatch(/\/evil\.exe$/);
  });

  it.each([
    [{ fileSizeBytes: 100 }, 'missing fileName'],
    [{ fileName: 'a.exe' }, 'missing size'],
    [{ fileName: 'a.exe', fileSizeBytes: 0 }, 'zero size'],
    [{ fileName: 'a.exe', fileSizeBytes: -5 }, 'negative size'],
  ])('rejects a bad request (%#: %s)', async (body) => {
    const res = await handler(makeEvent({ body: JSON.stringify(body) }));
    expect(res.statusCode).toBe(400);
  });

  it('rejects a file above the size ceiling', async () => {
    const res = await handler(
      makeEvent({
        body: JSON.stringify({ fileName: 'huge.exe', fileSizeBytes: 999 * 1024 ** 3 }),
      })
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/maximum upload size/i);
  });

  it('aborts the S3 upload when the catalog write fails', async () => {
    mockS3Send.mockResolvedValueOnce({ UploadId: 'upload-abc' });
    mockDynamoSend.mockRejectedValueOnce(new Error('table gone'));
    mockS3Send.mockResolvedValueOnce({});

    const res = await handler(
      makeEvent({ body: JSON.stringify({ fileName: 'a.exe', fileSizeBytes: 100 }) })
    );

    expect(res.statusCode).toBe(500);
    expect(mockS3Send.mock.calls[1][0]).toBeInstanceOf(AbortMultipartUploadCommand);
  });

  it('rejects a malformed JSON body with a 400, not a crash', async () => {
    const res = await handler(makeEvent({ body: '{not json' }));
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /bootstrap-packages/uploads/{packageId}/parts', () => {
  const partsEvent = (claims: any, body: any) =>
    makeEvent({
      resource: '/bootstrap-packages/uploads/{packageId}/parts',
      pathParameters: { packageId: 'pkg-1' },
      requestContext: { authorizer: { claims } },
      body: JSON.stringify(body),
    });

  it('signs the requested parts for the uploader', async () => {
    mockDynamoSend.mockResolvedValueOnce(dynamoGet(uploadingPackage()));

    const res = await handler(partsEvent(UPLOADER, { partNumbers: [1, 2, 3] }));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).parts).toHaveLength(3);
    expect(getSignedUrl).toHaveBeenCalledTimes(3);
  });

  it('lets an admin sign parts for someone else\u2019s upload', async () => {
    mockDynamoSend.mockResolvedValueOnce(dynamoGet(uploadingPackage()));
    const res = await handler(partsEvent(ADMIN, { partNumbers: [1] }));
    expect(res.statusCode).toBe(200);
  });

  it('refuses an unrelated user', async () => {
    mockDynamoSend.mockResolvedValueOnce(dynamoGet(uploadingPackage()));
    const res = await handler(partsEvent(OTHER_USER, { partNumbers: [1] }));
    expect(res.statusCode).toBe(403);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('refuses once the upload is no longer in progress', async () => {
    mockDynamoSend.mockResolvedValueOnce(dynamoGet(reviewablePackage()));
    const res = await handler(partsEvent(UPLOADER, { partNumbers: [1] }));
    expect(res.statusCode).toBe(409);
  });

  it('caps how many URLs one request can mint', async () => {
    mockDynamoSend.mockResolvedValueOnce(dynamoGet(uploadingPackage()));
    const res = await handler(
      partsEvent(UPLOADER, { partNumbers: Array.from({ length: 500 }, (_, i) => i + 1) })
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects out-of-range part numbers', async () => {
    mockDynamoSend.mockResolvedValueOnce(dynamoGet(uploadingPackage()));
    const res = await handler(partsEvent(UPLOADER, { partNumbers: [0, 99999] }));
    expect(res.statusCode).toBe(400);
  });

  it('404s an unknown package', async () => {
    mockDynamoSend.mockResolvedValueOnce(dynamoGet(null));
    const res = await handler(partsEvent(UPLOADER, { partNumbers: [1] }));
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /bootstrap-packages/uploads/{packageId}/complete', () => {
  const completeEvent = (body: any) =>
    makeEvent({
      resource: '/bootstrap-packages/uploads/{packageId}/complete',
      pathParameters: { packageId: 'pkg-1' },
      body: JSON.stringify(body),
    });

  it('completes the upload with parts in ascending order and triggers analysis', async () => {
    mockDynamoSend.mockResolvedValueOnce(dynamoGet(uploadingPackage()));
    mockS3Send.mockResolvedValueOnce({});
    mockDynamoSend.mockResolvedValueOnce({});
    mockLambdaSend.mockResolvedValueOnce({});

    const res = await handler(
      completeEvent({
        parts: [
          { partNumber: 3, etag: '"c"' },
          { partNumber: 1, etag: '"a"' },
          { partNumber: 2, etag: '"b"' },
        ],
      })
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe('analyzing');

    const complete = mockS3Send.mock.calls[0][0];
    expect(complete).toBeInstanceOf(CompleteMultipartUploadCommand);
    // S3 rejects a completion whose parts are not ascending; the browser
    // uploads concurrently and reports them in whatever order they finish.
    expect(complete.input.MultipartUpload.Parts.map((p: any) => p.PartNumber)).toEqual([1, 2, 3]);

    expect(mockLambdaSend).toHaveBeenCalledTimes(1);
    const invoke = mockLambdaSend.mock.calls[0][0];
    expect(invoke.input.InvocationType).toBe('Event');
  });

  it('rejects duplicate part numbers', async () => {
    mockDynamoSend.mockResolvedValueOnce(dynamoGet(uploadingPackage()));
    const res = await handler(
      completeEvent({ parts: [{ partNumber: 1, etag: '"a"' }, { partNumber: 1, etag: '"b"' }] })
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects parts with no etag', async () => {
    mockDynamoSend.mockResolvedValueOnce(dynamoGet(uploadingPackage()));
    const res = await handler(completeEvent({ parts: [{ partNumber: 1 }] }));
    expect(res.statusCode).toBe(400);
  });

  it('marks the package failed when the analyzer cannot be invoked', async () => {
    mockDynamoSend.mockResolvedValueOnce(dynamoGet(uploadingPackage()));
    mockS3Send.mockResolvedValueOnce({});
    mockDynamoSend.mockResolvedValueOnce({});
    mockLambdaSend.mockRejectedValueOnce(new Error('no such function'));
    mockDynamoSend.mockResolvedValueOnce({});

    const res = await handler(completeEvent({ parts: [{ partNumber: 1, etag: '"a"' }] }));

    expect(res.statusCode).toBe(200);
    const failure = mockDynamoSend.mock.calls[2][0];
    expect(failure.input.ExpressionAttributeValues[':failed'].S).toBe('analysis_failed');
  });
});

describe('DELETE /bootstrap-packages/uploads/{packageId}', () => {
  const abortEvent = (claims: any) =>
    makeEvent({
      httpMethod: 'DELETE',
      resource: '/bootstrap-packages/uploads/{packageId}',
      pathParameters: { packageId: 'pkg-1' },
      requestContext: { authorizer: { claims } },
    });

  it('aborts the upload, deletes the object and removes the record', async () => {
    mockDynamoSend.mockResolvedValueOnce(dynamoGet(uploadingPackage()));
    mockS3Send.mockResolvedValue({});
    mockDynamoSend.mockResolvedValueOnce({});

    const res = await handler(abortEvent(UPLOADER));

    expect(res.statusCode).toBe(200);
    expect(mockS3Send.mock.calls[0][0]).toBeInstanceOf(AbortMultipartUploadCommand);
    expect(mockS3Send.mock.calls[1][0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('refuses to delete an approved package through the upload API', async () => {
    mockDynamoSend.mockResolvedValueOnce(dynamoGet(reviewablePackage({ status: 'approved' })));
    const res = await handler(abortEvent(ADMIN));
    expect(res.statusCode).toBe(409);
  });

  it('refuses an unrelated user', async () => {
    mockDynamoSend.mockResolvedValueOnce(dynamoGet(uploadingPackage()));
    const res = await handler(abortEvent(OTHER_USER));
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /bootstrap-packages/{packageId}/review', () => {
  const reviewEvent = (claims: any, body: any) =>
    makeEvent({
      resource: '/bootstrap-packages/{packageId}/review',
      pathParameters: { packageId: 'pkg-1' },
      requestContext: { authorizer: { claims } },
      body: JSON.stringify(body),
    });

  it('requires an admin', async () => {
    const res = await handler(reviewEvent(UPLOADER, { action: 'approve' }));
    expect(res.statusCode).toBe(403);
  });

  it('rejects an unknown action', async () => {
    mockDynamoSend.mockResolvedValueOnce(dynamoGet(reviewablePackage()));
    const res = await handler(reviewEvent(ADMIN, { action: 'explode' }));
    expect(res.statusCode).toBe(400);
  });

  describe('reanalyze', () => {
    it('re-invokes the analyzer for a package whose analysis failed', async () => {
      // Analysis can fail before the hash is computed, and approval requires a
      // hash — without a retry the package would be stuck short of re-uploading
      // several GB.
      mockDynamoSend.mockResolvedValueOnce(
        dynamoGet(reviewablePackage({ status: 'analysis_failed', expectedSha256: undefined }))
      );
      mockDynamoSend.mockResolvedValueOnce({});
      mockLambdaSend.mockResolvedValueOnce({});

      const res = await handler(reviewEvent(ADMIN, { action: 'reanalyze' }));

      expect(res.statusCode).toBe(202);
      expect(JSON.parse(res.body).status).toBe('analyzing');
      expect(mockLambdaSend).toHaveBeenCalledTimes(1);
    });

    it('refuses to re-analyze an approved package', async () => {
      mockDynamoSend.mockResolvedValueOnce(dynamoGet(reviewablePackage({ status: 'approved' })));
      const res = await handler(reviewEvent(ADMIN, { action: 'reanalyze' }));
      expect(res.statusCode).toBe(409);
      expect(mockLambdaSend).not.toHaveBeenCalled();
    });
  });

  describe('approve', () => {
    it('promotes the object out of quarantine and approves the package', async () => {
      mockReviewFlow(reviewablePackage());

      const res = await handler(
        reviewEvent(ADMIN, { action: 'approve', installCommand: '{installer}', installArgs: '/S' })
      );

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).s3Key).toBe('packages/pkg-1/DaVinci_Resolve.zip');

      const copy = s3CallOf(CopyObjectCommand);
      expect(copy).toBeDefined();
      expect(copy!.input.CopySource).toContain('quarantine/pkg-1/');
      expect(copy!.input.Key).toBe('packages/pkg-1/DaVinci_Resolve.zip');

      // The quarantined original is removed; leaving it would keep an
      // unreviewed-prefix copy of an approved artifact around.
      expect(s3CallOf(DeleteObjectCommand)).toBeDefined();
    });

    it('refuses an install command outside the allowlist', async () => {
      mockReviewFlow(reviewablePackage());
      const res = await handler(
        reviewEvent(ADMIN, { action: 'approve', installCommand: 'C:\\evil\\backdoor.exe' })
      );
      expect(res.statusCode).toBe(400);
      expect(s3CallOf(CopyObjectCommand)).toBeUndefined();
    });

    it.each(['{installer}', 'msiexec.exe', 'powershell.exe', 'cmd.exe'])(
      'accepts %s',
      async (command) => {
        mockReviewFlow(reviewablePackage());
        const res = await handler(reviewEvent(ADMIN, { action: 'approve', installCommand: command }));
        expect(res.statusCode).toBe(200);
      }
    );

    it('refuses to approve without a verified hash', async () => {
      mockReviewFlow(reviewablePackage({ expectedSha256: undefined }));
      const res = await handler(reviewEvent(ADMIN, { action: 'approve', installCommand: '{installer}' }));
      expect(res.statusCode).toBe(409);
    });

    it('refuses to approve a package that is still uploading', async () => {
      mockReviewFlow(uploadingPackage());
      const res = await handler(reviewEvent(ADMIN, { action: 'approve', installCommand: '{installer}' }));
      expect(res.statusCode).toBe(409);
    });

    it('uses a multipart copy for an artifact above the 5 GiB CopyObject limit', async () => {
      mockReviewFlow(reviewablePackage({ fileSizeBytes: 6 * 1024 ** 3 }));

      const res = await handler(reviewEvent(ADMIN, { action: 'approve', installCommand: '{installer}' }));

      expect(res.statusCode).toBe(200);
      const names = mockS3Send.mock.calls.map((c) => c[0].constructor.name);
      expect(names).toContain('UploadPartCopyCommand');
      expect(names).not.toContain('CopyObjectCommand');
    });

    it('reads the malware scan tag before promoting anything', async () => {
      mockReviewFlow(reviewablePackage());
      await handler(reviewEvent(ADMIN, { action: 'approve', installCommand: '{installer}' }));
      const tagRead = s3CallOf(GetObjectTaggingCommand);
      expect(tagRead).toBeDefined();
      expect(tagRead!.input.Key).toBe('quarantine/pkg-1/DaVinci_Resolve.zip');
    });

    it('refuses a package GuardDuty flagged as malware', async () => {
      mockReviewFlow(reviewablePackage(), { scanTag: 'THREATS_FOUND' });
      const res = await handler(reviewEvent(ADMIN, { action: 'approve', installCommand: '{installer}' }));
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error).toMatch(/malware/i);
      expect(s3CallOf(CopyObjectCommand)).toBeUndefined();
    });

    it('approves when scanning returned a clean verdict', async () => {
      mockReviewFlow(reviewablePackage(), { scanTag: 'NO_THREATS_FOUND' });
      const res = await handler(reviewEvent(ADMIN, { action: 'approve', installCommand: '{installer}' }));
      expect(res.statusCode).toBe(200);
    });

    describe('trial-install gate', () => {
      const mediumConfidence = () =>
        reviewablePackage({
          analysis: {
            installerType: 'inno',
            confidence: 'medium',
            suggestedInstallCommand: '{installer}',
            suggestedInstallArgs: '/VERYSILENT',
            warnings: [],
            analyzedAt: '2026-08-24T00:00:00.000Z',
          },
        });

      it('blocks approval at medium confidence until a trial install passes', async () => {
        mockReviewFlow(mediumConfidence());
        const res = await handler(
          reviewEvent(ADMIN, { action: 'approve', installCommand: '{installer}' })
        );
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body).error).toMatch(/trial install must pass/i);
        expect(s3CallOf(CopyObjectCommand)).toBeUndefined();
      });

      it('allows approval once the trial install has passed', async () => {
        mockReviewFlow(
          mediumConfidence().packageId
            ? { ...mediumConfidence(), verification: { workstationId: 'i-0abc123', status: 'passed', queuedAt: 'x', installCommand: '{installer}', installArgs: '' } }
            : mediumConfidence()
        );
        const res = await handler(
          reviewEvent(ADMIN, { action: 'approve', installCommand: '{installer}' })
        );
        expect(res.statusCode).toBe(200);
      });

      it('lets an admin force past the gate, and records that they did', async () => {
        mockReviewFlow(mediumConfidence());
        const res = await handler(
          reviewEvent(ADMIN, { action: 'approve', installCommand: '{installer}', force: true })
        );
        expect(res.statusCode).toBe(200);
        const update = mockDynamoSend.mock.calls.find(
          ([c]: any[]) => c.constructor.name === 'UpdateItemCommand'
        );
        expect(update![0].input.ExpressionAttributeValues[':notes'].S).toMatch(
          /verification overridden/i
        );
      });

      it('requires a trial install when there is no analysis at all', async () => {
        mockReviewFlow(reviewablePackage({ analysis: undefined }));
        const res = await handler(
          reviewEvent(ADMIN, { action: 'approve', installCommand: '{installer}' })
        );
        expect(res.statusCode).toBe(409);
      });
    });

    describe('installer version gate', () => {
      it('refuses while a workstation runs a service too old for S3 packages', async () => {
        mockReviewFlow(reviewablePackage(), {
          queueRows: [{ workstationId: 'i-old', installerVersion: '1.4.0' }],
        });
        const res = await handler(
          reviewEvent(ADMIN, { action: 'approve', installCommand: '{installer}' })
        );
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body).error).toMatch(/older than 2\.0\.0/i);
      });

      it('allows approval once every reporting workstation is current', async () => {
        mockReviewFlow(reviewablePackage(), {
          queueRows: [
            { workstationId: 'i-a', installerVersion: '2.0.0' },
            { workstationId: 'i-b', installerVersion: '2.1.3' },
          ],
        });
        const res = await handler(
          reviewEvent(ADMIN, { action: 'approve', installCommand: '{installer}' })
        );
        expect(res.statusCode).toBe(200);
      });

      it('does not block on workstations that have never reported a version', async () => {
        // A brand new instance is indistinguishable from an un-upgraded one,
        // and blocking on it would make the first approval impossible.
        mockReviewFlow(reviewablePackage(), { queueRows: [] });
        const res = await handler(
          reviewEvent(ADMIN, { action: 'approve', installCommand: '{installer}' })
        );
        expect(res.statusCode).toBe(200);
      });
    });
  });

  describe('reject', () => {
    it('deletes the artifact and marks the package rejected', async () => {
      mockDynamoSend.mockResolvedValueOnce(dynamoGet(reviewablePackage()));
      mockS3Send.mockResolvedValue({});
      mockDynamoSend.mockResolvedValueOnce({});

      const res = await handler(
        reviewEvent(ADMIN, { action: 'reject', reviewNotes: 'Unlicensed' })
      );

      expect(res.statusCode).toBe(200);
      expect(mockS3Send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
      const update = mockDynamoSend.mock.calls[1][0];
      expect(update.input.ExpressionAttributeValues[':rejected'].S).toBe('rejected');
      expect(update.input.ExpressionAttributeValues[':notes'].S).toBe('Unlicensed');
    });

    it('will not reject an already approved package', async () => {
      mockDynamoSend.mockResolvedValueOnce(dynamoGet(reviewablePackage({ status: 'approved' })));
      const res = await handler(reviewEvent(ADMIN, { action: 'reject' }));
      expect(res.statusCode).toBe(409);
    });
  });

  describe('verify', () => {
    it('stages a readable copy and queues a trial install', async () => {
      mockReviewFlow(reviewablePackage());

      const res = await handler(
        reviewEvent(ADMIN, { action: 'verify', workstationId: 'ws-1' })
      );

      expect(res.statusCode).toBe(202);

      // The instance role cannot read quarantine/, so a trial install must run
      // against a copy under the readable verify/ prefix.
      const copy = s3CallOf(CopyObjectCommand);
      expect(copy).toBeDefined();
      expect(copy!.input.Key).toBe('verify/pkg-1/DaVinci_Resolve.zip');

      const put = mockDynamoSend.mock.calls.find(
        ([c]: any[]) => c.constructor.name === 'PutItemCommand'
      );
      const queued = put![0].input.Item;
      // Partitioned by instance ARN — the shape the Windows service queries and
      // the only one the ${ec2:SourceInstanceARN} IAM condition can match.
      expect(queued.PK.S).toBe(
        'workstation#arn:aws:ec2:us-west-2:111122223333:instance/i-0abc123'
      );
      expect(queued.s3Key.S).toBe('verify/pkg-1/DaVinci_Resolve.zip');
      expect(queued.source.S).toBe('s3');
      // One attempt gives a clean pass/fail rather than three noisy ones.
      expect(Number(queued.maxRetries.N)).toBe(0);
    });

    it('requires a workstation', async () => {
      mockReviewFlow(reviewablePackage());
      const res = await handler(reviewEvent(ADMIN, { action: 'verify' }));
      expect(res.statusCode).toBe(400);
    });

    it('404s an unknown workstation', async () => {
      mockDynamoSend.mockResolvedValueOnce(dynamoGet(reviewablePackage()));
      mockDynamoSend.mockResolvedValueOnce(dynamoGet(null));
      const res = await handler(reviewEvent(ADMIN, { action: 'verify', workstationId: 'ws-9' }));
      expect(res.statusCode).toBe(404);
    });

    it('refuses a command outside the allowlist', async () => {
      mockReviewFlow(reviewablePackage());
      const res = await handler(
        reviewEvent(ADMIN, {
          action: 'verify',
          workstationId: 'ws-1',
          installCommand: 'C:\\evil.exe',
        })
      );
      expect(res.statusCode).toBe(400);
    });
  });
});

describe('routing', () => {
  it('404s an unrecognised route', async () => {
    const res = await handler(makeEvent({ resource: '/bootstrap-packages/nope', httpMethod: 'GET' }));
    expect(res.statusCode).toBe(404);
  });
});
