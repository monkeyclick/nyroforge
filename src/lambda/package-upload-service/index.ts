import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  ScanCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommandOutput,
  GetObjectTaggingCommand,
  UploadPartCopyCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { v4 as uuidv4 } from 'uuid';
import { corsHeaders, jsonResponse, errorResponse } from '../shared/http';
import { isAdmin } from '../shared/auth';
import { logEvent } from '../shared/logging';
import { notifyUploaderOfDecision } from '../shared/notify';
import {
  BootstrapPackage,
  approvedKey,
  effectiveStatus,
  hasPassedVerification,
  instanceArn,
  isAllowedInstallCommand,
  quarantineKey,
  queuePartitionKey,
  requiresVerification,
  sanitizeFileName,
  verifyKey,
} from '../shared/packages';

const dynamodb = new DynamoDBClient({});
const s3 = new S3Client({});
const lambda = new LambdaClient({});

const PACKAGES_TABLE = process.env.BOOTSTRAP_PACKAGES_TABLE || '';
const QUEUE_TABLE = process.env.PACKAGE_QUEUE_TABLE || '';
const WORKSTATIONS_TABLE = process.env.WORKSTATIONS_TABLE_NAME || '';
const BINDINGS_TABLE = process.env.GROUP_PACKAGE_BINDINGS_TABLE || '';
const PACKAGES_BUCKET = process.env.PACKAGES_BUCKET || '';
const ANALYZER_FUNCTION = process.env.ANALYZER_FUNCTION_NAME || '';
const REGION = process.env.AWS_REGION || 'us-west-2';

/** S3 hard limits. */
const MIN_PART_SIZE = 5 * 1024 * 1024;
const MAX_PARTS = 10000;
/** Comfortable default: a 4 GB installer becomes 64 parts. */
const DEFAULT_PART_SIZE = 64 * 1024 * 1024;
/** Sanity ceiling on a single upload; override with MAX_UPLOAD_BYTES. */
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 20 * 1024 * 1024 * 1024);
/** Presigned part URLs are short-lived; the browser re-requests batches. */
const PART_URL_TTL_SECONDS = 3600;
/** Cap on how many part URLs one request may mint. */
const MAX_PARTS_PER_BATCH = 100;
/** CopyObject tops out at 5 GiB; larger objects need UploadPartCopy. */
const MAX_SINGLE_COPY_BYTES = 5 * 1024 * 1024 * 1024;
const COPY_PART_SIZE = 1024 * 1024 * 1024;
/**
 * Part copies run concurrently. Sequentially, a 20 GB artifact is 20 server-side
 * copies at roughly 20-40s each — comfortably past any sane Lambda timeout.
 */
const COPY_CONCURRENCY = 8;

interface PartPlan {
  partSizeBytes: number;
  partCount: number;
}

/**
 * Choose a part size that keeps the part count under S3's 10,000 limit for any
 * permitted file size while staying large enough that a multi-GB installer
 * doesn't turn into thousands of round trips.
 */
export function computePartPlan(fileSizeBytes: number): PartPlan {
  const minimumForLimit = Math.ceil(fileSizeBytes / (MAX_PARTS - 1));
  // Round up to a whole MiB so the numbers stay legible in the UI.
  const rounded = Math.ceil(minimumForLimit / (1024 * 1024)) * 1024 * 1024;
  const partSizeBytes = Math.max(DEFAULT_PART_SIZE, rounded, MIN_PART_SIZE);
  const partCount = Math.max(1, Math.ceil(fileSizeBytes / partSizeBytes));
  return { partSizeBytes, partCount };
}

function callerId(event: APIGatewayProxyEvent): string | undefined {
  const claims = (event.requestContext?.authorizer?.claims || {}) as Record<string, string>;
  return claims.email || claims.sub || claims['cognito:username'];
}

async function loadPackage(packageId: string): Promise<BootstrapPackage | null> {
  const res = await dynamodb.send(
    new GetItemCommand({
      TableName: PACKAGES_TABLE,
      Key: marshall({ packageId }),
    })
  );
  return res.Item ? (unmarshall(res.Item) as BootstrapPackage) : null;
}

/**
 * Uploads are visible to their uploader and to admins. Fails closed: a missing
 * caller identity is a denial, not a bypass.
 */
function canManageUpload(event: APIGatewayProxyEvent, pkg: BootstrapPackage): boolean {
  if (isAdmin(event)) return true;
  const caller = callerId(event);
  return Boolean(caller && pkg.uploadedBy && pkg.uploadedBy === caller);
}

/**
 * Minimum installer service version that understands S3-sourced packages.
 * Older versions ignore s3Key, fall through to an empty downloadUrl and fail.
 */
const MIN_INSTALLER_VERSION = '2.0.0';

function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Which workstations are still running an installer service too old to fetch a
 * package from S3.
 *
 * The service stamps `installerVersion` on every queue row it moves to
 * `installing`, so recent queue activity is the available evidence. A
 * workstation that has never installed anything reports no version and is not
 * counted — there is nothing to distinguish "old service" from "brand new
 * instance", and blocking on that would make the first approval impossible.
 */
async function findOutdatedWorkstations(): Promise<string[]> {
  if (!QUEUE_TABLE) return [];
  try {
    const res = await dynamodb.send(
      new ScanCommand({
        TableName: QUEUE_TABLE,
        FilterExpression: 'attribute_exists(installerVersion)',
        ProjectionExpression: 'workstationId, installerVersion',
      })
    );
    const outdated = new Set<string>();
    for (const item of res.Items || []) {
      const row = unmarshall(item) as any;
      if (compareVersions(row.installerVersion, MIN_INSTALLER_VERSION) < 0) {
        outdated.add(row.workstationId);
      }
    }
    return Array.from(outdated);
  } catch (error) {
    console.warn('Could not check installer service versions', error);
    return [];
  }
}

function bucketFor(pkg: BootstrapPackage): string {
  return pkg.s3Bucket || PACKAGES_BUCKET;
}

/**
 * Read GuardDuty Malware Protection's verdict for an uploaded object.
 *
 * GuardDuty writes its result to the object's tags after the upload lands, so
 * the tag may legitimately be absent — scanning may be disabled, still running,
 * or the object may predate it. Absence is reported as NO_RESULT and does not
 * block approval; only an explicit THREATS_FOUND does. A tagging error is
 * likewise non-blocking: failing every approval because a tag read failed
 * would be worse than the risk it guards against, and the admin review plus
 * SHA-256 pinning remain in place either way.
 */
async function readMalwareScanResult(
  bucket: string,
  key: string
): Promise<'NO_THREATS_FOUND' | 'THREATS_FOUND' | 'NO_RESULT'> {
  try {
    const res = await s3.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: key }));
    const tag = (res.TagSet || []).find(
      (t) => t.Key === 'GuardDutyMalwareScanStatus'
    );
    if (!tag?.Value) return 'NO_RESULT';
    return tag.Value === 'THREATS_FOUND' ? 'THREATS_FOUND' : 'NO_THREATS_FOUND';
  } catch (error) {
    console.warn('Could not read malware scan tags', error);
    return 'NO_RESULT';
  }
}

/** Strip a filename down to something usable as a default package name. */
function defaultNameFromFile(fileName: string): string {
  return sanitizeFileName(fileName)
    .replace(/\.(exe|msi|zip|msix|appx|bin)$/i, '')
    .replace(/[._]+/g, ' ')
    .trim()
    .slice(0, 120) || 'Uploaded package';
}

// ---------------------------------------------------------------------------
// POST /bootstrap-packages/uploads
// ---------------------------------------------------------------------------

async function initUpload(event: APIGatewayProxyEvent, body: any): Promise<APIGatewayProxyResult> {
  const uploader = callerId(event);
  if (!uploader) {
    return errorResponse(403, 'Forbidden: caller identity unavailable');
  }
  if (!PACKAGES_BUCKET) {
    return errorResponse(500, 'Package storage is not configured');
  }

  const rawFileName = String(body.fileName || '');
  const fileSizeBytes = Number(body.fileSizeBytes);

  if (!rawFileName.trim()) {
    return errorResponse(400, 'fileName is required');
  }
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    return errorResponse(400, 'fileSizeBytes must be a positive number');
  }
  if (fileSizeBytes > MAX_UPLOAD_BYTES) {
    return errorResponse(
      400,
      `File exceeds the maximum upload size of ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024 * 1024))} GB`
    );
  }

  const fileName = sanitizeFileName(rawFileName);
  const packageId = uuidv4();
  const key = quarantineKey(packageId, fileName);
  const plan = computePartPlan(fileSizeBytes);
  const now = new Date().toISOString();

  let created: CreateMultipartUploadCommandOutput;
  try {
    created = await s3.send(
      new CreateMultipartUploadCommand({
        Bucket: PACKAGES_BUCKET,
        Key: key,
        // Encryption comes from the bucket's default SSE-KMS configuration.
        // Setting it explicitly here would also have to be reflected in every
        // presigned UploadPart signature, which is the usual cause of
        // SignatureDoesNotMatch on SSE-KMS multipart uploads.
        ContentType: String(body.contentType || 'application/octet-stream').slice(0, 120),
        // S3 user metadata must be US-ASCII; a non-ASCII byte here fails the
        // whole CreateMultipartUpload call.
        Metadata: {
          uploadedby: uploader.replace(/[^\x20-\x7e]/g, '').slice(0, 250),
          packageid: packageId,
        },
      })
    );
  } catch (error) {
    return errorResponse(500, 'Failed to start upload', error);
  }

  if (!created.UploadId) {
    return errorResponse(500, 'S3 did not return an upload id');
  }

  const record: BootstrapPackage = {
    packageId,
    name: String(body.name || '').trim() || defaultNameFromFile(fileName),
    description: String(body.description || '').trim() || `Uploaded installer: ${fileName}`,
    type: body.type === 'driver' ? 'driver' : 'application',
    category: body.category || 'utility',
    downloadUrl: '',
    installCommand: '',
    installArgs: '',
    osVersions: Array.isArray(body.osVersions) && body.osVersions.length
      ? body.osVersions
      : ['windows-server-2019', 'windows-server-2022', 'windows-server-2025'],
    isRequired: false,
    // Cannot be selected for install until an admin approves it. The catalog
    // service independently refuses to flip this while status !== 'approved'.
    isEnabled: false,
    order: Number.isFinite(Number(body.order)) ? Number(body.order) : 50,
    estimatedInstallTimeMinutes: Number(body.estimatedInstallTimeMinutes) || 10,
    source: 's3',
    supersedesPackageId: body.supersedesPackageId
      ? String(body.supersedesPackageId)
      : undefined,
    s3Bucket: PACKAGES_BUCKET,
    s3Key: key,
    fileName,
    fileSizeBytes,
    status: 'uploading',
    uploadId: created.UploadId,
    uploadedBy: uploader,
    uploadedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await dynamodb.send(
      new PutItemCommand({
        TableName: PACKAGES_TABLE,
        // isRequired/isEnabled are stored as the strings 'true'/'false': they
        // are GSI key attributes (RequiredIndex), and DynamoDB silently omits
        // an item from an index when the key attribute has the wrong type.
        Item: marshall(
          { ...record, isRequired: 'false', isEnabled: 'false' },
          { removeUndefinedValues: true }
        ),
        ConditionExpression: 'attribute_not_exists(packageId)',
      })
    );
  } catch (error) {
    // Don't leave a dangling multipart upload billing the customer.
    await s3
      .send(new AbortMultipartUploadCommand({ Bucket: PACKAGES_BUCKET, Key: key, UploadId: created.UploadId }))
      .catch(() => undefined);
    return errorResponse(500, 'Failed to create package record', error);
  }

  return jsonResponse(201, {
    packageId,
    uploadId: created.UploadId,
    bucket: PACKAGES_BUCKET,
    key,
    fileName,
    partSizeBytes: plan.partSizeBytes,
    partCount: plan.partCount,
  });
}

