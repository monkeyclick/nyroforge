/**
 * Seed script to populate default bootstrap packages
 * Includes NVIDIA GRID drivers and common media/entertainment applications
 *
 * Install-command contract (see generateUserDataScript in
 * src/lambda/ec2-management/index.ts):
 *
 *   - `installCommand` holds the COMPLETE PowerShell command, with the literal
 *     token `${INSTALLER}` wherever the downloaded file's local path belongs.
 *     The launcher substitutes it with C:\Temp\<filename-from-downloadUrl>.
 *   - `installArgs` is null. It exists only for legacy catalog rows and is
 *     appended verbatim after the command when present.
 *   - `downloadUrl: 'none'` means nothing is downloaded and `installCommand`
 *     runs as an inline PowerShell statement.
 *
 * These entries previously hardcoded paths like "C:\Temp\LibreOffice.msi" that
 * did not match the filename in downloadUrl, so the installer was invoked
 * against a path that did not exist. Every failure was swallowed by the
 * try/catch around each package, so launches looked successful while the
 * software silently never installed.
 *
 * `isRequired` is stored as the STRING "true"/"false" because it is the
 * partition key of the RequiredIndex GSI. `isEnabled` is a real boolean.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-2';

const client = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(client);

// Get table name from environment or CloudFormation output
const BOOTSTRAP_TABLE = process.env.BOOTSTRAP_PACKAGES_TABLE || 'WorkstationBootstrapPackages';

const DEFAULT_PACKAGES = [
  // NVIDIA GRID Drivers
  {
    packageId: 'pkg-nvidia-grid-driver',
    name: 'NVIDIA GRID Driver',
    description: 'NVIDIA GRID driver for GPU workstations - Required for G4dn, G5, G6 instances',
    type: 'driver',
    category: 'graphics',
    downloadUrl: 'https://ec2-windows-nvidia-drivers.s3.amazonaws.com/latest/GRID-550-latest.exe',
    installCommand: 'Start-Process -FilePath "${INSTALLER}" -ArgumentList "/s /noeula /noreboot" -Wait',
    installArgs: null,
    requiresGpu: true,
    supportedGpuFamilies: ['NVIDIA'],
    osVersions: ['windows-server-2016', 'windows-server-2019', 'windows-server-2022', 'windows-server-2025'],
    isRequired: 'true', // Required for GPU instances - stored as string for GSI
    isEnabled: true,
    order: 10,
    estimatedInstallTimeMinutes: 8,
    metadata: {
      version: '550.x',
      vendor: 'NVIDIA',
      size: '~700MB',
      notes: 'Latest GRID driver from AWS. Automatically selected for GPU instance types.'
    }
  },

  // AMD GPU Drivers (for future AMD instances)
  {
    packageId: 'pkg-amd-gpu-driver',
    name: 'AMD GPU Driver',
    description: 'AMD Radeon Pro drivers for AMD GPU instances',
    type: 'driver',
    category: 'graphics',
    downloadUrl: 'https://drivers.amd.com/drivers/installer/22.40/beta/amd-software-pro-edition-23.q4.1-minimalsetup.exe',
    installCommand: 'Start-Process -FilePath "${INSTALLER}" -ArgumentList "/S" -Wait',
    installArgs: null,
    requiresGpu: true,
    supportedGpuFamilies: ['AMD'],
    osVersions: ['windows-server-2019', 'windows-server-2022', 'windows-server-2025'],
    isRequired: 'false',
    isEnabled: true,
    order: 11,
    estimatedInstallTimeMinutes: 10,
    metadata: {
      version: '23.Q4.1',
      vendor: 'AMD',
      size: '~500MB',
      notes: 'For AMD-based GPU instances (when available)'
    }
  },

  // 7-Zip
  {
    packageId: 'pkg-7zip',
    name: '7-Zip',
    description: 'File archiver with high compression ratio',
    type: 'application',
    category: 'utility',
    downloadUrl: 'https://www.7-zip.org/a/7z2301-x64.exe',
    installCommand: 'Start-Process -FilePath "${INSTALLER}" -ArgumentList "/S" -Wait',
    installArgs: null,
    requiresGpu: false,
    osVersions: ['windows-server-2016', 'windows-server-2019', 'windows-server-2022', 'windows-server-2025'],
    isRequired: 'false',
    isEnabled: true,
    order: 100,
    estimatedInstallTimeMinutes: 2,
    metadata: {
      version: '23.01',
      vendor: '7-Zip',
      size: '~1.5MB',
      notes: 'Popular file compression utility'
    }
  },

  // VLC Media Player
  {
    packageId: 'pkg-vlc',
    name: 'VLC Media Player',
    description: 'Free and open source cross-platform multimedia player',
    type: 'application',
    category: 'media',
    downloadUrl: 'https://get.videolan.org/vlc/3.0.20/win64/vlc-3.0.20-win64.exe',
    installCommand: 'Start-Process -FilePath "${INSTALLER}" -ArgumentList "/S" -Wait',
    installArgs: null,
    requiresGpu: false,
    osVersions: ['windows-server-2016', 'windows-server-2019', 'windows-server-2022', 'windows-server-2025'],
    isRequired: 'false',
    isEnabled: true,
    order: 110,
    estimatedInstallTimeMinutes: 3,
    metadata: {
      version: '3.0.20',
      vendor: 'VideoLAN',
      size: '~40MB',
      notes: 'Plays most multimedia files and streaming protocols'
    }
  },

  // LibreOffice (OpenOffice alternative - more actively maintained)
  {
    packageId: 'pkg-libreoffice',
    name: 'LibreOffice',
    description: 'Free and powerful office suite - successor to OpenOffice',
    type: 'application',
    category: 'productivity',
    downloadUrl: 'https://download.documentfoundation.org/libreoffice/stable/7.6.4/win/x86_64/LibreOffice_7.6.4_Win_x86-64.msi',
    installCommand: 'Start-Process -FilePath msiexec.exe -ArgumentList "/i ${INSTALLER} /qn /norestart" -Wait',
    installArgs: null,
    requiresGpu: false,
    osVersions: ['windows-server-2016', 'windows-server-2019', 'windows-server-2022', 'windows-server-2025'],
    isRequired: 'false',
    isEnabled: true,
    order: 120,
    estimatedInstallTimeMinutes: 5,
    metadata: {
      version: '7.6.4',
      vendor: 'The Document Foundation',
      size: '~300MB',
      notes: 'Includes Writer, Calc, Impress, Draw, and more'
    }
  },

  // Google Chrome
  {
    packageId: 'pkg-chrome',
    name: 'Google Chrome',
    description: 'Fast, secure web browser',
    type: 'application',
    category: 'utility',
    downloadUrl: 'https://dl.google.com/chrome/install/latest/chrome_installer.exe',
    installCommand: 'Start-Process -FilePath "${INSTALLER}" -ArgumentList "/silent /install" -Wait',
    installArgs: null,
    requiresGpu: false,
    osVersions: ['windows-server-2016', 'windows-server-2019', 'windows-server-2022', 'windows-server-2025'],
    isRequired: 'false',
    isEnabled: true,
    order: 130,
    estimatedInstallTimeMinutes: 3,
    metadata: {
      version: 'Latest',
      vendor: 'Google',
      size: '~90MB',
      notes: 'Automatically installs latest version'
    }
  },

  // Notepad++
  {
    packageId: 'pkg-notepadpp',
    name: 'Notepad++',
    description: 'Free source code editor and Notepad replacement',
    type: 'application',
    category: 'development',
    downloadUrl: 'https://github.com/notepad-plus-plus/notepad-plus-plus/releases/download/v8.6.2/npp.8.6.2.Installer.x64.exe',
    installCommand: 'Start-Process -FilePath "${INSTALLER}" -ArgumentList "/S" -Wait',
    installArgs: null,
    requiresGpu: false,
    osVersions: ['windows-server-2016', 'windows-server-2019', 'windows-server-2022', 'windows-server-2025'],
    isRequired: 'false',
    isEnabled: true,
    order: 140,
    estimatedInstallTimeMinutes: 2,
    metadata: {
      version: '8.6.2',
      vendor: 'Notepad++',
      size: '~5MB',
      notes: 'Supports multiple programming languages'
    }
  },

  // Adobe Acrobat Reader
  {
    packageId: 'pkg-acrobat-reader',
    name: 'Adobe Acrobat Reader DC',
    description: 'Free PDF reader with advanced features',
    type: 'application',
    category: 'productivity',
    downloadUrl: 'https://ardownload2.adobe.com/pub/adobe/reader/win/AcrobatDC/2300820360/AcroRdrDC2300820360_en_US.exe',
    installCommand: 'Start-Process -FilePath "${INSTALLER}" -ArgumentList "/sAll /rs /msi EULA_ACCEPT=YES" -Wait',
    installArgs: null,
    requiresGpu: false,
    osVersions: ['windows-server-2016', 'windows-server-2019', 'windows-server-2022', 'windows-server-2025'],
    isRequired: 'false',
    isEnabled: true,
    order: 150,
    estimatedInstallTimeMinutes: 4,
    metadata: {
      version: 'DC 23.008',
      vendor: 'Adobe',
      size: '~200MB',
      notes: 'Industry standard PDF viewer'
    }
  },

  // FFmpeg (media processing)
  {
    packageId: 'pkg-ffmpeg',
    name: 'FFmpeg',
    description: 'Complete solution to record, convert and stream audio and video',
    type: 'application',
    category: 'media',
    downloadUrl: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    installCommand: 'Expand-Archive -Path "${INSTALLER}" -DestinationPath "C:\\Program Files\\FFmpeg" -Force; [Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\\Program Files\\FFmpeg\\bin", [EnvironmentVariableTarget]::Machine)',
    installArgs: null,
    requiresGpu: false,
    osVersions: ['windows-server-2016', 'windows-server-2019', 'windows-server-2022', 'windows-server-2025'],
    isRequired: 'false',
    isEnabled: true,
    order: 160,
    estimatedInstallTimeMinutes: 2,
    metadata: {
      version: 'Latest',
      vendor: 'FFmpeg',
      size: '~100MB',
      notes: 'Command-line tool for video/audio processing'
    }
  },

  // Python (for scripting and automation)
  {
    packageId: 'pkg-python',
    name: 'Python 3.12',
    description: 'Programming language for general-purpose programming and automation',
    type: 'application',
    category: 'development',
    downloadUrl: 'https://www.python.org/ftp/python/3.12.0/python-3.12.0-amd64.exe',
    installCommand: 'Start-Process -FilePath "${INSTALLER}" -ArgumentList "/quiet InstallAllUsers=1 PrependPath=1" -Wait',
    installArgs: null,
    requiresGpu: false,
    osVersions: ['windows-server-2016', 'windows-server-2019', 'windows-server-2022', 'windows-server-2025'],
    isRequired: 'false',
    isEnabled: true,
    order: 170,
    estimatedInstallTimeMinutes: 5,
    metadata: {
      version: '3.12.0',
      vendor: 'Python Software Foundation',
      size: '~30MB',
      notes: 'Includes pip package manager'
    }
  },

  // OBS Studio (for screen recording/streaming)
  {
    packageId: 'pkg-obs-studio',
    name: 'OBS Studio',
    description: 'Free and open source software for video recording and live streaming',
    type: 'application',
    category: 'media',
    downloadUrl: 'https://cdn-fastly.obsproject.com/downloads/OBS-Studio-30.0.2-Full-Installer-x64.exe',
    installCommand: 'Start-Process -FilePath "${INSTALLER}" -ArgumentList "/S" -Wait',
    installArgs: null,
    requiresGpu: false,
    osVersions: ['windows-server-2019', 'windows-server-2022', 'windows-server-2025'],
    isRequired: 'false',
    isEnabled: true,
    order: 180,
    estimatedInstallTimeMinutes: 4,
    metadata: {
      version: '30.0.2',
      vendor: 'OBS Project',
      size: '~100MB',
      notes: 'Professional video recording and streaming'
    }
  },

  // Git for Windows
  {
    packageId: 'pkg-git',
    name: 'Git for Windows',
    description: 'Distributed version control system',
    type: 'application',
    category: 'development',
    downloadUrl: 'https://github.com/git-for-windows/git/releases/download/v2.43.0.windows.1/Git-2.43.0-64-bit.exe',
    installCommand: 'Start-Process -FilePath "${INSTALLER}" -ArgumentList "/VERYSILENT /NORESTART" -Wait',
    installArgs: null,
    requiresGpu: false,
    osVersions: ['windows-server-2016', 'windows-server-2019', 'windows-server-2022', 'windows-server-2025'],
    isRequired: 'false',
    isEnabled: true,
    order: 190,
    estimatedInstallTimeMinutes: 3,
    metadata: {
      version: '2.43.0',
      vendor: 'Git',
      size: '~50MB',
      notes: 'Includes Git Bash and GUI tools'
    }
  },

  // Windows Performance Optimizations
  //
  // downloadUrl 'none' means installCommand is spliced straight into the
  // generated PowerShell, so it must be a bare inline statement. It previously
  // put "-Command \"...\"" in installArgs with "powershell.exe" in
  // installCommand; the launcher prefers installArgs for 'none' packages, so
  // the generated script was a dangling "-Command" with no executable.
  {
    packageId: 'pkg-windows-optimization',
    name: 'Windows Server Optimization',
    description: 'Recommended Windows Server performance optimizations for media workstations',
    type: 'driver',
    category: 'graphics',
    downloadUrl: 'none',
    installCommand: "Set-ItemProperty -Path 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server' -Name 'fDenyTSConnections' -Value 0; Set-Service -Name 'Audiosrv' -StartupType Automatic; Start-Service Audiosrv -ErrorAction SilentlyContinue; powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c",
    installArgs: null,
    requiresGpu: false,
    osVersions: ['windows-server-2016', 'windows-server-2019', 'windows-server-2022', 'windows-server-2025'],
    isRequired: 'true',
    isEnabled: true,
    order: 5,
    estimatedInstallTimeMinutes: 1,
    metadata: {
      version: '1.0',
      vendor: 'System',
      size: 'N/A',
      notes: 'Enables RDP, audio and the high performance power plan'
    }
  }
];

/**
 * Fail fast on a catalog entry that cannot work at launch time, rather than
 * writing it and letting the workstation silently skip the install.
 */
