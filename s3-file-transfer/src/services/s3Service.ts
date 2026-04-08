//------------------------------------------------------------------------------
// S3 Service - Core S3 Operations with Multipart Upload/Download
//------------------------------------------------------------------------------

import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  CopyObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  GetBucketLocationCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  AWSCredentials,
  S3Bucket,
  S3Object,
  StorageClass,
  EncryptionConfig,
  ListObjectsResponse,
  MultipartUploadResponse,
  UploadPartResponse,
  CompleteMultipartResponse,
} from '../types';

// Default configuration
const DEFAULT_PART_SIZE = 10 * 1024 * 1024; // 10 MB
const DEFAULT_MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100 MB
const MAX_PARTS = 10000;

export class S3Service {
  private client: S3Client | null = null;
  private credentials: AWSCredentials | null = null;

  //----------------------------------------------------------------------------
  // Initialization
  //----------------------------------------------------------------------------

  initialize(credentials: AWSCredentials): void {
    this.credentials = credentials;
    this.client = this.createClient(credentials);
  }

  private createClient(credentials: AWSCredentials): S3Client {
    const config: any = {
      region: credentials.region,
    };

    if (credentials.type === 'accessKey' && credentials.accessKeyId && credentials.secretAccessKey) {
      config.credentials = {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      };
    }

    return new S3Client(config);
  }

  getClient(): S3Client {
    if (!this.client) {
      throw new Error('S3 client not initialized. Call initialize() first.');
    }
    return this.client;
  }

  isInitialized(): boolean {
    return this.client !== null;
  }

  //----------------------------------------------------------------------------
  // Bucket Operations
  //----------------------------------------------------------------------------

  async listBuckets(): Promise<S3Bucket[]> {
    const client = this.getClient();
    const response = await client.send(new ListBucketsCommand({}));

    return (response.Buckets || []).map((bucket) => ({
      name: bucket.Name || '',
      creationDate: bucket.CreationDate,
    }));
  }

  async createBucket(bucketName: string, region?: string): Promise<void> {
    const client = this.getClient();
    const createParams: any = {
      Bucket: bucketName,
    };

    // LocationConstraint is required for all regions except us-east-1
    const targetRegion = region || this.credentials?.region;
    if (targetRegion && targetRegion !== 'us-east-1') {
      createParams.CreateBucketConfiguration = {
        LocationConstraint: targetRegion,
      };
    }

    await client.send(new CreateBucketCommand(createParams));
  }

  async bucketExists(bucketName: string): Promise<boolean> {
    try {
      const client = this.getClient();
      await client.send(new HeadBucketCommand({ Bucket: bucketName }));
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  async getBucketRegion(bucketName: string): Promise<string> {
    const client = this.getClient();
    const response = await client.send(
      new GetBucketLocationCommand({ Bucket: bucketName })
    );
    // Empty LocationConstraint means us-east-1
    return response.LocationConstraint || 'us-east-1';
  }

  //----------------------------------------------------------------------------
  // Object Listing
  //----------------------------------------------------------------------------

  async listObjects(
    bucket: string,
    prefix: string = '',
    continuationToken?: string,
    maxKeys: number = 1000
  ): Promise<ListObjectsResponse> {
    const client = this.getClient();

    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        Delimiter: '/',
        MaxKeys: maxKeys,
        ContinuationToken: continuationToken,
      })
    );

    const objects: S3Object[] = (response.Contents || []).map((obj) => ({
      key: obj.Key || '',
      size: obj.Size || 0,
      lastModified: obj.LastModified || new Date(),
      etag: obj.ETag?.replace(/"/g, ''),
      storageClass: obj.StorageClass as StorageClass,
      isFolder: false,
      contentType: undefined,
    }));

    const prefixes: string[] = (response.CommonPrefixes || []).map(
      (p) => p.Prefix || ''
    );

    // Add folder objects for prefixes
    prefixes.forEach((p) => {
      const folderName = p.replace(prefix, '').replace(/\/$/, '');
      objects.unshift({
        key: p,
        size: 0,
        lastModified: new Date(),
        isFolder: true,
      });
    });

    return {
      objects,
      prefixes,
      continuationToken: response.NextContinuationToken,
      isTruncated: response.IsTruncated || false,
    };
  }

  async getObjectMetadata(bucket: string, key: string): Promise<S3Object> {
    const client = this.getClient();

    const response = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );

    return {
      key,
      size: response.ContentLength || 0,
      lastModified: response.LastModified || new Date(),
      etag: response.ETag?.replace(/"/g, ''),
      storageClass: response.StorageClass as StorageClass,
      isFolder: key.endsWith('/'),
      contentType: response.ContentType,
      metadata: response.Metadata,
    };
  }

  //----------------------------------------------------------------------------
  // Single Object Upload
  //----------------------------------------------------------------------------

