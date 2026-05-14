import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  ScanCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { EC2Client, DescribeInstancesCommand, CreateTagsCommand } from '@aws-sdk/client-ec2';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { v4 as uuidv4 } from 'uuid';

const dynamoClient = new DynamoDBClient({});
const ec2Client = new EC2Client({});

const TAG_TEMPLATES_TABLE = process.env.TAG_TEMPLATES_TABLE!;
const WORKSTATIONS_TABLE = process.env.WORKSTATIONS_TABLE_NAME!;
const USERS_TABLE = process.env.USERS_TABLE!;

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

export interface TagField {
  key: string;
  label: string;
  description?: string;
  required: boolean;
  allowedValues?: string[];
  defaultValue?: string;
  validation?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
  };
}

export interface TagTemplate {
  templateId: string;
  name: string;
  description?: string;
  category: string;
  isRequired: boolean;
  isEnabled: boolean;
  fields: TagField[];
  appliedCount?: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

async function isAdmin(userId: string): Promise<boolean> {
  try {
    const result = await dynamoClient.send(new GetItemCommand({
      TableName: USERS_TABLE,
      Key: marshall({ id: userId }),
    }));
    if (!result.Item) return false;
    const user = unmarshall(result.Item);
    const roles: string[] = user.roleIds || [];
    const perms: string[] = user.directPermissions || [];
    return roles.includes('admin') || perms.includes('system:admin') || perms.includes('workstations:manage-all');
  } catch {
    return false;
  }
}

function normalizeTemplate(raw: any): TagTemplate {
  return {
    ...raw,
    isRequired: raw.isRequired === 'true' || raw.isRequired === true,
    isEnabled: raw.isEnabled === 'true' || raw.isEnabled === true,
    fields: typeof raw.fields === 'string' ? JSON.parse(raw.fields) : (raw.fields || []),
  };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Tag Template Service:', JSON.stringify({ method: event.httpMethod, path: event.path }));

  try {
    const { httpMethod, path, pathParameters, body, requestContext } = event;
    const userId = requestContext.authorizer?.claims?.email || requestContext.authorizer?.claims?.sub || 'unknown';
    const adminUser = await isAdmin(userId);

    // GET /admin/tag-report
    if (httpMethod === 'GET' && path.includes('/admin/tag-report')) {
      if (!adminUser) return forbidden();
      return await getTagReport();
    }

    // POST /tag-templates/apply
    if (httpMethod === 'POST' && path.endsWith('/apply')) {
      if (!adminUser) return forbidden();
      return await applyTemplates(JSON.parse(body || '{}'), userId);
    }

    // /tag-templates/{templateId}
    const templateId = pathParameters?.templateId;

    switch (httpMethod) {
      case 'GET':
        return templateId ? await getTemplate(templateId) : await listTemplates(event.queryStringParameters);
      case 'POST':
        if (!adminUser) return forbidden();
        return await createTemplate(JSON.parse(body || '{}'), userId);
      case 'PUT':
        if (!adminUser || !templateId) return templateId ? forbidden() : notFound();
        return await updateTemplate(templateId, JSON.parse(body || '{}'));
      case 'DELETE':
        if (!adminUser || !templateId) return templateId ? forbidden() : notFound();
        return await deleteTemplate(templateId);
    }

    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ message: 'Invalid request' }) };
  } catch (error) {
    console.error('Tag template service error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Internal server error', error: error instanceof Error ? error.message : 'Unknown' }),
    };
  }
};

function forbidden(): APIGatewayProxyResult {
  return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ message: 'Admin access required' }) };
}

function notFound(): APIGatewayProxyResult {
  return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'Not found' }) };
}

