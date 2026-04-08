/**
 * Seed script to populate default bootstrap packages
 * Includes NVIDIA GRID drivers and common media/entertainment applications
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
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
    installCommand: 'Start-Process',
    installArgs: '-FilePath "C:\\Temp\\GRID-550-latest.exe" -ArgumentList "/s /noeula /noreboot" -Wait',
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
    installCommand: 'Start-Process',
    installArgs: '-FilePath "C:\\Temp\\amd-software-pro-edition.exe" -ArgumentList "/S" -Wait',
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
    installCommand: 'Start-Process',
    installArgs: '-FilePath "C:\\Temp\\7z2301-x64.exe" -ArgumentList "/S" -Wait',
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
    installCommand: 'Start-Process',
    installArgs: '-FilePath "C:\\Temp\\vlc-3.0.20-win64.exe" -ArgumentList "/S" -Wait',
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
    installCommand: 'Start-Process',
    installArgs: '-FilePath "msiexec.exe" -ArgumentList "/i C:\\Temp\\LibreOffice.msi /qn /norestart" -Wait',
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
    installCommand: 'Start-Process',
    installArgs: '-FilePath "C:\\Temp\\chrome_installer.exe" -ArgumentList "/silent /install" -Wait',
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
    installCommand: 'Start-Process',
    installArgs: '-FilePath "C:\\Temp\\npp.8.6.2.Installer.x64.exe" -ArgumentList "/S" -Wait',
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
    installCommand: 'Start-Process',
    installArgs: '-FilePath "C:\\Temp\\AcroRdrDC.exe" -ArgumentList "/sAll /rs /msi EULA_ACCEPT=YES" -Wait',
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
    installCommand: 'Expand-Archive',
    installArgs: '-Path "C:\\Temp\\ffmpeg-release-essentials.zip" -DestinationPath "C:\\Program Files\\FFmpeg" -Force; [Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\\Program Files\\FFmpeg\\bin", [EnvironmentVariableTarget]::Machine)',
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
    installCommand: 'Start-Process',
    installArgs: '-FilePath "C:\\Temp\\python-3.12.0-amd64.exe" -ArgumentList "/quiet InstallAllUsers=1 PrependPath=1" -Wait',
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
    installCommand: 'Start-Process',
    installArgs: '-FilePath "C:\\Temp\\OBS-Studio-Installer.exe" -ArgumentList "/S" -Wait',
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
    installCommand: 'Start-Process',
    installArgs: '-FilePath "C:\\Temp\\Git-2.43.0-64-bit.exe" -ArgumentList "/VERYSILENT /NORESTART" -Wait',
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
  {
    packageId: 'pkg-windows-optimization',
    name: 'Windows Server Optimization',
    description: 'Recommended Windows Server performance optimizations for media workstations',
    type: 'driver',
    category: 'graphics',
    downloadUrl: 'none',
    installCommand: 'powershell.exe',
    installArgs: `-Command "Set-ItemProperty -Path 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server' -name 'fDenyTSConnections' -value 0; Set-Service -Name 'Audiosrv' -StartupType Automatic; Start-Service Audiosrv; powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c; Disable-WindowsOptionalFeature -Online -FeatureName 'Internet-Explorer-Optional-amd64' -NoRestart"`,
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
      notes: 'Enables RDP, audio, high performance power plan, disables IE'
    }
  }
];

async function seedPackages() {
  console.log(`Seeding bootstrap packages to table: ${BOOTSTRAP_TABLE}`);
  console.log(`Total packages to seed: ${DEFAULT_PACKAGES.length}`);
  
  let successCount = 0;
  let errorCount = 0;

  for (const pkg of DEFAULT_PACKAGES) {
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
}

// Run the seeding
seedPackages()
  .then(() => {
    console.log('\nBootstrap packages seeded successfully!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\nFatal error during seeding:', error);
    process.exit(1);
  });