/**
 * Minimal ZIP central-directory reader with prefix extraction.
 *
 * This exists because the headline case — DaVinci Resolve — ships as a ZIP
 * wrapping the real installer, so identifying the archive alone tells you
 * nothing useful. The inner entry has to be found and fingerprinted.
 *
 * Only a *prefix* of the inner entry is ever inflated. Installer framework
 * markers and the PE header all live near the front of the file, and a full
 * extraction of a multi-GB entry would need both the archive and its expansion
 * resident on Lambda's ephemeral disk at once.
 */

import { createInflateRaw } from 'zlib';
import { promises as fs } from 'fs';
import type { FileHandle } from 'fs/promises';

export interface ZipEntry {
  fileName: string;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  compressionMethod: number;
  isDirectory: boolean;
}

const EOCD_SIGNATURE = 0x06054b50;
const EOCD64_SIGNATURE = 0x06064b50;
const EOCD64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** The comment field is up to 64 KB, so the EOCD sits within the last ~64 KB. */
const EOCD_SEARCH_WINDOW = 66 * 1024;

export function looksLikeZip(head: Buffer): boolean {
  return head.length >= 4 && head.readUInt32LE(0) === LOCAL_SIGNATURE;
}

async function readRange(handle: FileHandle, start: number, length: number): Promise<Buffer> {
  const size = Math.max(0, length);
  const buf = Buffer.alloc(size);
  if (size === 0) return buf;
  const { bytesRead } = await handle.read(buf, 0, size, start);
  return buf.subarray(0, bytesRead);
}

/**
 * Locate and parse the central directory.
 *
 * Handles Zip64, which matters here: an archive holding a >4 GB installer
 * stores 0xFFFFFFFF sentinels in the classic fields and the real values in the
 * Zip64 records.
 */
export async function readCentralDirectory(
  filePath: string,
  fileSize: number
): Promise<ZipEntry[]> {
  const handle = await fs.open(filePath, 'r');
  try {
    const windowSize = Math.min(EOCD_SEARCH_WINDOW, fileSize);
    const tail = await readRange(handle, fileSize - windowSize, windowSize);

    let eocdOffset = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) return [];

    let entryCount = tail.readUInt16LE(eocdOffset + 10);
    let centralSize = tail.readUInt32LE(eocdOffset + 12);
    let centralOffset = tail.readUInt32LE(eocdOffset + 16);

    // Zip64: follow the locator that precedes the classic EOCD.
    const locatorOffset = eocdOffset - 20;
    if (
      locatorOffset >= 0 &&
      tail.readUInt32LE(locatorOffset) === EOCD64_LOCATOR_SIGNATURE
    ) {
      const eocd64Offset = Number(tail.readBigUInt64LE(locatorOffset + 8));
      const eocd64 = await readRange(handle, eocd64Offset, 56);
      if (eocd64.length >= 56 && eocd64.readUInt32LE(0) === EOCD64_SIGNATURE) {
        entryCount = Number(eocd64.readBigUInt64LE(32));
        centralSize = Number(eocd64.readBigUInt64LE(40));
        centralOffset = Number(eocd64.readBigUInt64LE(48));
      }
    }

    if (centralOffset < 0 || centralOffset >= fileSize || centralSize <= 0) return [];

    const central = await readRange(handle, centralOffset, Math.min(centralSize, 32 * 1024 * 1024));
    const entries: ZipEntry[] = [];
    let cursor = 0;
    const cap = Math.min(entryCount || 0xffff, 20000);

    for (let i = 0; i < cap && cursor + 46 <= central.length; i++) {
      if (central.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) break;

      const compressionMethod = central.readUInt16LE(cursor + 10);
      let compressedSize = central.readUInt32LE(cursor + 20);
      let uncompressedSize = central.readUInt32LE(cursor + 24);
      const nameLength = central.readUInt16LE(cursor + 28);
      const extraLength = central.readUInt16LE(cursor + 30);
      const commentLength = central.readUInt16LE(cursor + 32);
      let localHeaderOffset = central.readUInt32LE(cursor + 42);

      const nameStart = cursor + 46;
      const fileName = central.subarray(nameStart, nameStart + nameLength).toString('utf8');
      const extraStart = nameStart + nameLength;

      // Zip64 extended information overrides any 0xFFFFFFFF sentinel, in a
      // fixed order of only the fields that were actually overflowed.
      if (
        uncompressedSize === 0xffffffff ||
        compressedSize === 0xffffffff ||
        localHeaderOffset === 0xffffffff
      ) {
        let extraCursor = extraStart;
        const extraEnd = Math.min(extraStart + extraLength, central.length);
        while (extraCursor + 4 <= extraEnd) {
          const headerId = central.readUInt16LE(extraCursor);
          const dataSize = central.readUInt16LE(extraCursor + 2);
          const dataStart = extraCursor + 4;
          if (headerId === 0x0001) {
            let field = dataStart;
            if (uncompressedSize === 0xffffffff && field + 8 <= extraEnd) {
              uncompressedSize = Number(central.readBigUInt64LE(field));
              field += 8;
            }
            if (compressedSize === 0xffffffff && field + 8 <= extraEnd) {
              compressedSize = Number(central.readBigUInt64LE(field));
              field += 8;
            }
            if (localHeaderOffset === 0xffffffff && field + 8 <= extraEnd) {
              localHeaderOffset = Number(central.readBigUInt64LE(field));
            }
            break;
          }
          extraCursor = dataStart + dataSize;
        }
      }

      entries.push({
        fileName,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        compressionMethod,
        isDirectory: fileName.endsWith('/'),
      });

      cursor = extraStart + extraLength + commentLength;
    }

    return entries;
  } finally {
    await handle.close();
  }
}

