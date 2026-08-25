import { deflateRawSync } from 'zlib';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { parsePeHeaders, readVersionInfo } from '../../src/lambda/package-analyzer/pe';
import { isCompoundFile, readMsiInfo } from '../../src/lambda/package-analyzer/msi';
import {
  readCentralDirectory,
  readEntryPrefix,
  pickInstallerEntry,
  looksLikeZip,
} from '../../src/lambda/package-analyzer/zip';
import {
  fingerprintBuffer,
  fingerprintFile,
  versionFromFileName,
} from '../../src/lambda/package-analyzer/fingerprint';
import { matchRecipe, buildArchiveCommand } from '../../src/lambda/package-analyzer/recipes';

// ---------------------------------------------------------------------------
// Synthetic binary builders
// ---------------------------------------------------------------------------

/** Build a minimal but structurally valid PE image with the given sections. */
function buildPe(options: {
  machine?: number;
  sections?: string[];
  trailer?: Buffer;
}): Buffer {
  const machine = options.machine ?? 0x8664;
  const sections = options.sections ?? ['.text', '.data'];
  const peOffset = 0x80;
  const optionalHeaderSize = 240;
  const sectionTableOffset = peOffset + 24 + optionalHeaderSize;
  const size = sectionTableOffset + sections.length * 40 + 64;

  const buf = Buffer.alloc(size);
  buf.write('MZ', 0, 'latin1');
  buf.writeUInt32LE(peOffset, 0x3c);
  buf.writeUInt32LE(0x00004550, peOffset); // 'PE\0\0'
  buf.writeUInt16LE(machine, peOffset + 4);
  buf.writeUInt16LE(sections.length, peOffset + 6);
  buf.writeUInt16LE(optionalHeaderSize, peOffset + 20);
  buf.writeUInt16LE(0x20b, peOffset + 24); // PE32+ optional header magic

  sections.forEach((name, i) => {
    const entry = sectionTableOffset + i * 40;
    buf.write(name.padEnd(8, '\u0000'), entry, 8, 'latin1');
    buf.writeUInt32LE(0x1000, entry + 8);
    buf.writeUInt32LE(0x1000 * (i + 1), entry + 12);
    buf.writeUInt32LE(0x200, entry + 16);
    buf.writeUInt32LE(0x400 * (i + 1), entry + 20);
  });

  return options.trailer ? Buffer.concat([buf, options.trailer]) : buf;
}

/** Build one VS_VERSIONINFO node: header, key, aligned value, children. */
function versionBlock(
  key: string,
  value: Buffer | null,
  type: number,
  children: Buffer[]
): Buffer {
  const keyBuf = Buffer.from(key + '\u0000', 'utf16le');
  const headerAndKey = Buffer.concat([Buffer.alloc(6), keyBuf]);
  const pad1 = Buffer.alloc((4 - (headerAndKey.length % 4)) % 4);
  const valueBuf = value ?? Buffer.alloc(0);
  const pad2 = Buffer.alloc((4 - (valueBuf.length % 4)) % 4);
  const childrenBuf = Buffer.concat(children);

  const block = Buffer.concat([headerAndKey, pad1, valueBuf, pad2, childrenBuf]);
  block.writeUInt16LE(block.length, 0);
  // wValueLength counts characters for text values.
  block.writeUInt16LE(type === 1 ? valueBuf.length / 2 : valueBuf.length, 2);
  block.writeUInt16LE(type, 4);
  return block;
}

function stringEntry(key: string, value: string): Buffer {
  return versionBlock(key, Buffer.from(value + '\u0000', 'utf16le'), 1, []);
}

function buildVersionInfoResource(entries: Record<string, string>): Buffer {
  const strings = Object.entries(entries).map(([k, v]) => stringEntry(k, v));
  const stringTable = versionBlock('040904b0', null, 1, strings);
  const stringFileInfo = versionBlock('StringFileInfo', null, 1, [stringTable]);
  // VS_FIXEDFILEINFO is a 52-byte binary value on the root node.
  const fixedInfo = Buffer.alloc(52);
  fixedInfo.writeUInt32LE(0xfeef04bd, 0);
  return versionBlock('VS_VERSION_INFO', fixedInfo, 0, [stringFileInfo]);
}

