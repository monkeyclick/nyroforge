import { ScheduledEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  QueryCommand, 
  ScanCommand,
  PutCommand, 
  DeleteCommand,
  BatchWriteCommand
} from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const GROUPS_TABLE = process.env.GROUPS_TABLE || '';
const USERS_TABLE = process.env.USERS_TABLE || '';
const MEMBERSHIPS_TABLE = process.env.MEMBERSHIPS_TABLE || '';
const AUDIT_LOGS_TABLE = process.env.AUDIT_LOGS_TABLE || '';

interface User {
  id: string;
  email: string;
  name: string;
  department?: string;
  role?: string;
  status?: string;
  attributes?: Record<string, any>;
  [key: string]: any;
}

interface DynamicRule {
  id: string;
  field: string;
  operator: string;
  value: any;
  logicalOperator?: 'AND' | 'OR';
}

interface Group {
  id: string;
  name: string;
  membershipType: 'static' | 'dynamic' | 'nested';
  dynamicRules?: {
    conditions: DynamicRule[];
    logicalOperator: 'AND' | 'OR';
  };
  isActive: boolean;
}

interface GroupMembership {
  id: string;
  groupId: string;
  userId: string;
  membershipType: 'static' | 'dynamic' | 'nested';
  addedAt: string;
  addedBy: string;
}

interface ReconciliationResult {
  groupsEvaluated: number;
  usersEvaluated: number;
  membershipsAdded: number;
  membershipsRemoved: number;
  errors: number;
  duration: number;
  startTime: string;
  endTime: string;
}

/**
 * Main Lambda handler for scheduled group membership reconciliation
 * This runs daily (or on schedule) to ensure all group memberships are correct
 */
export const handler = async (event: ScheduledEvent): Promise<ReconciliationResult> => {
  const startTime = new Date();
  console.log('Starting scheduled group membership reconciliation', {
    time: startTime.toISOString(),
    eventSource: event.source
  });

  const result: ReconciliationResult = {
    groupsEvaluated: 0,
    usersEvaluated: 0,
    membershipsAdded: 0,
    membershipsRemoved: 0,
    errors: 0,
    duration: 0,
    startTime: startTime.toISOString(),
    endTime: ''
  };

  try {
    // Step 1: Get all active dynamic groups
    const groups = await getDynamicGroups();
    result.groupsEvaluated = groups.length;
    
    console.log('Fetched dynamic groups', { count: groups.length });

    if (groups.length === 0) {
      console.log('No dynamic groups to evaluate');
      const endTime = new Date();
      result.endTime = endTime.toISOString();
      result.duration = endTime.getTime() - startTime.getTime();
      return result;
    }

    // Step 2: Get all active users
    const users = await getAllUsers();
    result.usersEvaluated = users.length;
    
    console.log('Fetched users', { count: users.length });

    // Step 3: Reconcile each group
    for (const group of groups) {
      try {
        const groupResult = await reconcileGroup(group, users);
        result.membershipsAdded += groupResult.added;
        result.membershipsRemoved += groupResult.removed;
        
        console.log('Reconciled group', {
          groupId: group.id,
          groupName: group.name,
          added: groupResult.added,
          removed: groupResult.removed
        });
      } catch (error) {
        console.error('Error reconciling group', { 
          groupId: group.id, 
          error 
        });
        result.errors++;
      }
    }

    const endTime = new Date();
    result.endTime = endTime.toISOString();
    result.duration = endTime.getTime() - startTime.getTime();

    console.log('Reconciliation complete', result);

    // Log reconciliation run
    await logReconciliationRun(result);

    return result;
  } catch (error) {
    console.error('Fatal error during reconciliation', { error });
    result.errors++;
    const endTime = new Date();
    result.endTime = endTime.toISOString();
    result.duration = endTime.getTime() - startTime.getTime();
    throw error;
  }
};

/**
 * Get all active dynamic groups
 */
async function getDynamicGroups(): Promise<Group[]> {
  try {
    const response = await docClient.send(new QueryCommand({
      TableName: GROUPS_TABLE,
      IndexName: 'MembershipTypeIndex',
      KeyConditionExpression: 'membershipType = :type',
      FilterExpression: 'isActive = :active',
      ExpressionAttributeValues: {
        ':type': 'dynamic',
        ':active': true
      }
    }));

    return response.Items as Group[] || [];
  } catch (error) {
    console.error('Error fetching dynamic groups', { error });
    throw error;
  }
}