/**
 * Read up to `maxBytes` of decompressed data from the start of one entry.
 *
 * Stored entries (method 0) are read directly; deflated entries (method 8) are
 * inflated only until the cap is reached, then the stream is torn down.
 */
export async function readEntryPrefix(
  filePath: string,
  entry: ZipEntry,
  maxBytes: number
): Promise<Buffer> {
  const handle = await fs.open(filePath, 'r');
  try {
    // The local header repeats the name/extra lengths, and they can differ from
    // the central directory's, so the data offset must be computed from here.
    const local = await readRange(handle, entry.localHeaderOffset, 30);
    if (local.length < 30 || local.readUInt32LE(0) !== LOCAL_SIGNATURE) {
      return Buffer.alloc(0);
    }
    const localNameLength = local.readUInt16LE(26);
    const localExtraLength = local.readUInt16LE(28);
    const dataOffset = entry.localHeaderOffset + 30 + localNameLength + localExtraLength;

    if (entry.compressionMethod === 0) {
      return await readRange(handle, dataOffset, Math.min(maxBytes, entry.uncompressedSize));
    }
    if (entry.compressionMethod !== 8) {
      return Buffer.alloc(0); // bzip2/lzma/zstd entries are not worth supporting here
    }

    return await inflatePrefix(handle, dataOffset, entry.compressedSize, maxBytes);
  } finally {
    await handle.close();
  }
}

function inflatePrefix(
  handle: FileHandle,
  dataOffset: number,
  compressedSize: number,
  maxBytes: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let produced = 0;
    let settled = false;
    const inflate = createInflateRaw();

    const finish = (): void => {
      if (settled) return;
      settled = true;
      inflate.removeAllListeners();
      inflate.destroy();
      resolve(Buffer.concat(chunks).subarray(0, maxBytes));
    };

    inflate.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      produced += chunk.length;
      if (produced >= maxBytes) finish();
    });
    inflate.on('end', finish);
    // A truncated or trailing-garbage stream still yields a usable prefix.
    inflate.on('error', () => finish());

    void (async () => {
      const readSize = 1024 * 1024;
      let offset = 0;
      try {
        while (offset < compressedSize && !settled) {
          const chunk = await readRange(
            handle,
            dataOffset + offset,
            Math.min(readSize, compressedSize - offset)
          );
          if (chunk.length === 0) break;
          offset += chunk.length;
          if (settled) break;
          if (!inflate.write(chunk)) {
            // Race drain against close: hitting the byte cap destroys the
            // stream mid-write, and waiting on a 'drain' that will never fire
            // would leave this loop pending forever.
            await new Promise<void>((r) => {
              const done = (): void => r();
              inflate.once('drain', done);
              inflate.once('close', done);
            });
          }
        }
        if (!settled) inflate.end();
      } catch (error) {
        if (!settled) {
          settled = true;
          reject(error);
        }
      }
    })();
  });
}

/**
 * Pick the entry most likely to be the actual installer: the largest
 * non-directory `.exe` or `.msi`, ignoring the uninstaller and any
 * prerequisite bundles that sit beside it.
 */
export function pickInstallerEntry(entries: ZipEntry[]): ZipEntry | undefined {
  const candidates = entries.filter(
    (e) =>
      !e.isDirectory &&
      /\.(exe|msi)$/i.test(e.fileName) &&
      !/(^|\/)(unins|uninstall|setup_prereq|vcredist|dotnet)/i.test(e.fileName)
  );
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, e) => (e.uncompressedSize > best.uncompressedSize ? e : best));
}
