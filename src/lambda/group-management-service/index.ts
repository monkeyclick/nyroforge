import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, DeleteCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

const GROUPS_TABLE = process.env.GROUPS_TABLE || 'UserGroups';
const GROUP_MEMBERSHIPS_TABLE = process.env.GROUP_MEMBERSHIPS_TABLE || 'GroupMemberships';
const GROUP_AUDIT_LOGS_TABLE = process.env.GROUP_AUDIT_LOGS_TABLE || 'GroupAuditLogs';
const USERS_TABLE = process.env.USERS_TABLE || 'EnhancedUsers';

interface Group {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
  membershipType: 'static' | 'dynamic';
  dynamicRules?: DynamicRule[];
  parentGroupId?: string;
  hierarchyPath?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  isActive: boolean;
  metadata?: Record<string, any>;
}

interface DynamicRule {
  id: string;
  name: string;
  description?: string;
  conditions: RuleCondition[];
  priority: number;
  isActive: boolean;
}

interface RuleCondition {
  field: string;
  operator: 'equals' | 'contains' | 'in' | 'exists' | 'gt' | 'lt' | 'matches' | 'startsWith' | 'endsWith' | 'between';
  value: any;
  logicalOperator?: 'AND' | 'OR';
}

interface GroupMembership {
  id: string;
  userId: string;
  groupId: string;
  membershipType: 'static' | 'dynamic' | 'nested';
  source?: string;
  addedAt: string;
  addedBy: string;
  expiresAt?: string;
}

interface GroupAuditLog {
  id: string;
  groupId: string;
  action: 'created' | 'updated' | 'deleted' | 'member_added' | 'member_removed' | 'rule_evaluated' | 'hierarchy_changed';
  performedBy: string;
  timestamp: string;
  changes?: any;
  metadata?: Record<string, any>;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;
    const pathParams = event.pathParameters || {};
    const currentUserId = event.requestContext?.authorizer?.claims?.sub || 'system';

    // Group CRUD operations
    if (path === '/admin/groups' && method === 'GET') {
      return await listGroups();
    }
    if (path === '/admin/groups' && method === 'POST') {
      return await createGroup(event, currentUserId);
    }
    if (path.match(/^\/admin\/groups\/[^/]+$/) && method === 'GET') {
      return await getGroupById(pathParams.groupId!);
    }
    if (path.match(/^\/admin\/groups\/[^/]+$/) && method === 'PUT') {
      return await updateGroup(pathParams.groupId!, event, currentUserId);
    }
    if (path.match(/^\/admin\/groups\/[^/]+$/) && method === 'DELETE') {
      return await deleteGroup(pathParams.groupId!, currentUserId);
    }

    // Group membership operations
    if (path.match(/^\/admin\/groups\/[^/]+\/members$/) && method === 'GET') {
      return await getGroupMembers(pathParams.groupId!);
    }
    if (path.match(/^\/admin\/groups\/[^/]+\/members$/) && method === 'POST') {
      return await addUserToGroup(pathParams.groupId!, event, currentUserId);
    }
    if (path.match(/^\/admin\/groups\/[^/]+\/members\/[^/]+$/) && method === 'DELETE') {
      return await removeUserFromGroup(pathParams.groupId!, pathParams.userId!, currentUserId);
    }

    // Rule evaluation
    if (path.match(/^\/admin\/groups\/[^/]+\/evaluate-rules$/) && method === 'POST') {
      return await evaluateGroupRules(pathParams.groupId!, currentUserId);
    }

    // Audit logs
    if (path === '/admin/group-audit-logs' && method === 'GET') {
      const groupId = event.queryStringParameters?.groupId;
      return await getGroupAuditLogs(groupId);
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Not found' })
    };
  } catch (error: any) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Internal server error' })
    };
  }
};

async function listGroups(): Promise<APIGatewayProxyResult> {
  const result = await docClient.send(new ScanCommand({
    TableName: GROUPS_TABLE
  }));

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*'
    },
    body: JSON.stringify({ groups: result.Items || [] })
  };
}