// ---------------------------------------------------------------------------
// POST /bootstrap-packages/uploads/{packageId}/parts
// ---------------------------------------------------------------------------

async function presignParts(
  event: APIGatewayProxyEvent,
  packageId: string,
  body: any
): Promise<APIGatewayProxyResult> {
  const pkg = await loadPackage(packageId);
  if (!pkg) return errorResponse(404, 'Package not found');
  if (!canManageUpload(event, pkg)) return errorResponse(403, 'Forbidden');
  if (pkg.status !== 'uploading' || !pkg.uploadId || !pkg.s3Key) {
    return errorResponse(409, 'This package is not accepting uploads');
  }

  const partNumbers = body.partNumbers;
  if (!Array.isArray(partNumbers) || partNumbers.length === 0) {
    return errorResponse(400, 'partNumbers must be a non-empty array');
  }
  if (partNumbers.length > MAX_PARTS_PER_BATCH) {
    return errorResponse(400, `Request at most ${MAX_PARTS_PER_BATCH} part URLs at a time`);
  }
  const normalized = partNumbers.map((n: any) => Number(n));
  if (normalized.some((n) => !Number.isInteger(n) || n < 1 || n > MAX_PARTS)) {
    return errorResponse(400, `partNumbers must be integers between 1 and ${MAX_PARTS}`);
  }

  try {
    const urls = await Promise.all(
      normalized.map(async (partNumber) => ({
        partNumber,
        url: await getSignedUrl(
          s3,
          new UploadPartCommand({
            Bucket: pkg.s3Bucket || PACKAGES_BUCKET,
            Key: pkg.s3Key as string,
            UploadId: pkg.uploadId as string,
            PartNumber: partNumber,
          }),
          { expiresIn: PART_URL_TTL_SECONDS }
        ),
      }))
    );
    return jsonResponse(200, { parts: urls, expiresInSeconds: PART_URL_TTL_SECONDS });
  } catch (error) {
    return errorResponse(500, 'Failed to sign upload parts', error);
  }
}

// ---------------------------------------------------------------------------
// POST /bootstrap-packages/uploads/{packageId}/complete
// ---------------------------------------------------------------------------

