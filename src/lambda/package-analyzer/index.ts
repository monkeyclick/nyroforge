/**
 * Package analyzer.
 *
 * Invoked asynchronously by package-upload-service once a multipart upload
 * completes. Streams the uploaded artifact to local disk once — computing the
 * authoritative SHA-256 on the way past — then fingerprints it, picks a silent
 * install recipe, and moves the package to `needs_review` for an admin.
 *
 * The hash is computed here rather than trusted from the browser, and rather
 * than read from S3's own `ChecksumSHA256`: for a multipart object that field
 * is a composite-of-parts digest, not the whole-object hash the Windows
 * installer service verifies against.
 */

import { createHash } from 'crypto';
import { createWriteStream, promises as fs } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable, Transform } from 'stream';
import * as path from 'path';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import {
  DynamoDBClient,
  GetItemCommand,
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { BootstrapPackage, PackageAnalysis } from '../shared/packages';
import { notifyPackageAwaitingReview, notifyUploaderOfAnalysisFailure } from '../shared/notify';
import { fingerprintFile } from './fingerprint';
import { matchRecipe, buildArchiveCommand } from './recipes';

const s3 = new S3Client({});
const dynamodb = new DynamoDBClient({});

const PACKAGES_TABLE = process.env.BOOTSTRAP_PACKAGES_TABLE || '';
/**
 * Lambda ephemeral storage is provisioned at 10 GB; leave headroom so a large
 * archive plus its inflated prefix cannot fill the volume mid-write.
 */
const MAX_LOCAL_BYTES = Number(process.env.MAX_ANALYZE_BYTES || 9 * 1024 * 1024 * 1024);

export interface AnalyzeEvent {
  packageId: string;
}

/** Hash bytes as they stream past, without buffering the object in memory. */
function hashingPassThrough(hash: ReturnType<typeof createHash>): Transform {
  return new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
}

async function loadPackage(packageId: string): Promise<BootstrapPackage | null> {
  const res = await dynamodb.send(
    new GetItemCommand({ TableName: PACKAGES_TABLE, Key: marshall({ packageId }) })
  );
  return res.Item ? (unmarshall(res.Item) as BootstrapPackage) : null;
}

/**
 * Find an existing package with the same content hash.
 *
 * Two uploads of the same binary are the same artifact however they were
 * named, and a duplicate wastes multi-GB of storage while giving admins two
 * catalog entries to keep in step. Surfaced as a warning rather than a hard
 * failure: a deliberate re-upload to replace a rejected entry is legitimate.
 */
async function findDuplicateByHash(
  sha256: string,
  excludePackageId: string
): Promise<{ packageId: string; name: string } | null> {
  try {
    const res = await dynamodb.send(
      new ScanCommand({
        TableName: PACKAGES_TABLE,
        FilterExpression: 'expectedSha256 = :hash AND packageId <> :self',
        ExpressionAttributeValues: marshall({ ':hash': sha256, ':self': excludePackageId }),
        ProjectionExpression: 'packageId, #n, #s',
        ExpressionAttributeNames: { '#n': 'name', '#s': 'status' },
      })
    );
    const match = (res.Items || [])
      .map((item) => unmarshall(item) as any)
      .find((item) => item.status !== 'rejected');
    return match ? { packageId: match.packageId, name: match.name } : null;
  } catch (error) {
    console.warn('Duplicate hash lookup failed', error);
    return null;
  }
}

async function markFailed(
  packageId: string,
  reason: string,
  sha256?: string,
  pkg?: BootstrapPackage
): Promise<void> {
  const values: Record<string, any> = {
    ':status': 'analysis_failed',
    ':notes': reason,
    ':now': new Date().toISOString(),
  };
  let expression = 'SET #s = :status, reviewNotes = :notes, updatedAt = :now';
  if (sha256) {
    expression += ', expectedSha256 = :hash';
    values[':hash'] = sha256;
  }

  await dynamodb
    .send(
      new UpdateItemCommand({
        TableName: PACKAGES_TABLE,
        Key: marshall({ packageId }),
        UpdateExpression: expression,
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: marshall(values, { removeUndefinedValues: true }),
      })
    )
    .catch((error) => console.error('Failed to record analysis failure', error));

  if (pkg) {
    await notifyUploaderOfAnalysisFailure({
      uploadedBy: pkg.uploadedBy,
      packageName: pkg.name,
      reason,
    });
  }
}

/**
 * Download to /tmp while hashing. Returns the local path and the hex digest.
 */
async function downloadAndHash(
  bucket: string,
  key: string,
  localPath: string
): Promise<{ sha256: string; bytes: number }> {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) {
    throw new Error('S3 object has no body');
  }

  const hash = createHash('sha256');
  let bytes = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(null, chunk);
    },
  });

  await pipeline(
    response.Body as Readable,
    hashingPassThrough(hash),
    counter,
    createWriteStream(localPath)
  );

  return { sha256: hash.digest('hex'), bytes };
}