  async uploadObject(
    bucket: string,
    key: string,
    body: Blob | Buffer | ReadableStream,
    options: {
      contentType?: string;
      storageClass?: StorageClass;
      encryption?: EncryptionConfig;
      metadata?: Record<string, string>;
      onProgress?: (loaded: number, total: number) => void;
    } = {}
  ): Promise<string> {
    const client = this.getClient();

    const uploadParams: any = {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: options.contentType || 'application/octet-stream',
      StorageClass: options.storageClass || 'STANDARD',
      Metadata: options.metadata,
    };

    // Encryption
    if (options.encryption?.type === 'SSE-S3') {
      uploadParams.ServerSideEncryption = 'AES256';
    } else if (options.encryption?.type === 'SSE-KMS') {
      uploadParams.ServerSideEncryption = 'aws:kms';
      if (options.encryption.kmsKeyId) {
        uploadParams.SSEKMSKeyId = options.encryption.kmsKeyId;
      }
    }

    const response = await client.send(new PutObjectCommand(uploadParams));
    return response.ETag?.replace(/"/g, '') || '';
  }

  //----------------------------------------------------------------------------
  // Multipart Upload
  //----------------------------------------------------------------------------

  async createMultipartUpload(
    bucket: string,
    key: string,
    options: {
      contentType?: string;
      storageClass?: StorageClass;
      encryption?: EncryptionConfig;
      metadata?: Record<string, string>;
    } = {}
  ): Promise<MultipartUploadResponse> {
    const client = this.getClient();

    const params: any = {
      Bucket: bucket,
      Key: key,
      ContentType: options.contentType || 'application/octet-stream',
      StorageClass: options.storageClass || 'STANDARD',
      Metadata: options.metadata,
    };

    // Encryption
    if (options.encryption?.type === 'SSE-S3') {
      params.ServerSideEncryption = 'AES256';
    } else if (options.encryption?.type === 'SSE-KMS') {
      params.ServerSideEncryption = 'aws:kms';
      if (options.encryption.kmsKeyId) {
        params.SSEKMSKeyId = options.encryption.kmsKeyId;
      }
    }

    const response = await client.send(new CreateMultipartUploadCommand(params));

    return {
      uploadId: response.UploadId || '',
      bucket,
      key,
    };
  }

  async uploadPart(
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
    body: Blob | Buffer,
    onProgress?: (loaded: number) => void
  ): Promise<UploadPartResponse> {
    const client = this.getClient();

    const response = await client.send(
      new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: body,
      })
    );

    return {
      etag: response.ETag?.replace(/"/g, '') || '',
      partNumber,
    };
  }

