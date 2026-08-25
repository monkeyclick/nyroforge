/**
 * Installer fingerprinting.
 *
 * Signals are applied strongest-first. Magic numbers and PE section names are
 * structural facts about the file and rate `high` confidence; ASCII marker
 * strings are strong but forgeable heuristics and rate `medium`; a bare PE with
 * nothing recognisable is `low`.
 */

import { promises as fs } from 'fs';
import { InstallerType, AnalysisConfidence } from '../shared/packages';
import { parsePeHeaders, readVersionInfo, PeVersionInfo } from './pe';
import { isCompoundFile, readMsiInfo } from './msi';
import { looksLikeZip, readCentralDirectory, readEntryPrefix, pickInstallerEntry } from './zip';

/** How much of the head and tail to scan for marker strings. */
const SCAN_WINDOW = 2 * 1024 * 1024;
/** How much of an inner archive entry to inflate for fingerprinting. */
const ARCHIVE_PREFIX_BYTES = 8 * 1024 * 1024;
/** MSI parsing needs the whole compound file resident; skip absurd ones. */
const MAX_MSI_PARSE_BYTES = 512 * 1024 * 1024;

export interface Fingerprint {
  installerType: InstallerType;
  confidence: AnalysisConfidence;
  architecture?: 'x64' | 'x86' | 'arm64';
  productName?: string;
  vendor?: string;
  version?: string;
  archiveEntry?: string;
  /** Fingerprint of the installer found inside an archive, when there is one. */
  inner?: Fingerprint;
  warnings: string[];
}

interface MarkerRule {
  type: InstallerType;
  markers: string[];
}

/**
 * Marker strings, checked in order. NSIS before Inno because some NSIS
 * installers embed an Inno-branded payload, and InstallShield last because its
 * name appears in unrelated bundles that merely ship an IS prerequisite.
 */
const MARKER_RULES: MarkerRule[] = [
  { type: 'nsis', markers: ['Nullsoft.NSIS.exehead', 'NullsoftInst'] },
  { type: 'inno', markers: ['Inno Setup Setup Data', 'JR.Inno.Setup', 'InnoSetupLdrWindow'] },
  { type: 'sfx-7z', markers: [';!@Install@!UTF-8!', '7-Zip SFX'] },
  { type: 'squirrel', markers: ['Squirrel.Windows', 'SquirrelSetup'] },
  {
    type: 'installshield',
    markers: ['InstallShield', 'ISSetupPrerequisites', 'setup.inx', 'IsProBENT'],
  },
];

function scanForMarkers(buffers: Buffer[]): InstallerType | null {
  for (const rule of MARKER_RULES) {
    for (const marker of rule.markers) {
      const needle = Buffer.from(marker, 'latin1');
      if (buffers.some((buf) => buf.includes(needle))) {
        return rule.type;
      }
    }
  }
  return null;
}

/** Recover a version like 19.1.4 or 2024.3 from a filename. */
export function versionFromFileName(fileName: string): string | undefined {
  const match = fileName.match(/(\d+\.\d+(?:\.\d+){0,2})/);
  return match ? match[1] : undefined;
}

async function readHeadAndTail(
  filePath: string,
  fileSize: number
): Promise<{ head: Buffer; tail: Buffer }> {
  const handle = await fs.open(filePath, 'r');
  try {
    const headSize = Math.min(SCAN_WINDOW, fileSize);
    const head = Buffer.alloc(headSize);
    await handle.read(head, 0, headSize, 0);

    const tailSize = Math.min(SCAN_WINDOW, Math.max(0, fileSize - headSize));
    const tail = Buffer.alloc(tailSize);
    if (tailSize > 0) {
      await handle.read(tail, 0, tailSize, fileSize - tailSize);
    }
    return { head, tail };
  } finally {
    await handle.close();
  }
}