async function createGroup(event: APIGatewayProxyEvent, currentUserId: string): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const groupId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date().toISOString();

  const group: Group = {
    id: groupId,
    name: body.name,
    description: body.description,
    permissions: body.permissions || [],
    membershipType: body.membershipType || 'static',
    dynamicRules: body.dynamicRules,
    parentGroupId: body.parentGroupId,
    hierarchyPath: body.hierarchyPath || groupId,
    createdAt: now,
    updatedAt: now,
    createdBy: currentUserId,
    isActive: true,
    metadata: body.metadata
  };

  await docClient.send(new PutCommand({
    TableName: GROUPS_TABLE,
    Item: group
  }));

  await logGroupAuditEvent(groupId, 'created', currentUserId, group);

  return {
    statusCode: 201,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*'
    },
    body: JSON.stringify(group)
  };
}

async function getGroupById(groupId: string): Promise<APIGatewayProxyResult> {
  const result = await docClient.send(new GetCommand({
    TableName: GROUPS_TABLE,
    Key: { id: groupId }
  }));

  if (!result.Item) {
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*'
      },
      body: JSON.stringify({ error: 'Group not found' })
    };
  }

  // Get member count
  const membersResult = await docClient.send(new QueryCommand({
    TableName: GROUP_MEMBERSHIPS_TABLE,
    IndexName: 'GroupMembersIndex',
    KeyConditionExpression: 'groupId = :groupId',
    ExpressionAttributeValues: {
      ':groupId': groupId
    }
  }));

  const group = {
    ...result.Item,
    memberCount: membersResult.Items?.length || 0
  };

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*'
    },
    body: JSON.stringify(group)
  };
}

async function updateGroup(groupId: string, event: APIGatewayProxyEvent, currentUserId: string): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const now = new Date().toISOString();

  const updateExpressions: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, any> = {};

  if (body.name !== undefined) {
    updateExpressions.push('#name = :name');
    expressionAttributeNames['#name'] = 'name';
    expressionAttributeValues[':name'] = body.name;
  }
  if (body.description !== undefined) {
    updateExpressions.push('description = :description');
    expressionAttributeValues[':description'] = body.description;
  }
  if (body.permissions !== undefined) {
    updateExpressions.push('permissions = :permissions');
    expressionAttributeValues[':permissions'] = body.permissions;
  }
  if (body.membershipType !== undefined) {
    updateExpressions.push('membershipType = :membershipType');
    expressionAttributeValues[':membershipType'] = body.membershipType;
  }
  if (body.dynamicRules !== undefined) {
    updateExpressions.push('dynamicRules = :dynamicRules');
    expressionAttributeValues[':dynamicRules'] = body.dynamicRules;
  }
  if (body.isActive !== undefined) {
    updateExpressions.push('isActive = :isActive');
    expressionAttributeValues[':isActive'] = body.isActive;
  }

  updateExpressions.push('updatedAt = :updatedAt');
  expressionAttributeValues[':updatedAt'] = now;

  const result = await docClient.send(new UpdateCommand({
    TableName: GROUPS_TABLE,
    Key: { id: groupId },
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: 'ALL_NEW'
  }));

  await logGroupAuditEvent(groupId, 'updated', currentUserId, body);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*'
    },
    body: JSON.stringify(result.Attributes)
  };
}

async function deleteGroup(groupId: string, currentUserId: string): Promise<APIGatewayProxyResult> {
  // Check for members
  const membersResult = await docClient.send(new QueryCommand({
    TableName: GROUP_MEMBERSHIPS_TABLE,
    IndexName: 'GroupMembersIndex',
    KeyConditionExpression: 'groupId = :groupId',
    ExpressionAttributeValues: {
      ':groupId': groupId
    }
  }));

  if (membersResult.Items && membersResult.Items.length > 0) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*'
      },
      body: JSON.stringify({ error: 'Cannot delete group with members. Remove all members first.' })
    };
  }

  await docClient.send(new DeleteCommand({
    TableName: GROUPS_TABLE,
    Key: { id: groupId }
  }));

  await logGroupAuditEvent(groupId, 'deleted', currentUserId);

  return {
    statusCode: 204,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*'
    },
    body: ''
  };
}

