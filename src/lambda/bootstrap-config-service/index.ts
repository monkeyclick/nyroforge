import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand, GetItemCommand, UpdateItemCommand, DeleteItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { requireAdmin } from '../shared/auth';
import { logEvent } from '../shared/logging';
import { corsHeaders } from '../shared/http';
import { scanAllItems } from '../shared/dynamo';
import { effectiveStatus, PackageAnalysis, PackageStatus, PackageVerification } from '../shared/packages';

const dynamoClient = new DynamoDBClient({});
const s3Client = new S3Client({});
const BOOTSTRAP_TABLE = process.env.BOOTSTRAP_PACKAGES_TABLE!;
const QUEUE_TABLE = process.env.PACKAGE_QUEUE_TABLE || '';

export interface BootstrapPackage {
  packageId: string;
  name: string;
  description: string;
  type: 'driver' | 'application';
  category: 'graphics' | 'utility' | 'productivity' | 'media' | 'development';
  downloadUrl: string;
  installCommand: string;
  installArgs?: string;
  expectedSha256?: string; // Hex SHA-256 of the installer; verified on the workstation before execution
  requiresGpu?: boolean; // Only install on GPU instances
  supportedGpuFamilies?: string[]; // e.g., ['NVIDIA', 'AMD']
  osVersions: string[]; // Which Windows versions support this
  isRequired: boolean; // Admin-controlled: must be installed
  isEnabled: boolean; // Admin-controlled: available for selection
  order: number; // Installation order (lower = earlier)
  estimatedInstallTimeMinutes: number;
  metadata?: {
    version?: string;
    vendor?: string;
    size?: string;
    notes?: string;
  };
  // Populated for uploaded packages; absent on hand-entered URL packages.
  source?: 'url' | 's3';
  s3Bucket?: string;
  s3Key?: string;
  fileName?: string;
  fileSizeBytes?: number;
  status?: PackageStatus;
  uploadedBy?: string;
  uploadedAt?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  analysis?: PackageAnalysis;
  verification?: PackageVerification;
  createdAt: string;
  updatedAt: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logEvent(event, 'Bootstrap Config Service - Event');

  const headers = corsHeaders();

  try {
    const { httpMethod, pathParameters, body } = event;

    // Reads are available to any authenticated user (the launch flow lists
    // bootstrap packages); mutations are admin-only.
    if (httpMethod === 'POST' || httpMethod === 'PUT' || httpMethod === 'DELETE') {
      const denied = requireAdmin(event);
      if (denied) {
        return denied;
      }
    }

    switch (httpMethod) {
      case 'GET':
        if (pathParameters?.packageId) {
          return await getPackage(pathParameters.packageId, headers);
        } else {
          return await listPackages(headers, event.queryStringParameters?.status || undefined);
        }

      case 'POST': {
        let createData: any;
        try {
          createData = JSON.parse(body || '{}');
        } catch {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ message: 'Request body is not valid JSON' }),
          };
        }
        return await createPackage(createData, headers);
      }

      case 'PUT':
        if (pathParameters?.packageId) {
          let updateData: any;
          try {
            updateData = JSON.parse(body || '{}');
          } catch {
            return {
              statusCode: 400,
              headers,
              body: JSON.stringify({ message: 'Request body is not valid JSON' }),
            };
          }
          return await updatePackage(pathParameters.packageId, updateData, headers);
        }
        break;

      case 'DELETE':
        if (pathParameters?.packageId) {
          return await deletePackage(pathParameters.packageId, headers);
        }
        break;
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ message: 'Invalid request' }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        message: 'Internal server error'
      }),
    };
  }
};