async function listTemplates(qs: Record<string, string | undefined> | null): Promise<APIGatewayProxyResult> {
  const category = qs?.category;
  const requiredOnly = qs?.required === 'true';

  let items: any[];

  if (category) {
    const result = await dynamoClient.send(new QueryCommand({
      TableName: TAG_TEMPLATES_TABLE,
      IndexName: 'CategoryIndex',
      KeyConditionExpression: 'category = :cat',
      ExpressionAttributeValues: marshall({ ':cat': category }),
    }));
    items = result.Items || [];
  } else if (requiredOnly) {
    const result = await dynamoClient.send(new QueryCommand({
      TableName: TAG_TEMPLATES_TABLE,
      IndexName: 'RequiredIndex',
      KeyConditionExpression: 'isRequired = :req',
      ExpressionAttributeValues: marshall({ ':req': 'true' }),
    }));
    items = result.Items || [];
  } else {
    const result = await dynamoClient.send(new ScanCommand({ TableName: TAG_TEMPLATES_TABLE }));
    items = result.Items || [];
  }

  const templates = items.map(item => normalizeTemplate(unmarshall(item)));
  templates.sort((a, b) => {
    if (a.isRequired !== b.isRequired) return a.isRequired ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      templates,
      summary: {
        total: templates.length,
        required: templates.filter(t => t.isRequired).length,
        optional: templates.filter(t => !t.isRequired && t.isEnabled).length,
        disabled: templates.filter(t => !t.isEnabled).length,
        categories: [...new Set(templates.map(t => t.category))],
      },
    }),
  };
}

async function getTemplate(templateId: string): Promise<APIGatewayProxyResult> {
  const result = await dynamoClient.send(new GetItemCommand({
    TableName: TAG_TEMPLATES_TABLE,
    Key: marshall({ templateId }),
  }));

  if (!result.Item) return notFound();

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify(normalizeTemplate(unmarshall(result.Item))),
  };
}

async function createTemplate(data: Partial<TagTemplate>, userId: string): Promise<APIGatewayProxyResult> {
  if (!data.name || !data.category) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'name and category are required' }),
    };
  }

  const templateId = `tmpl-${uuidv4()}`;
  const now = new Date().toISOString();

  const template: TagTemplate = {
    templateId,
    name: data.name,
    description: data.description || '',
    category: data.category,
    isRequired: data.isRequired || false,
    isEnabled: data.isEnabled !== undefined ? data.isEnabled : true,
    fields: data.fields || [],
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };

  const dynamoItem = {
    ...template,
    isRequired: template.isRequired ? 'true' : 'false',
    isEnabled: template.isEnabled ? 'true' : 'false',
    fields: JSON.stringify(template.fields),
  };

  await dynamoClient.send(new PutItemCommand({
    TableName: TAG_TEMPLATES_TABLE,
    Item: marshall(dynamoItem),
  }));

  return { statusCode: 201, headers: corsHeaders, body: JSON.stringify(template) };
}