/** Build a ZIP archive from in-memory entries, deflating each one. */
function buildZip(files: { name: string; content: Buffer; store?: boolean }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const stored = file.store === true;
    const data = stored ? file.content : deflateRawSync(file.content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(0, 14); // crc32, unchecked by the reader
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(file.content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(file.content.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);

    localParts.push(local, nameBuf, data);
    centralParts.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

/**
 * Build a minimal CFB (compound file) holding one stream, large enough to be
 * addressed through the regular FAT rather than the mini-FAT.
 */
function buildCompoundFile(streamName: string, streamData: Buffer): Buffer {
  const SECTOR = 512;
  const ENDOFCHAIN = 0xfffffffe;
  const FREESECT = 0xffffffff;
  const FATSECT = 0xfffffffd;

  const streamSectors = Math.ceil(streamData.length / SECTOR);
  const totalSectors = 2 + streamSectors; // FAT, directory, then stream data
  const buf = Buffer.alloc(SECTOR * (1 + totalSectors), 0);

  // --- Header ---
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(buf, 0);
  buf.writeUInt16LE(0x003e, 0x18);
  buf.writeUInt16LE(0x0003, 0x1a);
  buf.writeUInt16LE(0xfffe, 0x1c);
  buf.writeUInt16LE(9, 0x1e); // 512-byte sectors
  buf.writeUInt16LE(6, 0x20); // 64-byte mini sectors
  buf.writeUInt32LE(1, 0x2c); // one FAT sector
  buf.writeUInt32LE(1, 0x30); // directory starts at sector 1
  buf.writeUInt32LE(4096, 0x38); // mini stream cutoff
  buf.writeUInt32LE(ENDOFCHAIN, 0x3c);
  buf.writeUInt32LE(0, 0x40);
  buf.writeUInt32LE(ENDOFCHAIN, 0x44);
  buf.writeUInt32LE(0, 0x48);
  buf.writeUInt32LE(0, 0x4c); // DIFAT[0] -> FAT lives in sector 0
  for (let i = 1; i < 109; i++) buf.writeUInt32LE(FREESECT, 0x4c + i * 4);

  // --- FAT (sector 0, file offset 512) ---
  const fatBase = SECTOR;
  for (let i = 0; i < SECTOR / 4; i++) buf.writeUInt32LE(FREESECT, fatBase + i * 4);
  buf.writeUInt32LE(FATSECT, fatBase + 0 * 4);
  buf.writeUInt32LE(ENDOFCHAIN, fatBase + 1 * 4);
  for (let i = 0; i < streamSectors; i++) {
    const sector = 2 + i;
    const next = i === streamSectors - 1 ? ENDOFCHAIN : sector + 1;
    buf.writeUInt32LE(next, fatBase + sector * 4);
  }

  // --- Directory (sector 1, file offset 1024) ---
  const dirBase = SECTOR * 2;
  const writeDirEntry = (
    index: number,
    name: string,
    objectType: number,
    startSector: number,
    size: number
  ): void => {
    const at = dirBase + index * 128;
    const nameBuf = Buffer.from(name + '\u0000', 'utf16le');
    nameBuf.copy(buf, at);
    buf.writeUInt16LE(nameBuf.length, at + 0x40);
    buf.writeUInt8(objectType, at + 0x42);
    buf.writeUInt32LE(0xffffffff, at + 0x44); // left sibling
    buf.writeUInt32LE(0xffffffff, at + 0x48); // right sibling
    buf.writeUInt32LE(0xffffffff, at + 0x4c); // child
    buf.writeUInt32LE(startSector, at + 0x74);
    buf.writeUInt32LE(size, at + 0x78);
  };
  writeDirEntry(0, 'Root Entry', 5, ENDOFCHAIN, 0);
  writeDirEntry(1, streamName, 2, 2, streamData.length);

  // --- Stream data (sector 2 onward) ---
  streamData.copy(buf, SECTOR * 3);

  return buf;
}

/** Build an OLE property set with VT_LPSTR values. */
function buildPropertySet(properties: { id: number; value: string }[]): Buffer {
  const header = Buffer.alloc(48);
  header.writeUInt16LE(0xfffe, 0);
  header.writeUInt16LE(0, 2);
  header.writeUInt32LE(1, 24); // one property set
  header.writeUInt32LE(48, 44); // section starts right after the header

  const valueBuffers: Buffer[] = [];
  const idOffsetPairs = Buffer.alloc(properties.length * 8);
  let valueCursor = 8 + properties.length * 8;

  properties.forEach((prop, i) => {
    const text = Buffer.from(prop.value + '\u0000', 'latin1');
    const value = Buffer.alloc(8 + text.length + ((4 - (text.length % 4)) % 4));
    value.writeUInt32LE(0x001e, 0); // VT_LPSTR
    value.writeUInt32LE(text.length, 4);
    text.copy(value, 8);

    idOffsetPairs.writeUInt32LE(prop.id, i * 8);
    idOffsetPairs.writeUInt32LE(valueCursor, i * 8 + 4);
    valueBuffers.push(value);
    valueCursor += value.length;
  });

  const sectionHeader = Buffer.alloc(8);
  sectionHeader.writeUInt32LE(valueCursor, 0);
  sectionHeader.writeUInt32LE(properties.length, 4);

  return Buffer.concat([header, sectionHeader, idOffsetPairs, ...valueBuffers]);
}

async function withTempFile<T>(data: Buffer, fn: (p: string, size: number) => Promise<T>): Promise<T> {
  const file = path.join(os.tmpdir(), `fp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.writeFile(file, data);
  try {
    return await fn(file, data.length);
  } finally {
    await fs.unlink(file).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// PE
// ---------------------------------------------------------------------------

describe('PE parsing', () => {
  it('reads architecture and section names', () => {
    const pe = parsePeHeaders(buildPe({ sections: ['.text', '.rdata', '.wixburn'] }));
    expect(pe.isPe).toBe(true);
    expect(pe.architecture).toBe('x64');
    expect(pe.sections.map((s) => s.name)).toContain('.wixburn');
  });

  it('recognises 32-bit and ARM64 images', () => {
    expect(parsePeHeaders(buildPe({ machine: 0x014c })).architecture).toBe('x86');
    expect(parsePeHeaders(buildPe({ machine: 0xaa64 })).architecture).toBe('arm64');
  });

  it('rejects non-PE input without throwing', () => {
    expect(parsePeHeaders(Buffer.from('not an executable at all')).isPe).toBe(false);
    expect(parsePeHeaders(Buffer.alloc(0)).isPe).toBe(false);
    // 'MZ' with a garbage PE offset must not read out of bounds.
    const fake = Buffer.alloc(128);
    fake.write('MZ', 0, 'latin1');
    fake.writeUInt32LE(0x7fffffff, 0x3c);
    expect(parsePeHeaders(fake).isPe).toBe(false);
  });

  it('extracts product metadata from VS_VERSIONINFO', () => {
    const resource = buildVersionInfoResource({
      CompanyName: 'Blackmagic Design',
      ProductName: 'DaVinci Resolve',
      ProductVersion: '19.1.4',
      FileVersion: '19.1.4.0',
    });
    const info = readVersionInfo(Buffer.concat([Buffer.alloc(64), resource]));
    expect(info).toBeDefined();
    expect(info?.companyName).toBe('Blackmagic Design');
    expect(info?.productName).toBe('DaVinci Resolve');
    expect(info?.productVersion).toBe('19.1.4');
  });

  it('returns undefined when there is no version resource', () => {
    expect(readVersionInfo(Buffer.alloc(4096))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MSI
// ---------------------------------------------------------------------------

describe('MSI parsing', () => {
  it('detects the compound file signature', () => {
    expect(isCompoundFile(buildCompoundFile('Test', Buffer.alloc(8192)))).toBe(true);
    expect(isCompoundFile(Buffer.from('MZ....'))).toBe(false);
  });

  it('reads product name, vendor and architecture from SummaryInformation', () => {
    const propertySet = buildPropertySet([
      { id: 3, value: 'Contoso Widget Suite' }, // PID_SUBJECT
      { id: 4, value: 'Contoso Ltd' }, // PID_AUTHOR
      { id: 7, value: 'x64;1033' }, // PID_TEMPLATE
    ]);
    // Pad past the mini-stream cutoff so the regular FAT path is exercised.
    const padded = Buffer.concat([propertySet, Buffer.alloc(5000)]);
    const cfb = buildCompoundFile('SummaryInformation', padded);

    const info = readMsiInfo(cfb);
    expect(info).toBeDefined();
    expect(info?.productName).toBe('Contoso Widget Suite');
    expect(info?.vendor).toBe('Contoso Ltd');
    expect(info?.architecture).toBe('x64');
  });

  it('maps the Intel template to x86', () => {
    const propertySet = buildPropertySet([
      { id: 3, value: 'Legacy App' },
      { id: 7, value: 'Intel;1033' },
    ]);
    const cfb = buildCompoundFile(
      'SummaryInformation',
      Buffer.concat([propertySet, Buffer.alloc(5000)])
    );
    expect(readMsiInfo(cfb)?.architecture).toBe('x86');
  });

  it('returns undefined for a non-compound file and does not throw on garbage', () => {
    expect(readMsiInfo(Buffer.from('definitely not an msi'))).toBeUndefined();

    const corrupt = buildCompoundFile('SummaryInformation', Buffer.alloc(8192));
    // Scribble over the FAT so every chain lookup is nonsense.
    corrupt.fill(0xab, 512, 1024);
    expect(() => readMsiInfo(corrupt)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

describe('ZIP parsing', () => {
  it('lists central directory entries', async () => {
    const zip = buildZip([
      { name: 'readme.txt', content: Buffer.from('hello') },
      { name: 'Installer/Setup.exe', content: Buffer.alloc(4096, 0x41) },
    ]);
    expect(looksLikeZip(zip)).toBe(true);

    await withTempFile(zip, async (file, size) => {
      const entries = await readCentralDirectory(file, size);
      expect(entries.map((e) => e.fileName)).toEqual([
        'readme.txt',
        'Installer/Setup.exe',
      ]);
      expect(entries[1].uncompressedSize).toBe(4096);
    });
  });

  it('inflates a deflated entry prefix', async () => {
    const payload = Buffer.concat([
      Buffer.from('MZ'),
      Buffer.from('Nullsoft.NSIS.exehead'),
      Buffer.alloc(2048, 0x7),
    ]);
    const zip = buildZip([{ name: 'Setup.exe', content: payload }]);

    await withTempFile(zip, async (file, size) => {
      const entries = await readCentralDirectory(file, size);
      const prefix = await readEntryPrefix(file, entries[0], 1024 * 1024);
      expect(prefix.subarray(0, 2).toString()).toBe('MZ');
      expect(prefix.includes(Buffer.from('Nullsoft.NSIS.exehead'))).toBe(true);
    });
  });

  it('reads a stored (uncompressed) entry', async () => {
    const payload = Buffer.concat([Buffer.from('MZstored'), Buffer.alloc(512, 3)]);
    const zip = buildZip([{ name: 'Setup.exe', content: payload, store: true }]);

    await withTempFile(zip, async (file, size) => {
      const entries = await readCentralDirectory(file, size);
      const prefix = await readEntryPrefix(file, entries[0], 64);
      expect(prefix.subarray(0, 8).toString()).toBe('MZstored');
    });
  });

  it('caps the amount it inflates', async () => {
    const zip = buildZip([{ name: 'Big.exe', content: Buffer.alloc(4 * 1024 * 1024, 0x5a) }]);
    await withTempFile(zip, async (file, size) => {
      const entries = await readCentralDirectory(file, size);
      const prefix = await readEntryPrefix(file, entries[0], 8192);
      expect(prefix.length).toBeLessThanOrEqual(8192);
    });
  });

  it('picks the largest installer and skips uninstallers', () => {
    const entry = pickInstallerEntry([
      { fileName: 'unins000.exe', uncompressedSize: 9_000_000, compressedSize: 1, localHeaderOffset: 0, compressionMethod: 8, isDirectory: false },
      { fileName: 'docs/', uncompressedSize: 0, compressedSize: 0, localHeaderOffset: 0, compressionMethod: 0, isDirectory: true },
      { fileName: 'Setup.exe', uncompressedSize: 4_000_000, compressedSize: 1, localHeaderOffset: 0, compressionMethod: 8, isDirectory: false },
      { fileName: 'readme.txt', uncompressedSize: 50, compressedSize: 1, localHeaderOffset: 0, compressionMethod: 8, isDirectory: false },
    ]);
    expect(entry?.fileName).toBe('Setup.exe');
  });

  it('returns nothing when the archive holds no installer', () => {
    expect(
      pickInstallerEntry([
        { fileName: 'a.txt', uncompressedSize: 10, compressedSize: 1, localHeaderOffset: 0, compressionMethod: 8, isDirectory: false },
      ])
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fingerprinting
// ---------------------------------------------------------------------------

describe('fingerprintBuffer', () => {
  const empty = Buffer.alloc(0);

  it('rates a .wixburn section as high confidence', () => {
    const pe = buildPe({ sections: ['.text', '.wixburn'] });
    const fp = fingerprintBuffer(pe, empty, 'bundle.exe');
    expect(fp.installerType).toBe('wix-burn');
    expect(fp.confidence).toBe('high');
  });

  it('rates a compound file as a high-confidence MSI', () => {
    const cfb = buildCompoundFile('Test', Buffer.alloc(8192));
    const fp = fingerprintBuffer(cfb, empty, 'app.msi');
    expect(fp.installerType).toBe('msi');
    expect(fp.confidence).toBe('high');
  });

  it.each([
    ['Nullsoft.NSIS.exehead', 'nsis'],
    ['Inno Setup Setup Data', 'inno'],
    ['ISSetupPrerequisites', 'installshield'],
    [';!@Install@!UTF-8!', 'sfx-7z'],
    ['Squirrel.Windows', 'squirrel'],
  ])('identifies %s as %s at medium confidence', (marker, expected) => {
    const pe = buildPe({ trailer: Buffer.from(marker, 'latin1') });
    const fp = fingerprintBuffer(pe, Buffer.from(marker, 'latin1'), 'setup.exe');
    expect(fp.installerType).toBe(expected);
    expect(fp.confidence).toBe('medium');
  });

  it('falls back to low confidence for an unrecognised PE, and says so', () => {
    const fp = fingerprintBuffer(buildPe({}), empty, 'mystery.exe');
    expect(fp.installerType).toBe('unknown');
    expect(fp.confidence).toBe('low');
    expect(fp.warnings.join(' ')).toMatch(/guess/i);
  });

  it('flags input that is not an installer at all', () => {
    const fp = fingerprintBuffer(Buffer.from('just some text'), empty, 'notes.txt');
    expect(fp.installerType).toBe('unknown');
    expect(fp.warnings.join(' ')).toMatch(/neither a Windows executable/i);
  });
});

describe('versionFromFileName', () => {
  it.each([
    ['DaVinci_Resolve_19.1.4_Windows.exe', '19.1.4'],
    ['setup-2024.3.exe', '2024.3'],
    ['tool_1.2.3.4_x64.msi', '1.2.3.4'],
  ])('reads %s as %s', (name, expected) => {
    expect(versionFromFileName(name)).toBe(expected);
  });

  it('returns undefined when there is no version', () => {
    expect(versionFromFileName('setup.exe')).toBeUndefined();
  });
});

describe('fingerprintFile', () => {
  it('descends into an archive and identifies the inner installer', async () => {
    const inner = Buffer.concat([
      buildPe({ sections: ['.text'] }),
      Buffer.from('Inno Setup Setup Data', 'latin1'),
    ]);
    const zip = buildZip([
      { name: 'readme.txt', content: Buffer.from('read me') },
      { name: 'DaVinci_Resolve_19.1.4_Windows.exe', content: inner },
    ]);

    await withTempFile(zip, async (file, size) => {
      const fp = await fingerprintFile(file, 'DaVinci_Resolve_19.1.4_Windows.zip', size);
      expect(fp.installerType).toBe('zip');
      expect(fp.archiveEntry).toBe('DaVinci_Resolve_19.1.4_Windows.exe');
      expect(fp.inner?.installerType).toBe('inno');
      expect(fp.version).toBe('19.1.4');
    });
  });

  it('warns when an archive contains no installer', async () => {
    const zip = buildZip([{ name: 'notes.txt', content: Buffer.from('nothing here') }]);
    await withTempFile(zip, async (file, size) => {
      const fp = await fingerprintFile(file, 'bundle.zip', size);
      expect(fp.archiveEntry).toBeUndefined();
      expect(fp.warnings.join(' ')).toMatch(/No \.exe or \.msi was found/i);
    });
  });

  it('pulls MSI metadata off disk', async () => {
    const propertySet = buildPropertySet([
      { id: 3, value: 'Contoso Widget Suite' },
      { id: 4, value: 'Contoso Ltd' },
    ]);
    const cfb = buildCompoundFile(
      'SummaryInformation',
      Buffer.concat([propertySet, Buffer.alloc(5000)])
    );

    await withTempFile(cfb, async (file, size) => {
      const fp = await fingerprintFile(file, 'widget-2.5.msi', size);
      expect(fp.installerType).toBe('msi');
      expect(fp.productName).toBe('Contoso Widget Suite');
      expect(fp.vendor).toBe('Contoso Ltd');
      expect(fp.version).toBe('2.5');
    });
  });
});

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

describe('matchRecipe', () => {
  it('uses the framework default when no vendor rule applies', () => {
    const recipe = matchRecipe({ installerType: 'nsis', fileName: 'thing-setup.exe' });
    expect(recipe.recipeId).toBe('nsis');
    expect(recipe.installCommand).toBe('{installer}');
    expect(recipe.installArgs).toBe('/S');
  });

  it('produces an msiexec command line for MSIs', () => {
    const recipe = matchRecipe({ installerType: 'msi', fileName: 'app.msi' });
    expect(recipe.installCommand).toBe('msiexec.exe');
    expect(recipe.installArgs).toContain('/qn');
    expect(recipe.installArgs).toContain('{installer}');
  });

  it('lets a vendor rule override the framework default', () => {
    const recipe = matchRecipe({
      installerType: 'unknown',
      fileName: 'DaVinci_Resolve_19.1.4_Windows.exe',
    });
    expect(recipe.recipeId).toBe('blackmagic-resolve');
    expect(recipe.installArgs).toContain('/silent');
    expect(recipe.warnings.join(' ')).toMatch(/verify on one workstation/i);
  });

  it('matches a vendor rule on version-info metadata, not just the filename', () => {
    const recipe = matchRecipe({
      installerType: 'unknown',
      fileName: 'setup.exe',
      productName: 'DaVinci Resolve Studio',
    });
    expect(recipe.recipeId).toBe('blackmagic-resolve');
  });

  it('warns loudly for an unidentified installer', () => {
    const recipe = matchRecipe({ installerType: 'unknown', fileName: 'mystery.exe' });
    expect(recipe.warnings.join(' ')).toMatch(/could not be identified/i);
  });
});

describe('buildArchiveCommand', () => {
  const built = buildArchiveCommand('pkg-1', 'Installer/Setup.exe', '/VERYSILENT');

  it('runs through PowerShell as a single process', () => {
    expect(built.installCommand).toBe('powershell.exe');
    expect(built.installArgs).toContain('Expand-Archive');
    expect(built.installArgs).toContain('{installer}');
  });

  it('propagates the inner exit code', () => {
    // Without this the installer service sees PowerShell's own 0 and reports
    // success no matter what the real installer did.
    expect(built.installArgs).toContain('exit $p.ExitCode');
    expect(built.installArgs).toContain('-Wait -PassThru');
  });

  it('normalises the entry path and escapes quotes', () => {
    expect(built.installArgs).toContain('Installer\\Setup.exe');
    const nasty = buildArchiveCommand('pkg-2', "Weird'Name.exe", "--flag='x'");
    expect(nasty.installArgs).toContain("Weird''Name.exe");
    expect(nasty.installArgs).toContain("--flag=''x''");
  });

  it('omits ArgumentList when the inner installer takes no arguments', () => {
    const noArgs = buildArchiveCommand('pkg-3', 'Setup.exe', '');
    expect(noArgs.installArgs).not.toContain('-ArgumentList');
    expect(noArgs.installArgs).toContain('-Wait -PassThru');
  });
});
