/**
 * MSI metadata reader.
 *
 * An MSI is a Compound File Binary (CFB / OLE structured storage) container.
 * This reads its `\005SummaryInformation` property set, which carries the
 * product name, publisher and target platform in a simple, stable layout.
 *
 * Deliberately *not* decoding the MSI `Property` table: that needs the
 * `_StringPool`/`_StringData` pools plus `_Columns` metadata to interpret a
 * single row, which is a large amount of fragile parsing for one extra field.
 * SummaryInformation gives name, vendor and architecture reliably; the version
 * is recovered from the filename or the PE-style version string instead, and
 * the analyzer records a warning when it cannot be determined.
 */

export interface MsiInfo {
  productName?: string;
  vendor?: string;
  architecture?: 'x64' | 'x86' | 'arm64';
  comments?: string;
  revisionNumber?: string;
}

export const CFB_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export function isCompoundFile(head: Buffer): boolean {
  return head.length >= 8 && head.subarray(0, 8).equals(CFB_SIGNATURE);
}

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

/** Names in an MSI are escaped into a private Unicode range; undo that. */
function decodeMsiName(name: string): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz._';
  let out = '';
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    if (code >= 0x3800 && code < 0x4840) {
      if (code >= 0x4800) {
        // Single character.
        out += alphabet[code - 0x4800] ?? '';
      } else {
        const index = code - 0x3800;
        out += (alphabet[index & 0x3f] ?? '') + (alphabet[(index >> 6) & 0x3f] ?? '');
      }
    } else {
      out += ch;
    }
  }
  return out;
}

interface DirEntry {
  name: string;
  rawName: string;
  objectType: number;
  startingSector: number;
  streamSize: number;
}

class CompoundFile {
  private readonly buf: Buffer;
  private readonly sectorSize: number;
  private readonly miniSectorSize: number;
  private readonly miniStreamCutoff: number;
  private readonly fat: number[] = [];
  private readonly miniFat: number[] = [];
  private readonly directory: DirEntry[] = [];
  private miniStream: Buffer = Buffer.alloc(0);

  constructor(buf: Buffer) {
    this.buf = buf;
    this.sectorSize = 1 << buf.readUInt16LE(0x1e);
    this.miniSectorSize = 1 << buf.readUInt16LE(0x20);
    this.miniStreamCutoff = buf.readUInt32LE(0x38);
    this.readFat();
    this.readDirectory();
    this.readMiniFat();
  }

  private sectorOffset(sector: number): number {
    return (sector + 1) * this.sectorSize;
  }

  private readSector(sector: number): Buffer {
    const start = this.sectorOffset(sector);
    if (start < 0 || start + this.sectorSize > this.buf.length) {
      return Buffer.alloc(0);
    }
    return this.buf.subarray(start, start + this.sectorSize);
  }

  /** Follow a FAT chain, collecting sector numbers. Guarded against loops. */
  private chain(start: number, fat: number[]): number[] {
    const out: number[] = [];
    let sector = start;
    const limit = fat.length + 1;
    while (sector !== ENDOFCHAIN && sector !== FREESECT && out.length < limit) {
      if (sector < 0 || sector >= fat.length) break;
      out.push(sector);
      sector = fat[sector];
    }
    return out;
  }