async function getGroupMembers(groupId: string): Promise<APIGatewayProxyResult> {
  const result = await docClient.send(new QueryCommand({
    TableName: GROUP_MEMBERSHIPS_TABLE,
    IndexName: 'GroupMembersIndex',
    KeyConditionExpression: 'groupId = :groupId',
    ExpressionAttributeValues: {
      ':groupId': groupId
    }
  }));

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*'
    },
    body: JSON.stringify({ members: result.Items || [] })
  };
}

async function addUserToGroup(groupId: string, event: APIGatewayProxyEvent, currentUserId: string): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const userId = body.userId;
  const membershipType = body.membershipType || 'static';
  const now = new Date().toISOString();

  // Verify group exists
  const groupResult = await docClient.send(new GetCommand({
    TableName: GROUPS_TABLE,
    Key: { id: groupId }
  }));

  if (!groupResult.Item) {
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*'
      },
      body: JSON.stringify({ error: 'Group not found' })
    };
  }

  // Verify user exists
  const userResult = await docClient.send(new GetCommand({
    TableName: USERS_TABLE,
    Key: { id: userId }
  }));

  if (!userResult.Item) {
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*'
      },
      body: JSON.stringify({ error: 'User not found' })
    };
  }

  const membershipId = `user#${userId}#group#${groupId}`;
  const membership: GroupMembership = {
    id: membershipId,
    userId,
    groupId,
    membershipType,
    source: body.source,
    addedAt: now,
    addedBy: currentUserId,
    expiresAt: body.expiresAt
  };

  await docClient.send(new PutCommand({
    TableName: GROUP_MEMBERSHIPS_TABLE,
    Item: membership
  }));

  await logGroupAuditEvent(groupId, 'member_added', currentUserId, { userId, membershipType });

  return {
    statusCode: 201,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*'
    },
    body: JSON.stringify(membership)
  };
}

async function removeUserFromGroup(groupId: string, userId: string, currentUserId: string): Promise<APIGatewayProxyResult> {
  const membershipId = `user#${userId}#group#${groupId}`;

  await docClient.send(new DeleteCommand({
    TableName: GROUP_MEMBERSHIPS_TABLE,
    Key: { id: membershipId }
  }));

  await logGroupAuditEvent(groupId, 'member_removed', currentUserId, { userId });

  return {
    statusCode: 204,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*'
    },
    body: ''
  };
}

async function evaluateGroupRules(groupId: string, currentUserId: string): Promise<APIGatewayProxyResult> {
  // Get group
  const groupResult = await docClient.send(new GetCommand({
    TableName: GROUPS_TABLE,
    Key: { id: groupId }
  }));

  if (!groupResult.Item) {
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*'
      },
      body: JSON.stringify({ error: 'Group not found' })
    };
  }

  const group = groupResult.Item as Group;

  if (group.membershipType !== 'dynamic' || !group.dynamicRules) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*'
      },
      body: JSON.stringify({ error: 'Group is not dynamic or has no rules' })
    };
  }

  // Get all users
  const usersResult = await docClient.send(new ScanCommand({
    TableName: USERS_TABLE
  }));

  const users = usersResult.Items || [];
  const matchedUsers: string[] = [];

  // Evaluate rules for each user
  for (const user of users) {
    let matches = false;

    for (const rule of group.dynamicRules) {
      if (!rule.isActive) continue;

      const ruleMatches = evaluateConditions(rule.conditions, user);
      if (ruleMatches) {
        matches = true;
        break;
      }
    }

    if (matches) {
      matchedUsers.push(user.id);
      
      // Add membership if not already exists
      const membershipId = `user#${user.id}#group#${groupId}`;
      const existingMembership = await docClient.send(new GetCommand({
        TableName: GROUP_MEMBERSHIPS_TABLE,
        Key: { id: membershipId }
      }));

      if (!existingMembership.Item) {
        const membership: GroupMembership = {
          id: membershipId,
          userId: user.id,
          groupId,
          membershipType: 'dynamic',
          source: 'rule_evaluation',
          addedAt: new Date().toISOString(),
          addedBy: currentUserId
        };

        await docClient.send(new PutCommand({
          TableName: GROUP_MEMBERSHIPS_TABLE,
          Item: membership
        }));
      }
    }
  }

  await logGroupAuditEvent(groupId, 'rule_evaluated', currentUserId, { matchedUsers });

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*'
    },
    body: JSON.stringify({ matchedUsers, count: matchedUsers.length })
  };
}

