import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { EC2Client, DescribeInstanceTypesCommand, _InstanceType } from '@aws-sdk/client-ec2';
import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';

// Initialize AWS clients
const ec2Client = new EC2Client({});
const ssmClient = new SSMClient({});

const SSM_PARAMETER_NAME = '/workstation/config/allowedInstanceTypes';

interface InstanceTypeDetails {
  type: string;
  family: string;
  vcpus: number;
  memory: string;
  gpu: string;
  gpuMemory: string;
  storage: string;
  network: string;
  hourlyCost: number;
  monthlyCost: number;
  enabled: boolean;
}

interface UpdateInstanceTypesRequest {
  instanceTypes: string[];
}

interface DiscoverInstanceTypesRequest {
  families?: string[];
  region?: string;
}

export const handler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    const { path, httpMethod, body } = event;

    // Check admin authorization
    const claims = event.requestContext.authorizer?.claims;
    const groups = claims?.['cognito:groups'] || '';
    const isAdmin = groups.includes('workstation-admin');

    if (!isAdmin && httpMethod !== 'GET') {
      return {
        statusCode: 403,
        headers: getCORSHeaders(),
        body: JSON.stringify({ message: 'Admin access required' }),
      };
    }

    switch (httpMethod) {
      case 'GET':
        if (path.includes('/discover')) {
          return await discoverInstanceTypes(event);
        }
        return await getAllowedInstanceTypes();

      case 'PUT':
        return await updateAllowedInstanceTypes(body);

      case 'POST':
        if (path.includes('/discover')) {
          return await discoverInstanceTypes(event);
        }
        break;
    }

    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ message: 'Invalid request' }),
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        message: 'Internal server error',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
};

async function getAllowedInstanceTypes(): Promise<APIGatewayProxyResult> {
  try {
    // Get allowed instance types from SSM
    const getCommand = new GetParameterCommand({
      Name: SSM_PARAMETER_NAME,
    });

    const result = await ssmClient.send(getCommand);
    const allowedTypes = JSON.parse(result.Parameter?.Value || '[]');

    // Get detailed information for each instance type
    const instanceTypeDetails = await getInstanceTypeDetails(allowedTypes);

    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        instanceTypes: instanceTypeDetails,
        totalTypes: instanceTypeDetails.length,
        lastUpdated: new Date().toISOString(),
      }),
    };

  } catch (error) {
    console.error('Error getting allowed instance types:', error);
    return {
      statusCode: 500,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        message: 'Failed to get allowed instance types',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

async function updateAllowedInstanceTypes(body: string | null): Promise<APIGatewayProxyResult> {
  try {
    if (!body) {
      return {
        statusCode: 400,
        headers: getCORSHeaders(),
        body: JSON.stringify({ message: 'Request body is required' }),
      };
    }

    const request: UpdateInstanceTypesRequest = JSON.parse(body);
    
    if (!Array.isArray(request.instanceTypes)) {
      return {
        statusCode: 400,
        headers: getCORSHeaders(),
        body: JSON.stringify({ message: 'instanceTypes must be an array' }),
      };
    }

    // Validate instance types exist
    if (request.instanceTypes.length > 0) {
      const validateResult = await validateInstanceTypes(request.instanceTypes);
      if (!validateResult.valid) {
        return {
          statusCode: 400,
          headers: getCORSHeaders(),
          body: JSON.stringify({
            message: 'Invalid instance types',
            invalidTypes: validateResult.invalidTypes,
          }),
        };
      }
    }

    // Update SSM parameter
    const putCommand = new PutParameterCommand({
      Name: SSM_PARAMETER_NAME,
      Value: JSON.stringify(request.instanceTypes),
      Type: 'String',
      Overwrite: true,
      Description: 'Allowed EC2 instance types for workstations',
    });

    await ssmClient.send(putCommand);

    // Get updated details
    const instanceTypeDetails = await getInstanceTypeDetails(request.instanceTypes);

    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        message: 'Instance types updated successfully',
        instanceTypes: instanceTypeDetails,
        totalTypes: instanceTypeDetails.length,
        updatedAt: new Date().toISOString(),
      }),
    };

  } catch (error) {
    console.error('Error updating instance types:', error);
    return {
      statusCode: 500,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        message: 'Failed to update instance types',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

async function discoverInstanceTypes(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const request: DiscoverInstanceTypesRequest = body;

    // Default families to discover
    const families = request.families || ['g4dn', 'g5', 'g6', 'g4ad', 'p3', 'p4', 'p5'];
    const region = request.region || process.env.AWS_REGION || 'us-east-1';

    // Create regional EC2 client
    const regionalEC2 = new EC2Client({ region });

    // Discover all instance types matching the families
    const allInstanceTypes: InstanceTypeDetails[] = [];

    for (const family of families) {
      try {
        // Query for all sizes in this family
        const filters = [
          { Name: 'instance-type', Values: [`${family}.*`] },
        ];

        const command = new DescribeInstanceTypesCommand({
          Filters: filters,
          MaxResults: 100,
        });

        const result = await regionalEC2.send(command);
        
        if (result.InstanceTypes && result.InstanceTypes.length > 0) {
          const familyTypes = result.InstanceTypes.map(it => {
            const type = it.InstanceType!;
            const vcpus = it.VCpuInfo?.DefaultVCpus || 0;
            const memoryMiB = it.MemoryInfo?.SizeInMiB || 0;
            const memoryGB = Math.round(memoryMiB / 1024);
            
            // GPU information
            const gpuInfo = it.GpuInfo?.Gpus?.[0];
            const gpuName = gpuInfo?.Name || 'No GPU';
            const gpuCount = gpuInfo?.Count || 0;
            const gpuMemoryMiB = gpuInfo?.MemoryInfo?.SizeInMiB || 0;
            const gpuMemoryGB = gpuMemoryMiB > 0 ? Math.round(gpuMemoryMiB / 1024) : 0;
            
            const gpu = gpuCount > 0 ? `${gpuCount}x ${gpuName}` : 'None';
            const gpuMemory = gpuMemoryGB > 0 ? `${gpuMemoryGB} GiB` : 'N/A';
            
            // Storage information
            const ebsInfo = it.EbsInfo;
            const storage = ebsInfo?.EbsOptimizedSupport === 'supported' ? 'EBS Optimized' : 'Standard EBS';
            
            // Network information
            const networkInfo = it.NetworkInfo;
            const networkPerformance = networkInfo?.NetworkPerformance || 'Standard';
            
            // Cost information (approximate)
            const hourlyCost = estimateInstanceHourlyCost(type, region);
            const monthlyCost = hourlyCost * 24 * 30;

            return {
              type,
              family: type.split('.')[0],
              vcpus,
              memory: `${memoryGB} GiB`,
              gpu,
              gpuMemory,
              storage,
              network: networkPerformance,
              hourlyCost,
              monthlyCost: Math.round(monthlyCost * 100) / 100,
              enabled: false, // Not enabled by default
            };
          });

          allInstanceTypes.push(...familyTypes);
        }
      } catch (error) {
        console.warn(`Failed to discover ${family} family:`, error);
      }
    }

    // Sort by family and then by cost
    allInstanceTypes.sort((a, b) => {
      if (a.family !== b.family) {
        return a.family.localeCompare(b.family);
      }
      return a.hourlyCost - b.hourlyCost;
    });

    // Get currently allowed types
    let currentlyAllowed: string[] = [];
    try {
      const getCommand = new GetParameterCommand({
        Name: SSM_PARAMETER_NAME,
      });
      const result = await ssmClient.send(getCommand);
      currentlyAllowed = JSON.parse(result.Parameter?.Value || '[]');
    } catch (error) {
      console.warn('Could not get currently allowed types:', error);
    }

    // Mark currently allowed types as enabled
    allInstanceTypes.forEach(it => {
      it.enabled = currentlyAllowed.includes(it.type);
    });

    // Group by family
    const byFamily: Record<string, InstanceTypeDetails[]> = {};
    allInstanceTypes.forEach(it => {
      if (!byFamily[it.family]) {
        byFamily[it.family] = [];
      }
      byFamily[it.family].push(it);
    });

    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        instanceTypes: allInstanceTypes,
        byFamily,
        totalTypes: allInstanceTypes.length,
        families: Object.keys(byFamily),
        region,
        currentlyAllowed,
        lastUpdated: new Date().toISOString(),
      }),
    };

  } catch (error) {
    console.error('Error discovering instance types:', error);
    return {
      statusCode: 500,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        message: 'Failed to discover instance types',
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
}

async function getInstanceTypeDetails(instanceTypes: string[]): Promise<InstanceTypeDetails[]> {
  if (instanceTypes.length === 0) {
    return [];
  }

  try {
    const describeCommand = new DescribeInstanceTypesCommand({
      InstanceTypes: instanceTypes as _InstanceType[],
    });

    const result = await ec2Client.send(describeCommand);
    
    return (result.InstanceTypes || []).map(it => {
      const type = it.InstanceType!;
      const vcpus = it.VCpuInfo?.DefaultVCpus || 0;
      const memoryMiB = it.MemoryInfo?.SizeInMiB || 0;
      const memoryGB = Math.round(memoryMiB / 1024);
      
      // GPU information
      const gpuInfo = it.GpuInfo?.Gpus?.[0];
      const gpuName = gpuInfo?.Name || 'No GPU';
      const gpuCount = gpuInfo?.Count || 0;
      const gpuMemoryMiB = gpuInfo?.MemoryInfo?.SizeInMiB || 0;
      const gpuMemoryGB = gpuMemoryMiB > 0 ? Math.round(gpuMemoryMiB / 1024) : 0;
      
      const gpu = gpuCount > 0 ? `${gpuCount}x ${gpuName}` : 'None';
      const gpuMemory = gpuMemoryGB > 0 ? `${gpuMemoryGB} GiB` : 'N/A';
      
      // Storage information
      const ebsInfo = it.EbsInfo;
      const storage = ebsInfo?.EbsOptimizedSupport === 'supported' ? 'EBS Optimized' : 'Standard EBS';
      
      // Network information
      const networkInfo = it.NetworkInfo;
      const networkPerformance = networkInfo?.NetworkPerformance || 'Standard';
      
      // Cost information (approximate)
      const hourlyCost = estimateInstanceHourlyCost(type, process.env.AWS_REGION || 'us-east-1');
      const monthlyCost = hourlyCost * 24 * 30;

      return {
        type,
        family: type.split('.')[0],
        vcpus,
        memory: `${memoryGB} GiB`,
        gpu,
        gpuMemory,
        storage,
        network: networkPerformance,
        hourlyCost,
        monthlyCost: Math.round(monthlyCost * 100) / 100,
        enabled: true, // These are the allowed types, so they're enabled
      };
    });

  } catch (error) {
    console.error('Error getting instance type details:', error);
    return instanceTypes.map(type => ({
      type,
      family: type.split('.')[0],
      vcpus: 0,
      memory: 'Unknown',
      gpu: 'Unknown',
      gpuMemory: 'Unknown',
      storage: 'Unknown',
      network: 'Unknown',
      hourlyCost: 0,
      monthlyCost: 0,
      enabled: true,
    }));
  }
}

async function validateInstanceTypes(instanceTypes: string[]): Promise<{ valid: boolean; invalidTypes: string[] }> {
  try {
    const describeCommand = new DescribeInstanceTypesCommand({
      InstanceTypes: instanceTypes as _InstanceType[],
    });

    const result = await ec2Client.send(describeCommand);
    const validTypes = new Set<string>(result.InstanceTypes?.map(it => it.InstanceType as string) || []);
    
    const invalidTypes = instanceTypes.filter(type => !validTypes.has(type));
    
    return {
      valid: invalidTypes.length === 0,
      invalidTypes,
    };

  } catch (error) {
    console.error('Error validating instance types:', error);
    return {
      valid: false,
      invalidTypes: instanceTypes,
    };
  }
}

function estimateInstanceHourlyCost(instanceType: string, region: string): number {
  // Approximate hourly costs for GPU instances
  // Base costs from US East 1, apply region multiplier
  const baseCosts: Record<string, number> = {
    // G4dn family (NVIDIA T4)
    'g4dn.xlarge': 0.526,
    'g4dn.2xlarge': 0.752,
    'g4dn.4xlarge': 1.204,
    'g4dn.8xlarge': 2.176,
    'g4dn.12xlarge': 3.912,
    'g4dn.16xlarge': 4.352,
    
    // G5 family (NVIDIA A10G)
    'g5.xlarge': 1.006,
    'g5.2xlarge': 1.212,
    'g5.4xlarge': 2.030,
    'g5.8xlarge': 3.912,
    'g5.12xlarge': 5.672,
    'g5.16xlarge': 7.824,
    'g5.24xlarge': 11.736,
    'g5.48xlarge': 23.472,
    
    // G6 family (NVIDIA L4)
    'g6.xlarge': 0.7125,
    'g6.2xlarge': 1.425,
    'g6.4xlarge': 2.85,
    'g6.8xlarge': 5.70,
    'g6.12xlarge': 8.55,
    'g6.16xlarge': 11.40,
    'g6.24xlarge': 17.10,
    'g6.48xlarge': 34.20,
    
    // G4ad family (AMD Radeon Pro V520)
    'g4ad.xlarge': 0.378,
    'g4ad.2xlarge': 0.756,
    'g4ad.4xlarge': 1.512,
    'g4ad.8xlarge': 3.024,
    'g4ad.16xlarge': 6.048,
    
    // P3 family (NVIDIA V100)
    'p3.2xlarge': 3.06,
    'p3.8xlarge': 12.24,
    'p3.16xlarge': 24.48,
    
    // P4 family (NVIDIA A100)
    'p4d.24xlarge': 32.77,
    
    // P5 family (NVIDIA H100)
    'p5.48xlarge': 98.32,
  };

  // Region cost multipliers (approximate)
  const regionMultipliers: Record<string, number> = {
    'us-east-1': 1.0,
    'us-east-2': 1.0,
    'us-west-1': 1.1,
    'us-west-2': 1.0,
    'eu-west-1': 1.1,
    'eu-central-1': 1.1,
    'ap-northeast-1': 1.15,
    'ap-southeast-1': 1.1,
    'ap-southeast-2': 1.15,
  };

  const baseCost = baseCosts[instanceType] || 1.0;
  const multiplier = regionMultipliers[region] || 1.0;
  
  return Math.round(baseCost * multiplier * 100) / 100;
}

function getCORSHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  };
}