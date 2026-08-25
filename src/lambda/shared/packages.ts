/**
 * Shared contract for bootstrap packages.
 *
 * Four services read and write these records — bootstrap-config-service
 * (catalog CRUD), package-upload-service (artifact lifecycle),
 * package-analyzer (parameter generation) and group-package-service
 * (enqueue) — so the status machine, S3 key layout and install-command
 * allowlist live here rather than being re-implemented (and drifting) in
 * each one.
 */

/** Where the installer bytes come from. */
export type PackageSource = 'url' | 's3';

/**
 * Lifecycle of an uploaded package.
 *
 *   uploading ──► analyzing ──► needs_review ──► approved
 *       │              │              │      └─► rejected
 *       │              └─► analysis_failed ─────┘
 *       └─► (aborted: row deleted)
 *
 * Pre-existing URL-based packages have no status field at all; treat a
 * missing status as `approved` so the catalog keeps working untouched.
 */
export type PackageStatus =
  | 'uploading'
  | 'analyzing'
  | 'needs_review'
  | 'analysis_failed'
  | 'approved'
  | 'rejected';

export type InstallerType =
  | 'msi'
  | 'inno'
  | 'nsis'
  | 'installshield'
  | 'wix-burn'
  | 'msix'
  | 'sfx-7z'
  | 'squirrel'
  | 'zip'
  | 'unknown';

export type AnalysisConfidence = 'high' | 'medium' | 'low';

export interface PackageAnalysis {
  installerType: InstallerType;
  confidence: AnalysisConfidence;
  architecture?: 'x64' | 'x86' | 'arm64';
  detectedProductName?: string;
  detectedVersion?: string;
  detectedVendor?: string;
  /** Inner installer path, when the uploaded artifact is an archive. */
  archiveEntry?: string;
  /** Which recipe produced the suggestion (installer type id or vendor rule id). */
  recipeId?: string;
  suggestedInstallCommand: string;
  suggestedInstallArgs: string;
  warnings: string[];
  analyzedAt: string;
}

/** Result of a trial install on a real workstation. */
export interface PackageVerification {
  workstationId: string;
  /**
   * Partition key of the queue row this run wrote, stored verbatim so readers
   * do not have to reconstruct an instance ARN from region and account.
   */
  queuePartitionKey?: string;
  status: 'running' | 'passed' | 'failed';
  queuedAt: string;
  completedAt?: string;
  exitCodeMessage?: string;
  installCommand: string;
  installArgs: string;
}

export interface BootstrapPackage {
  packageId: string;
  name: string;
  description: string;
  type: 'driver' | 'application';
  category: 'graphics' | 'utility' | 'productivity' | 'media' | 'development';
  downloadUrl: string;
  installCommand: string;
  installArgs?: string;
  expectedSha256?: string;
  requiresGpu?: boolean;
  supportedGpuFamilies?: string[];
  osVersions: string[];
  isRequired: boolean;
  isEnabled: boolean;
  order: number;
  estimatedInstallTimeMinutes: number;
  metadata?: {
    version?: string;
    vendor?: string;
    size?: string;
    notes?: string;
  };

  // --- Upload support (absent on pre-existing URL packages) ---
  source?: PackageSource;
  s3Bucket?: string;
  s3Key?: string;
  fileName?: string;
  fileSizeBytes?: number;
  status?: PackageStatus;
  uploadId?: string;
  uploadedBy?: string;
  uploadedAt?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  analysis?: PackageAnalysis;
  verification?: PackageVerification;

  /**
   * Version lineage. A new upload that replaces an older package points at it
   * here; the older package is marked superseded and disabled on approval, and
   * its group bindings are migrated forward. Without this a version bump is an
   * unrelated catalog entry and every group binding silently keeps installing
   * the old release.
   */
  supersedesPackageId?: string;
  supersededByPackageId?: string;

  createdAt: string;
  updatedAt: string;
}

/**
 * A package with no `status` predates the upload feature and is a plain
 * URL entry the admin already curated — treat it as approved.
 */
export function effectiveStatus(pkg: Partial<BootstrapPackage>): PackageStatus {
  return (pkg.status as PackageStatus) || 'approved';
}

/** Only approved packages may be enabled, queued, or installed. */
export function isInstallable(pkg: Partial<BootstrapPackage>): boolean {
  return effectiveStatus(pkg) === 'approved';
}