/**
 * Get all active users (paginated)
 */
async function getAllUsers(): Promise<User[]> {
  const users: User[] = [];
  let lastEvaluatedKey: any = undefined;

  try {
    do {
      const response = await docClient.send(new ScanCommand({
        TableName: USERS_TABLE,
        FilterExpression: '#status = :active',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':active': 'active'
        },
        ExclusiveStartKey: lastEvaluatedKey,
        Limit: 100 // Process 100 users at a time
      }));

      if (response.Items) {
        users.push(...(response.Items as User[]));
      }

      lastEvaluatedKey = response.LastEvaluatedKey;
      
      console.log('Scanned users batch', { 
        batchSize: response.Items?.length,
        totalSoFar: users.length 
      });
    } while (lastEvaluatedKey);

    return users;
  } catch (error) {
    console.error('Error fetching users', { error });
    throw error;
  }
}

/**
 * Reconcile a single group against all users
 */
async function reconcileGroup(group: Group, users: User[]): Promise<{ added: number; removed: number }> {
  if (!group.dynamicRules || !group.dynamicRules.conditions) {
    console.log('Group has no dynamic rules, skipping', { groupId: group.id });
    return { added: 0, removed: 0 };
  }

  const result = { added: 0, removed: 0 };

  // Get current members of this group
  const currentMembers = await getGroupMembers(group.id);
  const currentMemberIds = new Set(
    currentMembers
      .filter(m => m.membershipType === 'dynamic')
      .map(m => m.userId)
  );

  // Determine which users should be members
  const shouldBeMemberIds = new Set<string>();
  for (const user of users) {
    if (evaluateRules(user, group.dynamicRules)) {
      shouldBeMemberIds.add(user.id);
    }
  }

  // Find users to add (should be members but aren't)
  const usersToAdd = Array.from(shouldBeMemberIds).filter(
    userId => !currentMemberIds.has(userId)
  );

  // Find users to remove (are members but shouldn't be)
  const usersToRemove = Array.from(currentMemberIds).filter(
    userId => !shouldBeMemberIds.has(userId)
  );

  console.log('Group reconciliation analysis', {
    groupId: group.id,
    currentMembers: currentMemberIds.size,
    shouldBeMembers: shouldBeMemberIds.size,
    toAdd: usersToAdd.length,
    toRemove: usersToRemove.length
  });

  // Add missing members
  for (const userId of usersToAdd) {
    try {
      await addMembership(userId, group.id);
      result.added++;
    } catch (error) {
      console.error('Error adding membership', { userId, groupId: group.id, error });
    }
  }

  // Remove incorrect members
  for (const userId of usersToRemove) {
    try {
      await removeMembership(userId, group.id);
      result.removed++;
    } catch (error) {
      console.error('Error removing membership', { userId, groupId: group.id, error });
    }
  }

  return result;
}

/**
 * Get all members of a group
 */
async function getGroupMembers(groupId: string): Promise<GroupMembership[]> {
  try {
    const response = await docClient.send(new QueryCommand({
      TableName: MEMBERSHIPS_TABLE,
      IndexName: 'GroupMembersIndex',
      KeyConditionExpression: 'groupId = :groupId',
      ExpressionAttributeValues: {
        ':groupId': groupId
      }
    }));

    return response.Items as GroupMembership[] || [];
  } catch (error) {
    console.error('Error fetching group members', { groupId, error });
    return [];
  }
}

/**
 * Evaluate dynamic rules against user attributes
 */
function evaluateRules(
  user: User,
  rules: { conditions: DynamicRule[]; logicalOperator: 'AND' | 'OR' }
): boolean {
  const { conditions, logicalOperator } = rules;

  if (!conditions || conditions.length === 0) {
    return false;
  }

  const results = conditions.map(condition => evaluateCondition(user, condition));

  if (logicalOperator === 'OR') {
    return results.some(r => r);
  } else {
    return results.every(r => r);
  }
}

/**
 * Evaluate a single condition against user attributes
 */