async function completeUpload(
  event: APIGatewayProxyEvent,
  packageId: string,
  body: any
): Promise<APIGatewayProxyResult> {
  const pkg = await loadPackage(packageId);
  if (!pkg) return errorResponse(404, 'Package not found');
  if (!canManageUpload(event, pkg)) return errorResponse(403, 'Forbidden');
  if (pkg.status !== 'uploading' || !pkg.uploadId || !pkg.s3Key) {
    return errorResponse(409, 'This package is not accepting uploads');
  }

  const parts = body.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return errorResponse(400, 'parts must be a non-empty array');
  }

  const cleaned = parts.map((p: any) => ({
    PartNumber: Number(p.partNumber ?? p.PartNumber),
    ETag: String(p.etag ?? p.ETag ?? ''),
  }));
  if (cleaned.some((p) => !Number.isInteger(p.PartNumber) || p.PartNumber < 1 || !p.ETag)) {
    return errorResponse(400, 'Each part needs a partNumber and an etag');
  }
  const seen = new Set(cleaned.map((p) => p.PartNumber));
  if (seen.size !== cleaned.length) {
    return errorResponse(400, 'Duplicate part numbers');
  }
  // S3 requires ascending part order; the browser uploads concurrently and may
  // report them out of order.
  cleaned.sort((a, b) => a.PartNumber - b.PartNumber);

  try {
    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: pkg.s3Bucket || PACKAGES_BUCKET,
        Key: pkg.s3Key,
        UploadId: pkg.uploadId,
        MultipartUpload: { Parts: cleaned },
      })
    );
  } catch (error) {
    return errorResponse(400, 'Failed to finalize upload; the parts may be incomplete', error);
  }

  await dynamodb.send(
    new UpdateItemCommand({
      TableName: PACKAGES_TABLE,
      Key: marshall({ packageId }),
      UpdateExpression: 'SET #s = :analyzing, updatedAt = :now REMOVE uploadId',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: marshall({
        ':analyzing': 'analyzing',
        ':now': new Date().toISOString(),
      }),
    })
  );

  // Fire-and-forget: the analyzer streams a multi-GB object, far longer than an
  // API request should wait. Lambda retries a failed async invoke twice on its
  // own; beyond that the package sits in 'analyzing' and an admin can retry.
  if (ANALYZER_FUNCTION) {
    try {
      await lambda.send(
        new InvokeCommand({
          FunctionName: ANALYZER_FUNCTION,
          InvocationType: 'Event',
          Payload: Buffer.from(JSON.stringify({ packageId })),
        })
      );
    } catch (error) {
      console.error('Failed to trigger package analysis', error);
      await markAnalysisFailed(packageId, 'Could not start analysis. Retry from the review queue.');
    }
  }

  return jsonResponse(200, { packageId, status: 'analyzing' });
}

async function markAnalysisFailed(packageId: string, reason: string): Promise<void> {
  await dynamodb
    .send(
      new UpdateItemCommand({
        TableName: PACKAGES_TABLE,
        Key: marshall({ packageId }),
        UpdateExpression: 'SET #s = :failed, reviewNotes = :reason, updatedAt = :now',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: marshall({
          ':failed': 'analysis_failed',
          ':reason': reason,
          ':now': new Date().toISOString(),
        }),
      })
    )
    .catch((err) => console.error('Failed to record analysis failure', err));
}

// ---------------------------------------------------------------------------
// DELETE /bootstrap-packages/uploads/{packageId}
// ---------------------------------------------------------------------------

async function abortUpload(event: APIGatewayProxyEvent, packageId: string): Promise<APIGatewayProxyResult> {
  const pkg = await loadPackage(packageId);
  if (!pkg) return errorResponse(404, 'Package not found');
  if (!canManageUpload(event, pkg)) return errorResponse(403, 'Forbidden');
  if (effectiveStatus(pkg) === 'approved') {
    return errorResponse(409, 'Approved packages must be deleted through the catalog, not the upload API');
  }

  const bucket = pkg.s3Bucket || PACKAGES_BUCKET;

  if (pkg.uploadId && pkg.s3Key) {
    await s3
      .send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: pkg.s3Key, UploadId: pkg.uploadId }))
      .catch((err) => console.warn('Abort multipart upload failed (may already be gone)', err));
  }
  if (pkg.s3Key) {
    await s3
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: pkg.s3Key }))
      .catch((err) => console.warn('Delete quarantined object failed', err));
  }

  await dynamodb.send(
    new DeleteItemCommand({ TableName: PACKAGES_TABLE, Key: marshall({ packageId }) })
  );

  return jsonResponse(200, { packageId, deleted: true });
}

// ---------------------------------------------------------------------------
// POST /bootstrap-packages/{packageId}/review   (admin only)
// ---------------------------------------------------------------------------

async function reviewPackage(
  event: APIGatewayProxyEvent,
  packageId: string,
  body: any
): Promise<APIGatewayProxyResult> {
  if (!isAdmin(event)) {
    return errorResponse(403, 'Forbidden: admin access required');
  }
  const pkg = await loadPackage(packageId);
  if (!pkg) return errorResponse(404, 'Package not found');

  const action = String(body.action || '');
  switch (action) {
    case 'approve':
      return approvePackage(event, pkg, body);
    case 'reject':
      return rejectPackage(event, pkg, body);
    case 'verify':
      return verifyPackage(event, pkg, body);
    case 'reanalyze':
      return reanalyzePackage(pkg);
    default:
      return errorResponse(400, "action must be 'approve', 'reject', 'verify' or 'reanalyze'");
  }
}

/**
 * Re-run analysis on an already-uploaded artifact.
 *
 * Analysis can fail before the hash is computed — a transient S3 read, a
 * Lambda timeout — and approval requires a hash, which would otherwise leave
 * the package permanently unapprovable with no way back except re-uploading
 * several GB.
 */
