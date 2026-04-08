const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-2';
const client = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(client);

async function updateNvidiaDriver() {
  const correctUrl = 'https://ec2-windows-nvidia-drivers.s3.amazonaws.com/latest/581.80_grid_win10_win11_server2022_server2025_dch_64bit_international_aws_swl.exe';
  
  console.log('Updating NVIDIA driver package with correct filename...\n');
  
  const params = {
    TableName: 'WorkstationBootstrapPackages',
    Key: { packageId: 'pkg-nvidia-grid-driver' },
    UpdateExpression: 'SET downloadUrl = :url, metadata.#src = :source, metadata.requiresIam = :iam, metadata.fileVersion = :version, updatedAt = :timestamp',
    ExpressionAttributeNames: {
      '#src': 'source'
    },
    ExpressionAttributeValues: {
      ':url': correctUrl,
      ':source': 'aws-s3',
      ':iam': 'true',
      ':version': '581.80',
      ':timestamp': new Date().toISOString()
    },
    ReturnValues: 'ALL_NEW'
  };

  try {
    const result = await docClient.send(new UpdateCommand(params));
    console.log('✅ Successfully updated NVIDIA driver package!\n');
    console.log('Updated Package Details:');
    console.log('- Package ID:', result.Attributes.packageId);
    console.log('- Name:', result.Attributes.name);
    console.log('- Download URL:', result.Attributes.downloadUrl);
    console.log('- Source:', result.Attributes.metadata?.source);
    console.log('- Requires IAM:', result.Attributes.metadata?.requiresIam);
    console.log('- File Version:', result.Attributes.metadata?.fileVersion);
    console.log('- Updated At:', result.Attributes.updatedAt);
    
    return result.Attributes;
  } catch (error) {
    console.error('❌ Error updating package:', error);
    throw error;
  }
}

updateNvidiaDriver()
  .then(() => {
    console.log('\n✅ NVIDIA driver package update complete!');
    console.log('\nNote: This S3 bucket requires IAM authentication.');
    console.log('EC2 instances with the WorkstationInstanceRole can access it.');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Update failed:', error.message);
    process.exit(1);
  });