async function updateTemplate(templateId: string, data: Partial<TagTemplate>): Promise<APIGatewayProxyResult> {
  const existing = await dynamoClient.send(new GetItemCommand({
    TableName: TAG_TEMPLATES_TABLE,
    Key: marshall({ templateId }),
  }));
  if (!existing.Item) return notFound();

  const now = new Date().toISOString();
  const updates: string[] = ['#updatedAt = :updatedAt'];
  const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
  const values: Record<string, any> = { ':updatedAt': now };

  const fields: Array<[keyof TagTemplate, string]> = [
    ['name', 'name'],
    ['description', 'description'],
    ['category', 'category'],
    ['fields', 'fields'],
  ];

  for (const [field, attr] of fields) {
    if (data[field] !== undefined) {
      names[`#${attr}`] = attr;
      values[`:${attr}`] = field === 'fields' ? JSON.stringify(data[field]) : data[field];
      updates.push(`#${attr} = :${attr}`);
    }
  }

  if (data.isRequired !== undefined) {
    names['#isRequired'] = 'isRequired';
    values[':isRequired'] = data.isRequired ? 'true' : 'false';
    updates.push('#isRequired = :isRequired');
  }

  if (data.isEnabled !== undefined) {
    names['#isEnabled'] = 'isEnabled';
    values[':isEnabled'] = data.isEnabled ? 'true' : 'false';
    updates.push('#isEnabled = :isEnabled');
  }

  await dynamoClient.send(new UpdateItemCommand({
    TableName: TAG_TEMPLATES_TABLE,
    Key: marshall({ templateId }),
    UpdateExpression: `SET ${updates.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: marshall(values),
  }));

  return getTemplate(templateId);
}

async function deleteTemplate(templateId: string): Promise<APIGatewayProxyResult> {
  const existing = await dynamoClient.send(new GetItemCommand({
    TableName: TAG_TEMPLATES_TABLE,
    Key: marshall({ templateId }),
  }));
  if (!existing.Item) return notFound();

  await dynamoClient.send(new DeleteItemCommand({
    TableName: TAG_TEMPLATES_TABLE,
    Key: marshall({ templateId }),
  }));

  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: 'Template deleted' }) };
}

async function applyTemplates(
  request: { templateIds: string[]; workstationIds: string[]; tagValues?: Record<string, string> },
  userId: string
): Promise<APIGatewayProxyResult> {
  if (!request.templateIds?.length || !request.workstationIds?.length) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'templateIds and workstationIds are required' }),
    };
  }

  // Load all requested templates
  const templates: TagTemplate[] = [];
  for (const templateId of request.templateIds) {
    const result = await dynamoClient.send(new GetItemCommand({
      TableName: TAG_TEMPLATES_TABLE,
      Key: marshall({ templateId }),
    }));
    if (result.Item) templates.push(normalizeTemplate(unmarshall(result.Item)));
  }

  if (!templates.length) {
    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ message: 'No templates found' }) };
  }

  // Build merged tag map from template defaults + overrides
  const tagMap: Record<string, string> = {};
  for (const template of templates) {
    for (const field of template.fields) {
      const value = request.tagValues?.[field.key] ?? field.defaultValue;
      if (value) tagMap[field.key] = value;
    }
  }
  tagMap['AppliedBy'] = userId;
  tagMap['TaggedAt'] = new Date().toISOString();

  // Load workstation records to get instance IDs
  const results: { workstationId: string; instanceId?: string; success: boolean; error?: string }[] = [];

  for (const workstationId of request.workstationIds) {
    try {
      const record = await dynamoClient.send(new GetItemCommand({
        TableName: WORKSTATIONS_TABLE,
        Key: marshall({ PK: `WORKSTATION#${workstationId}`, SK: 'METADATA' }),
      }));

      if (!record.Item) {
        results.push({ workstationId, success: false, error: 'Workstation not found' });
        continue;
      }

      const workstation = unmarshall(record.Item);
      const instanceId = workstation.instanceId;

      if (!instanceId) {
        results.push({ workstationId, success: false, error: 'No instance ID' });
        continue;
      }

      const ec2Tags = Object.entries(tagMap).map(([Key, Value]) => ({ Key, Value }));
      await ec2Client.send(new CreateTagsCommand({ Resources: [instanceId], Tags: ec2Tags }));

      // Persist applied tags back to the workstation DynamoDB record (merge with existing customTags)
      const existing = (() => {
        try { return JSON.parse(workstation.customTags || '{}'); } catch { return {}; }
      })();
      await dynamoClient.send(new UpdateItemCommand({
        TableName: WORKSTATIONS_TABLE,
        Key: marshall({ PK: `WORKSTATION#${workstationId}`, SK: 'METADATA' }),
        UpdateExpression: 'SET #customTags = :tags, #updatedAt = :now',
        ExpressionAttributeNames: { '#customTags': 'customTags', '#updatedAt': 'updatedAt' },
        ExpressionAttributeValues: marshall({ ':tags': JSON.stringify({ ...existing, ...tagMap }), ':now': new Date().toISOString() }),
      }));

      results.push({ workstationId, instanceId, success: true });
    } catch (error) {
      results.push({ workstationId, success: false, error: error instanceof Error ? error.message : 'Unknown' });
    }
  }

  const successCount = results.filter(r => r.success).length;
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      message: `Applied tags to ${successCount}/${request.workstationIds.length} workstations`,
      results,
    }),
  };
}