async function reanalyzePackage(pkg: BootstrapPackage): Promise<APIGatewayProxyResult> {
  const status = effectiveStatus(pkg);
  if (status !== 'analysis_failed' && status !== 'needs_review') {
    return errorResponse(409, `Cannot re-analyze a package in status '${status}'`);
  }
  if (!pkg.s3Key) {
    return errorResponse(409, 'Package has no uploaded artifact');
  }
  if (!ANALYZER_FUNCTION) {
    return errorResponse(500, 'Analyzer is not configured');
  }

  await dynamodb.send(
    new UpdateItemCommand({
      TableName: PACKAGES_TABLE,
      Key: marshall({ packageId: pkg.packageId }),
      UpdateExpression: 'SET #s = :analyzing, updatedAt = :now REMOVE reviewNotes',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: marshall({
        ':analyzing': 'analyzing',
        ':now': new Date().toISOString(),
      }),
    })
  );

  try {
    await lambda.send(
      new InvokeCommand({
        FunctionName: ANALYZER_FUNCTION,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ packageId: pkg.packageId })),
      })
    );
  } catch (error) {
    await markAnalysisFailed(pkg.packageId, 'Could not start analysis.');
    return errorResponse(500, 'Failed to start analysis', error);
  }

  return jsonResponse(202, { packageId: pkg.packageId, status: 'analyzing' });
}

/**
 * Copy an object between prefixes. CopyObject handles up to 5 GiB in one call;
 * beyond that S3 requires a multipart copy, which a large Studio installer can
 * genuinely exceed.
 */
async function copyObject(
  bucket: string,
  sourceKey: string,
  destKey: string,
  sizeBytes: number
): Promise<void> {
  const copySource = `${bucket}/${encodeURIComponent(sourceKey).replace(/%2F/g, '/')}`;

  if (sizeBytes <= MAX_SINGLE_COPY_BYTES) {
    await s3.send(new CopyObjectCommand({ Bucket: bucket, Key: destKey, CopySource: copySource }));
    return;
  }

  const created = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: bucket, Key: destKey })
  );
  const uploadId = created.UploadId as string;
  try {
    // Plan every byte range up front, then copy them in parallel.
    const ranges: { partNumber: number; start: number; end: number }[] = [];
    for (let offset = 0, partNumber = 1; offset < sizeBytes; partNumber++) {
      const end = Math.min(offset + COPY_PART_SIZE, sizeBytes) - 1;
      ranges.push({ partNumber, start: offset, end });
      offset = end + 1;
    }

    const parts: { PartNumber: number; ETag: string }[] = [];
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < ranges.length) {
        const range = ranges[cursor++];
        const res = await s3.send(
          new UploadPartCopyCommand({
            Bucket: bucket,
            Key: destKey,
            UploadId: uploadId,
            PartNumber: range.partNumber,
            CopySource: copySource,
            CopySourceRange: `bytes=${range.start}-${range.end}`,
          })
        );
        parts.push({
          PartNumber: range.partNumber,
          ETag: res.CopyPartResult?.ETag as string,
        });
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(COPY_CONCURRENCY, ranges.length) }, () => worker())
    );

    // S3 requires ascending part order; the workers finish out of order.
    parts.sort((a, b) => a.PartNumber - b.PartNumber);

    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: destKey,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      })
    );
  } catch (error) {
    await s3
      .send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: destKey, UploadId: uploadId }))
      .catch(() => undefined);
    throw error;
  }
}

/**
 * Retire the package this one replaces, and carry its group bindings forward.
 *
 * A version bump is only useful if the groups already installing the old
 * release start getting the new one. The predecessor is disabled and marked
 * superseded rather than deleted, so its artifact and audit trail survive and
 * a workstation mid-install is not left pointing at a missing object.
 *
 * Best-effort: an approval that has already promoted the artifact must not be
 * undone because a binding rewrite failed. Failures are returned so the caller
 * can report them.
 */
