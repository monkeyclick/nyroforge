#!/usr/bin/env node

/**
 * Script to add Amazon DCV Server bootstrap package to DynamoDB
 * 
 * Usage: node scripts/seed-dcv-package.js
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-west-2' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.BOOTSTRAP_PACKAGES_TABLE || 'WorkstationBootstrapPackages';

const dcvPackage = {
  packageId: 'dcv-server-2024',
  name: 'Amazon DCV Server 2024',
  description: 'NICE DCV Server for high-performance remote desktop with UDP QUIC. Provides 30-50% lower latency than RDP and supports 4K streaming.',
  type: 'application',
  category: 'remote-access',
  downloadUrl: 'https://d1uj6qtbmh3dt5.cloudfront.net/nice-dcv-server-x64-Release.msi',
  installCommand: 'Start-Process msiexec.exe -ArgumentList',
  installArgs: '/i INSTALLER_PATH /quiet /norestart ADDLOCAL=ALL',
  requiresGpu: false,
  supportedGpuFamilies: [], // Works with or without GPU
  osVersions: [
    'windows-server-2025',
    'windows-server-2022',
    'windows-server-2019',
    'windows-server-2016'
  ],
  isRequired: 'false', // Optional package, user can choose RDP or DCV (stored as string for GSI)
  isEnabled: 'true', // Stored as string for GSI compatibility
  order: 15, // Install after drivers but before applications
  estimatedInstallTimeMinutes: 5,
  metadata: {
    version: '2024.1',
    vendor: 'AWS/NICE',
    ports: [8443],
    protocols: ['TCP', 'UDP'],
    quicEnabled: true,
    features: [
      'High-performance streaming protocol',
      'UDP QUIC for low latency',
      'Hardware-accelerated encoding',
      '4K resolution support',
      'Web browser access (HTML5)',
      'Multi-session support',
      'Linux and Windows client support'
    ],
    documentation: 'https://docs.aws.amazon.com/dcv/',
    clientDownload: 'https://www.amazondcv.com/'
  }
};

async function seedDcvPackage() {
  console.log('='.repeat(80));
  console.log('Amazon DCV Bootstrap Package Seeding Script');
  console.log('='.repeat(80));
  console.log(`Target Table: ${TABLE_NAME}`);
  console.log(`AWS Region: ${process.env.AWS_REGION || 'us-west-2'}`);
  console.log('');

  try {
    console.log('Creating DCV bootstrap package...');
    console.log('Package details:');
    console.log(`  - ID: ${dcvPackage.packageId}`);
    console.log(`  - Name: ${dcvPackage.name}`);
    console.log(`  - Installer URL: ${dcvPackage.downloadUrl}`);
    console.log(`  - Ports: TCP 8443, UDP 8443`);
    console.log(`  - QUIC Enabled: Yes`);
    console.log('');

    const command = new PutCommand({
      TableName: TABLE_NAME,
      Item: dcvPackage
    });

    await docClient.send(command);

    console.log('✅ Successfully added DCV bootstrap package to DynamoDB');
    console.log('');
    console.log('Package Configuration:');
    console.log(`  - Installation Order: ${dcvPackage.order}`);
    console.log(`  - Estimated Install Time: ${dcvPackage.estimatedInstallTimeMinutes} minutes`);
    console.log(`  - Required: ${dcvPackage.isRequired ? 'Yes' : 'No (Optional)'}`);
    console.log(`  - Enabled: ${dcvPackage.isEnabled ? 'Yes' : 'No'}`);
    console.log('');
    console.log('Supported OS Versions:');
    dcvPackage.osVersions.forEach(os => {
      console.log(`  - ${os}`);
    });
    console.log('');
    console.log('Key Features:');
    dcvPackage.metadata.features.forEach(feature => {
      console.log(`  ✓ ${feature}`);
    });
    console.log('');
    console.log('='.repeat(80));
    console.log('DCV package is now available for workstation launches!');
    console.log('Users can select it from the Bootstrap Packages section.');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('❌ Error adding DCV package:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      code: error.$metadata?.httpStatusCode
    });
    process.exit(1);
  }
}

// Run the script
seedDcvPackage().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});