/**
 * Silent-install recipes.
 *
 * Two layers. `INSTALLER_TYPE_RECIPES` holds the documented silent switches for
 * each installer framework — reliable, because the framework defines them.
 * `VENDOR_RULES` overrides those for products known to deviate, matched on
 * filename and on the PE version-info strings.
 *
 * A recipe is a *starting point shown to an approving admin*, never something
 * applied unattended. Whether a given vendor's build honours its framework's
 * standard switches can only really be established by running it, which is what
 * the verify action exists for.
 */

import { InstallerType } from '../shared/packages';

export interface Recipe {
  id: string;
  installCommand: string;
  installArgs: string;
  warnings?: string[];
}

export interface VendorRule {
  id: string;
  /** Matched against the uploaded filename. */
  fileNamePattern?: RegExp;
  /** Matched against PE CompanyName / MSI Author. */
  vendorPattern?: RegExp;
  /** Matched against PE ProductName / MSI Subject. */
  productPattern?: RegExp;
  installerType?: InstallerType;
  installCommand?: string;
  installArgs?: string;
  warnings?: string[];
}

/**
 * `{installer}` is substituted by the Windows service with the quoted path of
 * the downloaded artifact — in the command as well as in the arguments.
 */
export const INSTALLER_TYPE_RECIPES: Record<InstallerType, Recipe> = {
  msi: {
    id: 'msi',
    installCommand: 'msiexec.exe',
    installArgs: '/i {installer} /qn /norestart',
  },
  inno: {
    id: 'inno',
    installCommand: '{installer}',
    installArgs: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
  },
  nsis: {
    id: 'nsis',
    installCommand: '{installer}',
    installArgs: '/S',
  },
  'wix-burn': {
    id: 'wix-burn',
    installCommand: '{installer}',
    installArgs: '/quiet /norestart',
  },
  installshield: {
    id: 'installshield',
    installCommand: '{installer}',
    installArgs: '/s /v"/qn REBOOT=ReallySuppress"',
    warnings: [
      'InstallShield silent switches vary between the MSI-wrapped and legacy script engines. If /s /v"/qn" fails, try /silent /norestart, or generate a response file with /r and pass /s /f1"<file>.iss".',
    ],
  },
  msix: {
    id: 'msix',
    installCommand: 'powershell.exe',
    installArgs:
      '-NoProfile -ExecutionPolicy Bypass -Command "Add-AppxPackage -Path {installer}"',
  },
  'sfx-7z': {
    id: 'sfx-7z',
    installCommand: '{installer}',
    installArgs: '-y',
    warnings: [
      'A 7-Zip self-extracting archive only unpacks; it may not run an installer afterwards. Confirm what the payload does.',
    ],
  },
  squirrel: {
    id: 'squirrel',
    installCommand: '{installer}',
    installArgs: '--silent',
  },
  zip: {
    id: 'zip',
    installCommand: 'powershell.exe',
    installArgs: '',
    warnings: ['Archive contents could not be identified; set the install command manually.'],
  },
  unknown: {
    id: 'unknown',
    installCommand: '{installer}',
    installArgs: '/S',
    warnings: [
      'Installer framework could not be identified. /S is only a guess — verify on a workstation before publishing.',
    ],
  },
};