async function supersedePackage(
  oldPackageId: string,
  newPackage: BootstrapPackage
): Promise<string[]> {
  const problems: string[] = [];
  const now = new Date().toISOString();

  const previous = await loadPackage(oldPackageId);
  if (!previous) {
    return [`Package ${oldPackageId} no longer exists; nothing to supersede.`];
  }

  try {
    await dynamodb.send(
      new UpdateItemCommand({
        TableName: PACKAGES_TABLE,
        Key: marshall({ packageId: oldPackageId }),
        UpdateExpression:
          'SET supersededByPackageId = :new, isEnabled = :false, updatedAt = :now',
        ExpressionAttributeValues: marshall({
          ':new': newPackage.packageId,
          // Stored as a string: isEnabled is a GSI key attribute.
          ':false': 'false',
          ':now': now,
        }),
      })
    );
  } catch (error) {
    console.error('Failed to mark predecessor superseded', error);
    problems.push(`Could not disable the previous version (${oldPackageId}).`);
  }

  if (!BINDINGS_TABLE) {
    return problems;
  }

  // Bindings are keyed GROUP#<id> / PACKAGE#<packageId>, so migrating one means
  // writing a new item and deleting the old — there is no key update.
  let bindings: any[] = [];
  try {
    const res = await dynamodb.send(
      new QueryCommand({
        TableName: BINDINGS_TABLE,
        IndexName: 'PackageIndex',
        KeyConditionExpression: 'packageId = :pid',
        ExpressionAttributeValues: marshall({ ':pid': oldPackageId }),
      })
    );
    bindings = (res.Items || []).map((item) => unmarshall(item));
  } catch (error) {
    // No PackageIndex, or a query failure: fall back to a scan. The bindings
    // table is small (groups x packages), so this stays cheap.
    try {
      const res = await dynamodb.send(
        new ScanCommand({
          TableName: BINDINGS_TABLE,
          FilterExpression: 'packageId = :pid',
          ExpressionAttributeValues: marshall({ ':pid': oldPackageId }),
        })
      );
      bindings = (res.Items || []).map((item) => unmarshall(item));
    } catch (scanError) {
      console.error('Could not read group bindings for migration', scanError);
      return [...problems, 'Could not read group bindings; migrate them manually.'];
    }
  }

  for (const binding of bindings) {
    try {
      await dynamodb.send(
        new PutItemCommand({
          TableName: BINDINGS_TABLE,
          Item: marshall(
            {
              ...binding,
              SK: `PACKAGE#${newPackage.packageId}`,
              packageId: newPackage.packageId,
              packageName: newPackage.name,
              packageDescription: newPackage.description,
              updatedAt: now,
            },
            { removeUndefinedValues: true }
          ),
        })
      );
      await dynamodb.send(
        new DeleteItemCommand({
          TableName: BINDINGS_TABLE,
          Key: marshall({ PK: binding.PK, SK: binding.SK }),
        })
      );
    } catch (error) {
      console.error('Failed to migrate a group binding', error);
      problems.push(`Could not migrate the binding on ${binding.PK}.`);
    }
  }

  console.log(
    `Superseded ${oldPackageId} with ${newPackage.packageId}; migrated ${bindings.length} binding(s)`
  );
  return problems;
}

async function approvePackage(
  event: APIGatewayProxyEvent,
  pkg: BootstrapPackage,
  body: any
): Promise<APIGatewayProxyResult> {
  const status = effectiveStatus(pkg);
  if (status !== 'needs_review' && status !== 'analysis_failed') {
    return errorResponse(409, `Cannot approve a package in status '${status}'`);
  }

  // The admin approves a specific command line, not just a binary — take the
  // final values from the request so edits made in the review UI are what get
  // recorded and (later) executed.
  const installCommand = String(body.installCommand ?? pkg.installCommand ?? '').trim();
  const installArgs = String(body.installArgs ?? pkg.installArgs ?? '');

  if (!installCommand) {
    return errorResponse(400, 'installCommand is required to approve a package');
  }
  if (!isAllowedInstallCommand(installCommand)) {
    return errorResponse(
      400,
      'installCommand must be {installer}, msiexec.exe, powershell.exe or cmd.exe'
    );
  }
  if (!pkg.expectedSha256) {
    return errorResponse(409, 'Package has no verified SHA-256 hash; re-run analysis before approving');
  }
  if (!pkg.s3Key || !pkg.fileName) {
    return errorResponse(409, 'Package has no uploaded artifact');
  }

  // An installer service that predates the S3 download path ignores s3Key and
  // fails on an empty downloadUrl, so publishing an uploaded package before the
  // fleet is updated breaks installs on exactly the machines that pick it up.
  if (pkg.source === 's3' && body.force !== true) {
    const outdated = await findOutdatedWorkstations();
    if (outdated.length > 0) {
      return errorResponse(
        409,
        `${outdated.length} workstation(s) are running an installer service older than ` +
          `${MIN_INSTALLER_VERSION} and cannot install uploaded packages: ` +
          `${outdated.slice(0, 5).join(', ')}${outdated.length > 5 ? '…' : ''}. ` +
          'Update the fleet, or approve with force to publish anyway.'
      );
    }
  }

  // A malware finding blocks publication outright. GuardDuty tags the object
  // asynchronously, so this is checked at approval rather than at upload.
  const scan = await readMalwareScanResult(bucketFor(pkg), pkg.s3Key);
  if (scan === 'THREATS_FOUND') {
    return errorResponse(
      409,
      'Malware scanning flagged this artifact. It cannot be approved; reject it instead.'
    );
  }

  // Anything short of a structural identification is a guess about the silent
  // switches, so it has to be proved on a real workstation first. `force` lets
  // an admin publish anyway when they have verified out of band, and is
  // recorded in the review notes.
  if (requiresVerification(pkg) && !hasPassedVerification(pkg) && body.force !== true) {
    const state = pkg.verification?.status ?? 'not run';
    return errorResponse(
      409,
      `Confidence is '${pkg.analysis?.confidence ?? 'unknown'}', so a trial install must pass ` +
        `before this package can be approved (currently: ${state}). ` +
        'Run one from the review queue, or approve with force to override.'
    );
  }

  const bucket = bucketFor(pkg);
  const destKey = approvedKey(pkg.packageId, pkg.fileName);

  // Promoting the object across the prefix boundary is what actually makes it
  // reachable: the workstation instance role can read `packages/*` only.
  if (pkg.s3Key !== destKey) {
    try {
      await copyObject(bucket, pkg.s3Key, destKey, Number(pkg.fileSizeBytes || 0));
    } catch (error) {
      return errorResponse(500, 'Failed to promote the installer to approved storage', error);
    }
    await s3
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: pkg.s3Key }))
      .catch((err) => console.warn('Failed to remove quarantined copy', err));
  }

  // A trial install may have staged a readable copy under `verify/`; it has
  // served its purpose now that the artifact lives under `packages/`.
  if (pkg.verification && pkg.fileName) {
    await s3
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: verifyKey(pkg.packageId, pkg.fileName) }))
      .catch(() => undefined);
  }

  const now = new Date().toISOString();
  const updates: Record<string, any> = {
    ':approved': 'approved',
    ':key': destKey,
    ':cmd': installCommand,
    ':args': installArgs,
    ':by': callerId(event) || 'unknown',
    ':at': now,
    ':notes':
      body.force === true
        ? `[verification overridden] ${String(body.reviewNotes || '')}`.trim()
        : String(body.reviewNotes || ''),
    ':now': now,
  };

  await dynamodb.send(
    new UpdateItemCommand({
      TableName: PACKAGES_TABLE,
      Key: marshall({ packageId: pkg.packageId }),
      UpdateExpression:
        'SET #s = :approved, s3Key = :key, installCommand = :cmd, installArgs = :args, ' +
        'reviewedBy = :by, reviewedAt = :at, reviewNotes = :notes, updatedAt = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: marshall(updates, { removeUndefinedValues: true }),
    })
  );

  // Retire the predecessor only once this package is safely approved.
  const supersedeWarnings = pkg.supersedesPackageId
    ? await supersedePackage(pkg.supersedesPackageId, pkg)
    : [];

  await notifyUploaderOfDecision({
    uploadedBy: pkg.uploadedBy,
    packageName: pkg.name,
    decision: 'approved',
    reviewedBy: callerId(event),
    notes: String(body.reviewNotes || ''),
  });

  return jsonResponse(200, {
    packageId: pkg.packageId,
    status: 'approved',
    s3Key: destKey,
    supersededPackageId: pkg.supersedesPackageId,
    warnings: supersedeWarnings,
  });
}