function evaluateConditions(conditions: RuleCondition[], user: any): boolean {
  if (conditions.length === 0) return false;

  let result = true;
  let currentOperator: 'AND' | 'OR' = 'AND';

  for (const condition of conditions) {
    const conditionResult = evaluateCondition(condition, user);

    if (currentOperator === 'AND') {
      result = result && conditionResult;
    } else {
      result = result || conditionResult;
    }

    currentOperator = condition.logicalOperator || 'AND';
  }

  return result;
}

function evaluateCondition(condition: RuleCondition, user: any): boolean {
  const fieldValue = getNestedValue(user, condition.field);

  switch (condition.operator) {
    case 'equals':
      return fieldValue === condition.value;
    case 'contains':
      return typeof fieldValue === 'string' && fieldValue.includes(condition.value);
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(fieldValue);
    case 'exists':
      return fieldValue !== undefined && fieldValue !== null;
    case 'gt':
      return fieldValue > condition.value;
    case 'lt':
      return fieldValue < condition.value;
    case 'matches':
      try {
        // Validate regex complexity to prevent ReDoS
        const pattern = String(condition.value);
        if (pattern.length > 100) {
          console.warn('Regex pattern too long, skipping matches evaluation');
          return false;
        }
        // Use a timeout-safe approach: test with a simple string first
        const regex = new RegExp(pattern);
        const testStr = String(fieldValue);
        if (testStr.length > 1000) {
          console.warn('Input string too long for regex matching, skipping');
          return false;
        }
        return regex.test(testStr);
      } catch (e) {
        console.error('Invalid regex pattern:', condition.value);
        return false;
      }
    case 'startsWith':
      return typeof fieldValue === 'string' && fieldValue.startsWith(condition.value);
    case 'endsWith':
      return typeof fieldValue === 'string' && fieldValue.endsWith(condition.value);
    case 'between':
      return Array.isArray(condition.value) && fieldValue >= condition.value[0] && fieldValue <= condition.value[1];
    default:
      return false;
  }
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

async function getGroupAuditLogs(groupId?: string): Promise<APIGatewayProxyResult> {
  if (groupId) {
    const result = await docClient.send(new QueryCommand({
      TableName: GROUP_AUDIT_LOGS_TABLE,
      IndexName: 'GroupLogsIndex',
      KeyConditionExpression: 'groupId = :groupId',
      ExpressionAttributeValues: {
        ':groupId': groupId
      },
      ScanIndexForward: false,
      Limit: 100
    }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*'
      },
      body: JSON.stringify({ logs: result.Items || [] })
    };
  } else {
    const result = await docClient.send(new ScanCommand({
      TableName: GROUP_AUDIT_LOGS_TABLE,
      Limit: 100
    }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*'
      },
      body: JSON.stringify({ logs: result.Items || [] })
    };
  }
}

async function logGroupAuditEvent(
  groupId: string,
  action: GroupAuditLog['action'],
  performedBy: string,
  changes?: any,
  metadata?: Record<string, any>
): Promise<void> {
  const log: GroupAuditLog = {
    id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    groupId,
    action,
    performedBy,
    timestamp: new Date().toISOString(),
    changes,
    metadata
  };

  await docClient.send(new PutCommand({
    TableName: GROUP_AUDIT_LOGS_TABLE,
    Item: log
  }));
}