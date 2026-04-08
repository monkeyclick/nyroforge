//------------------------------------------------------------------------------
// S3 File Transfer - Type Definitions
//------------------------------------------------------------------------------

// AWS Credential Types
export type CredentialType = 'accessKey' | 'iamRole' | 'sso' | 'profile';

export interface AWSCredentials {
  type: CredentialType;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  region: string;
  profileName?: string;
  ssoStartUrl?: string;
  ssoRegion?: string;
  ssoAccountId?: string;
  ssoRoleName?: string;
}

export interface CredentialProfile {
  id: string;
  name: string;
  credentials: AWSCredentials;
  isDefault: boolean;
  createdAt: Date;
  lastUsed?: Date;
}

// S3 Object Types
export interface S3Bucket {
  name: string;
  creationDate?: Date;
  region?: string;
}

export interface S3Object {
  key: string;
  size: number;
  lastModified: Date;
  etag?: string;
  storageClass?: StorageClass;
  isFolder: boolean;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface S3ObjectWithPath extends S3Object {
  bucket: string;
  fullPath: string;
}

export type StorageClass = 
  | 'STANDARD'
  | 'REDUCED_REDUNDANCY'
  | 'STANDARD_IA'
  | 'ONEZONE_IA'
  | 'INTELLIGENT_TIERING'
  | 'GLACIER'
  | 'DEEP_ARCHIVE'
  | 'GLACIER_IR';

export type EncryptionType = 'none' | 'SSE-S3' | 'SSE-KMS';

export interface EncryptionConfig {
  type: EncryptionType;
  kmsKeyId?: string;
}

// Local File Types
export interface LocalFile {
  name: string;
  path: string;
  size: number;
  type: string;
  lastModified: Date;
  isDirectory: boolean;
  file?: File; // Browser File object
}

export interface LocalFolder {
  name: string;
  path: string;
  children: (LocalFile | LocalFolder)[];
}

// Transfer Types
export type TransferDirection = 'upload' | 'download';
export type TransferStatus = 
  | 'pending'
  | 'queued'
  | 'preparing'
  | 'transferring'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TransferProgress {
  loaded: number;
  total: number;
  percentage: number;
  speed: number; // bytes per second
  remainingTime: number; // seconds
  startTime: Date;
  elapsedTime: number; // seconds
}

export interface TransferItem {
  id: string;
  direction: TransferDirection;
  status: TransferStatus;
  
  // Source
  sourcePath: string;
  sourceName: string;
  sourceSize: number;
  
  // Destination
  destinationBucket?: string;
  destinationKey?: string;
  destinationPath?: string;
  
  // Progress
  progress: TransferProgress;
  bytesTransferred: number;
  
  // Multipart upload
  isMultipart: boolean;
  uploadId?: string;
  partNumber?: number;
  totalParts?: number;
  completedParts?: number;
  
  // Options
  storageClass: StorageClass;
  encryption: EncryptionConfig;
  metadata?: Record<string, string>;
  contentType?: string;
  
  // Checksums
  localChecksum?: string;
  remoteChecksum?: string;
  checksumVerified?: boolean;
  
  // Error handling
  error?: TransferError;
  retryCount: number;
  maxRetries: number;
  
  // Timestamps
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  pausedAt?: Date;
}

export interface TransferError {
  code: string;
  message: string;
  details?: string;
  retryable: boolean;
}

export interface TransferBatch {
  id: string;
  name: string;
  items: TransferItem[];
  status: TransferStatus;
  totalSize: number;
  transferredSize: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

// Transfer Options
export interface UploadOptions {
  bucket: string;
  keyPrefix: string;
  storageClass: StorageClass;
  encryption: EncryptionConfig;
  metadata?: Record<string, string>;
  preserveTimestamps: boolean;
  checksumAlgorithm: 'MD5' | 'SHA256';
  multipartThreshold: number; // bytes
  partSize: number; // bytes
  maxConcurrentParts: number;
  conflictResolution: ConflictResolution;
}

export interface DownloadOptions {
  destinationPath: string;
  preserveStructure: boolean;
  preserveTimestamps: boolean;
  checksumVerification: boolean;
  conflictResolution: ConflictResolution;
  maxConcurrentDownloads: number;
}

export type ConflictResolution = 'overwrite' | 'skip' | 'rename' | 'ask';

// Queue Management
export interface QueueSettings {
  maxConcurrentTransfers: number;
  maxConcurrentUploads: number;
  maxConcurrentDownloads: number;
  autoRetry: boolean;
  maxRetries: number;
  retryDelayMs: number;
  pauseOnError: boolean;
}

// Transfer History
export interface TransferHistoryEntry {
  id: string;
  direction: TransferDirection;
  sourcePath: string;
  destinationPath: string;
  size: number;
  status: 'completed' | 'failed' | 'cancelled';
  error?: TransferError;
  duration: number; // ms
  averageSpeed: number; // bytes/s
  timestamp: Date;
  bucket: string;
  checksumVerified: boolean;
}

// Notifications
export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  action?: {
    label: string;
    onClick: () => void;
  };
}

// Settings
export interface AppSettings {
  credentials: CredentialProfile[];
  activeProfileId?: string;
  defaultBucket?: string;
  defaultStorageClass: StorageClass;
  defaultEncryption: EncryptionConfig;
  queue: QueueSettings;
  upload: {
    multipartThreshold: number;
    partSize: number;
    maxConcurrentParts: number;
  };
  download: {
    defaultPath: string;
    maxConcurrentDownloads: number;
  };
  checksum: {
    enabled: boolean;
    algorithm: 'MD5' | 'SHA256';
  };
  notifications: {
    enabled: boolean;
    onComplete: boolean;
    onError: boolean;
  };
  theme: 'light' | 'dark' | 'system';
}

// Browser State
export interface S3BrowserState {
  currentBucket?: string;
  currentPrefix: string;
  objects: S3Object[];
  loading: boolean;
  error?: string;
  selectedObjects: string[];
  searchQuery: string;
  sortBy: 'name' | 'size' | 'lastModified';
  sortOrder: 'asc' | 'desc';
}

export interface LocalBrowserState {
  currentPath: string;
  items: LocalFile[];
  loading: boolean;
  error?: string;
  selectedItems: string[];
  searchQuery: string;
  sortBy: 'name' | 'size' | 'lastModified';
  sortOrder: 'asc' | 'desc';
}

// API Response Types
export interface ListObjectsResponse {
  objects: S3Object[];
  prefixes: string[];
  continuationToken?: string;
  isTruncated: boolean;
}

export interface MultipartUploadResponse {
  uploadId: string;
  bucket: string;
  key: string;
}

export interface UploadPartResponse {
  etag: string;
  partNumber: number;
}

export interface CompleteMultipartResponse {
  location: string;
  bucket: string;
  key: string;
  etag: string;
}