async function rejectPackage(
  event: APIGatewayProxyEvent,
  pkg: BootstrapPackage,
  body: any
): Promise<APIGatewayProxyResult> {
  const status = effectiveStatus(pkg);
  if (status === 'approved') {
    return errorResponse(409, 'Cannot reject an already approved package; delete it from the catalog instead');
  }

  const bucket = pkg.s3Bucket || PACKAGES_BUCKET;
  if (pkg.s3Key) {
    await s3
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: pkg.s3Key }))
      .catch((err) => console.warn('Failed to delete rejected artifact', err));
  }

  const now = new Date().toISOString();
  await dynamodb.send(
    new UpdateItemCommand({
      TableName: PACKAGES_TABLE,
      Key: marshall({ packageId: pkg.packageId }),
      UpdateExpression:
        'SET #s = :rejected, reviewedBy = :by, reviewedAt = :at, reviewNotes = :notes, ' +
        'isEnabled = :false, updatedAt = :now REMOVE s3Key',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: marshall({
        ':rejected': 'rejected',
        ':by': callerId(event) || 'unknown',
        ':at': now,
        ':notes': String(body.reviewNotes || 'Rejected by administrator'),
        ':false': 'false',
        ':now': now,
      }),
    })
  );

  await notifyUploaderOfDecision({
    uploadedBy: pkg.uploadedBy,
    packageName: pkg.name,
    decision: 'rejected',
    reviewedBy: callerId(event),
    notes: String(body.reviewNotes || 'Rejected by administrator'),
  });

  return jsonResponse(200, { packageId: pkg.packageId, status: 'rejected' });
}

/**
 * Trial-install the package on one nominated workstation before publishing it.
 *
 * Auto-detected silent flags are a well-informed guess until something actually
 * runs them, so this queues the exact command the admin is about to approve and
 * lets the existing installer service report back through the package queue.
 */