function validatePackage(pkg) {
  if (pkg.downloadUrl !== 'none' && !pkg.installCommand.includes('${INSTALLER}')) {
    return 'installCommand must contain the ${INSTALLER} placeholder';
  }
  if (pkg.downloadUrl === 'none' && pkg.installCommand.includes('${INSTALLER}')) {
    return 'installCommand cannot use ${INSTALLER} when nothing is downloaded';
  }
  if (pkg.isRequired !== 'true' && pkg.isRequired !== 'false') {
    return 'isRequired must be the string "true" or "false" (RequiredIndex GSI key)';
  }
  if (typeof pkg.isEnabled !== 'boolean') {
    return 'isEnabled must be a boolean';
  }
  return null;
}

async function seedPackages() {
  console.log(`Seeding bootstrap packages to table: ${BOOTSTRAP_TABLE}`);
  console.log(`AWS Region: ${REGION}`);
  console.log(`Total packages to seed: ${DEFAULT_PACKAGES.length}`);

  let successCount = 0;
  let errorCount = 0;

  for (const pkg of DEFAULT_PACKAGES) {
    const invalid = validatePackage(pkg);
    if (invalid) {
      console.error(`✗ Invalid definition for ${pkg.name}: ${invalid}`);
      errorCount++;
      continue;
    }

    try {
      const timestamp = new Date().toISOString();
      await docClient.send(new PutCommand({
        TableName: BOOTSTRAP_TABLE,
        Item: {
          ...pkg,
          createdAt: timestamp,
          updatedAt: timestamp
        }
      }));
      console.log(`✓ Seeded: ${pkg.name}`);
      successCount++;
    } catch (error) {
      console.error(`✗ Failed to seed ${pkg.name}:`, error.message);
      errorCount++;
    }
  }

  console.log('\n=== Seeding Complete ===');
  console.log(`Success: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Total: ${DEFAULT_PACKAGES.length}`);

  return errorCount;
}

// Run the seeding. A non-zero exit on partial failure lets the deployment
// scripts stop and report instead of continuing past a half-seeded catalog.
seedPackages()
  .then(errorCount => {
    if (errorCount > 0) {
      console.error(`\n${errorCount} package(s) failed to seed.`);
      process.exit(1);
    }
    console.log('\nBootstrap packages seeded successfully!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\nFatal error during seeding:', error);
    process.exit(1);
  });
