import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { EC2Client, DescribeRegionsCommand, DescribeInstanceTypesCommand, DescribeImagesCommand, _InstanceType } from '@aws-sdk/client-ec2';
import { SSMClient, GetParameterCommand, GetParametersCommand } from '@aws-sdk/client-ssm';

// Initialize AWS clients
const ec2Client = new EC2Client({});
const ssmClient = new SSMClient({});

interface RegionInfo {
  id: string;
  name: string;
  available: boolean;
  instanceTypes: string[];
}

interface InstanceTypeInfo {
  type: string;
  vcpus: number;
  memory: string;
  gpu: string;
  storage: string;
  network: string;
  hourlyCost: number;
  monthlyCost: number;
}

interface WindowsAMIInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  architecture: string;
  creationDate: string;
}

export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    const { path, httpMethod } = event;

    switch (httpMethod) {
      case 'GET':
        if (path.includes('/regions')) {
          return await getAvailableRegions();
        } else if (path.includes('/instance-types')) {
          return await getInstanceTypes();
        } else if (path.includes('/windows-amis')) {
          return await getWindowsAMIs();
        } else if (path.includes('/config')) {
          return await getSystemConfiguration();
        }
        break;
    }

    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({ message: 'Invalid request' }),
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Internal server error',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
};