export const handler = async (event: AnalyzeEvent): Promise<{ packageId: string; status: string }> => {
  const packageId = event?.packageId;
  console.log('Analyzing package', packageId);

  if (!packageId) {
    throw new Error('packageId is required');
  }
  if (!PACKAGES_TABLE) {
    throw new Error('BOOTSTRAP_PACKAGES_TABLE is not configured');
  }

  const pkg = await loadPackage(packageId);
  if (!pkg) {
    console.error('Package not found', packageId);
    return { packageId, status: 'not_found' };
  }
  if (!pkg.s3Bucket || !pkg.s3Key || !pkg.fileName) {
    await markFailed(packageId, 'Package has no uploaded artifact to analyze.', undefined, pkg);
    return { packageId, status: 'analysis_failed' };
  }

  const size = Number(pkg.fileSizeBytes || 0);
  if (size > MAX_LOCAL_BYTES) {
    await markFailed(
      packageId,
      `Artifact is ${Math.round(size / 1e9)} GB, above the ${Math.round(
        MAX_LOCAL_BYTES / 1e9
      )} GB analysis limit. Set the install parameters manually.`,
      undefined,
      pkg
    );
    return { packageId, status: 'analysis_failed' };
  }

  const localPath = path.join('/tmp', `pkg-${packageId}`);
  let sha256: string | undefined;

  try {
    const downloaded = await downloadAndHash(pkg.s3Bucket, pkg.s3Key, localPath);
    sha256 = downloaded.sha256;
    console.log(`Hashed ${downloaded.bytes} bytes for ${packageId}: ${sha256}`);

    const fingerprint = await fingerprintFile(localPath, pkg.fileName, downloaded.bytes);

    // An archive becomes a single PowerShell invocation that unpacks and runs
    // the installer it contains; the inner fingerprint decides that installer's
    // own silent switches.
    let recipe = matchRecipe({
      installerType: fingerprint.installerType,
      fileName: pkg.fileName,
      productName: fingerprint.productName,
      vendor: fingerprint.vendor,
    });

    if (fingerprint.installerType === 'zip' && fingerprint.archiveEntry) {
      const innerRecipe = matchRecipe({
        installerType: fingerprint.inner?.installerType || 'unknown',
        fileName: fingerprint.archiveEntry,
        productName: fingerprint.productName,
        vendor: fingerprint.vendor,
      });
      const archiveCommand = buildArchiveCommand(
        packageId,
        fingerprint.archiveEntry,
        innerRecipe.installArgs
      );
      recipe = {
        recipeId: `zip+${innerRecipe.recipeId}`,
        installCommand: archiveCommand.installCommand,
        installArgs: archiveCommand.installArgs,
        warnings: innerRecipe.warnings,
      };
    }

    const duplicate = await findDuplicateByHash(sha256, packageId);
    if (duplicate) {
      fingerprint.warnings.push(
        `Byte-identical to the existing package "${duplicate.name}" (${duplicate.packageId}). ` +
          'Approving this creates a second catalog entry for the same installer.'
      );
    }

    const analysis: PackageAnalysis = {
      installerType: fingerprint.installerType,
      confidence: fingerprint.confidence,
      architecture: fingerprint.architecture,
      detectedProductName: fingerprint.productName,
      detectedVersion: fingerprint.version,
      detectedVendor: fingerprint.vendor,
      archiveEntry: fingerprint.archiveEntry,
      recipeId: recipe.recipeId,
      suggestedInstallCommand: recipe.installCommand,
      suggestedInstallArgs: recipe.installArgs,
      warnings: [...fingerprint.warnings, ...recipe.warnings],
      analyzedAt: new Date().toISOString(),
    };

    const now = new Date().toISOString();
    const values: Record<string, any> = {
      ':status': 'needs_review',
      ':hash': sha256,
      ':analysis': analysis,
      ':cmd': recipe.installCommand,
      ':args': recipe.installArgs,
      ':size': downloaded.bytes,
      ':now': now,
    };
    let expression =
      'SET #s = :status, expectedSha256 = :hash, analysis = :analysis, ' +
      'installCommand = :cmd, installArgs = :args, fileSizeBytes = :size, updatedAt = :now';

    // Prefer real product metadata over the filename-derived placeholder, but
    // never overwrite a name the uploader typed themselves.
    if (fingerprint.productName && !pkg.name?.trim()) {
      expression += ', #n = :name';
      values[':name'] = fingerprint.productName;
    }

    const names: Record<string, string> = { '#s': 'status' };
    if (values[':name']) names['#n'] = 'name';

    await dynamodb.send(
      new UpdateItemCommand({
        TableName: PACKAGES_TABLE,
        Key: marshall({ packageId }),
        UpdateExpression: expression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: marshall(values, { removeUndefinedValues: true }),
      })
    );

    console.log(
      `Analysis complete for ${packageId}: ${analysis.installerType} (${analysis.confidence})`
    );

    await notifyPackageAwaitingReview({
      name: fingerprint.productName || pkg.name,
      fileName: pkg.fileName,
      uploadedBy: pkg.uploadedBy,
      confidence: analysis.confidence,
      installerType: analysis.installerType,
    });

    return { packageId, status: 'needs_review' };
  } catch (error) {
    console.error('Analysis failed', error);
    await markFailed(
      packageId,
      'Automatic analysis failed. Set the install parameters manually and approve.',
      sha256,
      pkg
    );
    return { packageId, status: 'analysis_failed' };
  } finally {
    await fs.unlink(localPath).catch(() => undefined);
  }
};
