//------------------------------------------------------------------------------
// Utility Functions - Formatters
//------------------------------------------------------------------------------

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Format bytes per second to human-readable speed
 */
export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return '0 B/s';

  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];

  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
  const speed = bytesPerSecond / Math.pow(k, i);

  return speed.toFixed(2) + ' ' + sizes[Math.min(i, sizes.length - 1)];
}

/**
 * Format seconds to human-readable duration
 */
export function formatDuration(seconds: number): string {
  if (seconds < 0) return '--:--';
  if (!isFinite(seconds)) return '--:--';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format date to locale string
 */
export function formatDate(date: Date | string, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };

  return d.toLocaleDateString(undefined, options || defaultOptions);
}

/**
 * Format relative time (e.g., "2 minutes ago")
 */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) {
    return 'just now';
  } else if (diffMin < 60) {
    return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  } else if (diffHour < 24) {
    return `${diffHour} hour${diffHour !== 1 ? 's' : ''} ago`;
  } else if (diffDay < 7) {
    return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
  } else {
    return formatDate(d, { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

/**
 * Format percentage
 */
export function formatPercentage(value: number, decimals: number = 0): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Truncate path in the middle
 */
export function truncatePath(path: string, maxLength: number): string {
  if (path.length <= maxLength) return path;

  const parts = path.split('/');
  if (parts.length <= 2) {
    return truncate(path, maxLength);
  }

  const first = parts[0];
  const last = parts[parts.length - 1];
  const middle = '...';

  if (first.length + last.length + middle.length + 2 > maxLength) {
    return truncate(path, maxLength);
  }

  return `${first}/${middle}/${last}`;
}

/**
 * Get file extension
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filename.substring(lastDot + 1).toLowerCase();
}

/**
 * Get file name without extension
 */
export function getFileNameWithoutExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return filename;
  return filename.substring(0, lastDot);
}

/**
 * Generate unique filename for conflict resolution
 */
export function generateUniqueFilename(filename: string, suffix: string = '_copy'): string {
  const ext = getFileExtension(filename);
  const name = getFileNameWithoutExtension(filename);
  
  if (ext) {
    return `${name}${suffix}.${ext}`;
  }
  return `${filename}${suffix}`;
}

/**
 * Generate numbered filename for conflict resolution
 */
export function generateNumberedFilename(filename: string, number: number): string {
  const ext = getFileExtension(filename);
  const name = getFileNameWithoutExtension(filename);
  
  if (ext) {
    return `${name} (${number}).${ext}`;
  }
  return `${filename} (${number})`;
}

/**
 * Clean S3 key (remove leading/trailing slashes, double slashes)
 */
export function cleanS3Key(key: string): string {
  return key
    .replace(/\/+/g, '/') // Replace multiple slashes with single
    .replace(/^\//, '') // Remove leading slash
    .replace(/\/$/, ''); // Remove trailing slash
}

/**
 * Join S3 key parts
 */
export function joinS3Key(...parts: string[]): string {
  return cleanS3Key(parts.filter(Boolean).join('/'));
}

/**
 * Get parent prefix from key
 */
export function getParentPrefix(key: string): string {
  const cleaned = cleanS3Key(key);
  const lastSlash = cleaned.lastIndexOf('/');
  if (lastSlash === -1) return '';
  return cleaned.substring(0, lastSlash + 1);
}

/**
 * Check if key is a folder (ends with /)
 */
export function isFolder(key: string): boolean {
  return key.endsWith('/');
}

/**
 * Get storage class display name
 */
export function getStorageClassDisplayName(storageClass: string): string {
  const names: Record<string, string> = {
    STANDARD: 'Standard',
    REDUCED_REDUNDANCY: 'Reduced Redundancy',
    STANDARD_IA: 'Standard-IA',
    ONEZONE_IA: 'One Zone-IA',
    INTELLIGENT_TIERING: 'Intelligent-Tiering',
    GLACIER: 'Glacier Flexible Retrieval',
    DEEP_ARCHIVE: 'Glacier Deep Archive',
    GLACIER_IR: 'Glacier Instant Retrieval',
  };
  return names[storageClass] || storageClass;
}

/**
 * Parse S3 URI
 */
export function parseS3Uri(uri: string): { bucket: string; key: string } | null {
  const match = uri.match(/^s3:\/\/([^/]+)\/(.*)$/);
  if (!match) return null;
  return {
    bucket: match[1],
    key: match[2],
  };
}

/**
 * Build S3 URI
 */
export function buildS3Uri(bucket: string, key: string): string {
  return `s3://${bucket}/${key}`;
}