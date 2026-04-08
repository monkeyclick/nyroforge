import { APIGatewayProxyHandler } from 'aws-lambda';
import { EC2Client, DescribeImagesCommand } from '@aws-sdk/client-ec2';

// AMI name patterns for Windows Server versions
const AMI_PATTERNS: Record<string, string> = {
  'windows-server-2025': 'Windows_Server-2025-English-Full-Base*',
  'windows-server-2022': 'Windows_Server-2022-English-Full-Base*',
  'windows-server-2019': 'Windows_Server-2019-English-Full-Base*',
  'windows-server-2016': 'Windows_Server-2016-English-Full-Base*',
};

export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('AMI Validation Request:', JSON.stringify(event, null, 2));

  const headers = {
    'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { osVersion, region } = body;

    if (!osVersion || !region) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Missing required parameters: osVersion and region',
        }),
      };
    }

    const VALID_AWS_REGIONS = [
      'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
      'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-north-1',
      'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3', 'ap-south-1',
      'sa-east-1', 'ca-central-1', 'me-south-1', 'af-south-1'
    ];

    // Validate region to prevent SSRF
    if (region && !VALID_AWS_REGIONS.includes(region)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: `Invalid AWS region: ${region}` }),
      };
    }

    const pattern = AMI_PATTERNS[osVersion];
    if (!pattern) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: `Unknown OS version: ${osVersion}`,
          supportedVersions: Object.keys(AMI_PATTERNS),
        }),
      };
    }

    // Initialize EC2 client for the specified region
    const ec2Client = new EC2Client({ region });

    // Search for the latest AMI matching the pattern
    const command = new DescribeImagesCommand({
      Filters: [
        {
          Name: 'name',
          Values: [pattern],
        },
        {
          Name: 'state',
          Values: ['available'],
        },
        {
          Name: 'architecture',
          Values: ['x86_64'],
        },
      ],
      Owners: ['amazon'], // Only search official Amazon AMIs
    });

    const response = await ec2Client.send(command);
    const images = response.Images || [];

    if (images.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          available: false,
          message: `No AMI found for ${osVersion} in region ${region}`,
          osVersion,
          region,
        }),
      };
    }

    // Sort by creation date to get the latest AMI
    const sortedImages = images.sort((a, b) => {
      const dateA = new Date(a.CreationDate || 0).getTime();
      const dateB = new Date(b.CreationDate || 0).getTime();
      return dateB - dateA;
    });

    const latestAmi = sortedImages[0];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        available: true,
        ami: {
          id: latestAmi.ImageId,
          name: latestAmi.Name,
          description: latestAmi.Description,
          creationDate: latestAmi.CreationDate,
          architecture: latestAmi.Architecture,
          platform: latestAmi.PlatformDetails,
        },
        osVersion,
        region,
        totalAvailable: images.length,
        message: `Found ${images.length} available AMI(s) for ${osVersion} in ${region}`,
      }),
    };
  } catch (error) {
    console.error('AMI Validation Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to validate AMI',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};