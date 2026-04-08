#!/usr/bin/env node

/**
 * Fix Bootstrap Package URLs
 * 
 * This script updates broken package download URLs in the WorkstationBootstrapPackages
 * DynamoDB table with current, working URLs.
 */

const { DynamoDBClient, ScanCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-2';
const dynamoClient = new DynamoDBClient({ region: REGION });
const TABLE_NAME = 'WorkstationBootstrapPackages';

// Updated package URLs (as of November 2025)
const UPDATED_URLS = {
  // GPU Drivers
  'pkg-nvidia-grid-driver': {
    downloadUrl: 'https://us.download.nvidia.com/tesla/538.46/538.46-data-center-tesla-desktop-win10-win11-64bit-dch-international.exe',
    description: 'NVIDIA GRID vGPU driver for Tesla GPUs (latest stable)',
  },
  'pkg-nvidia-gaming-driver': {
    downloadUrl: 'https://us.download.nvidia.com/Windows/546.33/546.33-desktop-win10-win11-64bit-international-dch-whql.exe',
    description: 'NVIDIA Gaming GPU driver (latest Game Ready)',
  },
  
  // Browsers
  'pkg-chrome': {
    downloadUrl: 'https://dl.google.com/chrome/install/GoogleChromeStandaloneEnterprise64.msi',
    description: 'Google Chrome browser (Enterprise MSI)',
  },
  'pkg-firefox': {
    downloadUrl: 'https://download.mozilla.org/?product=firefox-msi-latest-ssl&os=win64&lang=en-US',
    description: 'Mozilla Firefox browser (MSI installer)',
  },
  
  // Office/Productivity
  'pkg-libreoffice': {
    downloadUrl: 'https://download.documentfoundation.org/libreoffice/stable/24.8.3/win/x86_64/LibreOffice_24.8.3_Win_x86-64.msi',
    description: 'LibreOffice office suite',
  },
  
  // Development Tools
  'pkg-vscode': {
    downloadUrl: 'https://code.visualstudio.com/sha/download?build=stable&os=win32-x64',
    description: 'Visual Studio Code',
  },
  'pkg-git': {
    downloadUrl: 'https://github.com/git-for-windows/git/releases/download/v2.43.0.windows.1/Git-2.43.0-64-bit.exe',
    description: 'Git for Windows',
  },
  'pkg-python': {
    downloadUrl: 'https://www.python.org/ftp/python/3.12.1/python-3.12.1-amd64.exe',
    description: 'Python 3.12',
  },
  'pkg-nodejs': {
    downloadUrl: 'https://nodejs.org/dist/v20.10.0/node-v20.10.0-x64.msi',
    description: 'Node.js LTS',
  },
  
  // Media Tools
  'pkg-vlc': {
    downloadUrl: 'https://get.videolan.org/vlc/3.0.20/win64/vlc-3.0.20-win64.exe',
    description: 'VLC Media Player',
  },
  'pkg-obs-studio': {
    downloadUrl: 'https://cdn-fastly.obsproject.com/downloads/OBS-Studio-30.0.2-Windows-Installer.exe',
    description: 'OBS Studio',
  },
  'pkg-blender': {
    downloadUrl: 'https://download.blender.org/release/Blender4.0/blender-4.0.2-windows-x64.msi',
    description: 'Blender 3D',
  },
  
  // Compression Tools
  'pkg-7zip': {
    downloadUrl: 'https://www.7-zip.org/a/7z2301-x64.exe',
    description: '7-Zip file archiver',
  },
  
  // Remote Desktop
  'pkg-nice-dcv': {
    downloadUrl: 'https://d1uj6qtbmh3dt5.cloudfront.net/nice-dcv-server-x64-Release-2023.1-16388.msi',
    description: 'NICE DCV Server',
  },
  
  // Utilities
  'pkg-notepadplusplus': {
    downloadUrl: 'https://github.com/notepad-plus-plus/notepad-plus-plus/releases/download/v8.6/npp.8.6.Installer.x64.exe',
    description: 'Notepad++',
  },
};

async function fixPackageUrls() {
  console.log('🔧 Fixing Bootstrap Package URLs...\n');
  console.log(`📊 Table: ${TABLE_NAME}`);
  console.log(`🌎 Region: ${REGION}\n`);
  
  try {
    // Scan all packages
    console.log('📥 Fetching all packages from DynamoDB...');
    const scanResult = await dynamoClient.send(new ScanCommand({
      TableName: TABLE_NAME,
    }));
    
    const packages = (scanResult.Items || []).map(item => unmarshall(item));
    console.log(`✅ Found ${packages.length} packages\n`);
    
    let updatedCount = 0;
    let skippedCount = 0;
    const errors = [];
    
    // Update each package if we have a new URL
    for (const pkg of packages) {
      const packageId = pkg.packageId;
      const currentUrl = pkg.downloadUrl;
      
      if (UPDATED_URLS[packageId]) {
        const newData = UPDATED_URLS[packageId];
        const newUrl = newData.downloadUrl;
        
        console.log(`📦 ${pkg.name || packageId}`);
        console.log(`   Package ID: ${packageId}`);
        console.log(`   Current URL: ${currentUrl.substring(0, 60)}...`);
        console.log(`   New URL: ${newUrl.substring(0, 60)}...`);
        
        try {
          // Update the package
          const updateCommand = new UpdateItemCommand({
            TableName: TABLE_NAME,
            Key: marshall({ packageId: packageId }),
            UpdateExpression: 'SET downloadUrl = :url, description = :desc, updatedAt = :timestamp',
            ExpressionAttributeValues: marshall({
              ':url': newUrl,
              ':desc': newData.description,
              ':timestamp': new Date().toISOString(),
            }),
          });
          
          await dynamoClient.send(updateCommand);
          console.log(`   ✅ Updated successfully\n`);
          updatedCount++;
        } catch (error) {
          console.error(`   ❌ Error: ${error.message}\n`);
          errors.push({ packageId, error: error.message });
        }
      } else {
        console.log(`⏭️  ${pkg.name || packageId} - No update available, skipping`);
        skippedCount++;
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Updated: ${updatedCount} packages`);
    console.log(`⏭️  Skipped: ${skippedCount} packages`);
    console.log(`❌ Errors: ${errors.length}`);
    
    if (errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      errors.forEach(err => {
        console.log(`   - ${err.packageId}: ${err.error}`);
      });
    }
    
    console.log('\n✨ Package URL fix complete!\n');
    
    // Return exit code
    return errors.length > 0 ? 1 : 0;
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    console.error('Stack:', error.stack);
    return 1;
  }
}

// Run the script
fixPackageUrls()
  .then(exitCode => {
    process.exit(exitCode);
  })
  .catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });