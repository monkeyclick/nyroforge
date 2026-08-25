/**
 * Minimal PE (Portable Executable) reader.
 *
 * Only what package fingerprinting needs: the machine type, the section table
 * (a section literally named `.wixburn` is a definitive WiX bundle marker) and
 * the VS_VERSIONINFO resource, which is the single best source of a real
 * product name, vendor and version for an EXE installer.
 *
 * Hand-rolled rather than pulled from npm: the subset is small, the format is
 * stable, and every read here is bounds-checked against a possibly hostile
 * upload.
 */

export interface PeSection {
  name: string;
  virtualAddress: number;
  virtualSize: number;
  rawOffset: number;
  rawSize: number;
}

export interface PeVersionInfo {
  productName?: string;
  companyName?: string;
  fileDescription?: string;
  productVersion?: string;
  fileVersion?: string;
  originalFilename?: string;
}

export interface PeInfo {
  isPe: boolean;
  architecture?: 'x64' | 'x86' | 'arm64';
  sections: PeSection[];
  versionInfo?: PeVersionInfo;
}

const IMAGE_FILE_MACHINE_I386 = 0x014c;
const IMAGE_FILE_MACHINE_AMD64 = 0x8664;
const IMAGE_FILE_MACHINE_ARM64 = 0xaa64;

function safeU16(buf: Buffer, offset: number): number | null {
  return offset >= 0 && offset + 2 <= buf.length ? buf.readUInt16LE(offset) : null;
}

function safeU32(buf: Buffer, offset: number): number | null {
  return offset >= 0 && offset + 4 <= buf.length ? buf.readUInt32LE(offset) : null;
}

/**
 * Parse the PE headers out of a buffer holding at least the front of the file.
 * The section table lives within the first few KB, so a modest prefix is
 * enough — `versionInfo` is filled separately by `readVersionInfo`.
 */
export function parsePeHeaders(head: Buffer): PeInfo {
  const empty: PeInfo = { isPe: false, sections: [] };

  if (head.length < 64 || head[0] !== 0x4d || head[1] !== 0x5a) {
    return empty; // no 'MZ'
  }

  const peOffset = safeU32(head, 0x3c);
  if (peOffset === null || peOffset + 24 > head.length) return empty;
  if (head.readUInt32LE(peOffset) !== 0x00004550) return empty; // 'PE\0\0'

  const machine = safeU16(head, peOffset + 4);
  const numberOfSections = safeU16(head, peOffset + 6);
  const sizeOfOptionalHeader = safeU16(head, peOffset + 20);
  if (machine === null || numberOfSections === null || sizeOfOptionalHeader === null) {
    return empty;
  }

  let architecture: PeInfo['architecture'];
  if (machine === IMAGE_FILE_MACHINE_AMD64) architecture = 'x64';
  else if (machine === IMAGE_FILE_MACHINE_I386) architecture = 'x86';
  else if (machine === IMAGE_FILE_MACHINE_ARM64) architecture = 'arm64';

  const sectionTableOffset = peOffset + 24 + sizeOfOptionalHeader;
  const sections: PeSection[] = [];
  // A corrupt or crafted header can claim an absurd section count.
  const sectionCount = Math.min(numberOfSections, 96);

  for (let i = 0; i < sectionCount; i++) {
    const entry = sectionTableOffset + i * 40;
    if (entry + 40 > head.length) break;
    const rawName = head.subarray(entry, entry + 8);
    const nul = rawName.indexOf(0);
    const name = rawName.subarray(0, nul === -1 ? 8 : nul).toString('latin1');
    sections.push({
      name,
      virtualSize: head.readUInt32LE(entry + 8),
      virtualAddress: head.readUInt32LE(entry + 12),
      rawSize: head.readUInt32LE(entry + 16),
      rawOffset: head.readUInt32LE(entry + 20),
    });
  }

  return { isPe: true, architecture, sections };
}

/** UTF-16LE null-terminated string read. Returns the value and the byte length consumed. */
function readUtf16Z(buf: Buffer, offset: number, limit: number): { value: string; next: number } {
  let end = offset;
  while (end + 1 < limit && !(buf[end] === 0 && buf[end + 1] === 0)) {
    end += 2;
  }
  return {
    value: buf.subarray(offset, end).toString('utf16le'),
    next: Math.min(end + 2, limit),
  };
}