async function createPackage(data: Partial<BootstrapPackage>, headers: any): Promise<APIGatewayProxyResult> {
  // These fields are asserted non-null below (`data.field!`); without this
  // check a missing field silently stores `undefined` instead of failing.
  const requiredFields: (keyof BootstrapPackage)[] = [
    'name', 'description', 'type', 'category', 'downloadUrl', 'installCommand',
  ];
  const missingField = requiredFields.find((field) => !data[field]);
  if (missingField) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ message: `Missing required field: ${missingField}` }),
    };
  }

  const packageId = `pkg-${uuidv4()}`;
  const timestamp = new Date().toISOString();

  const pkg: BootstrapPackage = {
    packageId,
    name: data.name!,
    description: data.description!,
    type: data.type!,
    category: data.category!,
    downloadUrl: data.downloadUrl!,
    installCommand: data.installCommand!,
    installArgs: data.installArgs,
    expectedSha256: data.expectedSha256,
    requiresGpu: data.requiresGpu || false,
    supportedGpuFamilies: data.supportedGpuFamilies || [],
    osVersions: data.osVersions || ['windows-server-2019', 'windows-server-2022', 'windows-server-2025'],
    isRequired: data.isRequired || false,
    isEnabled: data.isEnabled !== undefined ? data.isEnabled : true,
    order: data.order || 100,
    estimatedInstallTimeMinutes: data.estimatedInstallTimeMinutes || 5,
    metadata: data.metadata || {},
    // Hand-entered URL packages are curated by an admin at creation time, so
    // they are approved on arrival. Uploaded packages never come through here —
    // package-upload-service creates those with status 'uploading'.
    source: 'url',
    status: 'approved',
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  // Convert booleans to strings for DynamoDB GSI compatibility
  const dynamoItem = {
    ...pkg,
    isRequired: pkg.isRequired ? 'true' : 'false',
    isEnabled: pkg.isEnabled ? 'true' : 'false',
  };

  await dynamoClient.send(new PutItemCommand({
    TableName: BOOTSTRAP_TABLE,
    Item: marshall(dynamoItem),
  }));

  return {
    statusCode: 201,
    headers,
    body: JSON.stringify(pkg),
  };
}

async function getPackage(packageId: string, headers: any): Promise<APIGatewayProxyResult> {
  const result = await dynamoClient.send(new GetItemCommand({
    TableName: BOOTSTRAP_TABLE,
    Key: marshall({ packageId }),
  }));

  if (!result.Item) {
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ message: 'Package not found' }),
    };
  }

  const pkg = unmarshall(result.Item) as any;
  // Convert string booleans back to actual booleans
  pkg.isRequired = pkg.isRequired === 'true' || pkg.isRequired === true;
  pkg.isEnabled = pkg.isEnabled === 'true' || pkg.isEnabled === true;

  const verification = await hydrateVerification(pkg);
  if (verification) {
    pkg.verification = verification;
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(pkg),
  };
}

/**
 * A trial install reports its outcome through the package queue, which is what
 * the Windows installer service writes to. Read the live queue row rather than
 * duplicating status onto the package record, so the review UI always shows
 * what actually happened on the workstation.
 */
async function hydrateVerification(pkg: any): Promise<PackageVerification | undefined> {
  const stored = pkg.verification as PackageVerification | undefined;
  if (!stored?.workstationId || !QUEUE_TABLE) return stored;
  // Terminal results never change; no need to re-read the queue.
  if (stored.status !== 'running') return stored;

  // The queue is partitioned by instance ARN; the verify run recorded the exact
  // key it wrote, so there is nothing to reconstruct. Rows from before that
  // change fall back to the bare-instance-id form.
  const partitionKey = stored.queuePartitionKey || `workstation#${stored.workstationId}`;

  try {
    const res = await dynamoClient.send(new GetItemCommand({
      TableName: QUEUE_TABLE,
      Key: marshall({
        PK: partitionKey,
        SK: `package#${pkg.packageId}#verify`,
      }),
    }));
    if (!res.Item) return stored;

    const item = unmarshall(res.Item) as any;
    const status =
      item.status === 'completed' ? 'passed'
      : item.status === 'failed' ? 'failed'
      : 'running';

    return {
      ...stored,
      status,
      completedAt: item.completedAt || item.installedAt,
      exitCodeMessage: item.errorMessage,
    };
  } catch (error) {
    console.error('Could not read verification status from the package queue', error);
    return stored;
  }
}

async function listPackages(headers: any, statusFilter?: string): Promise<APIGatewayProxyResult> {
  let items: Record<string, any>[];

  if (statusFilter) {
    // StatusIndex exists so the review queue is a Query, not a full-table Scan
    // that grows with the catalog.
    const result = await dynamoClient.send(new QueryCommand({
      TableName: BOOTSTRAP_TABLE,
      IndexName: 'StatusIndex',
      KeyConditionExpression: '#s = :status',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: marshall({ ':status': statusFilter }),
    }));
    items = (result.Items || []).map(item => unmarshall(item));
  } else {
    items = await scanAllItems(dynamoClient, {
      TableName: BOOTSTRAP_TABLE,
    });
  }

  const packages = items
    .map(item => {
      const pkg = item as any;
      // Convert string booleans back to actual booleans
      pkg.isRequired = pkg.isRequired === 'true' || pkg.isRequired === true;
      pkg.isEnabled = pkg.isEnabled === 'true' || pkg.isEnabled === true;
      return pkg as BootstrapPackage;
    })
    .sort((a, b) => a.order - b.order);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      packages,
      summary: {
        total: packages.length,
        required: packages.filter(p => p.isRequired).length,
        optional: packages.filter(p => !p.isRequired && p.isEnabled).length,
        disabled: packages.filter(p => !p.isEnabled).length,
        // Uploads waiting on an admin. Packages predating the upload feature
        // carry no status and count as approved.
        needsReview: packages.filter(p => {
          const status = effectiveStatus(p);
          return status === 'needs_review' || status === 'analysis_failed';
        }).length,
        uploading: packages.filter(p => {
          const status = effectiveStatus(p);
          return status === 'uploading' || status === 'analyzing';
        }).length,
      }
    }),
  };
}