  private readFat(): void {
    const numFatSectors = this.buf.readUInt32LE(0x2c);
    const fatSectors: number[] = [];

    // First 109 FAT sector numbers live in the header's DIFAT.
    for (let i = 0; i < Math.min(109, numFatSectors); i++) {
      const sector = this.buf.readUInt32LE(0x4c + i * 4);
      if (sector !== FREESECT) fatSectors.push(sector);
    }

    // Remaining FAT sector numbers live in a chain of DIFAT sectors.
    let difatSector = this.buf.readUInt32LE(0x44);
    const numDifatSectors = this.buf.readUInt32LE(0x48);
    const entriesPerDifat = this.sectorSize / 4 - 1;
    let guard = 0;
    while (
      difatSector !== ENDOFCHAIN &&
      difatSector !== FREESECT &&
      guard++ < numDifatSectors + 1 &&
      fatSectors.length < numFatSectors
    ) {
      const sec = this.readSector(difatSector);
      if (sec.length === 0) break;
      for (let i = 0; i < entriesPerDifat && fatSectors.length < numFatSectors; i++) {
        const value = sec.readUInt32LE(i * 4);
        if (value !== FREESECT) fatSectors.push(value);
      }
      difatSector = sec.readUInt32LE(entriesPerDifat * 4);
    }

    for (const sector of fatSectors) {
      const sec = this.readSector(sector);
      for (let i = 0; i + 4 <= sec.length; i += 4) {
        this.fat.push(sec.readUInt32LE(i));
      }
    }
  }

  private readDirectory(): void {
    const firstDirSector = this.buf.readUInt32LE(0x30);
    const sectors = this.chain(firstDirSector, this.fat);
    for (const sector of sectors) {
      const sec = this.readSector(sector);
      for (let offset = 0; offset + 128 <= sec.length; offset += 128) {
        const nameLength = sec.readUInt16LE(offset + 0x40);
        if (nameLength < 2 || nameLength > 64) continue;
        const rawName = sec
          .subarray(offset, offset + nameLength - 2)
          .toString('utf16le');
        this.directory.push({
          rawName,
          name: decodeMsiName(rawName),
          objectType: sec.readUInt8(offset + 0x42),
          startingSector: sec.readUInt32LE(offset + 0x74),
          // Streams here are far below 2^53 bytes; reading the low half is safe.
          streamSize: sec.readUInt32LE(offset + 0x78),
        });
      }
    }
  }

  private readMiniFat(): void {
    const firstMiniFat = this.buf.readUInt32LE(0x3c);
    for (const sector of this.chain(firstMiniFat, this.fat)) {
      const sec = this.readSector(sector);
      for (let i = 0; i + 4 <= sec.length; i += 4) {
        this.miniFat.push(sec.readUInt32LE(i));
      }
    }
    // The root entry's stream is the container for all mini-stream data.
    const root = this.directory[0];
    if (root && root.objectType === 5) {
      this.miniStream = this.readFatStream(root.startingSector, root.streamSize);
    }
  }

  private readFatStream(startSector: number, size: number): Buffer {
    const chunks: Buffer[] = [];
    let remaining = size;
    for (const sector of this.chain(startSector, this.fat)) {
      if (remaining <= 0) break;
      const sec = this.readSector(sector);
      chunks.push(sec.subarray(0, Math.min(sec.length, remaining)));
      remaining -= sec.length;
    }
    return Buffer.concat(chunks);
  }

  private readMiniStream(startSector: number, size: number): Buffer {
    const chunks: Buffer[] = [];
    let remaining = size;
    let sector = startSector;
    let guard = 0;
    while (
      sector !== ENDOFCHAIN &&
      sector !== FREESECT &&
      remaining > 0 &&
      guard++ < this.miniFat.length + 1
    ) {
      const start = sector * this.miniSectorSize;
      if (start + this.miniSectorSize > this.miniStream.length) break;
      const chunk = this.miniStream.subarray(start, start + this.miniSectorSize);
      chunks.push(chunk.subarray(0, Math.min(chunk.length, remaining)));
      remaining -= chunk.length;
      sector = sector < this.miniFat.length ? this.miniFat[sector] : ENDOFCHAIN;
    }
    return Buffer.concat(chunks);
  }

  /** Read a named stream, choosing the FAT or mini-FAT path by size. */
  readStream(decodedName: string): Buffer | null {
    const entry = this.directory.find((d) => d.objectType === 2 && d.name === decodedName);
    if (!entry) return null;
    return entry.streamSize < this.miniStreamCutoff
      ? this.readMiniStream(entry.startingSector, entry.streamSize)
      : this.readFatStream(entry.startingSector, entry.streamSize);
  }