/** Fingerprint a buffer that holds (at least the front of) an installer. */
export function fingerprintBuffer(head: Buffer, tail: Buffer, fileName: string): Fingerprint {
  const warnings: string[] = [];

  if (isCompoundFile(head)) {
    return { installerType: 'msi', confidence: 'high', warnings };
  }

  const pe = parsePeHeaders(head);

  if (pe.isPe) {
    // A `.wixburn` section is written only by the WiX bundle linker — this is a
    // structural fact, not a string that happens to appear.
    if (pe.sections.some((s) => s.name === '.wixburn')) {
      const versionInfo = readVersionInfo(tail) || readVersionInfo(head);
      return {
        installerType: 'wix-burn',
        confidence: 'high',
        architecture: pe.architecture,
        ...fromVersionInfo(versionInfo),
        warnings,
      };
    }

    const marker = scanForMarkers([head, tail]);
    const versionInfo = readVersionInfo(tail) || readVersionInfo(head);
    if (marker) {
      return {
        installerType: marker,
        confidence: 'medium',
        architecture: pe.architecture,
        ...fromVersionInfo(versionInfo),
        warnings,
      };
    }

    warnings.push(
      'No installer framework signature was found. The suggested silent switch is a guess.'
    );
    return {
      installerType: 'unknown',
      confidence: 'low',
      architecture: pe.architecture,
      ...fromVersionInfo(versionInfo),
      warnings,
    };
  }

  if (looksLikeZip(head)) {
    return { installerType: 'zip', confidence: 'high', warnings };
  }

  warnings.push('File is neither a Windows executable, an MSI, nor a ZIP archive.');
  return { installerType: 'unknown', confidence: 'low', warnings };
}

function fromVersionInfo(
  info: PeVersionInfo | undefined
): { productName?: string; vendor?: string; version?: string } {
  if (!info) return {};
  return {
    productName: info.productName || info.fileDescription,
    vendor: info.companyName,
    version: info.productVersion || info.fileVersion,
  };
}

/**
 * Fingerprint an installer already downloaded to local disk.
 *
 * MSI and ZIP are handled with format-specific follow-up passes; everything
 * else is decided from the head/tail scan.
 */
export async function fingerprintFile(
  filePath: string,
  fileName: string,
  fileSize: number
): Promise<Fingerprint> {
  const { head, tail } = await readHeadAndTail(filePath, fileSize);
  const result = fingerprintBuffer(head, tail, fileName);

  if (result.installerType === 'msi') {
    if (fileSize <= MAX_MSI_PARSE_BYTES) {
      try {
        const whole = await fs.readFile(filePath);
        const msi = readMsiInfo(whole);
        if (msi) {
          result.productName = msi.productName;
          result.vendor = msi.vendor;
          result.architecture = msi.architecture;
        }
      } catch (error) {
        result.warnings.push('MSI metadata could not be read; falling back to the filename.');
      }
    } else {
      result.warnings.push('MSI is too large to parse for metadata; using the filename instead.');
    }
  }

  if (result.installerType === 'zip') {
    await fingerprintArchive(filePath, fileSize, result);
  }

  if (!result.version) {
    result.version = versionFromFileName(fileName);
    if (!result.version) {
      result.warnings.push('Version could not be determined; set it manually if it matters.');
    }
  }

  return result;
}

/** Find and fingerprint the installer inside an archive. */
async function fingerprintArchive(
  filePath: string,
  fileSize: number,
  result: Fingerprint
): Promise<void> {
  let entries;
  try {
    entries = await readCentralDirectory(filePath, fileSize);
  } catch (error) {
    result.warnings.push('Archive directory could not be read.');
    return;
  }

  const entry = pickInstallerEntry(entries);
  if (!entry) {
    result.warnings.push(
      'No .exe or .msi was found inside the archive; set the install command manually.'
    );
    return;
  }

  result.archiveEntry = entry.fileName;

  let prefix: Buffer;
  try {
    prefix = await readEntryPrefix(filePath, entry, ARCHIVE_PREFIX_BYTES);
  } catch (error) {
    result.warnings.push(`Could not read '${entry.fileName}' from the archive.`);
    return;
  }

  if (prefix.length === 0) {
    result.warnings.push(
      `'${entry.fileName}' uses an unsupported compression method; identify it manually.`
    );
    return;
  }

  // Only a prefix was inflated, so the tail scan has nothing extra to offer and
  // version info (which lives in .rsrc, near the end) is usually out of reach.
  const inner = fingerprintBuffer(prefix, Buffer.alloc(0), entry.fileName);
  result.inner = inner;
  result.productName = result.productName || inner.productName;
  result.vendor = result.vendor || inner.vendor;
  result.version = result.version || inner.version || versionFromFileName(entry.fileName);
  result.architecture = result.architecture || inner.architecture;
  result.warnings.push(...inner.warnings);

  if (inner.installerType === 'unknown') {
    result.warnings.push(
      `Found '${entry.fileName}' inside the archive but could not identify its installer type.`
    );
  }
}