const align4 = (n: number): number => (n + 3) & ~3;

interface VersionBlock {
  length: number;
  valueLength: number;
  type: number;
  key: string;
  valueOffset: number;
  childrenOffset: number;
  end: number;
}

/**
 * Read one VS_VERSIONINFO-style block. Every node in the tree — the root,
 * StringFileInfo, each StringTable and each String — shares this layout:
 * wLength, wValueLength, wType, a UTF-16 key, then a 4-byte-aligned value,
 * then 4-byte-aligned children.
 */
function readVersionBlock(buf: Buffer, offset: number, base: number): VersionBlock | null {
  if (offset + 6 > buf.length) return null;
  const length = buf.readUInt16LE(offset);
  const valueLength = buf.readUInt16LE(offset + 2);
  const type = buf.readUInt16LE(offset + 4);
  if (length < 6 || offset + length > buf.length) return null;

  const blockEnd = offset + length;
  const { value: key, next } = readUtf16Z(buf, offset + 6, blockEnd);
  // Alignment is relative to the start of the whole structure.
  const valueOffset = base + align4(next - base);
  // wValueLength counts characters for text values, bytes for binary ones.
  const valueBytes = type === 1 ? valueLength * 2 : valueLength;
  const childrenOffset = base + align4(valueOffset + valueBytes - base);

  return { length, valueLength, type, key, valueOffset, childrenOffset, end: blockEnd };
}

/**
 * Extract the string table from a VS_VERSIONINFO resource.
 *
 * Rather than walking the PE resource directory tree, this locates the
 * `VS_VERSION_INFO` key directly — it is a fixed UTF-16 marker and the
 * structure it introduces is self-describing, so the tree walk buys nothing.
 */
export function readVersionInfo(buf: Buffer): PeVersionInfo | undefined {
  const marker = Buffer.from('VS_VERSION_INFO\u0000', 'utf16le');
  const keyAt = buf.indexOf(marker);
  if (keyAt < 6) return undefined;

  // The block starts 6 bytes before its key (wLength/wValueLength/wType).
  const base = keyAt - 6;
  const root = readVersionBlock(buf, base, base);
  if (!root) return undefined;

  const out: PeVersionInfo = {};
  let found = false;

  // Children of the root: VarFileInfo and StringFileInfo.
  let cursor = root.childrenOffset;
  let guard = 0;
  while (cursor < root.end && guard++ < 32) {
    const child = readVersionBlock(buf, cursor, base);
    if (!child) break;

    if (child.key === 'StringFileInfo') {
      // Children are StringTables keyed by langid+codepage.
      let tableCursor = child.childrenOffset;
      let tableGuard = 0;
      while (tableCursor < child.end && tableGuard++ < 32) {
        const table = readVersionBlock(buf, tableCursor, base);
        if (!table) break;

        let stringCursor = table.childrenOffset;
        let stringGuard = 0;
        while (stringCursor < table.end && stringGuard++ < 128) {
          const entry = readVersionBlock(buf, stringCursor, base);
          if (!entry) break;

          if (entry.type === 1 && entry.valueLength > 0) {
            const valueEnd = Math.min(entry.valueOffset + entry.valueLength * 2, entry.end);
            const value = readUtf16Z(buf, entry.valueOffset, valueEnd).value.trim();
            if (value) {
              found = true;
              switch (entry.key) {
                case 'ProductName': out.productName = value; break;
                case 'CompanyName': out.companyName = value; break;
                case 'FileDescription': out.fileDescription = value; break;
                case 'ProductVersion': out.productVersion = value; break;
                case 'FileVersion': out.fileVersion = value; break;
                case 'OriginalFilename': out.originalFilename = value; break;
              }
            }
          }

          if (entry.length === 0) break;
          stringCursor = base + align4(stringCursor + entry.length - base);
        }

        if (table.length === 0) break;
        tableCursor = base + align4(tableCursor + table.length - base);
      }
    }

    if (child.length === 0) break;
    cursor = base + align4(cursor + child.length - base);
  }

  return found ? out : undefined;
}