async function verifyPackage(
  event: APIGatewayProxyEvent,
  pkg: BootstrapPackage,
  body: any
): Promise<APIGatewayProxyResult> {
  const workstationId = String(body.workstationId || '').trim();
  if (!workstationId) {
    return errorResponse(400, 'workstationId is required to verify a package');
  }
  if (!QUEUE_TABLE) {
    return errorResponse(500, 'Package queue is not configured');
  }

  const installCommand = String(body.installCommand ?? pkg.installCommand ?? '').trim();
  const installArgs = String(body.installArgs ?? pkg.installArgs ?? '');
  if (!isAllowedInstallCommand(installCommand)) {
    return errorResponse(
      400,
      'installCommand must be {installer}, msiexec.exe, powershell.exe or cmd.exe'
    );
  }
  if (!pkg.s3Key || !pkg.fileName) {
    return errorResponse(409, 'Package has no uploaded artifact');
  }

  const workstation = await dynamodb.send(
    new GetItemCommand({
      TableName: WORKSTATIONS_TABLE,
      Key: marshall({ PK: `WORKSTATION#${workstationId}`, SK: 'METADATA' }),
    })
  );
  if (!workstation.Item) {
    return errorResponse(404, 'Workstation not found');
  }
  const instanceId = (unmarshall(workstation.Item) as any).instanceId;
  if (!instanceId) {
    return errorResponse(409, 'Workstation has no running instance to verify against');
  }

  const accountId = event.requestContext?.accountId || process.env.DEPLOY_ACCOUNT_ID || '';
  if (!accountId) {
    return errorResponse(500, 'Cannot determine the AWS account id for the queue partition key');
  }

  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

  // Stage a copy under `verify/`, which the workstation instance role can read.
  // Queueing the quarantine key directly would fail: withholding read on
  // `quarantine/*` is exactly what stops unreviewed uploads from executing, so
  // a deliberate trial install has to move the object somewhere reachable.
  // The copy expires after 2 days by lifecycle rule and is deleted on approve.
  const bucket = pkg.s3Bucket || PACKAGES_BUCKET;
  const stagedKey = verifyKey(pkg.packageId, pkg.fileName);
  if (pkg.s3Key !== stagedKey) {
    try {
      await copyObject(bucket, pkg.s3Key, stagedKey, Number(pkg.fileSizeBytes || 0));
    } catch (error) {
      return errorResponse(500, 'Failed to stage the installer for verification', error);
    }
  }

  await dynamodb.send(
    new PutItemCommand({
      TableName: QUEUE_TABLE,
      Item: marshall(
        {
          // Instance ARN, matching the partition the installer service polls
          // and the dynamodb:LeadingKeys condition on the instance role.
          PK: queuePartitionKey(instanceArn(REGION, accountId, instanceId)),
          SK: `package#${pkg.packageId}#verify`,
          workstationId: instanceId,
          packageId: pkg.packageId,
          packageName: `[verify] ${pkg.name}`,
          source: 's3',
          s3Bucket: bucket,
          s3Key: stagedKey,
          downloadUrl: '',
          installCommand,
          installArgs,
          expectedSha256: pkg.expectedSha256,
          status: 'pending',
          installOrder: 999,
          required: false,
          retryCount: 0,
          // A verification run is a signal, not a service to keep alive; one
          // attempt gives a clean pass/fail instead of three noisy ones.
          maxRetries: 0,
          createdAt: now,
          createdBy: callerId(event) || 'unknown',
          verificationFor: pkg.packageId,
          estimatedInstallTimeMinutes: pkg.estimatedInstallTimeMinutes,
          ttl,
        },
        { removeUndefinedValues: true }
      ),
    })
  );

  const verification = {
    workstationId: instanceId,
    queuePartitionKey: queuePartitionKey(instanceArn(REGION, accountId, instanceId)),
    status: 'running' as const,
    queuedAt: now,
    installCommand,
    installArgs,
  };

  await dynamodb.send(
    new UpdateItemCommand({
      TableName: PACKAGES_TABLE,
      Key: marshall({ packageId: pkg.packageId }),
      UpdateExpression: 'SET verification = :v, updatedAt = :now',
      ExpressionAttributeValues: marshall({ ':v': verification, ':now': now }),
    })
  );

  return jsonResponse(202, { packageId: pkg.packageId, verification });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logEvent(event, 'Package Upload Service - Event');

  const method = event.httpMethod;
  const resource = event.resource || event.path || '';
  const packageId = event.pathParameters?.packageId || '';

  try {
    let body: any = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch {
        return errorResponse(400, 'Request body is not valid JSON');
      }
    }

    if (!PACKAGES_TABLE) {
      return errorResponse(500, 'Package catalog is not configured');
    }

    if (method === 'OPTIONS') {
      return { statusCode: 204, headers: corsHeaders(), body: '' };
    }

    if (resource.endsWith('/uploads') && method === 'POST') {
      return await initUpload(event, body);
    }
    if (resource.endsWith('/uploads/{packageId}/parts') && method === 'POST') {
      return await presignParts(event, packageId, body);
    }
    if (resource.endsWith('/uploads/{packageId}/complete') && method === 'POST') {
      return await completeUpload(event, packageId, body);
    }
    if (resource.endsWith('/uploads/{packageId}') && method === 'DELETE') {
      return await abortUpload(event, packageId);
    }
    if (resource.endsWith('/{packageId}/review') && method === 'POST') {
      return await reviewPackage(event, packageId, body);
    }

    return errorResponse(404, 'Unknown route');
  } catch (error) {
    return errorResponse(500, 'Internal server error', error);
  }
};

// Exported for unit tests.
export const __testing = { computePartPlan, defaultNameFromFile };