  async completeMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: UploadPartResponse[]
  ): Promise<CompleteMultipartResponse> {
    const client = this.getClient();

    const response = await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((p) => ({
            ETag: p.etag,
            PartNumber: p.partNumber,
          })),
        },
      })
    );

    return {
      location: response.Location || '',
      bucket: response.Bucket || bucket,
      key: response.Key || key,
      etag: response.ETag?.replace(/"/g, '') || '',
    };
  }

  async abortMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string
  ): Promise<void> {
    const client = this.getClient();

    await client.send(
      new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
      })
    );
  }

  //----------------------------------------------------------------------------
  // Managed Upload (with built-in multipart handling)
  //----------------------------------------------------------------------------

  async managedUpload(
    bucket: string,
    key: string,
    body: Blob | Buffer | ReadableStream,
    options: {
      contentType?: string;
      storageClass?: StorageClass;
      encryption?: EncryptionConfig;
      metadata?: Record<string, string>;
      partSize?: number;
      queueSize?: number;
      onProgress?: (loaded: number, total: number) => void;
      abortSignal?: AbortSignal;
    } = {}
  ): Promise<CompleteMultipartResponse> {
    const client = this.getClient();

    const uploadParams: any = {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: options.contentType || 'application/octet-stream',
      StorageClass: options.storageClass || 'STANDARD',
      Metadata: options.metadata,
    };

    // Encryption
    if (options.encryption?.type === 'SSE-S3') {
      uploadParams.ServerSideEncryption = 'AES256';
    } else if (options.encryption?.type === 'SSE-KMS') {
      uploadParams.ServerSideEncryption = 'aws:kms';
      if (options.encryption.kmsKeyId) {
        uploadParams.SSEKMSKeyId = options.encryption.kmsKeyId;
      }
    }

    const upload = new Upload({
      client,
      params: uploadParams,
      partSize: options.partSize || DEFAULT_PART_SIZE,
      queueSize: options.queueSize || 4,
      leavePartsOnError: false,
    });

    if (options.abortSignal) {
      options.abortSignal.addEventListener('abort', () => {
        upload.abort();
      });
    }

    upload.on('httpUploadProgress', (progress) => {
      if (options.onProgress && progress.loaded && progress.total) {
        options.onProgress(progress.loaded, progress.total);
      }
    });

    const result = await upload.done();

    return {
      location: result.Location || '',
      bucket: result.Bucket || bucket,
      key: result.Key || key,
      etag: result.ETag?.replace(/"/g, '') || '',
    };
  }

  //----------------------------------------------------------------------------
  // Download Operations
  //----------------------------------------------------------------------------

  async downloadObject(
    bucket: string,
    key: string
  ): Promise<{
    body: ReadableStream;
    contentLength: number;
    contentType: string;
    etag: string;
    metadata?: Record<string, string>;
  }> {
    const client = this.getClient();

    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );

    return {
      body: response.Body as ReadableStream,
      contentLength: response.ContentLength || 0,
      contentType: response.ContentType || 'application/octet-stream',
      etag: response.ETag?.replace(/"/g, '') || '',
      metadata: response.Metadata,
    };
  }

  async getPresignedDownloadUrl(
    bucket: string,
    key: string,
    expiresIn: number = 3600
  ): Promise<string> {
    const client = this.getClient();

    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
      { expiresIn }
    );

    return url;
  }

  async getPresignedUploadUrl(
    bucket: string,
    key: string,
    options: {
      contentType?: string;
      expiresIn?: number;
    } = {}
  ): Promise<string> {
    const client = this.getClient();

    const url = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: options.contentType,
      }),
      { expiresIn: options.expiresIn || 3600 }
    );

    return url;
  }

  //----------------------------------------------------------------------------
  // Delete Operations
  //----------------------------------------------------------------------------

  async deleteObject(bucket: string, key: string): Promise<void> {
    const client = this.getClient();

    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
  }

  async deleteObjects(bucket: string, keys: string[]): Promise<string[]> {
    const client = this.getClient();
    const deletedKeys: string[] = [];

    // Delete in batches of 1000 (S3 limit)
    const batchSize = 1000;
    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);

      const response = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: batch.map((key) => ({ Key: key })),
            Quiet: false,
          },
        })
      );

      if (response.Deleted) {
        deletedKeys.push(...response.Deleted.map((d) => d.Key || ''));
      }
    }

    return deletedKeys;
  }

  async deletePrefix(bucket: string, prefix: string): Promise<number> {
    let totalDeleted = 0;
    let continuationToken: string | undefined;

    do {
      const listResponse = await this.listObjects(
        bucket,
        prefix,
        continuationToken,
        1000
      );

      if (listResponse.objects.length > 0) {
        const keys = listResponse.objects.map((obj) => obj.key);
        await this.deleteObjects(bucket, keys);
        totalDeleted += keys.length;
      }

      continuationToken = listResponse.continuationToken;
    } while (continuationToken);

    return totalDeleted;
  }

  //----------------------------------------------------------------------------
  // Copy Operations
  //----------------------------------------------------------------------------

  async copyObject(
    sourceBucket: string,
    sourceKey: string,
    destinationBucket: string,
    destinationKey: string,
    options: {
      storageClass?: StorageClass;
      encryption?: EncryptionConfig;
      metadata?: Record<string, string>;
      metadataDirective?: 'COPY' | 'REPLACE';
    } = {}
  ): Promise<string> {
    const client = this.getClient();

    const params: any = {
      Bucket: destinationBucket,
      Key: destinationKey,
      CopySource: `${sourceBucket}/${sourceKey}`,
      StorageClass: options.storageClass,
      MetadataDirective: options.metadataDirective || 'COPY',
    };

    if (options.metadata && options.metadataDirective === 'REPLACE') {
      params.Metadata = options.metadata;
    }

    // Encryption
    if (options.encryption?.type === 'SSE-S3') {
      params.ServerSideEncryption = 'AES256';
    } else if (options.encryption?.type === 'SSE-KMS') {
      params.ServerSideEncryption = 'aws:kms';
      if (options.encryption.kmsKeyId) {
        params.SSEKMSKeyId = options.encryption.kmsKeyId;
      }
    }

    const response = await client.send(new CopyObjectCommand(params));
    return response.CopyObjectResult?.ETag?.replace(/"/g, '') || '';
  }

  //----------------------------------------------------------------------------
  // Utility Functions
  //----------------------------------------------------------------------------

  calculatePartSize(fileSize: number, preferredPartSize?: number): number {
    const partSize = preferredPartSize || DEFAULT_PART_SIZE;

    // Ensure we don't exceed max parts
    const minPartSize = Math.ceil(fileSize / MAX_PARTS);
    const effectivePartSize = Math.max(partSize, minPartSize);

    // Round up to nearest MB for cleaner sizes
    return Math.ceil(effectivePartSize / (1024 * 1024)) * 1024 * 1024;
  }

  calculateTotalParts(fileSize: number, partSize: number): number {
    return Math.ceil(fileSize / partSize);
  }

  shouldUseMultipart(fileSize: number, threshold?: number): boolean {
    return fileSize >= (threshold || DEFAULT_MULTIPART_THRESHOLD);
  }

  formatKey(prefix: string, filename: string): string {
    const cleanPrefix = prefix.endsWith('/') ? prefix : prefix ? `${prefix}/` : '';
    return `${cleanPrefix}${filename}`;
  }

  extractFilename(key: string): string {
    return key.split('/').pop() || key;
  }

  extractPrefix(key: string): string {
    const parts = key.split('/');
    parts.pop();
    return parts.join('/');
  }
}

// Singleton instance
export const s3Service = new S3Service();