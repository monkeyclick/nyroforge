// Enhanced authentication and authorization types
export type Permission =
  | 'workstations:read'
  | 'workstations:write'
  | 'workstations:delete'
  | 'workstations:manage-all'
  | 'users:read'
  | 'users:write'
  | 'users:delete'
  | 'groups:read'
  | 'groups:write'
  | 'groups:delete'
  | 'groups:manage-rules'
  | 'groups:manage-hierarchy'
  | 'groups:view-audit'
  | 'roles:read'
  | 'roles:write'
  | 'roles:delete'
  | 'analytics:read'
  | 'settings:read'
  | 'settings:write'
  | 'admin:full-access';

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  isSystem: boolean; // Cannot be deleted if true
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

// Basic Group interface (backward compatible)
export interface Group {
  id: string;
  name: string;
  description: string;
  roleIds: string[];
  members: string[]; // User IDs
  tags: Record<string, string>;
  isDefault: boolean; // Auto-assign new users if true
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

// Enhanced Group with dynamic rules, hierarchy, and quotas
export interface EnhancedGroup extends Group {
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
  directPermissions: Permission[]; // Bypass role inheritance
  resourceQuotas?: ResourceQuota;
  
  // Configuration
  isSystem: boolean;             // Cannot be deleted
  memberCount: number;           // Cached for performance
  lastEvaluatedAt?: string;      // For dynamic groups
  