async function getTagReport(): Promise<APIGatewayProxyResult> {
  // Load all templates
  const templatesResult = await dynamoClient.send(new ScanCommand({ TableName: TAG_TEMPLATES_TABLE }));
  const templates = (templatesResult.Items || []).map(i => normalizeTemplate(unmarshall(i)));
  const requiredTemplates = templates.filter(t => t.isRequired && t.isEnabled);

  // Load all workstations from DynamoDB — table uses PK=WORKSTATION#<id> SK=METADATA
  const workstationsResult = await dynamoClient.send(new ScanCommand({
    TableName: WORKSTATIONS_TABLE,
    FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
    ExpressionAttributeValues: marshall({ ':prefix': 'WORKSTATION#', ':sk': 'METADATA' }),
  }));
  const workstations = (workstationsResult.Items || []).map(i => {
    const w = unmarshall(i);
    // Derive workstationId from PK if not stored as a flat attribute
    if (!w.workstationId && w.PK?.startsWith('WORKSTATION#')) {
      w.workstationId = (w.PK as string).replace('WORKSTATION#', '');
    }
    return w;
  });

  // Load EC2 tags for running/stopped instances
  const instanceIds = workstations.map(w => w.instanceId).filter(Boolean);
  const ec2TagMap: Record<string, Record<string, string>> = {};

  if (instanceIds.length > 0) {
    try {
      const ec2Result = await ec2Client.send(new DescribeInstancesCommand({
        InstanceIds: instanceIds,
        Filters: [{ Name: 'instance-state-name', Values: ['pending', 'running', 'stopping', 'stopped'] }],
      }));
      const ec2Instances = ec2Result.Reservations?.flatMap(r => r.Instances || []) || [];
      for (const inst of ec2Instances) {
        const tags: Record<string, string> = {};
        for (const tag of inst.Tags || []) {
          if (tag.Key && tag.Value) tags[tag.Key] = tag.Value;
        }
        if (inst.InstanceId) ec2TagMap[inst.InstanceId] = tags;
      }
    } catch (e) {
      console.warn('Could not load EC2 tags:', e instanceof Error ? e.message : e);
    }
  }

  // Per-workstation compliance
  const workstationReports = workstations.map(w => {
    const ec2Tags = ec2TagMap[w.instanceId] || {};
    const customTags: Record<string, string> = (() => {
      try { return JSON.parse(w.customTags || '{}'); } catch { return {}; }
    })();
    const allTags = { ...ec2Tags, ...customTags };

    const templateCompliance = requiredTemplates.map(template => {
      const fieldResults = template.fields.map(field => ({
        key: field.key,
        present: Boolean(allTags[field.key]?.trim()),
        value: allTags[field.key],
      }));
      const missingRequired = fieldResults.filter(f => !f.present && template.fields.find(tf => tf.key === f.key)?.required);
      return {
        templateId: template.templateId,
        templateName: template.name,
        compliant: missingRequired.length === 0,
        missingFields: missingRequired.map(f => f.key),
        presentFields: fieldResults.filter(f => f.present).map(f => f.key),
      };
    });

    const overallCompliant = templateCompliance.every(tc => tc.compliant);

    return {
      workstationId: w.workstationId,
      instanceId: w.instanceId,
      name: w.tags?.Name || w.instanceId,
      userId: w.userId,
      osVersion: w.osVersion,
      platform: w.platform,
      state: w.status,
      overallCompliant,
      templateCompliance,
      ec2Tags,
      customTags,
    };
  });

  // Template compliance summary
  const templateSummary = requiredTemplates.map(template => {
    const compliantCount = workstationReports.filter(w =>
      w.templateCompliance.find(tc => tc.templateId === template.templateId)?.compliant
    ).length;
    return {
      templateId: template.templateId,
      templateName: template.name,
      category: template.category,
      totalWorkstations: workstationReports.length,
      compliantCount,
      nonCompliantCount: workstationReports.length - compliantCount,
      compliancePercent: workstationReports.length > 0
        ? Math.round((compliantCount / workstationReports.length) * 100)
        : 100,
    };
  });

  // Cost breakdown by common dimensions from EC2 tags
  const costDimensions = ['CostCenter', 'Environment', 'Project', 'Team', 'Department'];
  const costByDimension: Record<string, Record<string, number>> = {};
  for (const dim of costDimensions) {
    const groups: Record<string, number> = {};
    for (const [, tags] of Object.entries(ec2TagMap)) {
      const val = tags[dim] || 'Untagged';
      groups[val] = (groups[val] || 0) + 1;
    }
    if (Object.keys(groups).length > 0) costByDimension[dim] = groups;
  }

  const totalWorkstations = workstationReports.length;
  const compliantCount = workstationReports.filter(w => w.overallCompliant).length;

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      summary: {
        totalWorkstations,
        compliantCount,
        nonCompliantCount: totalWorkstations - compliantCount,
        compliancePercent: totalWorkstations > 0 ? Math.round((compliantCount / totalWorkstations) * 100) : 100,
        requiredTemplates: requiredTemplates.length,
        totalTemplates: templates.length,
        generatedAt: new Date().toISOString(),
      },
      templateSummary,
      workstations: workstationReports,
      costByDimension,
    }),
  };
}