export const VENDOR_RULES: VendorRule[] = [
  {
    id: 'blackmagic-resolve',
    fileNamePattern: /davinci[ _-]?resolve/i,
    productPattern: /davinci resolve/i,
    installerType: 'installshield',
    installCommand: '{installer}',
    installArgs: '/i /silent /suppressmsgboxes /norestart',
    warnings: [
      "Blackmagic's silent switches have changed across Resolve releases — verify on one workstation before publishing.",
      'Studio activation and the first-run registration dialog are not handled by a silent install; licensing remains a separate step.',
      'Resolve requires a working GPU driver. Order this package after the GPU driver package.',
    ],
  },
  {
    id: 'adobe-creative-cloud',
    fileNamePattern: /(creative[ _-]?cloud|adobe.*set-?up)/i,
    vendorPattern: /adobe/i,
    installCommand: '{installer}',
    installArgs: '--silent',
    warnings: [
      'Adobe enterprise installers are normally generated per-organisation through the Admin Console packager; a consumer download may ignore --silent.',
    ],
  },
  {
    id: 'nvidia-display-driver',
    fileNamePattern: /^\d+\.\d+.*(quadro|grid|desktop).*win/i,
    vendorPattern: /nvidia/i,
    installCommand: '{installer}',
    installArgs: '-s -noreboot -clean',
    warnings: ['NVIDIA driver installs frequently require a reboot to complete.'],
  },
  {
    id: 'chrome-enterprise-msi',
    fileNamePattern: /googlechrome.*\.msi$/i,
    installerType: 'msi',
    installCommand: 'msiexec.exe',
    installArgs: '/i {installer} /qn /norestart',
  },
];

export interface RecipeMatchInput {
  installerType: InstallerType;
  fileName: string;
  productName?: string;
  vendor?: string;
}

export interface RecipeMatch {
  recipeId: string;
  installCommand: string;
  installArgs: string;
  warnings: string[];
}

/**
 * Resolve the recipe for a fingerprinted artifact. A vendor rule wins over the
 * framework default; where the rule omits a field, the framework default fills
 * it in, and warnings from both are kept.
 */
export function matchRecipe(input: RecipeMatchInput): RecipeMatch {
  const base = INSTALLER_TYPE_RECIPES[input.installerType] || INSTALLER_TYPE_RECIPES.unknown;

  const vendorRule = VENDOR_RULES.find((rule) => {
    const byFileName = rule.fileNamePattern?.test(input.fileName) ?? false;
    const byVendor = Boolean(input.vendor) && (rule.vendorPattern?.test(input.vendor as string) ?? false);
    const byProduct =
      Boolean(input.productName) && (rule.productPattern?.test(input.productName as string) ?? false);
    return byFileName || byVendor || byProduct;
  });

  if (!vendorRule) {
    return {
      recipeId: base.id,
      installCommand: base.installCommand,
      installArgs: base.installArgs,
      warnings: [...(base.warnings || [])],
    };
  }

  const typeDefault = vendorRule.installerType
    ? INSTALLER_TYPE_RECIPES[vendorRule.installerType]
    : base;

  return {
    recipeId: vendorRule.id,
    installCommand: vendorRule.installCommand || typeDefault.installCommand,
    installArgs: vendorRule.installArgs ?? typeDefault.installArgs,
    warnings: [...(vendorRule.warnings || []), ...(typeDefault.warnings || [])],
  };
}

/**
 * Build the single-process command that unpacks an archive and runs the
 * installer inside it.
 *
 * The Windows service starts exactly one process per package, so an archive has
 * to become one PowerShell invocation. `exit $p.ExitCode` is load-bearing:
 * without it PowerShell returns 0 whatever the installer did, and every archive
 * package would report success.
 */
export function buildArchiveCommand(
  packageId: string,
  archiveEntry: string,
  innerArgs: string
): { installCommand: string; installArgs: string } {
  const entry = archiveEntry.replace(/'/g, "''").replace(/\//g, '\\');
  const args = innerArgs.replace(/'/g, "''");
  const argumentList = args.trim() ? `-ArgumentList '${args}' ` : '';

  const script = [
    `$d = Join-Path $env:TEMP 'pkg-${packageId}'`,
    `Expand-Archive -LiteralPath {installer} -DestinationPath $d -Force`,
    `$exe = Join-Path $d '${entry}'`,
    `$p = Start-Process -FilePath $exe ${argumentList}-Wait -PassThru`,
    `exit $p.ExitCode`,
  ].join('; ');

  return {
    installCommand: 'powershell.exe',
    installArgs: `-NoProfile -ExecutionPolicy Bypass -Command "${script}"`,
  };
}
