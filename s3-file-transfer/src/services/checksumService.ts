//------------------------------------------------------------------------------
// Checksum Service - File Integrity Verification
//------------------------------------------------------------------------------

import SparkMD5 from 'spark-md5';

export type ChecksumAlgorithm = 'MD5' | 'SHA256';

export interface ChecksumResult {
  algorithm: ChecksumAlgorithm;
  hash: string;
  base64?: string;
}

export interface ChecksumProgress {
  bytesProcessed: number;
  totalBytes: number;
  percentage: number;
}

const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks for processing

export class ChecksumService {
  //----------------------------------------------------------------------------
  // MD5 Checksum
  //----------------------------------------------------------------------------

  async calculateMD5(
    file: File | Blob,
    onProgress?: (progress: ChecksumProgress) => void
  ): Promise<ChecksumResult> {
    return new Promise((resolve, reject) => {
      const spark = new SparkMD5.ArrayBuffer();
      const fileReader = new FileReader();
      const totalSize = file.size;
      let currentChunk = 0;
      let bytesProcessed = 0;
      const chunks = Math.ceil(totalSize / CHUNK_SIZE);

      const loadNext = () => {
        const start = currentChunk * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, totalSize);
        fileReader.readAsArrayBuffer(file.slice(start, end));
      };

      fileReader.onload = (e) => {
        if (e.target?.result) {
          spark.append(e.target.result as ArrayBuffer);
          bytesProcessed += (e.target.result as ArrayBuffer).byteLength;

          if (onProgress) {
            onProgress({
              bytesProcessed,
              totalBytes: totalSize,
              percentage: Math.round((bytesProcessed / totalSize) * 100),
            });
          }
        }

        currentChunk++;

        if (currentChunk < chunks) {
          loadNext();
        } else {
          const hash = spark.end();
          resolve({
            algorithm: 'MD5',
            hash,
            base64: this.hexToBase64(hash),
          });
        }
      };

      fileReader.onerror = () => {
        reject(new Error('Failed to read file for checksum calculation'));
      };

      loadNext();
    });
  }

  //----------------------------------------------------------------------------
  // SHA256 Checksum (using Web Crypto API)
  //----------------------------------------------------------------------------

  async calculateSHA256(
    file: File | Blob,
    onProgress?: (progress: ChecksumProgress) => void
  ): Promise<ChecksumResult> {
    const totalSize = file.size;
    let bytesProcessed = 0;

    // For smaller files, process all at once
    if (totalSize < 100 * 1024 * 1024) {
      const arrayBuffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      const hash = this.arrayBufferToHex(hashBuffer);

      if (onProgress) {
        onProgress({
          bytesProcessed: totalSize,
          totalBytes: totalSize,
          percentage: 100,
        });
      }

      return {
        algorithm: 'SHA256',
        hash,
        base64: this.arrayBufferToBase64(hashBuffer),
      };
    }

    // For larger files, process in chunks
    // Note: Web Crypto doesn't support streaming, so we need to accumulate
    // For very large files, consider using a worker or wasm implementation
    const chunks: ArrayBuffer[] = [];
    const chunkCount = Math.ceil(totalSize / CHUNK_SIZE);

    for (let i = 0; i < chunkCount; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalSize);
      const chunk = await file.slice(start, end).arrayBuffer();
      chunks.push(chunk);
      bytesProcessed += chunk.byteLength;

      if (onProgress) {
        onProgress({
          bytesProcessed,
          totalBytes: totalSize,
          percentage: Math.round((bytesProcessed / totalSize) * 100),
        });
      }
    }

    // Concatenate all chunks
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }

    const hashBuffer = await crypto.subtle.digest('SHA-256', combined.buffer);
    const hash = this.arrayBufferToHex(hashBuffer);

    return {
      algorithm: 'SHA256',
      hash,
      base64: this.arrayBufferToBase64(hashBuffer),
    };
  }

  //----------------------------------------------------------------------------
  // Calculate Checksum (Generic)
  //----------------------------------------------------------------------------

  async calculateChecksum(
    file: File | Blob,
    algorithm: ChecksumAlgorithm = 'MD5',
    onProgress?: (progress: ChecksumProgress) => void
  ): Promise<ChecksumResult> {
    if (algorithm === 'SHA256') {
      return this.calculateSHA256(file, onProgress);
    }
    return this.calculateMD5(file, onProgress);
  }

  //----------------------------------------------------------------------------
  // Verification
  //----------------------------------------------------------------------------

  async verifyChecksum(
    file: File | Blob,
    expectedHash: string,
    algorithm: ChecksumAlgorithm = 'MD5'
  ): Promise<boolean> {
    const result = await this.calculateChecksum(file, algorithm);
    return this.compareHashes(result.hash, expectedHash);
  }

  compareHashes(hash1: string, hash2: string): boolean {
    // Normalize hashes (remove quotes, convert to lowercase)
    const normalize = (h: string) => h.replace(/"/g, '').toLowerCase();
    return normalize(hash1) === normalize(hash2);
  }

  //----------------------------------------------------------------------------
  // ETag Comparison (S3 uses ETag which may be MD5 or multipart signature)
  //----------------------------------------------------------------------------

  isMultipartEtag(etag: string): boolean {
    // Multipart ETags contain a dash followed by the part count
    return etag.includes('-');
  }

  parseMultipartEtag(etag: string): { hash: string; partCount: number } | null {
    const match = etag.match(/^([a-f0-9]+)-(\d+)$/i);
    if (match) {
      return {
        hash: match[1],
        partCount: parseInt(match[2], 10),
      };
    }
    return null;
  }

  //----------------------------------------------------------------------------
  // Multipart Checksum Calculation (for S3 multipart uploads)
  //----------------------------------------------------------------------------

  async calculateMultipartMD5(
    file: File | Blob,
    partSize: number,
    onProgress?: (progress: ChecksumProgress) => void
  ): Promise<ChecksumResult> {
    const totalSize = file.size;
    const partCount = Math.ceil(totalSize / partSize);
    const partMD5s: string[] = [];
    let bytesProcessed = 0;

    for (let i = 0; i < partCount; i++) {
      const start = i * partSize;
      const end = Math.min(start + partSize, totalSize);
      const partBlob = file.slice(start, end);
      
      const partChecksum = await this.calculateMD5(partBlob);
      partMD5s.push(partChecksum.hash);
      
      bytesProcessed = end;
      
      if (onProgress) {
        onProgress({
          bytesProcessed,
          totalBytes: totalSize,
          percentage: Math.round((bytesProcessed / totalSize) * 100),
        });
      }
    }

    // Calculate the MD5 of all part MD5s concatenated
    const concatenatedMD5s = partMD5s.map(h => this.hexToArrayBuffer(h));
    const totalLength = concatenatedMD5s.reduce((acc, buf) => acc + buf.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of concatenatedMD5s) {
      combined.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }

    const spark = new SparkMD5.ArrayBuffer();
    spark.append(combined.buffer);
    const finalHash = spark.end();

    return {
      algorithm: 'MD5',
      hash: `${finalHash}-${partCount}`,
    };
  }

  //----------------------------------------------------------------------------
  // Utility Functions
  //----------------------------------------------------------------------------

  private arrayBufferToHex(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private hexToBase64(hex: string): string {
    const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private hexToArrayBuffer(hex: string): ArrayBuffer {
    const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    return bytes.buffer;
  }

  base64ToHex(base64: string): string {
    const binary = atob(base64);
    let hex = '';
    for (let i = 0; i < binary.length; i++) {
      hex += binary.charCodeAt(i).toString(16).padStart(2, '0');
    }
    return hex;
  }

  //----------------------------------------------------------------------------
  // Content Type Detection
  //----------------------------------------------------------------------------

  detectContentType(filename: string): string {
    const extension = filename.split('.').pop()?.toLowerCase();
    
    const mimeTypes: Record<string, string> = {
      // Documents
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'ppt': 'application/vnd.ms-powerpoint',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'txt': 'text/plain',
      'csv': 'text/csv',
      'json': 'application/json',
      'xml': 'application/xml',
      
      // Images
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'svg': 'image/svg+xml',
      'ico': 'image/x-icon',
      'bmp': 'image/bmp',
      'tiff': 'image/tiff',
      'tif': 'image/tiff',
      
      // Audio
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'ogg': 'audio/ogg',
      'flac': 'audio/flac',
      'm4a': 'audio/mp4',
      
      // Video
      'mp4': 'video/mp4',
      'webm': 'video/webm',
      'avi': 'video/x-msvideo',
      'mov': 'video/quicktime',
      'mkv': 'video/x-matroska',
      
      // Archives
      'zip': 'application/zip',
      'tar': 'application/x-tar',
      'gz': 'application/gzip',
      'rar': 'application/vnd.rar',
      '7z': 'application/x-7z-compressed',
      
      // Code
      'html': 'text/html',
      'css': 'text/css',
      'js': 'application/javascript',
      'ts': 'application/typescript',
      'py': 'text/x-python',
      'java': 'text/x-java-source',
      'go': 'text/x-go',
      'rs': 'text/x-rust',
      'c': 'text/x-c',
      'cpp': 'text/x-c++',
      'h': 'text/x-c',
      'hpp': 'text/x-c++',
      
      // Other
      'wasm': 'application/wasm',
      'ttf': 'font/ttf',
      'woff': 'font/woff',
      'woff2': 'font/woff2',
      'eot': 'application/vnd.ms-fontobject',
    };

    return mimeTypes[extension || ''] || 'application/octet-stream';
  }
}

// Singleton instance
export const checksumService = new ChecksumService();