  // Advanced Features
  conflictResolution: 'highest' | 'lowest' | 'explicit';
  inheritPermissions: boolean;   // From parent groups
  propagateToChildren: boolean;
}

// Dynamic rule for automatic group membership
export interface DynamicRule {
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

// Condition for dynamic rules
export interface RuleCondition {
  field: string;                 // e.g., "department", "role", "status"
  operator: 'equals' | 'notEquals' | 'contains' | 'startsWith' | 'endsWith' |
            'greaterThan' | 'lessThan' | 'in' | 'notIn' | 'exists';
  value: any;
  caseSensitive?: boolean;
}

// Resource quotas per group
export interface ResourceQuota {
  maxWorkstations?: number;
  maxStorageGB?: number;
  maxCostPerMonth?: number;
  allowedInstanceTypes?: string[];
  allowedRegions?: string[];
  maxConcurrentWorkstations?: number;
}

// Group membership record
export interface GroupMembership {
  id: string;                    // "user#<userId>#group#<groupId>"
  userId: string;
  groupId: string;
  membershipType: 'static' | 'dynamic' | 'nested';
  sourceRuleId?: string;         // If dynamic
  addedAt: string;
  addedBy?: string;
  expiresAt?: string;            // Optional expiry
  metadata?: Record<string, any>;
}

// Group audit log entry
export interface GroupAuditLog {
  id: string;
  groupId: string;
  timestamp: string;
  action: GroupAction;
  performedBy: string;
  performedByEmail?: string;
  details: GroupAuditDetails;
  ipAddress?: string;
  userAgent?: string;
}

export type GroupAction =
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
  | 'RULE_EVALUATED'
  | 'HIERARCHY_CHANGED'
  | 'PERMISSIONS_UPDATED'
  | 'QUOTA_CHANGED'
  | 'DYNAMIC_EVALUATION';

export interface GroupAuditDetails {
  before?: any;
  after?: any;
  affectedUsers?: string[];
  ruleMatches?: number;
  changesSummary?: string;
}

export interface EnhancedUser {
  id: string;
  email: string;
  name: string;
  phone?: string;
  status: 'active' | 'suspended' | 'pending' | 'deleted';
  roleIds: string[];
  groupIds: string[];
  directPermissions: Permission[]; // Direct permissions bypassing roles
  attributes: Record<string, any>;
  preferences: UserPreferences;
  loginHistory: LoginEvent[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  createdBy?: string;
  // Deletion-related fields
  deletedAt?: string;
  deletedBy?: string;
  deletionType?: 'soft' | 'hard';
  scheduledPurgeDate?: string;
  deletionReason?: string;
}

export interface UserPreferences {
  defaultRegion?: string;
  defaultInstanceType?: string;
  defaultAutoTerminateHours?: number;
  theme?: 'light' | 'dark';
  notifications?: boolean;
  language?: string;
  timezone?: string;
}

export interface LoginEvent {
  timestamp: string;
  ipAddress: string;
  userAgent: string;
  location?: string;
  success: boolean;
}

export interface PermissionCheck {
  userId: string;
  permission: Permission;
  resourceId?: string; // For resource-specific checks
  context?: Record<string, any>;
}

export interface AuthContext {
  user: EnhancedUser | null;
  roles: Role[];
  groups: Group[];
  permissions: Permission[];
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface UserInvitation {
  id: string;
  email: string;
  roleIds: string[];
  groupIds: string[];
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
}

// API request/response types
export interface CreateUserRequest {
  email: string;
  name: string;
  roleIds: string[];
  groupIds?: string[];
  sendInvitation?: boolean;
  attributes?: Record<string, any>;
}

export interface UpdateUserRequest {
  name?: string;
  phone?: string;
  status?: 'active' | 'suspended';
  roleIds?: string[];
  groupIds?: string[];
  attributes?: Record<string, any>;
}

export interface CreateRoleRequest {
  name: string;
  description: string;
  permissions: Permission[];
}

export interface CreateGroupRequest {
  name: string;
  description: string;
  roleIds: string[];
  isDefault?: boolean;
  tags?: Record<string, string>;
  // Enhanced fields
  membershipType?: 'static' | 'dynamic' | 'hybrid';
  parentGroupId?: string;
  directPermissions?: Permission[];
  resourceQuotas?: ResourceQuota;
  conflictResolution?: 'highest' | 'lowest' | 'explicit';
  inheritPermissions?: boolean;
  propagateToChildren?: boolean;
}

export interface UpdateGroupRequest {
  name?: string;
  description?: string;
  roleIds?: string[];
  isDefault?: boolean;
  tags?: Record<string, string>;
  directPermissions?: Permission[];
  resourceQuotas?: ResourceQuota;
  conflictResolution?: 'highest' | 'lowest' | 'explicit';
  inheritPermissions?: boolean;
  propagateToChildren?: boolean;
}

export interface UsersListResponse {
  users: EnhancedUser[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

export interface RolesListResponse {
  roles: Role[];
}

export interface GroupsListResponse {
  groups: Group[] | EnhancedGroup[];
  pagination?: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

export interface GroupMembersResponse {
  members: EnhancedUser[];
  pagination?: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

export interface GroupAuditLogsResponse {
  logs: GroupAuditLog[];
  pagination?: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

// Filter and search types
export interface UserFilters {
  status?: 'active' | 'suspended' | 'pending';
  roleId?: string;
  groupId?: string;
  search?: string; // Search by name or email
  createdAfter?: string;
  createdBefore?: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  userEmail: string;
  action: string;
  resource: string;
  resourceId: string;
  changes?: Record<string, { before: any; after: any }>;
  timestamp: string;
  ipAddress: string;
  userAgent: string;
}

// Dynamic rule testing
export interface RuleTestResult {
  matchedUsers: EnhancedUser[];
  totalMatches: number;
  executionTime: number;
  conditions: RuleCondition[];
}

// Effective permissions calculation
export interface EffectivePermissionsResponse {
  permissions: Permission[];
  sources: PermissionSource[];
}

export interface PermissionSource {
  type: 'direct' | 'role' | 'group' | 'inherited';
  source: string;
  permissions: Permission[];
}

// Group hierarchy
export interface GroupTreeNode {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  children: GroupTreeNode[];
  level: number;
  path: string;
}

// Bulk operations
export interface BulkOperationRequest {
  userIds: string[];
  groupId: string;
}

export interface BulkOperationResponse {
  succeeded: string[];
  failed: Array<{ userId: string; error: string }>;
  total: number;
  successCount: number;
  failureCount: number;
}

// Backward compatibility - map to enhanced types
export interface User extends Omit<EnhancedUser, 'roleIds' | 'groupIds'> {
  role: 'admin' | 'user';
  groups: string[];
}