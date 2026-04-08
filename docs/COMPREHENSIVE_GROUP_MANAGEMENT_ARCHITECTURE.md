# Comprehensive Group Management System - Architecture Design

## Executive Summary

This document outlines the architecture for implementing a comprehensive group management system with dynamic membership rules, hierarchical organization, advanced permission management, and real-time synchronization capabilities.

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Enhanced Data Model](#enhanced-data-model)
3. [Dynamic Group Rules Engine](#dynamic-group-rules-engine)
4. [Group Hierarchy System](#group-hierarchy-system)
5. [Permission Conflict Resolution](#permission-conflict-resolution)
6. [Backend Architecture](#backend-architecture)
7. [Frontend Architecture](#frontend-architecture)
8. [Real-Time Synchronization](#real-time-synchronization)
9. [Implementation Roadmap](#implementation-roadmap)
10. [Security Considerations](#security-considerations)

---

## 1. Current State Analysis

### Existing Infrastructure

**Frontend Components:**
- `GroupManagement.tsx`: Basic CRUD operations for groups
- Displays groups in card grid with role assignments
- Modal for creating/editing groups

**Backend Services:**
- `user-management-service/index.ts`: Stub implementations
- Basic GET/POST/PUT/DELETE endpoints for groups
- Simple DynamoDB operations

**Data Model:**
```typescript
interface Group {
  id: string;
  name: string;
  description: string;
  roleIds: string[];
  members: string[];      // Static list
  tags: Record<string, string>;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}
```

### Gaps to Address

1. ❌ No dynamic membership rules
2. ❌ No group hierarchy support
3. ❌ No bulk member operations
4. ❌ No permission conflict resolution
5. ❌ No real-time membership updates
6. ❌ No resource quotas per group
7. ❌ No detailed audit logging
8. ❌ No nested group support

---

## 2. Enhanced Data Model

### 2.1 DynamoDB Table Schema

#### Groups Table (Enhanced)

```typescript
interface EnhancedGroup {
  // Core Identity
  id: string;                    // Partition Key
  name: string;
  description: string;
  
  // Membership Management
  membershipType: 'static' | 'dynamic' | 'hybrid';
  staticMembers: string[];       // User IDs directly assigned
  dynamicRules?: DynamicRule[];  // Rules for auto-membership
  
  // Hierarchy
  parentGroupId?: string;
  childGroupIds: string[];
  hierarchyPath: string;         // e.g., "/root/dept/team"
  level: number;                 // Depth in hierarchy (0 = root)
  
  // Permissions & Resources
  roleIds: string[];
  directPermissions: string[];   // Bypass role inheritance
  resourceQuotas: ResourceQuota;
  
  // Configuration
  tags: Record<string, string>;
  isDefault: boolean;
  isSystem: boolean;             // Cannot be deleted
  
  // Metadata
  memberCount: number;           // Cached for performance
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  lastEvaluatedAt?: string;      // For dynamic groups
  
  // Advanced Features
  conflictResolution: 'highest' | 'lowest' | 'explicit';
  inheritPermissions: boolean;   // From parent groups
  propagateToChildren: boolean;
}

interface DynamicRule {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  priority: number;              // Higher = evaluated first
  conditions: RuleCondition[];
  logicalOperator: 'AND' | 'OR';
  evaluationCache?: {
    lastEvaluated: string;
    matchedUsers: string[];
    cacheExpiry: string;
  };
}

interface RuleCondition {
  field: string;                 // e.g., "department", "role", "status"
  operator: 'equals' | 'notEquals' | 'contains' | 'startsWith' | 'endsWith' | 
            'greaterThan' | 'lessThan' | 'in' | 'notIn' | 'exists';
  value: any;
  caseSensitive?: boolean;
}

interface ResourceQuota {
  maxWorkstations?: number;
  maxStorageGB?: number;
  maxCostPerMonth?: number;
  allowedInstanceTypes?: string[];
  allowedRegions?: string[];
  maxConcurrentWorkstations?: number;
}
```

#### Group Memberships Table (New)

For efficient many-to-many queries:

```typescript
interface GroupMembership {
  id: string;                    // Partition Key: "user#<userId>#group#<groupId>"
  userId: string;                // GSI Partition Key
  groupId: string;               // GSI Sort Key
  membershipType: 'static' | 'dynamic' | 'nested';
  sourceRuleId?: string;         // If dynamic
  addedAt: string;
  addedBy?: string;
  expiresAt?: string;            // Optional expiry
  metadata?: Record<string, any>;
}
```

#### Group Audit Logs Table (New)

```typescript
interface GroupAuditLog {
  id: string;                    // Partition Key
  groupId: string;               // GSI Partition Key
  timestamp: string;             // GSI Sort Key
  action: GroupAction;
  performedBy: string;
  details: AuditDetails;
  ipAddress?: string;
  userAgent?: string;
}

type GroupAction = 
  | 'GROUP_CREATED'
  | 'GROUP_UPDATED'
  | 'GROUP_DELETED'
  | 'MEMBER_ADDED'
  | 'MEMBER_REMOVED'
  | 'MEMBER_BULK_ADD'
  | 'MEMBER_BULK_REMOVE'
  | 'RULE_ADDED'
  | 'RULE_UPDATED'
  | 'RULE_DELETED'
  | 'HIERARCHY_CHANGED'
  | 'PERMISSIONS_UPDATED'
  | 'QUOTA_CHANGED'
  | 'DYNAMIC_EVALUATION';

interface AuditDetails {
  before?: any;
  after?: any;
  affectedUsers?: string[];
  ruleMatches?: number;
  changesSummary?: string;
}
```

### 2.2 Global Secondary Indexes

**Groups Table GSIs:**
1. `parentGroupId-createdAt-index`: Query child groups
2. `membershipType-updatedAt-index`: Query dynamic groups for re-evaluation
3. `createdBy-createdAt-index`: User's created groups

**GroupMemberships GSIs:**
1. `userId-groupId-index`: All groups for a user
2. `groupId-userId-index`: All members of a group

**GroupAuditLogs GSIs:**
1. `groupId-timestamp-index`: Group activity timeline
2. `performedBy-timestamp-index`: User's group actions

---

## 3. Dynamic Group Rules Engine

### 3.1 Rule Evaluation Architecture

```typescript
class DynamicGroupEvaluator {
  /**
   * Evaluates all dynamic rules for a group and returns matching users
   */
  async evaluateGroupRules(groupId: string): Promise<string[]> {
    const group = await this.getGroup(groupId);
    if (!group.dynamicRules || group.membershipType === 'static') {
      return [];
    }

    const matchedUsers = new Set<string>();
    const sortedRules = this.sortRulesByPriority(group.dynamicRules);

    for (const rule of sortedRules) {
      if (!rule.enabled) continue;

      const ruleMatches = await this.evaluateSingleRule(rule);
      ruleMatches.forEach(userId => matchedUsers.add(userId));
    }

    return Array.from(matchedUsers);
  }

  /**
   * Evaluates a single rule against all users
   */
  private async evaluateSingleRule(rule: DynamicRule): Promise<string[]> {
    const allUsers = await this.getAllUsers();
    const matches: string[] = [];

    for (const user of allUsers) {
      if (this.userMatchesRule(user, rule)) {
        matches.push(user.id);
      }
    }

    return matches;
  }

  /**
   * Checks if a user matches a rule's conditions
   */
  private userMatchesRule(user: EnhancedUser, rule: DynamicRule): boolean {
    const conditionResults = rule.conditions.map(condition =>
      this.evaluateCondition(user, condition)
    );

    if (rule.logicalOperator === 'AND') {
      return conditionResults.every(result => result);
    } else {
      return conditionResults.some(result => result);
    }
  }

  /**
   * Evaluates a single condition against a user
   */
  private evaluateCondition(user: EnhancedUser, condition: RuleCondition): boolean {
    const fieldValue = this.getUserFieldValue(user, condition.field);
    
    switch (condition.operator) {
      case 'equals':
        return this.compareEquals(fieldValue, condition.value, condition.caseSensitive);
      case 'notEquals':
        return !this.compareEquals(fieldValue, condition.value, condition.caseSensitive);
      case 'contains':
        return this.compareContains(fieldValue, condition.value, condition.caseSensitive);
      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(fieldValue);
      case 'exists':
        return fieldValue !== undefined && fieldValue !== null;
      // ... other operators
      default:
        return false;
    }
  }

  /**
   * Real-time evaluation when user attributes change
   */
  async reevaluateUserMemberships(userId: string): Promise<void> {
    const dynamicGroups = await this.getDynamicGroups();
    
    for (const group of dynamicGroups) {
      const shouldBeMember = await this.userShouldBeInGroup(userId, group);
      const isMember = await this.isUserInGroup(userId, group.id);
      
      if (shouldBeMember && !isMember) {
        await this.addUserToGroup(userId, group.id, 'dynamic');
      } else if (!shouldBeMember && isMember) {
        await this.removeUserFromGroup(userId, group.id);
      }
    }
  }
}
```

### 3.2 Rule Caching Strategy

```typescript
interface RuleEvaluationCache {
  ruleId: string;
  groupId: string;
  matchedUsers: string[];
  evaluatedAt: string;
  expiresAt: string;
  conditions: RuleCondition[];
}
```

**Caching Policy:**
- Cache dynamic rule results for 5-15 minutes
- Invalidate cache when:
  - Rule conditions change
  - User attributes that match rule fields change
  - Manual group member changes occur
- Use DynamoDB TTL for automatic cache expiration

### 3.3 Supported Rule Fields

```typescript
const RULE_SUPPORTED_FIELDS = {
  // User Identity
  'email': 'string',
  'name': 'string',
  'status': 'string',
  
  // User Attributes
  'attributes.department': 'string',
  'attributes.location': 'string',
  'attributes.title': 'string',
  'attributes.employeeType': 'string',
  'attributes.startDate': 'date',
  'attributes.managerId': 'string',
  
  // Roles & Permissions
  'roleIds': 'array',
  'groupIds': 'array',
  'directPermissions': 'array',
  
  // Activity
  'lastLoginAt': 'date',
  'createdAt': 'date',
  
  // Custom Attributes
  'attributes.*': 'any',  // Support custom fields
} as const;
```

---

## 4. Group Hierarchy System

### 4.1 Hierarchy Model

```
┌─────────────────────────────────────────────┐
│           Root Organization                 │
│           hierarchyPath: "/"                │
│           level: 0                          │
└──────────────┬──────────────────────────────┘
               │
        ┌──────┴──────┬──────────────┐
        │             │              │
    ┌───▼───┐    ┌───▼───┐     ┌───▼───┐
    │ Dept  │    │ Dept  │     │ Dept  │
    │ Eng   │    │ Sales │     │ HR    │
    │ /eng  │    │ /sales│     │ /hr   │
    │ lvl:1 │    │ lvl:1 │     │ lvl:1 │
    └───┬───┘    └───────┘     └───────┘
        │
    ┌───┴───┬───────────┐
    │       │           │
┌───▼─┐ ┌───▼─┐     ┌───▼─┐
│Team │ │Team │     │Team │
│FE   │ │BE   │     │QA   │
│/eng │ │/eng │     │/eng │
│/fe  │ │/be  │     │/qa  │
│lvl:2│ │lvl:2│     │lvl:2│
└─────┘ └─────┘     └─────┘
```

### 4.2 Hierarchy Operations

```typescript
class GroupHierarchyManager {
  /**
   * Creates a group hierarchy path
   */
  buildHierarchyPath(parentPath: string, groupName: string): string {
    return `${parentPath}/${groupName.toLowerCase().replace(/\s+/g, '-')}`;
  }

  /**
   * Gets all ancestor groups (parent, grandparent, etc.)
   */
  async getAncestors(groupId: string): Promise<EnhancedGroup[]> {
    const ancestors: EnhancedGroup[] = [];
    let currentGroup = await this.getGroup(groupId);
    
    while (currentGroup.parentGroupId) {
      const parent = await this.getGroup(currentGroup.parentGroupId);
      ancestors.push(parent);
      currentGroup = parent;
    }
    
    return ancestors;
  }

  /**
   * Gets all descendant groups (children, grandchildren, etc.)
   */
  async getDescendants(groupId: string): Promise<EnhancedGroup[]> {
    const descendants: EnhancedGroup[] = [];
    const group = await this.getGroup(groupId);
    
    for (const childId of group.childGroupIds) {
      const child = await this.getGroup(childId);
      descendants.push(child);
      const grandchildren = await this.getDescendants(childId);
      descendants.push(...grandchildren);
    }
    
    return descendants;
  }

  /**
   * Moves a group to a new parent (with validation)
   */
  async moveGroup(groupId: string, newParentId: string): Promise<void> {
    // Validate no circular references
    if (await this.wouldCreateCircular(groupId, newParentId)) {
      throw new Error('Cannot move group: would create circular hierarchy');
    }
    
    const group = await this.getGroup(groupId);
    const newParent = await this.getGroup(newParentId);
    
    // Remove from old parent
    if (group.parentGroupId) {
      await this.removeChildFromParent(group.parentGroupId, groupId);
    }
    
    // Update group
    group.parentGroupId = newParentId;
    group.hierarchyPath = this.buildHierarchyPath(newParent.hierarchyPath, group.name);
    group.level = newParent.level + 1;
    
    // Add to new parent
    await this.addChildToParent(newParentId, groupId);
    
    // Update all descendants' paths recursively
    await this.updateDescendantPaths(groupId);
  }
}
```

### 4.3 Permission Inheritance

```typescript
/**
 * Permission inheritance flows DOWN the hierarchy
 * - Parent permissions are inherited by children (if inheritPermissions=true)
 * - Child-specific permissions are additive
 * - Direct permissions on user override group permissions
 */
async function getEffectivePermissions(userId: string): Promise<Set<string>> {
  const permissions = new Set<string>();
  const user = await getUser(userId);
  
  // 1. Add direct user permissions (highest priority)
  user.directPermissions.forEach(p => permissions.add(p));
  
  // 2. Get all user's groups (including nested)
  const userGroups = await getUserGroups(userId);
  
  for (const group of userGroups) {
    // 3. Add group's direct permissions
    group.directPermissions.forEach(p => permissions.add(p));
    
    // 4. Add role permissions from group
    for (const roleId of group.roleIds) {
      const role = await getRole(roleId);
      role.permissions.forEach(p => permissions.add(p));
    }
    
    // 5. If inheritance enabled, get parent permissions
    if (group.inheritPermissions && group.parentGroupId) {
      const parentPerms = await getGroupPermissionsRecursive(group.parentGroupId);
      parentPerms.forEach(p => permissions.add(p));
    }
  }
  
  return permissions;
}
```

---

## 5. Permission Conflict Resolution

### 5.1 Conflict Scenarios

```typescript
/**
 * Scenario 1: User in multiple groups with different permissions
 * Group A: workstations:read, workstations:write
 * Group B: workstations:read
 * Result: UNION (workstations:read, workstations:write)
 */

/**
 * Scenario 2: Overlapping resource quotas
 * Group A: maxWorkstations: 5
 * Group B: maxWorkstations: 10
 * Result: Based on conflictResolution strategy
 */

/**
 * Scenario 3: Hierarchical conflicts
 * Parent Group: maxCostPerMonth: 1000
 * Child Group: maxCostPerMonth: 2000
 * Result: Based on conflictResolution strategy
 */
```

### 5.2 Resolution Strategies

```typescript
type ConflictResolutionStrategy = 
  | 'highest'     // Take the most permissive value
  | 'lowest'      // Take the most restrictive value
  | 'explicit'    // Use explicitly set value, error if multiple
  | 'deny'        // Deny if any group denies
  | 'union';      // Combine all permissions

class PermissionConflictResolver {
  /**
   * Resolves conflicts in resource quotas
   */
  resolveQuotaConflicts(
    quotas: ResourceQuota[],
    strategy: ConflictResolutionStrategy
  ): ResourceQuota {
    const resolved: ResourceQuota = {};
    
    // Permissions are always UNION
    const allPermissions = new Set<string>();
    quotas.forEach(q => {
      q.allowedInstanceTypes?.forEach(t => allPermissions.add(t));
      q.allowedRegions?.forEach(r => allPermissions.add(r));
    });
    
    resolved.allowedInstanceTypes = Array.from(allPermissions);
    resolved.allowedRegions = Array.from(allPermissions);
    
    // Numeric quotas depend on strategy
    const maxWorkstations = quotas.map(q => q.maxWorkstations).filter(Boolean);
    if (maxWorkstations.length > 0) {
      resolved.maxWorkstations = strategy === 'highest'
        ? Math.max(...maxWorkstations)
        : Math.min(...maxWorkstations);
    }
    
    const maxCost = quotas.map(q => q.maxCostPerMonth).filter(Boolean);
    if (maxCost.length > 0) {
      resolved.maxCostPerMonth = strategy === 'highest'
        ? Math.max(...maxCost)
        : Math.min(...maxCost);
    }
    
    return resolved;
  }

  /**
   * Validates if user can perform action with resolved permissions
   */
  async validateUserAction(
    userId: string,
    action: string,
    resourceRequirements?: ResourceQuota
  ): Promise<{ allowed: boolean; reason?: string }> {
    const effectivePerms = await getEffectivePermissions(userId);
    const effectiveQuota = await getEffectiveQuota(userId);
    
    // Check permission
    if (!effectivePerms.has(action)) {
      return { allowed: false, reason: `Missing permission: ${action}` };
    }
    
    // Check quotas if provided
    if (resourceRequirements) {
      if (resourceRequirements.maxWorkstations && 
          effectiveQuota.maxWorkstations &&
          resourceRequirements.maxWorkstations > effectiveQuota.maxWorkstations) {
        return { 
          allowed: false, 
          reason: `Exceeds quota: maxWorkstations (${effectiveQuota.maxWorkstations})` 
        };
      }
    }
    
    return { allowed: true };
  }
}
```

---

## 6. Backend Architecture

### 6.1 New API Endpoints

```typescript
// Group Management
POST   /admin/groups                          // Create group
GET    /admin/groups                          // List groups (with filters)
GET    /admin/groups/{id}                     // Get group details
PUT    /admin/groups/{id}                     // Update group
DELETE /admin/groups/{id}                     // Delete group

// Group Membership
GET    /admin/groups/{id}/members             // List members
POST   /admin/groups/{id}/members             // Add member
POST   /admin/groups/{id}/members/bulk        // Bulk add members
DELETE /admin/groups/{id}/members/{userId}    // Remove member
DELETE /admin/groups/{id}/members/bulk        // Bulk remove members

// Dynamic Rules
POST   /admin/groups/{id}/rules               // Add dynamic rule
PUT    /admin/groups/{id}/rules/{ruleId}      // Update rule
DELETE /admin/groups/{id}/rules/{ruleId}      // Delete rule
POST   /admin/groups/{id}/rules/{ruleId}/evaluate  // Manually trigger evaluation

// Group Hierarchy
PUT    /admin/groups/{id}/parent              // Change parent group
GET    /admin/groups/{id}/ancestors           // Get ancestor groups
GET    /admin/groups/{id}/descendants         // Get descendant groups
GET    /admin/groups/tree                     // Get full hierarchy tree

// Permissions & Quotas
GET    /admin/groups/{id}/effective-permissions  // Get resolved permissions
GET    /admin/groups/{id}/effective-quotas       // Get resolved quotas
PUT    /admin/groups/{id}/quotas                 // Update quotas

// Audit
GET    /admin/groups/{id}/audit-logs          // Get group activity
GET    /admin/groups/{id}/members/history     // Member change history

// User-centric
GET    /admin/users/{id}/groups               // User's groups
GET    /admin/users/{id}/effective-permissions  // User's resolved permissions
POST   /admin/users/{id}/reevaluate           // Trigger membership re-evaluation
```

### 6.2 Enhanced Lambda Structure

```typescript
// Enhanced handler with new routes
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const routes = new Map<string, Handler>([
    // Group CRUD
    ['GET /admin/groups', listGroups],
    ['GET /admin/groups/{id}', getGroup],
    ['POST /admin/groups', createGroup],
    ['PUT /admin/groups/{id}', updateGroup],
    ['DELETE /admin/groups/{id}', deleteGroup],
    
    // Members
    ['GET /admin/groups/{id}/members', getGroupMembers],
    ['POST /admin/groups/{id}/members', addGroupMember],
    ['POST /admin/groups/{id}/members/bulk', bulkAddMembers],
    ['DELETE /admin/groups/{id}/members/{userId}', removeGroupMember],
    ['DELETE /admin/groups/{id}/members/bulk', bulkRemoveMembers],
    
    // Dynamic Rules
    ['POST /admin/groups/{id}/rules', addDynamicRule],
    ['PUT /admin/groups/{id}/rules/{ruleId}', updateDynamicRule],
    ['DELETE /admin/groups/{id}/rules/{ruleId}', deleteDynamicRule],
    ['POST /admin/groups/{id}/rules/{ruleId}/evaluate', evaluateDynamicRule],
    
    // Hierarchy
    ['PUT /admin/groups/{id}/parent', changeParentGroup],
    ['GET /admin/groups/{id}/ancestors', getAncestors],
    ['GET /admin/groups/{id}/descendants', getDescendants],
    ['GET /admin/groups/tree', getGroupTree],
    
    // Permissions
    ['GET /admin/groups/{id}/effective-permissions', getEffectivePermissions],
    ['GET /admin/groups/{id}/effective-quotas', getEffectiveQuotas],
    ['PUT /admin/groups/{id}/quotas', updateQuotas],
    
    // Audit
    ['GET /admin/groups/{id}/audit-logs', getGroupAuditLogs],
  ]);
  
  const handler = findMatchingRoute(event, routes);
  return await handler(event);
};
```

### 6.3 Background Jobs

```typescript
/**
 * Scheduled Lambda for periodic dynamic group evaluation
 */
export const dynamicGroupEvaluationJob = async (): Promise<void> => {
  const dynamicGroups = await getDynamicGroups();
  
  for (const group of dynamicGroups) {
    try {
      console.log(`Evaluating dynamic group: ${group.name}`);
      await evaluateAndSyncGroupMembership(group.id);
    } catch (error) {
      console.error(`Failed to evaluate group ${group.id}:`, error);
    }
  }
};

/**
 * EventBridge-triggered function for user attribute changes
 */
export const userAttributeChangeHandler = async (event: DynamoDBStreamEvent): Promise<void> => {
  for (const record of event.Records) {
    if (record.eventName === 'MODIFY') {
      const userId = record.dynamodb?.Keys?.id?.S;
      if (userId) {
        await reevaluateUserMemberships(userId);
      }
    }
  }
};
```

---

## 7. Frontend Architecture

### 7.1 Component Hierarchy

```
GroupManagement (Container)
├── GroupListView
│   ├── GroupFilters
│   ├── GroupSearchBar
│   ├── GroupCard[]
│   └── GroupPagination
├── GroupDetailView
│   ├── GroupHeader
│   ├── GroupTabs
│   │   ├── MembersTab
│   │   │   ├── MemberList
│   │   │   ├── AddMemberButton
│   │   │   └── BulkOperationsMenu
│   │   ├── RulesTab
│   │   │   ├── RuleList
│   │   │   └── DynamicRuleBuilder
│   │   ├── PermissionsTab
│   │   │   ├── RoleSelector
│   │   │   ├── DirectPermissionsEditor
│   │   │   └── EffectivePermissionsViewer
│   │   ├── QuotasTab
│   │   │   └── ResourceQuotaEditor
│   │   ├── HierarchyTab
│   │   │   ├── ParentGroupSelector
│   │   │   ├── ChildGroupsList
│   │   │   └── HierarchyTreeView
│   │   └── AuditTab
│   │       └── ActivityTimeline
│   └── GroupActions
├── DynamicRuleBuilder
│   ├── ConditionBuilder
│   ├── LogicalOperatorSelector
│   ├── RulePriorityEditor
│   └── RuleTestingPanel
└── GroupHierarchyVisualizer
    └── TreeDiagram (D3.js or similar)
```

### 7.2 Key Components

#### Dynamic Rule Builder

```typescript
interface DynamicRuleBuilderProps {
  groupId: string;
  existingRule?: DynamicRule;
  onSave: (rule: DynamicRule) => Promise<void>;
  onCancel: () => void;
}

const DynamicRuleBuilder: React.FC<DynamicRuleBuilderProps> = ({ 
  groupId, 
  existingRule, 
  onSave, 
  onCancel 
}) => {
  const [rule, setRule] = useState<DynamicRule>(existingRule || createEmptyRule());
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<TestResults | null>(null);

  const addCondition = () => {
    setRule(prev => ({
      ...prev,
      conditions: [...prev.conditions, createEmptyCondition()]
    }));
  };

  const removeCondition = (index: number) => {
    setRule(prev => ({
      ...prev,
      conditions: prev.conditions.filter((_, i) => i !== index)
    }));
  };

  const testRule = async () => {
    setTesting(true);
    try {
      const results = await apiClient.testDynamicRule(groupId, rule);
      setTestResults(results);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Rule metadata */}
      <div>
        <label>Rule Name</label>
        <input
          value={rule.name}
          onChange={(e) => setRule(prev => ({ ...prev, name: e.target.value }))}
        />
      </div>

      {/* Logical operator */}
      <div>
        <label>Match:</label>
        <select
          value={rule.logicalOperator}
          onChange={(e) => setRule(prev => ({ 
            ...prev, 
            logicalOperator: e.target.value as 'AND' | 'OR' 
          }))}
        >
          <option value="AND">All conditions (AND)</option>
          <option value="OR">Any condition (OR)</option>
        </select>
      </div>

      {/* Conditions */}
      <div className="space-y-4">
        {rule.conditions.map((condition, index) => (
          <ConditionEditor
            key={index}
            condition={condition}
            onChange={(updated) => updateCondition(index, updated)}
            onRemove={() => removeCondition(index)}
          />
        ))}
        <button onClick={addCondition}>+ Add Condition</button>
      </div>

      {/* Test results */}
      {testResults && (
        <div className="bg-blue-50 p-4 rounded">
          <h4>Test Results</h4>
          <p>{testResults.matchedUsers.length} users would match this rule</p>
          <ul>
            {testResults.matchedUsers.slice(0, 5).map(user => (
              <li key={user.id}>{user.name} ({user.email})</li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-4">
        <button onClick={testRule} disabled={testing}>
          {testing ? 'Testing...' : 'Test Rule'}
        </button>
        <button onClick={() => onSave(rule)}>Save Rule</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
};
```

#### Bulk Operations Modal

```typescript
interface BulkOperationsModalProps {
  groupId: string;
  operation: 'add' | 'remove';
  onComplete: () => void;
  onCancel: () => void;
}

const BulkOperationsModal: React.FC<BulkOperationsModalProps> = ({
  groupId,
  operation,
  onComplete,
  onCancel
}) => {
  const [userIds, setUserIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const csv = e.target?.result as string;
      const ids = csv.split('\n').map(line => line.trim()).filter(Boolean);
      setUserIds(ids);
    };
    reader.readAsText(file);
  };

  const executeBulkOperation = async () => {
    setUploading(true);
    try {
      if (operation === 'add') {
        await apiClient.bulkAddGroupMembers(groupId, userIds, (p) => setProgress(p));
      } else {
        await apiClient.bulkRemoveGroupMembers(groupId, userIds, (p) => setProgress(p));
      }
      onComplete();
    } catch (error) {
      alert(`Failed to ${operation} members: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal>
      <h2>Bulk {operation === 'add' ? 'Add' : 'Remove'} Members</h2>
      
      <div>
        <input type="file" accept=".csv" onChange={handleFileUpload} />
        <p>Upload a CSV file with user IDs or emails (one per line)</p>
      </div>

      {userIds.length > 0 && (
        <div>
          <p>{userIds.length} users will be {operation === 'add' ? 'added to' : 'removed from'} this group</p>
        </div>
      )}

      {uploading && (
        <div>
          <progress value={progress} max={100} />
          <p>{progress}% complete</p>
        </div>
      )}

      <div className="flex gap-4">
        <button onClick={executeBulkOperation} disabled={uploading || userIds.length === 0}>
          Execute
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </Modal>
  );
};
```

#### Group Hierarchy Tree

```typescript
import { Tree, TreeNode } from 'react-d3-tree';

interface GroupTreeNode {
  name: string;
  attributes?: { groupId: string };
  children?: GroupTreeNode[];
}

const GroupHierarchyVisualizer: React.FC<{ rootGroupId: string }> = ({ rootGroupId }) => {
  const [treeData, setTreeData] = useState<GroupTreeNode | null>(null);

  useEffect(() => {
    loadHierarchyTree();
  }, [rootGroupId]);

  const loadHierarchyTree = async () => {
    const tree = await apiClient.getGroupTree(rootGroupId);
    setTreeData(tree);
  };

  const handleNodeClick = (nodeData: TreeNode) => {
    const groupId = nodeData.attributes?.groupId;
    if (groupId) {
      navigate(`/admin/groups/${groupId}`);
    }
  };

  return (
    <div style={{ width: '100%', height: '600px' }}>
      {treeData && (
        <Tree
          data={treeData}
          orientation="vertical"
          translate={{ x: 400, y: 50 }}
          onNodeClick={handleNodeClick}
          pathFunc="step"
          nodeSize={{ x: 200, y: 100 }}
        />
      )}
    </div>
  );
};
```

---

## 8. Real-Time Synchronization

### 8.1 Change Detection

```typescript
/**
 * DynamoDB Streams + EventBridge integration
 */

// When user attributes change
Users Table (DynamoDB)
  └─> DynamoDB Stream
      └─> Lambda Trigger
          └─> Re-evaluate dynamic groups
              └─> Update GroupMemberships Table
                  └─> Publish to EventBridge
                      └─> Notify connected clients (WebSocket/SSE)

// When dynamic rule changes
Groups Table (DynamoDB)
  └─> Update rule
      └─> Trigger immediate evaluation
          └─> Compare previous vs new memberships
              └─> Publish change events
```

### 8.2 WebSocket Integration (Optional)

```typescript
// Frontend connection
const wsClient = new WebSocketClient('wss://api.example.com/ws');

wsClient.on('group:member:added', (data) => {
  queryClient.invalidateQueries(['groups', data.groupId, 'members']);
  toast.success(`${data.userName} was added to ${data.groupName}`);
});

wsClient.on('group:rule:evaluated', (data) => {
  queryClient.invalidateQueries(['groups', data.groupId]);
  toast.info(`Group ${data.groupName} membership updated`);
});
```

### 8.3 Polling Fallback

```typescript
// React Query with automatic refetch
const { data: groupMembers } = useQuery({
  queryKey: ['groups', groupId, 'members'],
  queryFn: () => apiClient.getGroupMembers(groupId),
  refetchInterval: 30000, // 30 seconds
  enabled: isDynamicGroup,
});
```

---

## 9. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
- [ ] Enhance DynamoDB schema with new tables
- [ ] Implement basic dynamic rule structure
- [ ] Create GroupMemberships table and GSIs
- [ ] Update API client with new endpoints
- [ ] Add audit logging infrastructure

### Phase 2: Dynamic Groups (Week 2-3)
- [ ] Implement rule evaluation engine
- [ ] Create condition operators
- [ ] Build caching layer
- [ ] Add manual and scheduled evaluation
- [ ] Build DynamicRuleBuilder component
- [ ] Add rule testing functionality

### Phase 3: Group Hierarchy (Week 3-4)
- [ ] Implement hierarchy path management
- [ ] Create parent/child operations
- [ ] Build permission inheritance logic
- [ ] Add hierarchy validation (circular ref check)
- [ ] Create GroupHierarchyVisualizer component
- [ ] Implement move group functionality

### Phase 4: Permissions & Quotas (Week 4-5)
- [ ] Implement conflict resolution strategies
- [ ] Create effective permissions resolver
- [ ] Build quota management system
- [ ] Add validation for quota enforcement
- [ ] Create ResourceQuotaEditor component
- [ ] Implement permission checking middleware

### Phase 5: Bulk Operations (Week 5)
- [ ] Create bulk add/remove endpoints
- [ ] Implement CSV parsing
- [ ] Add progress tracking
- [ ] Build BulkOperationsModal component
- [ ] Add error handling and rollback

### Phase 6: Advanced Features (Week 6)
- [ ] Implement member history tracking
- [ ] Create detailed audit logging
- [ ] Build activity timeline component
- [ ] Add search and filtering
- [ ] Implement nested group support

### Phase 7: Real-Time Sync (Week 7)
- [ ] Set up DynamoDB Streams
- [ ] Create EventBridge rules
- [ ] Implement user change detection
- [ ] Add WebSocket support (optional)
- [ ] Create notification system

### Phase 8: Testing & Polish (Week 8)
- [ ] Comprehensive unit tests
- [ ] Integration tests
- [ ] Performance optimization
- [ ] UI/UX refinements
- [ ] Documentation updates

---

## 10. Security Considerations

### 10.1 Authorization

```typescript
/**
 * Permission requirements for group operations
 */
const GROUP_PERMISSIONS = {
  'groups:read': ['viewGroups', 'viewGroupMembers'],
  'groups:write': ['createGroup', 'updateGroup', 'addMembers'],
  'groups:delete': ['deleteGroup', 'removeMembers'],
  'groups:manage-rules': ['createRule', 'updateRule', 'deleteRule'],
  'groups:manage-hierarchy': ['changeParent', 'moveGroup'],
  'groups:view-audit': ['viewAuditLogs'],
} as const;
```

### 10.2 Input Validation

```typescript
/**
 * Validate dynamic rule to prevent injection
 */
function validateRule(rule: DynamicRule): ValidationResult {
  // Check field names are in allowlist
  for (const condition of rule.conditions) {
    if (!RULE_SUPPORTED_FIELDS[condition.field]) {
      return { valid: false, error: `Invalid field: ${condition.field}` };
    }
  }
  
  // Validate operators
  const validOperators = ['equals', 'notEquals', 'contains', 'in', 'exists'];
  for (const condition of rule.conditions) {
    if (!validOperators.includes(condition.operator)) {
      return { valid: false, error: `Invalid operator: ${condition.operator}` };
    }
  }
  
  // Prevent regex injection in 'contains' operator
  for (const condition of rule.conditions) {
    if (condition.operator === 'contains' && typeof condition.value === 'string') {
      if (/[.*+?^${}()|[\]\\]/.test(condition.value)) {
        return { valid: false, error: 'Special regex characters not allowed in contains' };
      }
    }
  }
  
  return { valid: true };
}
```

### 10.3 Rate Limiting

```typescript
/**
 * Prevent abuse of dynamic rule evaluation
 */
const RATE_LIMITS = {
  ruleEvaluationPerHour: 10,
  bulkOperationsPerHour: 5,
  groupCreationPerDay: 20,
} as const;
```

### 10.4 Audit Requirements

```typescript
/**
 * All sensitive operations must be audited
 */
const AUDITED_OPERATIONS = [
  'GROUP_CREATED',
  'GROUP_DELETED',
  'MEMBER_ADDED',
  'MEMBER_REMOVED',
  'RULE_CREATED',
  'RULE_UPDATED',
  'RULE_DELETED',
  'PERMISSIONS_CHANGED',
  'QUOTA_CHANGED',
  'HIERARCHY_CHANGED',
] as const;
```

---

## Conclusion

This comprehensive group management system provides:

✅ **Dynamic Membership** - Rule-based automatic user assignment  
✅ **Hierarchical Organization** - Multi-level group structure with inheritance  
✅ **Advanced Permissions** - Conflict resolution and effective permission calculation  
✅ **Bulk Operations** - Efficient mass member management  
✅ **Real-Time Sync** - Automatic membership updates when user attributes change  
✅ **Detailed Auditing** - Complete activity tracking and history  
✅ **Scalable Architecture** - Designed for enterprise-level usage  
✅ **Flexible Configuration** - Customizable rules, quotas, and strategies  

### Estimated Effort

- **Backend**: 120-150 hours
- **Frontend**: 80-100 hours
- **Testing**: 40-50 hours
- **Total**: 240-300 hours (6-8 weeks with 1 developer)

### Next Steps

1. Review and approve architectural design
2. Prioritize features for MVP
3. Set up development environment
4. Begin Phase 1 implementation
5. Conduct iterative reviews

---

**Document Version**: 1.0  
**Last Updated**: 2025-11-13  
**Author**: Roo Architect Mode  
**Status**: Awaiting Review