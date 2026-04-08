#!/usr/bin/env node

/**
 * Update NVIDIA Driver to Use AWS S3 Source
 * 
 * This script updates the NVIDIA GRID driver package to use AWS's official
 * S3 bucket instead of NVIDIA's public CDN. This is recommended for EC2
 * instances as it's optimized for AWS infrastructure.
 */

const { DynamoDBClient, UpdateItemCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-2';
const dynamoClient = new DynamoDBClient({ region: REGION });
const TABLE_NAME = 'WorkstationBootstrapPackages';

// AWS S3 configuration for NVIDIA drivers
const AWS_S3_CONFIG = {
  packageId: 'pkg-nvidia-grid-driver',
  downloadUrl: 'https://ec2-windows-nvidia-drivers.s3.amazonaws.com/latest/GRID_vGPU_Server_Driver_Latest.exe',
  description: 'NVIDIA GRID vGPU driver from AWS S3 (always latest)',
  requiresIam: true,
  installCommand: 'Start-Process',
  installArgs: 'INSTALLER_PATH -ArgumentList \'/s\', \'/noreboot\' -Wait',
};

async function updateNvidiaDriver() {
  console.log('🔄 Updating NVIDIA GRID Driver to AWS S3 Source...\n');
  console.log(`📊 Table: ${TABLE_NAME}`);
  console.log(`🌎 Region: ${REGION}\n`);
  
  try {
    // Get current package details
    console.log('📥 Fetching current package configuration...');
    const getResult = await dynamoClient.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ packageId: AWS_S3_CONFIG.packageId }),
    }));
    
    if (!getResult.Item) {
      console.error(`❌ Package ${AWS_S3_CONFIG.packageId} not found in table`);
      return 1;
    }
    
    const currentPackage = unmarshall(getResult.Item);
    console.log(`✅ Found package: ${currentPackage.name}`);
    console.log(`   Current URL: ${currentPackage.downloadUrl}\n`);
    
    // Update the package
    console.log('🔄 Updating package configuration...');
    const updateCommand = new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ packageId: AWS_S3_CONFIG.packageId }),
      UpdateExpression: 'SET downloadUrl = :url, description = :desc, updatedAt = :timestamp, metadata = :metadata',
      ExpressionAttributeValues: marshall({
        ':url': AWS_S3_CONFIG.downloadUrl,
        ':desc': AWS_S3_CONFIG.description,
        ':timestamp': new Date().toISOString(),
        ':metadata': {
          source: 'aws-s3',
          bucket: 'ec2-windows-nvidia-drivers',
          prefix: 'latest',
          requiresIam: true,
          iamPermissions: ['s3:GetObject'],
          note: 'AWS-managed NVIDIA GRID drivers, always latest version'
        }
      }),
    });
    
    await dynamoClient.send(updateCommand);
    console.log('✅ Package updated successfully\n');
    
    // Display new configuration
    console.log('📋 New Configuration:');
    console.log(`   Package ID: ${AWS_S3_CONFIG.packageId}`);
    console.log(`   Download URL: ${AWS_S3_CONFIG.downloadUrl}`);
    console.log(`   Description: ${AWS_S3_CONFIG.description}`);
    console.log(`   Source: AWS S3 (managed)`);
    console.log(`   Requires IAM: Yes`);
    console.log('');
    
    // Display required IAM permissions
    console.log('🔐 Required IAM Permissions:');
    console.log('   The EC2 instance profile needs the following permissions:');
    console.log('');
    console.log('   {');
    console.log('     "Effect": "Allow",');
    console.log('     "Action": ["s3:GetObject"],');
    console.log('     "Resource": "arn:aws:s3:::ec2-windows-nvidia-drivers/*"');
    console.log('   }');
    console.log('');
    
    console.log('✨ Update complete!');
    console.log('');
    console.log('⚠️  IMPORTANT NEXT STEPS:');
    console.log('   1. Update the EC2 instance profile IAM role');
    console.log('   2. Add S3 GetObject permission for ec2-windows-nvidia-drivers bucket');
    console.log('   3. Deploy updated IAM policy to CloudFormation');
    console.log('   4. Test driver download on a new workstation');
    console.log('');
    
    return 0;
    
  } catch (error) {
    console.error('\n❌ Error updating package:', error);
    console.error('Error details:', error.message);
    console.error('Stack:', error.stack);
    return 1;
  }
}

// Run the script
updateNvidiaDriver()
  .then(exitCode => {
    process.exit(exitCode);
  })
  .catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });