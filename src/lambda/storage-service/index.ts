import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectsCommand,
  PutObjectCommand,
  HeadBucketCommand,
  ListBucketsCommand,
  DeleteBucketCommand,
  ListObjectVersionsCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SSMClient, GetParameterCommand, DeleteParameterCommand, PutParameterCommand, GetParametersByPathCommand } from '@aws-sdk/client-ssm';
import {
  EFSClient,
  DescribeFileSystemsCommand,
  DeleteFileSystemCommand,
  DescribeMountTargetsCommand,
  DeleteMountTargetCommand,
  DescribeAccessPointsCommand,
  DeleteAccessPointCommand,
} from '@aws-sdk/client-efs';
import {
  FSxClient,
  DescribeFileSystemsCommand as FSxDescribeFileSystemsCommand,
  DeleteFileSystemCommand as FSxDeleteFileSystemCommand,
  DescribeVolumesCommand,
  DeleteVolumeCommand,
  DescribeStorageVirtualMachinesCommand,
  DeleteStorageVirtualMachineCommand,
} from '@aws-sdk/client-fsx';

const s3Client = new S3Client({});
const ssmClient = new SSMClient({});
const efsClient = new EFSClient({});
const fsxClient = new FSxClient({});

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

interface StorageConfig {
  transferBucket: string;
  efsFileSystemId: string;
  efsAccessPointId: string;
  region: string;
}

async function getStorageConfig(): Promise<StorageConfig> {
  const environment = process.env.ENVIRONMENT || 'dev';
  const region = process.env.AWS_REGION || 'us-east-1';
  
  let transferBucket = '';
  let efsFileSystemId = '';
  let efsAccessPointId = '';
  
  try {
    const bucketParam = await ssmClient.send(new GetParameterCommand({
      Name: `/${environment}/storage/transfer-bucket`,
    }));
    transferBucket = bucketParam.Parameter?.Value || '';
  } catch (e) {
    console.log('Transfer bucket parameter not found');
  }
  
  try {
    const efsParam = await ssmClient.send(new GetParameterCommand({
      Name: `/${environment}/storage/efs-file-system-id`,
    }));
    efsFileSystemId = efsParam.Parameter?.Value || '';
  } catch (e) {
    console.log('EFS file system parameter not found');
  }
  
  try {
    const apParam = await ssmClient.send(new GetParameterCommand({
      Name: `/${environment}/storage/efs-access-point-id`,
    }));
    efsAccessPointId = apParam.Parameter?.Value || '';
  } catch (e) {
    console.log('EFS access point parameter not found');
  }
  
  return {
    transferBucket,
    efsFileSystemId,
    efsAccessPointId,
    region,
  };
}

async function listObjects(bucketName: string, prefix: string = ''): Promise<APIGatewayProxyResult> {
  try {
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      Delimiter: '/',
    });
    
    const response = await s3Client.send(command);
    
    const objects: any[] = [];
    let totalSize = 0;
    
    // Add folders (common prefixes)
    if (response.CommonPrefixes) {
      for (const prefix of response.CommonPrefixes) {
        objects.push({
          key: prefix.Prefix,
          size: 0,
          lastModified: null,
          isFolder: true,
        });
      }
    }
    
    // Add files
    if (response.Contents) {
      for (const obj of response.Contents) {
        // Skip the prefix itself if it appears
        if (obj.Key === prefix) continue;
        
        objects.push({
          key: obj.Key,
          size: obj.Size || 0,
          lastModified: obj.LastModified?.toISOString(),
          storageClass: obj.StorageClass,
          isFolder: false,
        });
        totalSize += obj.Size || 0;
      }
    }
    
    // Get total object count
    let totalObjects = 0;
    const countCommand = new ListObjectsV2Command({
      Bucket: bucketName,
    });
    const countResponse = await s3Client.send(countCommand);
    totalObjects = countResponse.KeyCount || 0;
    
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        objects,
        stats: {
          bucketName,
          totalObjects,
          totalSize,
        },
      }),
    };
  } catch (error) {
    console.error('Error listing objects:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to list objects', details: String(error) }),
    };
  }
}

async function getDownloadUrl(bucketName: string, key: string): Promise<APIGatewayProxyResult> {
  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    
    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ url }),
    };
  } catch (error) {
    console.error('Error generating download URL:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to generate download URL' }),
    };
  }
}

async function getUploadUrl(bucketName: string, key: string, contentType: string): Promise<APIGatewayProxyResult> {
  try {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: contentType,
    });
    
    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ url }),
    };
  } catch (error) {
    console.error('Error generating upload URL:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to generate upload URL' }),
    };
  }
}

async function deleteObjects(bucketName: string, keys: string[]): Promise<APIGatewayProxyResult> {
  try {
    const command = new DeleteObjectsCommand({
      Bucket: bucketName,
      Delete: {
        Objects: keys.map(key => ({ Key: key })),
      },
    });
    
    await s3Client.send(command);
    
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: `Successfully deleted ${keys.length} objects` }),
    };
  } catch (error) {
    console.error('Error deleting objects:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to delete objects' }),
    };
  }
}

async function getEfsStatus(fileSystemId: string): Promise<string> {
  if (!fileSystemId) return 'Not configured';
  
  try {
    const command = new DescribeFileSystemsCommand({
      FileSystemId: fileSystemId,
    });
    const response = await efsClient.send(command);
    
    if (response.FileSystems && response.FileSystems.length > 0) {
      return response.FileSystems[0].LifeCycleState || 'Unknown';
    }
    return 'Not found';
  } catch (error) {
    console.error('Error getting EFS status:', error);
    return 'Error';
  }
}

// List all deployed file systems
async function listFileSystems(): Promise<APIGatewayProxyResult> {
  try {
    const fileSystems: any[] = [];
    
    // List EFS file systems
    try {
      const efsCommand = new DescribeFileSystemsCommand({});
      const efsResponse = await efsClient.send(efsCommand);
      
      if (efsResponse.FileSystems) {
        for (const fs of efsResponse.FileSystems) {
          fileSystems.push({
            id: fs.FileSystemId,
            type: 'efs',
            name: fs.Name || fs.FileSystemId,
            status: fs.LifeCycleState,
            sizeInBytes: fs.SizeInBytes?.Value || 0,
            creationTime: fs.CreationTime?.toISOString(),
            encrypted: fs.Encrypted,
            performanceMode: fs.PerformanceMode,
            throughputMode: fs.ThroughputMode,
            tags: fs.Tags,
          });
        }
      }
    } catch (e) {
      console.log('Error listing EFS:', e);
    }
    
    // List FSx file systems
    try {
      const fsxCommand = new FSxDescribeFileSystemsCommand({});
      const fsxResponse = await fsxClient.send(fsxCommand);
      
      if (fsxResponse.FileSystems) {
        for (const fs of fsxResponse.FileSystems) {
          let fsType = 'fsx';
          if (fs.FileSystemType === 'WINDOWS') fsType = 'fsx-windows';
          else if (fs.FileSystemType === 'LUSTRE') fsType = 'fsx-lustre';
          else if (fs.FileSystemType === 'ONTAP') fsType = 'fsx-ontap';
          else if (fs.FileSystemType === 'OPENZFS') fsType = 'fsx-openzfs';
          
          fileSystems.push({
            id: fs.FileSystemId,
            type: fsType,
            name: fs.Tags?.find((t: { Key?: string; Value?: string }) => t.Key === 'Name')?.Value || fs.FileSystemId,
            status: fs.Lifecycle,
            storageCapacity: fs.StorageCapacity,
            storageType: fs.StorageType,
            creationTime: fs.CreationTime?.toISOString(),
            vpcId: fs.VpcId,
            subnetIds: fs.SubnetIds,
            dnsName: fs.DNSName,
            tags: fs.Tags,
          });
        }
      }
    } catch (e) {
      console.log('Error listing FSx:', e);
    }
    
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ fileSystems }),
    };
  } catch (error) {
    console.error('Error listing file systems:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to list file systems', details: String(error) }),
    };
  }
}

// Delete an EFS file system
async function deleteEfsFileSystem(fileSystemId: string): Promise<APIGatewayProxyResult> {
  try {
    console.log(`Deleting EFS file system: ${fileSystemId}`);
    
    // First, delete all access points
    try {
      const apCommand = new DescribeAccessPointsCommand({ FileSystemId: fileSystemId });
      const apResponse = await efsClient.send(apCommand);
      
      if (apResponse.AccessPoints) {
        for (const ap of apResponse.AccessPoints) {
          console.log(`Deleting access point: ${ap.AccessPointId}`);
          await efsClient.send(new DeleteAccessPointCommand({ AccessPointId: ap.AccessPointId }));
        }
      }
    } catch (e) {
      console.log('Error deleting access points:', e);
    }
    
    // Then, delete all mount targets
    try {
      const mtCommand = new DescribeMountTargetsCommand({ FileSystemId: fileSystemId });
      const mtResponse = await efsClient.send(mtCommand);
      
      if (mtResponse.MountTargets) {
        for (const mt of mtResponse.MountTargets) {
          console.log(`Deleting mount target: ${mt.MountTargetId}`);
          await efsClient.send(new DeleteMountTargetCommand({ MountTargetId: mt.MountTargetId }));
        }
        
        // Wait for mount targets to be deleted (they take time)
        console.log('Waiting for mount targets to be deleted...');
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
      }
    } catch (e) {
      console.log('Error deleting mount targets:', e);
    }
    
    // Finally, delete the file system
    await efsClient.send(new DeleteFileSystemCommand({ FileSystemId: fileSystemId }));
    
    // Clean up SSM parameters
    const environment = process.env.ENVIRONMENT || 'dev';
    try {
      await ssmClient.send(new DeleteParameterCommand({ Name: `/${environment}/storage/efs-file-system-id` }));
      await ssmClient.send(new DeleteParameterCommand({ Name: `/${environment}/storage/efs-access-point-id` }));
    } catch (e) {
      console.log('Error cleaning up SSM parameters:', e);
    }
    
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: `EFS file system ${fileSystemId} deletion initiated`,
        note: 'Mount targets and access points have been deleted. File system deletion may take a few minutes to complete.',
      }),
    };
  } catch (error: any) {
    console.error('Error deleting EFS:', error);
    
    // Check if mount targets still exist
    if (error.name === 'FileSystemInUse') {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'File system is still in use. Mount targets may still be deleting. Please wait a few minutes and try again.',
          details: String(error),
        }),
      };
    }
    
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to delete EFS file system', details: String(error) }),
    };
  }
}

// Delete an FSx file system
async function deleteFsxFileSystem(fileSystemId: string, fileSystemType: string): Promise<APIGatewayProxyResult> {
  try {
    console.log(`Deleting FSx file system: ${fileSystemId} (type: ${fileSystemType})`);
    
    // For ONTAP, we need to delete volumes and SVMs first
    if (fileSystemType === 'fsx-ontap' || fileSystemType === 'ONTAP') {
      // Delete volumes first
      try {
        const volCommand = new DescribeVolumesCommand({
          Filters: [{ Name: 'file-system-id', Values: [fileSystemId] }],
        });
        const volResponse = await fsxClient.send(volCommand);
        
        if (volResponse.Volumes) {
          for (const vol of volResponse.Volumes) {
            // Skip root volumes, they get deleted with the SVM
            if (vol.OntapConfiguration?.OntapVolumeType === 'RW') {
              console.log(`Deleting volume: ${vol.VolumeId}`);
              await fsxClient.send(new DeleteVolumeCommand({
                VolumeId: vol.VolumeId,
                OntapConfiguration: { SkipFinalBackup: true },
              }));
            }
          }
        }
      } catch (e) {
        console.log('Error deleting volumes:', e);
      }
      
      // Delete SVMs
      try {
        const svmCommand = new DescribeStorageVirtualMachinesCommand({
          Filters: [{ Name: 'file-system-id', Values: [fileSystemId] }],
        });
        const svmResponse = await fsxClient.send(svmCommand);
        
        if (svmResponse.StorageVirtualMachines) {
          for (const svm of svmResponse.StorageVirtualMachines) {
            console.log(`Deleting SVM: ${svm.StorageVirtualMachineId}`);
            await fsxClient.send(new DeleteStorageVirtualMachineCommand({
              StorageVirtualMachineId: svm.StorageVirtualMachineId,
            }));
          }
        }
      } catch (e) {
        console.log('Error deleting SVMs:', e);
      }
      
      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
    
    // Delete the file system
    const deleteParams: any = { FileSystemId: fileSystemId };
    
    if (fileSystemType === 'fsx-windows' || fileSystemType === 'WINDOWS') {
      deleteParams.WindowsConfiguration = { SkipFinalBackup: true };
    } else if (fileSystemType === 'fsx-lustre' || fileSystemType === 'LUSTRE') {
      deleteParams.LustreConfiguration = { SkipFinalBackup: true };
    } else if (fileSystemType === 'fsx-openzfs' || fileSystemType === 'OPENZFS') {
      deleteParams.OpenZFSConfiguration = { SkipFinalBackup: true };
    }
    
    await fsxClient.send(new FSxDeleteFileSystemCommand(deleteParams));
    
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: `FSx file system ${fileSystemId} deletion initiated`,
        note: 'File system deletion may take 10-30 minutes to complete.',
      }),
    };
  } catch (error) {
    console.error('Error deleting FSx:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to delete FSx file system', details: String(error) }),
    };
  }
}

// Delete an S3 bucket (must be empty first)
async function deleteS3Bucket(bucketName: string): Promise<APIGatewayProxyResult> {
  try {
    console.log(`Deleting S3 bucket: ${bucketName}`);
    
    // First, delete all objects and versions
    let continuationToken: string | undefined;
    do {
      const listCommand = new ListObjectVersionsCommand({
        Bucket: bucketName,
        KeyMarker: continuationToken,
      });
      const listResponse = await s3Client.send(listCommand);
      
      const objectsToDelete: { Key: string; VersionId?: string }[] = [];
      
      if (listResponse.Versions) {
        for (const version of listResponse.Versions) {
          if (version.Key) {
            objectsToDelete.push({ Key: version.Key, VersionId: version.VersionId });
          }
        }
      }
      
      if (listResponse.DeleteMarkers) {
        for (const marker of listResponse.DeleteMarkers) {
          if (marker.Key) {
            objectsToDelete.push({ Key: marker.Key, VersionId: marker.VersionId });
          }
        }
      }
      
      if (objectsToDelete.length > 0) {
        await s3Client.send(new DeleteObjectsCommand({
          Bucket: bucketName,
          Delete: { Objects: objectsToDelete },
        }));
      }
      
      continuationToken = listResponse.NextKeyMarker;
    } while (continuationToken);
    
    // Now delete the bucket
    await s3Client.send(new DeleteBucketCommand({ Bucket: bucketName }));
    
    // Clean up SSM parameter
    const environment = process.env.ENVIRONMENT || 'dev';
    try {
      await ssmClient.send(new DeleteParameterCommand({ Name: `/${environment}/storage/transfer-bucket` }));
    } catch (e) {
      console.log('Error cleaning up SSM parameter:', e);
    }
    
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: `S3 bucket ${bucketName} has been deleted`,
      }),
    };
  } catch (error) {
    console.error('Error deleting S3 bucket:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to delete S3 bucket', details: String(error) }),
    };
  }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Storage service request:', JSON.stringify(event, null, 2));
  
  // Handle OPTIONS requests for CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: '',
    };
  }
  
  const path = event.path;
  const method = event.httpMethod;
  
  try {
    // Authentication check - require valid authorizer claims
    const claims = event.requestContext?.authorizer?.claims;
    if (!claims || !claims.sub) {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Unauthorized - authentication required' })
      };
    }

    const userId = claims.sub;

    const config = await getStorageConfig();
    
    // GET /admin/storage/config
    if (path.endsWith('/config') && method === 'GET') {
      const efsStatus = await getEfsStatus(config.efsFileSystemId);
      
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          ...config,
          efsStatus,
        }),
      };
    }
    
    // GET /admin/storage/list
    if (path.endsWith('/list') && method === 'GET') {
      if (!config.transferBucket) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Transfer bucket not configured' }),
        };
      }
      
      const prefix = event.queryStringParameters?.prefix || '';
      return await listObjects(config.transferBucket, prefix);
    }
    
    // GET /admin/storage/download
    if (path.endsWith('/download') && method === 'GET') {
      if (!config.transferBucket) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Transfer bucket not configured' }),
        };
      }
      
      const key = event.queryStringParameters?.key;
      if (!key) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Missing key parameter' }),
        };
      }
      
      return await getDownloadUrl(config.transferBucket, key);
    }
    
    // POST /admin/storage/upload-url
    if (path.endsWith('/upload-url') && method === 'POST') {
      if (!config.transferBucket) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Transfer bucket not configured' }),
        };
      }
      
      const body = JSON.parse(event.body || '{}');
      const { key, contentType } = body;
      
      if (!key) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Missing key parameter' }),
        };
      }
      
      return await getUploadUrl(config.transferBucket, key, contentType || 'application/octet-stream');
    }
    
    // DELETE /admin/storage/delete (S3 objects)
    if (path.endsWith('/delete') && method === 'DELETE') {
      if (!config.transferBucket) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Transfer bucket not configured' }),
        };
      }
      
      const body = JSON.parse(event.body || '{}');
      const { keys } = body;
      
      if (!keys || !Array.isArray(keys) || keys.length === 0) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Missing or empty keys array' }),
        };
      }
      
      return await deleteObjects(config.transferBucket, keys);
    }
    
    // GET /admin/storage/filesystems - List all deployed file systems
    if (path.endsWith('/filesystems') && method === 'GET') {
      return await listFileSystems();
    }
    
    // DELETE /admin/storage/filesystem - Delete a file system
    if (path.endsWith('/filesystem') && method === 'DELETE') {
      const body = JSON.parse(event.body || '{}');
      const { fileSystemId, fileSystemType } = body;
      
      if (!fileSystemId) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Missing fileSystemId parameter' }),
        };
      }
      
      if (!fileSystemType) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Missing fileSystemType parameter (efs, fsx-windows, fsx-lustre, fsx-ontap, fsx-openzfs, s3)' }),
        };
      }
      
      // Handle different file system types
      if (fileSystemType === 'efs') {
        return await deleteEfsFileSystem(fileSystemId);
      } else if (fileSystemType.startsWith('fsx')) {
        return await deleteFsxFileSystem(fileSystemId, fileSystemType);
      } else if (fileSystemType === 's3') {
        return await deleteS3Bucket(fileSystemId);
      } else {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: `Unknown file system type: ${fileSystemType}` }),
        };
      }
    }
    
    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Not found' }),
    };
    
  } catch (error) {
    console.error('Internal error:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'An internal error occurred. Please try again later.',
      }),
    };
  }
};