/**
 * Partition key for a workstation's package queue.
 *
 * Keyed by the instance ARN rather than the bare instance id so the workstation
 * instance role can be scoped with a `dynamodb:LeadingKeys` condition of
 * `workstation#${ec2:SourceInstanceARN}` — the only IAM condition key that
 * identifies the calling instance. With a bare instance id there is no
 * expressible condition, and an earlier attempt to write one silently denied
 * every request instead.
 */
export function queuePartitionKey(instanceArn: string): string {
  return `workstation#${instanceArn}`;
}

/** Build the instance ARN the queue is partitioned by. */
export function instanceArn(region: string, accountId: string, instanceId: string): string {
  return `arn:aws:ec2:${region}:${accountId}:instance/${instanceId}`;
}

/**
 * Accept either key shape when reading.
 *
 * Queue rows written before the ARN re-keying use the bare instance id, and
 * they live for up to 30 days under the table's TTL, so reads have to look in
 * both partitions until those age out.
 */
export function legacyQueuePartitionKey(instanceId: string): string {
  return `workstation#${instanceId}`;
}

export const QUARANTINE_PREFIX = 'quarantine/';
export const APPROVED_PREFIX = 'packages/';
/**
 * Staging area for admin-initiated trial installs. Readable by the workstation
 * instance role (unlike `quarantine/`) so a package can be proved out before it
 * is published; objects here expire after 2 days.
 */
export const VERIFY_PREFIX = 'verify/';

/**
 * Strip everything that could escape the intended prefix or confuse Windows
 * once the file lands in a temp directory. Path separators, traversal, control
 * characters and leading dots all go; the extension is preserved because the
 * analyzer and the installer both key off it.
 */
export function sanitizeFileName(raw: string): string {
  const base = String(raw || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop() as string;
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^A-Za-z0-9._ +()-]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180);
  return cleaned || 'installer.bin';
}

export function quarantineKey(packageId: string, fileName: string): string {
  return `${QUARANTINE_PREFIX}${packageId}/${sanitizeFileName(fileName)}`;
}

export function approvedKey(packageId: string, fileName: string): string {
  return `${APPROVED_PREFIX}${packageId}/${sanitizeFileName(fileName)}`;
}

export function verifyKey(packageId: string, fileName: string): string {
  return `${VERIFY_PREFIX}${packageId}/${sanitizeFileName(fileName)}`;
}

/**
 * Executables an install command is allowed to name.
 *
 * `installCommand` becomes `ProcessStartInfo.FileName` on the workstation and
 * runs as SYSTEM, so it is not a free-text field. `{installer}` means "the
 * downloaded artifact itself", which the Windows service substitutes.
 * Arguments stay free-text — an approving admin needs to be able to pass
 * whatever silent-install flags the vendor requires.
 */
export const ALLOWED_INSTALL_COMMANDS = [
  '{installer}',
  'msiexec.exe',
  'powershell.exe',
  'cmd.exe',
] as const;

export function isAllowedInstallCommand(command: string): boolean {
  const normalized = String(command || '').trim().toLowerCase();
  return (ALLOWED_INSTALL_COMMANDS as readonly string[]).some(
    (allowed) => allowed.toLowerCase() === normalized
  );
}

/** Hex SHA-256, case-insensitive. */
export function isValidSha256(hash: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(String(hash || '').trim());
}

/**
 * Confidence levels at which a trial install is required before publishing.
 *
 * A framework fingerprint tells you which installer built the artifact; it does
 * not tell you whether this particular vendor build honours that framework's
 * silent switches. Only running it does. `high` confidence comes from
 * structural facts (an MSI compound file, a `.wixburn` section) where the
 * command line is defined by the format itself.
 */
export function requiresVerification(pkg: Partial<BootstrapPackage>): boolean {
  if (pkg.source !== 's3') return false;
  const confidence = pkg.analysis?.confidence;
  // No analysis at all means the parameters were hand-written — prove them.
  if (!confidence) return true;
  return confidence !== 'high';
}

/** Whether a trial install has actually passed on a real workstation. */
export function hasPassedVerification(pkg: Partial<BootstrapPackage>): boolean {
  return pkg.verification?.status === 'passed';
}