async function updatePackage(packageId: string, data: Partial<BootstrapPackage>, headers: any): Promise<APIGatewayProxyResult> {
  const timestamp = new Date().toISOString();

  // Enabling a package is what makes it selectable for installation, so it is
  // gated on approval here rather than only in the UI. `status`, `s3Key`,
  // `source` and `expectedSha256` are deliberately absent from
  // `updateableFields` below: they are owned by the upload and analysis
  // pipeline, and letting this endpoint set them would route around review.
  if (data.isEnabled === true || (data.isEnabled as unknown) === 'true') {
    const current = await dynamoClient.send(new GetItemCommand({
      TableName: BOOTSTRAP_TABLE,
      Key: marshall({ packageId }),
    }));
    if (!current.Item) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ message: 'Package not found' }),
      };
    }
    const status = effectiveStatus(unmarshall(current.Item) as any);
    if (status !== 'approved') {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({
          message: `Cannot enable a package with status '${status}'. Approve it in the review queue first.`,
        }),
      };
    }
  }

  const updateExpressions: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, any> = { ':updatedAt': timestamp };

  const updateableFields = [
    'name', 'description', 'type', 'category', 'downloadUrl', 'installCommand', 'expectedSha256',
    'installArgs', 'requiresGpu', 'supportedGpuFamilies', 'osVersions',
    'isRequired', 'isEnabled', 'order', 'estimatedInstallTimeMinutes', 'metadata'
  ];

  updateableFields.forEach(field => {
    if (data[field as keyof BootstrapPackage] !== undefined) {
      let value = data[field as keyof BootstrapPackage];
      
      // Convert booleans to strings for DynamoDB GSI compatibility
      if (field === 'isRequired' && typeof value === 'boolean') {
        value = value ? 'true' : 'false';
      }
      if (field === 'isEnabled' && typeof value === 'boolean') {
        value = value ? 'true' : 'false';
      }
      
      const attrName = `#${field}`;
      const attrValue = `:${field}`;
      expressionAttributeNames[attrName] = field;
      expressionAttributeValues[attrValue] = value;
      updateExpressions.push(`${attrName} = ${attrValue}`);
    }
  });

  updateExpressions.push('#updatedAt = :updatedAt');
  expressionAttributeNames['#updatedAt'] = 'updatedAt';

  try {
    await dynamoClient.send(new UpdateItemCommand({
      TableName: BOOTSTRAP_TABLE,
      Key: marshall({ packageId }),
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ConditionExpression: 'attribute_exists(packageId)',
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: marshall(expressionAttributeValues),
    }));
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ message: 'Package not found' }),
      };
    }
    throw error;
  }

  return await getPackage(packageId, headers);
}

async function deletePackage(packageId: string, headers: any): Promise<APIGatewayProxyResult> {
  // Read first so the uploaded artifact can be removed with the catalog row;
  // otherwise deleting a package orphans a multi-GB object in S3 that nothing
  // references and nothing will ever clean up.
  const existing = await dynamoClient.send(new GetItemCommand({
    TableName: BOOTSTRAP_TABLE,
    Key: marshall({ packageId }),
  }));

  if (existing.Item) {
    const pkg = unmarshall(existing.Item) as any;
    if (pkg.s3Bucket && pkg.s3Key) {
      await s3Client
        .send(new DeleteObjectCommand({ Bucket: pkg.s3Bucket, Key: pkg.s3Key }))
        .catch((error) => console.error('Failed to delete package artifact from S3', error));
    }
  }

  await dynamoClient.send(new DeleteItemCommand({
    TableName: BOOTSTRAP_TABLE,
    Key: marshall({ packageId }),
  }));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ message: 'Package deleted successfully' }),
  };
}