function evaluateCondition(user: User, condition: DynamicRule): boolean {
  const userValue = getUserFieldValue(user, condition.field);
  const { operator, value } = condition;

  switch (operator) {
    case 'equals':
      return userValue === value;
    case 'notEquals':
      return userValue !== value;
    case 'contains':
      return typeof userValue === 'string' && userValue.includes(value);
    case 'startsWith':
      return typeof userValue === 'string' && userValue.startsWith(value);
    case 'endsWith':
      return typeof userValue === 'string' && userValue.endsWith(value);
    case 'greaterThan':
      return Number(userValue) > Number(value);
    case 'lessThan':
      return Number(userValue) < Number(value);
    case 'in':
      return Array.isArray(value) && value.includes(userValue);
    case 'notIn':
      return Array.isArray(value) && !value.includes(userValue);
    case 'exists':
      return userValue !== undefined && userValue !== null;
    default:
      console.warn('Unknown operator', { operator });
      return false;
  }
}

/**
 * Get user field value, supporting nested attributes
 */
function getUserFieldValue(user: User, field: string): any {
  const parts = field.split('.');
  let value: any = user;

  for (const part of parts) {
    if (value && typeof value === 'object') {
      value = value[part];
    } else {
      return undefined;
    }
  }

  return value;
}

/**
 * Add membership
 */
async function addMembership(userId: string, groupId: string): Promise<void> {
  const now = new Date().toISOString();
  const membershipId = `user#${userId}#group#${groupId}`;

  await docClient.send(new PutCommand({
    TableName: MEMBERSHIPS_TABLE,
    Item: {
      id: membershipId,
      userId,
      groupId,
      membershipType: 'dynamic',
      addedAt: now,
      addedBy: 'system:group-membership-reconciliation',
      lastEvaluatedAt: now
    }
  }));

  // Log the membership addition
  await logAudit({
    groupId,
    action: 'member_added_reconciliation',
    performedBy: 'system:group-membership-reconciliation',
    targetUserId: userId,
    details: {
      membershipType: 'dynamic',
      reason: 'Added during scheduled reconciliation',
      automated: true
    }
  });
}

/**
 * Remove membership
 */
async function removeMembership(userId: string, groupId: string): Promise<void> {
  const membershipId = `user#${userId}#group#${groupId}`;

  await docClient.send(new DeleteCommand({
    TableName: MEMBERSHIPS_TABLE,
    Key: { id: membershipId }
  }));

  // Log the membership removal
  await logAudit({
    groupId,
    action: 'member_removed_reconciliation',
    performedBy: 'system:group-membership-reconciliation',
    targetUserId: userId,
    details: {
      membershipType: 'dynamic',
      reason: 'Removed during scheduled reconciliation',
      automated: true
    }
  });
}

/**
 * Log audit event
 */
async function logAudit(params: {
  groupId: string;
  action: string;
  performedBy: string;
  targetUserId?: string;
  details: Record<string, any>;
}): Promise<void> {
  const { groupId, action, performedBy, targetUserId, details } = params;
  const timestamp = new Date().toISOString();

  try {
    await docClient.send(new PutCommand({
      TableName: AUDIT_LOGS_TABLE,
      Item: {
        id: `${groupId}#${Date.now()}`,
        groupId,
        action,
        performedBy,
        targetUserId,
        timestamp,
        details,
        ttl: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60 * 2) // 2 years
      }
    }));
  } catch (error) {
    console.error('Error logging audit event', { error });
    // Don't throw - audit logging shouldn't block the main operation
  }
}

/**
 * Log reconciliation run results
 */
async function logReconciliationRun(result: ReconciliationResult): Promise<void> {
  try {
    await docClient.send(new PutCommand({
      TableName: AUDIT_LOGS_TABLE,
      Item: {
        id: `reconciliation#${Date.now()}`,
        groupId: 'system',
        action: 'reconciliation_completed',
        performedBy: 'system:group-membership-reconciliation',
        timestamp: result.endTime,
        details: {
          ...result,
          automated: true,
          scheduled: true
        },
        ttl: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) // 1 year
      }
    }));
  } catch (error) {
    console.error('Error logging reconciliation run', { error });
  }
}