  listStreams(): string[] {
    return this.directory.filter((d) => d.objectType === 2).map((d) => d.name);
  }
}

// OLE property set identifiers used by SummaryInformation.
const PID_TITLE = 2;
const PID_SUBJECT = 3;
const PID_AUTHOR = 4;
const PID_COMMENTS = 6;
const PID_TEMPLATE = 7;
const PID_REVNUMBER = 9;

const VT_I2 = 0x0002;
const VT_I4 = 0x0003;
const VT_LPSTR = 0x001e;
const VT_LPWSTR = 0x001f;

/** Parse the first section of an OLE property set into id → value. */
function parsePropertySet(stream: Buffer): Map<number, string | number> {
  const out = new Map<number, string | number>();
  if (stream.length < 48) return out;

  const numSets = stream.readUInt32LE(24);
  if (numSets < 1) return out;

  const sectionOffset = stream.readUInt32LE(44);
  if (sectionOffset + 8 > stream.length) return out;

  const numProperties = stream.readUInt32LE(sectionOffset + 4);
  const cap = Math.min(numProperties, 256);

  for (let i = 0; i < cap; i++) {
    const entry = sectionOffset + 8 + i * 8;
    if (entry + 8 > stream.length) break;
    const propertyId = stream.readUInt32LE(entry);
    const valueOffset = sectionOffset + stream.readUInt32LE(entry + 4);
    if (valueOffset + 4 > stream.length) continue;

    const type = stream.readUInt32LE(valueOffset);
    const dataOffset = valueOffset + 4;

    if (type === VT_LPSTR || type === VT_LPWSTR) {
      if (dataOffset + 4 > stream.length) continue;
      const length = stream.readUInt32LE(dataOffset);
      const start = dataOffset + 4;
      if (length <= 0 || start + length > stream.length || length > 1 << 20) continue;
      const raw = stream.subarray(start, start + length);
      const text =
        type === VT_LPWSTR
          ? raw.toString('utf16le')
          : raw.toString('utf8');
      out.set(propertyId, text.replace(/\u0000+$/, '').trim());
    } else if (type === VT_I4 && dataOffset + 4 <= stream.length) {
      out.set(propertyId, stream.readInt32LE(dataOffset));
    } else if (type === VT_I2 && dataOffset + 2 <= stream.length) {
      out.set(propertyId, stream.readInt16LE(dataOffset));
    }
  }

  return out;
}

/**
 * Read product metadata out of an MSI held entirely in memory.
 * Returns undefined when the file is not a usable compound file.
 */
export function readMsiInfo(buf: Buffer): MsiInfo | undefined {
  if (!isCompoundFile(buf)) return undefined;

  let cfb: CompoundFile;
  try {
    cfb = new CompoundFile(buf);
  } catch {
    return undefined;
  }

  // The stream name starts with U+0005; both the decoded and raw forms are
  // tried because the escape decoder leaves control characters untouched.
  const candidates = cfb.listStreams().filter((n) => n.includes('SummaryInformation'));
  if (candidates.length === 0) return undefined;

  const stream = cfb.readStream(candidates[0]);
  if (!stream || stream.length === 0) return undefined;

  const props = parsePropertySet(stream);
  const asString = (id: number): string | undefined => {
    const value = props.get(id);
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  };

  const template = asString(PID_TEMPLATE) || '';
  let architecture: MsiInfo['architecture'];
  if (/x64|amd64/i.test(template)) architecture = 'x64';
  else if (/arm64/i.test(template)) architecture = 'arm64';
  else if (/intel|x86/i.test(template)) architecture = 'x86';

  const info: MsiInfo = {
    // PID_SUBJECT holds the product name; PID_TITLE is the boilerplate
    // "Installation Database" for essentially every MSI.
    productName: asString(PID_SUBJECT) || asString(PID_TITLE),
    vendor: asString(PID_AUTHOR),
    comments: asString(PID_COMMENTS),
    revisionNumber: asString(PID_REVNUMBER),
    architecture,
  };

  return info;
}