async function getAvailableRegions(): Promise<APIGatewayProxyResult> {
  try {
    // Get all AWS regions
    const describeCommand = new DescribeRegionsCommand({});
    const regionsResult = await ec2Client.send(describeCommand);

    // Get allowed instance types for checking availability
    const allowedInstanceTypes = await getAllowedInstanceTypes();

    const regions: RegionInfo[] = [];

    for (const region of regionsResult.Regions || []) {
      const regionId = region.RegionName!;
      
      // Create regional EC2 client
      const regionalEC2 = new EC2Client({ region: regionId });
      
      try {
        // Check if G4/G5/G6 instances are available in this region
        const instanceTypesCommand = new DescribeInstanceTypesCommand({
          InstanceTypes: allowedInstanceTypes as _InstanceType[],
        });
        
        const instanceTypesResult = await regionalEC2.send(instanceTypesCommand);
        const availableTypes = instanceTypesResult.InstanceTypes?.map(it => it.InstanceType!) || [];
        
        regions.push({
          id: regionId,
          name: getRegionDisplayName(regionId),
          available: availableTypes.length > 0,
          instanceTypes: availableTypes,
        });

      } catch (error) {
        console.warn(`Could not check instance availability in region ${regionId}:`, error);
        // Region might not support the instance types or API might be unavailable
        // Still include it but mark as unavailable for GPU instances
        regions.push({
          id: regionId,
          name: getRegionDisplayName(regionId),
          available: false,
          instanceTypes: [],
        });
      }
    }

    // Sort regions by name for better UX
    regions.sort((a, b) => a.name.localeCompare(b.name));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600', // 1 hour cache
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        regions: regions, // Return ALL regions, not just available ones
        availableRegions: regions.filter(r => r.available), // Also provide filtered list
        totalRegions: regions.length,
        availableCount: regions.filter(r => r.available).length,
        lastUpdated: new Date().toISOString(),
      }),
    };

  } catch (error) {
    console.error('Error getting regions:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Failed to get regions',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

async function getInstanceTypes(): Promise<APIGatewayProxyResult> {
  try {
    console.log('getInstanceTypes: Starting...');
    const allowedTypes = await getAllowedInstanceTypes();
    console.log(`getInstanceTypes: Got ${allowedTypes.length} allowed types from SSM:`, allowedTypes.slice(0, 5), '...');
    
    // Get detailed information for each instance type
    const describeCommand = new DescribeInstanceTypesCommand({
      InstanceTypes: allowedTypes as _InstanceType[],
    });

    const result = await ec2Client.send(describeCommand);
    console.log(`getInstanceTypes: EC2 returned ${result.InstanceTypes?.length || 0} instance type details`);
    
    const instanceTypes: InstanceTypeInfo[] = (result.InstanceTypes || []).map(instanceType => {
      const type = instanceType.InstanceType!;
      const vcpus = instanceType.VCpuInfo?.DefaultVCpus || 0;
      const memoryMiB = instanceType.MemoryInfo?.SizeInMiB || 0;
      const memoryGB = Math.round(memoryMiB / 1024);
      
      // GPU information
      const gpuInfo = instanceType.GpuInfo?.Gpus?.[0];
      const gpuName = gpuInfo?.Name || 'Unknown GPU';
      const gpuCount = gpuInfo?.Count || 0;
      const gpu = gpuCount > 0 ? `${gpuCount}x ${gpuName}` : 'No GPU';
      
      // Storage information
      const ebsInfo = instanceType.EbsInfo;
      const storage = ebsInfo?.EbsOptimizedSupport === 'supported' ? 'EBS Optimized' : 'Standard EBS';
      
      // Network information
      const networkInfo = instanceType.NetworkInfo;
      const networkPerformance = networkInfo?.NetworkPerformance || 'Standard';
      
      // Cost information (approximate)
      const hourlyCost = getInstanceHourlyCost(type);
      const monthlyCost = hourlyCost * 24 * 30;

      return {
        type,
        vcpus,
        memory: `${memoryGB} GiB`,
        gpu,
        storage,
        network: networkPerformance,
        hourlyCost,
        monthlyCost: Math.round(monthlyCost * 100) / 100,
      };
    });

    // Sort by cost
    instanceTypes.sort((a, b) => a.hourlyCost - b.hourlyCost);

    console.log(`getInstanceTypes: Returning ${instanceTypes.length} instance types`);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate', // No caching - always fetch latest config
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        instanceTypes,
        totalTypes: instanceTypes.length,
        lastUpdated: new Date().toISOString(),
      }),
    };

  } catch (error) {
    console.error('Error getting instance types:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Failed to get instance types',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

async function getWindowsAMIs(): Promise<APIGatewayProxyResult> {
  try {
    const windowsVersions = await getSupportedWindowsVersions();
    const amis: WindowsAMIInfo[] = [];

    for (const version of windowsVersions) {
      const versionAMIs = await getLatestWindowsAMIsForVersion(version);
      amis.push(...versionAMIs);
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=1800', // 30 minutes cache
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        amis,
        totalAMIs: amis.length,
        lastUpdated: new Date().toISOString(),
      }),
    };

  } catch (error) {
    console.error('Error getting Windows AMIs:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Failed to get Windows AMIs',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

async function getSystemConfiguration(): Promise<APIGatewayProxyResult> {
  try {
    // Get all configuration parameters
    const parameterNames = [
      '/workstation/config/defaultInstanceType',
      '/workstation/config/allowedInstanceTypes',
      '/workstation/config/defaultAutoTerminateHours',
      '/workstation/config/windowsVersions',
    ];

    const getParametersCommand = new GetParametersCommand({
      Names: parameterNames,
    });

    const result = await ssmClient.send(getParametersCommand);
    
    const config: Record<string, any> = {};
    
    result.Parameters?.forEach(param => {
      const name = param.Name?.split('/').pop();
      let value = param.Value;
      
      // Parse JSON values
      if (name && ['allowedInstanceTypes', 'windowsVersions'].includes(name)) {
        try {
          value = JSON.parse(value || '[]');
        } catch (e) {
          console.warn(`Failed to parse JSON for parameter ${name}:`, e);
        }
      }
      
      if (name) {
        config[name] = value;
      }
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300', // 5 minutes cache
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        configuration: config,
        lastUpdated: new Date().toISOString(),
      }),
    };

  } catch (error) {
    console.error('Error getting system configuration:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: JSON.stringify({
        message: 'Failed to get system configuration',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

// Helper functions

async function getAllowedInstanceTypes(): Promise<string[]> {
  try {
    const getCommand = new GetParameterCommand({
      Name: '/workstation/config/allowedInstanceTypes',
    });

    const result = await ssmClient.send(getCommand);
    return JSON.parse(result.Parameter?.Value || '[]');
  } catch (error) {
    console.warn('Could not get allowed instance types from SSM, using defaults:', error);
    return [
      'g4dn.xlarge', 'g4dn.2xlarge', 'g4dn.4xlarge',
      'g5.xlarge', 'g5.2xlarge', 'g5.4xlarge',
      'g6.xlarge', 'g6.2xlarge', 'g6.4xlarge'
    ];
  }
}

async function getSupportedWindowsVersions(): Promise<string[]> {
  try {
    const getCommand = new GetParameterCommand({
      Name: '/workstation/config/windowsVersions',
    });

    const result = await ssmClient.send(getCommand);
    return JSON.parse(result.Parameter?.Value || '[]');
  } catch (error) {
    console.warn('Could not get Windows versions from SSM, using defaults:', error);
    return ['Windows Server 2019', 'Windows Server 2022'];
  }
}

async function getLatestWindowsAMIsForVersion(version: string): Promise<WindowsAMIInfo[]> {
  const versionMap: Record<string, string> = {
    'Windows Server 2019': 'Windows_Server-2019-English-Full-Base-*',
    'Windows Server 2022': 'Windows_Server-2022-English-Full-Base-*',
  };

  const namePattern = versionMap[version];
  if (!namePattern) return [];

  try {
    const describeCommand = new DescribeImagesCommand({
      Filters: [
        { Name: 'name', Values: [namePattern] },
        { Name: 'owner-id', Values: ['801119661308'] }, // Amazon's account ID
        { Name: 'state', Values: ['available'] },
        { Name: 'architecture', Values: ['x86_64'] },
      ],
      MaxResults: 5, // Get latest 5 AMIs
    });

    const result = await ec2Client.send(describeCommand);
    
    return (result.Images || [])
      .sort((a, b) => new Date(b.CreationDate || '').getTime() - new Date(a.CreationDate || '').getTime())
      .map(image => ({
        id: image.ImageId!,
        name: image.Name!,
        description: image.Description || '',
        version: version,
        architecture: image.Architecture || 'x86_64',
        creationDate: image.CreationDate || '',
      }));

  } catch (error) {
    console.error(`Failed to get AMIs for ${version}:`, error);
    return [];
  }
}

function getRegionDisplayName(regionId: string): string {
  const regionNames: Record<string, string> = {
    'us-east-1': 'US East (N. Virginia)',
    'us-east-2': 'US East (Ohio)',
    'us-west-1': 'US West (N. California)',
    'us-west-2': 'US West (Oregon)',
    'af-south-1': 'Africa (Cape Town)',
    'ap-east-1': 'Asia Pacific (Hong Kong)',
    'ap-northeast-1': 'Asia Pacific (Tokyo)',
    'ap-northeast-2': 'Asia Pacific (Seoul)',
    'ap-northeast-3': 'Asia Pacific (Osaka)',
    'ap-south-1': 'Asia Pacific (Mumbai)',
    'ap-south-2': 'Asia Pacific (Hyderabad)',
    'ap-southeast-1': 'Asia Pacific (Singapore)',
    'ap-southeast-2': 'Asia Pacific (Sydney)',
    'ap-southeast-3': 'Asia Pacific (Jakarta)',
    'ap-southeast-4': 'Asia Pacific (Melbourne)',
    'ca-central-1': 'Canada (Central)',
    'ca-west-1': 'Canada (Calgary)',
    'eu-central-1': 'Europe (Frankfurt)',
    'eu-central-2': 'Europe (Zurich)',
    'eu-north-1': 'Europe (Stockholm)',
    'eu-south-1': 'Europe (Milan)',
    'eu-south-2': 'Europe (Spain)',
    'eu-west-1': 'Europe (Ireland)',
    'eu-west-2': 'Europe (London)',
    'eu-west-3': 'Europe (Paris)',
    'il-central-1': 'Israel (Tel Aviv)',
    'me-central-1': 'Middle East (UAE)',
    'me-south-1': 'Middle East (Bahrain)',
    'sa-east-1': 'South America (São Paulo)',
    'us-gov-east-1': 'AWS GovCloud (US-East)',
    'us-gov-west-1': 'AWS GovCloud (US-West)',
  };

  return regionNames[regionId] || regionId;
}

function getInstanceHourlyCost(instanceType: string): number {
  // Approximate hourly costs for GPU instances (US East 1)
  const costs: Record<string, number> = {
    'g4dn.xlarge': 0.526,
    'g4dn.2xlarge': 0.752,
    'g4dn.4xlarge': 1.204,
    'g4dn.8xlarge': 2.176,
    'g5.xlarge': 1.006,
    'g5.2xlarge': 1.212,
    'g5.4xlarge': 2.030,
    'g5.8xlarge': 3.912,
    'g6.xlarge': 0.7125,
    'g6.2xlarge': 1.425,
    'g6.4xlarge': 2.85,
    'g6.8xlarge': 5.70,
  };
  
  return costs[instanceType] || 1.0; // Default fallback
}