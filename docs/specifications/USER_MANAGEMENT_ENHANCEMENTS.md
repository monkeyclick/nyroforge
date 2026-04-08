# Technical Specification: Admin UI User Management Enhancements

## Document Information
| Field | Value |
|-------|-------|
| Version | 1.0 |
| Created | 2025-12-18 |
| Status | Draft |
| Author | System Architect |

---

## Executive Summary

This technical specification details two major enhancements to the Admin UI User Management section:

1. **User Deletion Capability** - Enhanced deletion workflow with confirmation dialogs, soft-delete vs hard-delete options, associated data handling, and comprehensive audit logging
2. **Password Management Feature** - Administrative password management including manual set/reset, temporary passwords, force change on next login, password strength validation, and email notifications

---

## Table of Contents

1. [Feature 1: User Deletion Capability](#feature-1-user-deletion-capability)
   - [Overview](#11-overview)
   - [UI Mockup Description](#12-ui-mockup-description)
   - [API Endpoints](#13-api-endpoints)
   - [Data Models](#14-data-models)
   - [Security Considerations](#15-security-considerations)
   - [Permission Levels](#16-permission-levels)
   - [Error Handling](#17-error-handling)
   - [Audit Logging](#18-audit-logging)

2. [Feature 2: Password Management](#feature-2-password-management)
   - [Overview](#21-overview)
   - [UI Mockup Description](#22-ui-mockup-description)
   - [API Endpoints](#23-api-endpoints)
   - [Data Models](#24-data-models)
   - [Security Considerations](#25-security-considerations)
   - [Permission Levels](#26-permission-levels)
   - [Error Handling](#27-error-handling)
   - [Email Notifications](#28-email-notifications)

3. [Implementation Plan](#implementation-plan)
4. [Testing Requirements](#testing-requirements)
5. [Rollback Strategy](#rollback-strategy)

---

## Feature 1: User Deletion Capability

### 1.1 Overview

The user deletion capability provides administrators with a comprehensive workflow to remove users from the system. The feature supports both soft-delete (disabling/archiving) and hard-delete (permanent removal) options, with appropriate safeguards, confirmation dialogs, and audit trails.

#### Key Requirements
- Multi-step confirmation dialog for destructive actions
- Soft-delete option that preserves user data in a disabled state
- Hard-delete option that permanently removes user data
- Proper handling of associated data (workstations, group memberships, audit logs)
- Prevention of self-deletion
- Prevention of deleting the last admin user
- Comprehensive audit logging for compliance

### 1.2 UI Mockup Description

#### 1.2.1 Delete Button Location

The delete button will be added to each user row in the Users table within the `UserManagementModal` component:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  User Management                                                    [×]     │
├─────────────────────────────────────────────────────────────────────────────┤
│  [Users] [Roles] [Groups] [Audit] [Settings]                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  [🔍 Search users...        ] [All Status ▼]              [+ Add User]      │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 👤 John Doe                                        ●Active          │   │
│  │    john.doe@example.com                                             │   │
│  │    [Admin] [Users]                                                  │   │
│  │                                               [✏️] [🔑] [🗑️]        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 👤 Jane Smith                                      ●Active          │   │
│  │    jane.smith@example.com                                           │   │
│  │    [Users]                                                          │   │
│  │                                               [✏️] [🔑] [🗑️]        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘

Legend: [✏️] Edit  [🔑] Password  [🗑️] Delete
```

#### 1.2.2 Initial Confirmation Dialog (Step 1)

When the delete button is clicked, an initial confirmation dialog appears:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ⚠️ Delete User                                                    [×]     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Are you sure you want to delete the following user?                        │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  👤 John Doe                                                        │   │
│  │  📧 john.doe@example.com                                            │   │
│  │  📅 Created: Jan 15, 2025                                           │   │
│  │  🕐 Last Login: Dec 17, 2025                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  📊 Associated Data                                                 │   │
│  │  ├─ 3 active workstations                                          │   │
│  │  ├─ 2 group memberships                                            │   │
│  │  ├─ 15 audit log entries                                           │   │
│  │  └─ 2 saved preferences                                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Choose deletion type:                                                      │
│                                                                             │
│  ○ Soft Delete (Recommended)                                                │
│    User will be disabled but data preserved for 90 days.                   │
│    User can be restored during this period.                                │
│                                                                             │
│  ○ Hard Delete                                                             │
│    Permanently removes user and all associated data.                       │
│    This action cannot be undone.                                           │
│                                                                             │
│                                    [Cancel]  [Continue →]                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 1.2.3 Hard Delete Final Confirmation Dialog (Step 2)

If hard delete is selected, a second confirmation with type-to-confirm:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🚨 Permanent Deletion Warning                                      [×]    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ⚠️ This action is IRREVERSIBLE                                            │
│                                                                             │
│  You are about to permanently delete:                                       │
│  • User account: john.doe@example.com                                       │
│  • 3 associated workstations will be released                              │
│  • 2 group memberships will be removed                                     │
│  • User's login history will be anonymized                                 │
│                                                                             │
│  To confirm, type the user's email address below:                          │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ☑️ I understand that this action cannot be undone                          │
│  ☑️ I have verified that this user should be permanently removed            │
│                                                                             │
│                          [← Back]  [Cancel]  [Delete Permanently]           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

Note: [Delete Permanently] button is disabled until:
- Email is typed correctly
- Both checkboxes are checked
```

#### 1.2.4 Soft Delete Confirmation Dialog

For soft delete, a simpler confirmation:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Disable User Account                                              [×]     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User "john.doe@example.com" will be disabled:                              │
│                                                                             │
│  ✓ Account will be immediately deactivated                                 │
│  ✓ User will be unable to log in                                           │
│  ✓ All workstations will be stopped (not terminated)                       │
│  ✓ Data will be preserved for 90 days                                      │
│  ✓ Account can be restored within this period                              │
│                                                                             │
│  Reason for disabling (optional):                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ [Employee departure / Security concern / Other...]                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ☐ Send notification email to user                                         │
│  ☐ Notify user's manager                                                   │
│                                                                             │
│                                         [Cancel]  [Disable Account]         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 1.2.5 Processing State

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Processing Deletion                                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                           [====================================]            │
│                                                                             │
│  ✓ Stopping active workstations...                                         │
│  ✓ Removing group memberships...                                           │
│  → Updating Cognito user pool...                                           │
│  ○ Archiving user data...                                                  │
│  ○ Creating audit records...                                               │
│                                                                             │
│  Please do not close this dialog.                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 1.2.6 Success State

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ✓ User Deleted Successfully                                        [×]    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User "john.doe@example.com" has been successfully [disabled/deleted].      │
│                                                                             │
│  Summary:                                                                   │
│  • 3 workstations released                                                 │
│  • 2 group memberships removed                                             │
│  • Audit log entry created (ID: audit-xxx-xxx)                             │
│                                                                             │
│  [Soft Delete Only:]                                                        │
│  Data will be automatically purged on: March 18, 2026                      │
│  To restore this user, go to Settings > Archived Users                     │
│                                                                             │
│                                                            [Close]          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 API Endpoints

#### 1.3.1 Get User Deletion Preview

Fetches information about data associated with a user before deletion.

```
GET /admin/users/{userId}/deletion-preview
```

**Request Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**Response (200 OK):**
```json
{
  "user": {
    "id": "user-uuid",
    "email": "john.doe@example.com",
    "name": "John Doe",
    "status": "active",
    "createdAt": "2025-01-15T10:00:00Z",
    "lastLoginAt": "2025-12-17T14:30:00Z"
  },
  "associatedData": {
    "workstations": {
      "count": 3,
      "activeCount": 2,
      "items": [
        {
          "id": "ws-001",
          "name": "Development Workstation",
          "status": "running"
        }
      ]
    },
    "groupMemberships": {
      "count": 2,
      "items": [
        {"groupId": "grp-001", "groupName": "Engineering"},
        {"groupId": "grp-002", "groupName": "Admins"}
      ]
    },
    "auditLogEntries": 15,
    "savedPreferences": 2
  },
  "deletionRestrictions": {
    "canSoftDelete": true,
    "canHardDelete": true,
    "restrictions": [],
    "warnings": [
      "User is an administrator. Ensure another admin exists before deletion."
    ]
  }
}
```

**Error Responses:**

| Status | Error Code | Description |
|--------|------------|-------------|
| 401 | UNAUTHORIZED | Invalid or missing authentication token |
| 403 | FORBIDDEN | Insufficient permissions to view deletion preview |
| 404 | USER_NOT_FOUND | User with specified ID does not exist |
| 500 | INTERNAL_ERROR | Server error occurred |

#### 1.3.2 Soft Delete User

Archives/disables a user account while preserving data.

```
POST /admin/users/{userId}/soft-delete
```

**Request Body:**
```json
{
  "reason": "Employee departure",
  "notes": "Last day was December 15, 2025",
  "notifyUser": true,
  "notifyManager": false,
  "retentionDays": 90,
  "stopWorkstations": true
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "User successfully disabled",
  "deletedUser": {
    "id": "user-uuid",
    "email": "john.doe@example.com",
    "previousStatus": "active",
    "newStatus": "deleted",
    "deletionType": "soft",
    "deletedAt": "2025-12-18T10:00:00Z",
    "deletedBy": "admin-user-uuid",
    "scheduledPurgeDate": "2026-03-18T10:00:00Z",
    "canRestore": true
  },
  "actions": {
    "workstationsStopped": 2,
    "groupMembershipsRemoved": 2,
    "cognitoUserDisabled": true,
    "notificationsSent": ["user"]
  },
  "auditLogId": "audit-xxx-xxx"
}
```

**Error Responses:**

| Status | Error Code | Description |
|--------|------------|-------------|
| 400 | INVALID_REQUEST | Invalid request body or parameters |
| 400 | SELF_DELETION | Cannot delete your own account |
| 400 | LAST_ADMIN | Cannot delete the last administrator |
| 401 | UNAUTHORIZED | Invalid or missing authentication token |
| 403 | FORBIDDEN | Insufficient permissions for user deletion |
| 404 | USER_NOT_FOUND | User with specified ID does not exist |
| 409 | ALREADY_DELETED | User is already deleted |
| 500 | INTERNAL_ERROR | Server error occurred |

#### 1.3.3 Hard Delete User

Permanently removes a user and all associated data.

```
DELETE /admin/users/{userId}
```

**Request Body:**
```json
{
  "confirmationEmail": "john.doe@example.com",
  "reason": "GDPR data removal request",
  "acknowledgements": {
    "understandIrreversible": true,
    "verifiedDeletion": true
  }
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "User permanently deleted",
  "deletedUser": {
    "id": "user-uuid",
    "email": "john.doe@example.com",
    "deletionType": "hard",
    "deletedAt": "2025-12-18T10:00:00Z",
    "deletedBy": "admin-user-uuid"
  },
  "actions": {
    "workstationsTerminated": 3,
    "groupMembershipsRemoved": 2,
    "auditLogsAnonymized": 15,
    "cognitoUserDeleted": true,
    "dynamoDBRecordsDeleted": 5
  },
  "auditLogId": "audit-xxx-xxx"
}
```

**Error Responses:**

| Status | Error Code | Description |
|--------|------------|-------------|
| 400 | INVALID_REQUEST | Missing or invalid request parameters |
| 400 | EMAIL_MISMATCH | Confirmation email does not match |
| 400 | ACKNOWLEDGEMENT_REQUIRED | Required acknowledgements not provided |
| 400 | SELF_DELETION | Cannot delete your own account |
| 400 | LAST_ADMIN | Cannot delete the last administrator |
| 401 | UNAUTHORIZED | Invalid or missing authentication token |
| 403 | FORBIDDEN | Insufficient permissions (requires users:delete:hard) |
| 404 | USER_NOT_FOUND | User with specified ID does not exist |
| 500 | INTERNAL_ERROR | Server error occurred |
| 500 | PARTIAL_DELETION | Deletion partially completed; manual cleanup required |

#### 1.3.4 Restore Soft-Deleted User

Restores a previously soft-deleted user.

```
POST /admin/users/{userId}/restore
```

**Request Body:**
```json
{
  "restoreGroupMemberships": true,
  "restoreWorkstations": false,
  "notifyUser": true
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "User successfully restored",
  "restoredUser": {
    "id": "user-uuid",
    "email": "john.doe@example.com",
    "status": "active",
    "restoredAt": "2025-12-18T10:00:00Z",
    "restoredBy": "admin-user-uuid"
  },
  "actions": {
    "groupMembershipsRestored": 2,
    "cognitoUserEnabled": true,
    "notificationsSent": ["user"]
  },
  "auditLogId": "audit-xxx-xxx"
}
```

### 1.4 Data Models

#### 1.4.1 DeletedUser Table Schema

```typescript
interface DeletedUser {
  id: string;                    // Primary key - same as original user ID
  email: string;
  name: string;
  deletionType: 'soft' | 'hard';
  deletedAt: string;             // ISO 8601 timestamp
  deletedBy: string;             // Admin user ID who performed deletion
  reason?: string;
  notes?: string;
  scheduledPurgeDate?: string;   // For soft deletes - TTL
  originalData: {                // Snapshot of user data at deletion time
    roleIds: string[];
    groupIds: string[];
    attributes: Record<string, any>;
    preferences: Record<string, any>;
    createdAt: string;
    lastLoginAt?: string;
  };
  restorable: boolean;
  ttl?: number;                  // DynamoDB TTL for automatic purge
}
```

#### 1.4.2 Extended EnhancedUser Model

```typescript
interface EnhancedUser {
  // Existing fields...
  id: string;
  email: string;
  name: string;
  status: 'active' | 'suspended' | 'pending' | 'deleted';
  
  // New deletion-related fields
  deletedAt?: string;
  deletedBy?: string;
  deletionType?: 'soft' | 'hard';
  scheduledPurgeDate?: string;
  deletionReason?: string;
}
```

#### 1.4.3 Audit Log Extension

```typescript
interface DeletionAuditLog {
  id: string;
  action: 'USER_SOFT_DELETE' | 'USER_HARD_DELETE' | 'USER_RESTORE';
  performedBy: string;
  performedByEmail: string;
  targetUserId: string;
  targetUserEmail: string;
  timestamp: string;
  ipAddress: string;
  userAgent: string;
  details: {
    deletionType?: 'soft' | 'hard';
    reason?: string;
    notes?: string;
    associatedDataRemoved: {
      workstations: number;
      groupMemberships: number;
      auditLogs?: number;
    };
    acknowledgements?: {
      understandIrreversible: boolean;
      verifiedDeletion: boolean;
    };
  };
}
```

### 1.5 Security Considerations

#### 1.5.1 Authentication & Authorization
- All deletion endpoints require valid JWT authentication
- JWT token must be from the Cognito User Pool
- Token must not be expired
- Admin must have appropriate permission grants

#### 1.5.2 Prevention of Privilege Escalation
- Admins cannot delete users with higher privilege levels
- Super-admins can only be deleted by other super-admins
- Audit all deletion attempts (successful and failed)

#### 1.5.3 Self-Deletion Prevention
```typescript
if (currentUserId === targetUserId) {
  throw new ForbiddenError('SELF_DELETION', 'Cannot delete your own account');
}
```

#### 1.5.4 Last Admin Protection
```typescript
async function validateNotLastAdmin(userId: string): Promise<void> {
  const adminCount = await getActiveAdminCount();
  const isAdmin = await userHasAdminRole(userId);
  
  if (isAdmin && adminCount <= 1) {
    throw new ForbiddenError('LAST_ADMIN', 'Cannot delete the last administrator');
  }
}
```

#### 1.5.5 Rate Limiting
- Maximum 10 deletion operations per admin per hour
- Exponential backoff for repeated failures
- Alert on unusual deletion patterns

#### 1.5.6 Data Protection
- Hard-deleted user data must be purged from all systems
- Soft-deleted data must be encrypted at rest
- Backup systems must honor deletion requests within 30 days
- Comply with GDPR right to erasure requirements

#### 1.5.7 Confirmation Requirements
- Hard delete requires email confirmation typing
- Hard delete requires explicit acknowledgement checkboxes
- All deletions logged with administrator identity

### 1.6 Permission Levels

#### 1.6.1 Permission Hierarchy

| Permission | Description | Can Perform |
|------------|-------------|-------------|
| `users:read` | View user information | View deletion preview |
| `users:delete:soft` | Soft delete users | Disable/archive users |
| `users:delete:hard` | Hard delete users | Permanently delete users |
| `users:restore` | Restore deleted users | Restore soft-deleted users |
| `users:delete:*` | All deletion permissions | All deletion operations |

#### 1.6.2 Role-Based Permissions

```typescript
const rolePermissions = {
  'super-admin': [
    'users:delete:soft',
    'users:delete:hard',
    'users:restore'
  ],
  'admin': [
    'users:delete:soft',
    'users:restore'
  ],
  'user-manager': [
    'users:delete:soft'
  ],
  'viewer': []
};
```

#### 1.6.3 Permission Checks

```typescript
async function checkDeletionPermission(
  adminId: string,
  targetUserId: string,
  deletionType: 'soft' | 'hard'
): Promise<void> {
  const requiredPermission = deletionType === 'hard' 
    ? 'users:delete:hard' 
    : 'users:delete:soft';
    
  const hasPermission = await userHasPermission(adminId, requiredPermission);
  if (!hasPermission) {
    throw new ForbiddenError(
      'INSUFFICIENT_PERMISSIONS',
      `Missing permission: ${requiredPermission}`
    );
  }
  
  // Check target user's privilege level
  const adminPrivilegeLevel = await getUserPrivilegeLevel(adminId);
  const targetPrivilegeLevel = await getUserPrivilegeLevel(targetUserId);
  
  if (targetPrivilegeLevel > adminPrivilegeLevel) {
    throw new ForbiddenError(
      'PRIVILEGE_ESCALATION',
      'Cannot delete user with higher privilege level'
    );
  }
}
```

### 1.7 Error Handling

#### 1.7.1 Error Response Format

```typescript
interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
    timestamp: string;
    requestId: string;
  };
}
```

#### 1.7.2 Error Scenarios

| Scenario | Error Code | HTTP Status | User Message |
|----------|------------|-------------|--------------|
| User not found | USER_NOT_FOUND | 404 | The specified user could not be found |
| Self deletion | SELF_DELETION | 400 | You cannot delete your own account |
| Last admin | LAST_ADMIN | 400 | Cannot delete the last administrator |
| Email mismatch | EMAIL_MISMATCH | 400 | The confirmation email does not match |
| Missing acknowledgement | ACKNOWLEDGEMENT_REQUIRED | 400 | Please confirm the required acknowledgements |
| Insufficient permissions | FORBIDDEN | 403 | You do not have permission to perform this action |
| User already deleted | ALREADY_DELETED | 409 | This user has already been deleted |
| User cannot be restored | RESTORE_EXPIRED | 400 | This user can no longer be restored. Retention period has expired. |
| Partial deletion | PARTIAL_DELETION | 500 | Deletion partially completed. Please contact support. |
| Workstation termination failed | WORKSTATION_ERROR | 500 | Failed to terminate user workstations. Deletion aborted. |
| Cognito deletion failed | COGNITO_ERROR | 500 | Failed to delete user from authentication system |

#### 1.7.3 Rollback Strategy for Partial Failures

```typescript
async function deleteUserWithRollback(
  userId: string,
  deletionType: 'soft' | 'hard',
  options: DeleteUserOptions
): Promise<DeleteUserResult> {
  const rollbackActions: Array<() => Promise<void>> = [];
  
  try {
    // Step 1: Stop/terminate workstations
    const workstationResult = await handleWorkstations(userId, deletionType);
    rollbackActions.push(() => restoreWorkstations(workstationResult));
    
    // Step 2: Remove group memberships
    const membershipResult = await removeGroupMemberships(userId);
    rollbackActions.push(() => restoreGroupMemberships(membershipResult));
    
    // Step 3: Update Cognito
    await updateCognitoUser(userId, deletionType);
    rollbackActions.push(() => restoreCognitoUser(userId));
    
    // Step 4: Update DynamoDB
    await updateDynamoDBUser(userId, deletionType);
    
    // Step 5: Create audit log (always succeeds or logs separately)
    await createAuditLog(userId, deletionType, options);
    
    return { success: true };
    
  } catch (error) {
    // Execute rollback actions in reverse order
    for (const rollback of rollbackActions.reverse()) {
      try {
        await rollback();
      } catch (rollbackError) {
        console.error('Rollback failed:', rollbackError);
        // Log for manual intervention
      }
    }
    throw error;
  }
}
```

### 1.8 Audit Logging

#### 1.8.1 Events to Log

| Event | Description | Data Captured |
|-------|-------------|---------------|
| DELETION_PREVIEW_VIEWED | Admin viewed deletion preview | adminId, targetUserId, timestamp |
| SOFT_DELETE_INITIATED | Soft delete process started | adminId, targetUserId, reason |
| SOFT_DELETE_COMPLETED | Soft delete completed successfully | adminId, targetUserId, actionsPerformed |
| HARD_DELETE_INITIATED | Hard delete process started | adminId, targetUserId, acknowledgements |
| HARD_DELETE_COMPLETED | Hard delete completed successfully | adminId, targetUserId, actionsPerformed |
| DELETE_FAILED | Deletion failed | adminId, targetUserId, errorCode, errorMessage |
| USER_RESTORED | Soft-deleted user was restored | adminId, targetUserId, restoredData |
| RESTORATION_FAILED | User restoration failed | adminId, targetUserId, errorCode |

#### 1.8.2 Audit Log Entry Structure

```typescript
interface DeletionAuditEntry {
  id: string;
  event: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: string;
  actor: {
    userId: string;
    email: string;
    ipAddress: string;
    userAgent: string;
  };
  target: {
    userId: string;
    email: string;
    name: string;
  };
  action: {
    type: 'soft_delete' | 'hard_delete' | 'restore';
    reason?: string;
    notes?: string;
  };
  result: {
    success: boolean;
    errorCode?: string;
    errorMessage?: string;
  };
  associatedData: {
    workstationsAffected: number;
    groupMembershipsAffected: number;
    dataRecordsAffected: number;
  };
  metadata: Record<string, any>;
}
```

#### 1.8.3 Retention Policy

- Deletion audit logs: Retained for 7 years (compliance requirement)
- Deletion audit logs for hard-deleted users: Anonymized but retained
- Access to deletion audit logs: Restricted to super-admins and auditors

---

## Feature 2: Password Management

### 2.1 Overview

The password management feature allows administrators to manually set or reset passwords for end users. This includes options for temporary passwords, forcing password changes on next login, password strength validation, and configurable email notifications.

#### Key Requirements
- Set initial password for new users
- Reset forgotten passwords for existing users
- Generate temporary passwords with expiration
- Force password change on next login
- Password strength validation with configurable policies
- Email notification toggles for credential changes
- Audit logging of all password operations
- Rate limiting to prevent abuse

### 2.2 UI Mockup Description

#### 2.2.1 Password Reset Button Location

The password management button (key icon) is displayed in the user actions area:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 👤 John Doe                                        ●Active          │   │
│  │    john.doe@example.com                                             │   │
│  │    [Admin] [Users]                                                  │   │
│  │                                               [✏️] [🔑] [🗑️]        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                       ↑                     │
│                                              Password Management            │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 2.2.2 Password Management Dialog

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🔑 Password Management                                            [×]     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User: john.doe@example.com                                                 │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Password Action                                                    │   │
│  │                                                                     │   │
│  │  ○ Generate Temporary Password                                      │   │
│  │    System will generate a secure random password                    │   │
│  │                                                                     │   │
│  │  ● Set Custom Password                                              │   │
│  │    Manually enter a password for the user                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  New Password:                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ••••••••••••                                              [👁]     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Password Strength: [████████░░] Strong                                    │
│                                                                             │
│  Requirements:                                                              │
│  ✓ At least 12 characters                                                  │
│  ✓ Contains uppercase letter                                               │
│  ✓ Contains lowercase letter                                               │
│  ✓ Contains number                                                         │
│  ✗ Contains special character (!@#$%^&*)                                   │
│                                                                             │
│  Confirm Password:                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ••••••••••••                                              [👁]     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│  ✓ Passwords match                                                         │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────     │
│                                                                             │
│  Options:                                                                   │
│                                                                             │
│  ☑️ Require password change on next login                                   │
│                                                                             │
│  Password Expiration:                                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ○ No expiration (permanent password)                                │   │
│  │ ● Temporary (expires in)  [24 hours    ▼]                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────     │
│                                                                             │
│  Notifications:                                                             │
│                                                                             │
│  ☑️ Send password reset email to user                                       │
│     Email will include: [Password in email] [Password link only]           │
│                                                                             │
│  ☑️ Send notification to administrator                                      │
│     To: admin@company.com                                                  │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────     │
│                                                                             │
│  Reason for password change (optional):                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ [User forgot password / Security incident / Initial setup...]       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│                                         [Cancel]  [Set Password]            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 2.2.3 Generated Password Dialog

When "Generate Temporary Password" is selected:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🔑 Generated Password                                              [×]    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  A temporary password has been generated for john.doe@example.com           │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │        xK9#mP2$vL5n                                     [📋]       │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      Click to copy                          │
│                                                                             │
│  ⚠️ Important:                                                              │
│  • This password will only be shown once                                   │
│  • Password expires in: 24 hours                                           │
│  • User must change password on first login                                │
│                                                                             │
│  Notifications sent:                                                        │
│  ✓ Email sent to john.doe@example.com (password included)                  │
│  ✓ Admin notification sent                                                 │
│                                                                             │
│                                               [Done]                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 2.2.4 Password Policy Configuration (Admin Settings)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ⚙️ Password Policy Settings                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Minimum Requirements:                                                      │
│                                                                             │
│  Minimum Length:        [12    ▼] characters                               │
│  Maximum Length:        [128   ▼] characters                               │
│                                                                             │
│  Character Requirements:                                                    │
│  ☑️ Require uppercase letters (A-Z)                                         │
│  ☑️ Require lowercase letters (a-z)                                         │
│  ☑️ Require numbers (0-9)                                                   │
│  ☑️ Require special characters (!@#$%^&*()_+-=)                             │
│                                                                             │
│  Additional Rules:                                                          │
│  ☑️ Cannot contain username or email                                        │
│  ☑️ Cannot be in list of common passwords                                   │
│  ☑️ Cannot match previous [5 ▼] passwords                                   │
│                                                                             │
│  Temporary Password Settings:                                               │
│  Default expiration:    [24 hours   ▼]                                     │
│  Minimum length:        [16    ▼] characters                               │
│  ☑️ Auto-generate special characters                                        │
│                                                                             │
│  Password Reset Limits:                                                     │
│  Max resets per day:    [5     ▼] per user                                 │
│  Cooldown period:       [5     ▼] minutes between resets                   │
│                                                                             │
│                                         [Cancel]  [Save Settings]           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 2.2.5 Success State

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ✓ Password Updated Successfully                                    [×]    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Password has been updated for john.doe@example.com                         │
│                                                                             │
│  Configuration:                                                             │
│  • Password type: Custom                                                   │
│  • Expires: Never                                                          │
│  • Force change on login: Yes                                              │
│                                                                             │
│  Notifications:                                                             │
│  ✓ User notification email sent                                            │
│  ✓ Admin notification sent                                                 │
│                                                                             │
│  Audit log entry created: PWD-2025-12-18-001234                            │
│                                                                             │
│                                               [Close]                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 API Endpoints

#### 2.3.1 Set/Reset User Password

```
POST /admin/users/{userId}/password
```

**Request Body:**
```json
{
  "password": "NewSecurePassword123!",
  "passwordType": "custom",
  "temporary": false,
  "expiresIn": null,
  "forceChangeOnLogin": true,
  "notifications": {
    "notifyUser": true,
    "includePasswordInEmail": false,
    "notifyAdmin": true
  },
  "reason": "User forgot password"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Password updated successfully",
  "details": {
    "userId": "user-uuid",
    "email": "john.doe@example.com",
    "passwordType": "custom",
    "temporary": false,
    "expiresAt": null,
    "forceChangeOnLogin": true,
    "updatedAt": "2025-12-18T10:00:00Z",
    "updatedBy": "admin-user-uuid"
  },
  "notifications": {
    "userNotified": true,
    "adminNotified": true
  },
  "auditLogId": "pwd-xxx-xxx"
}
```

#### 2.3.2 Generate Temporary Password

```
POST /admin/users/{userId}/password/generate
```

**Request Body:**
```json
{
  "expiresIn": "24h",
  "length": 16,
  "forceChangeOnLogin": true,
  "notifications": {
    "notifyUser": true,
    "includePasswordInEmail": true,
    "notifyAdmin": false
  },
  "reason": "Initial user setup"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Temporary password generated",
  "details": {
    "userId": "user-uuid",
    "email": "john.doe@example.com",
    "generatedPassword": "xK9#mP2$vL5nQ8@r",
    "passwordType": "temporary",
    "temporary": true,
    "expiresAt": "2025-12-19T10:00:00Z",
    "forceChangeOnLogin": true,
    "generatedAt": "2025-12-18T10:00:00Z",
    "generatedBy": "admin-user-uuid"
  },
  "notifications": {
    "userNotified": true,
    "adminNotified": false
  },
  "auditLogId": "pwd-xxx-xxx"
}
```

#### 2.3.3 Validate Password Strength

```
POST /admin/password/validate
```

**Request Body:**
```json
{
  "password": "TestPassword123",
  "userId": "user-uuid"
}
```

**Response (200 OK):**
```json
{
  "valid": false,
  "strength": "medium",
  "score": 65,
  "requirements": {
    "minLength": { "required": 12, "met": true, "message": "At least 12 characters" },
    "maxLength": { "required": 128, "met": true, "message": "No more than 128 characters" },
    "uppercase": { "required": true, "met": true, "message": "Contains uppercase letter" },
    "lowercase": { "required": true, "met": true, "message": "Contains lowercase letter" },
    "numbers": { "required": true, "met": true, "message": "Contains number" },
    "specialChars": { "required": true, "met": false, "message": "Contains special character (!@#$%^&*)" },
    "notCommon": { "required": true, "met": true, "message": "Not a commonly used password" },
    "notUsername": { "required": true, "met": true, "message": "Does not contain username or email" },
    "notPreviousPassword": { "required": true, "met": true, "message": "Different from last 5 passwords" }
  },
  "suggestions": [
    "Add a special character like ! @ # $ % ^ & *"
  ]
}
```

#### 2.3.4 Get Password Policy

```
GET /admin/settings/password-policy
```

**Response (200 OK):**
```json
{
  "policy": {
    "minLength": 12,
    "maxLength": 128,
    "requireUppercase": true,
    "requireLowercase": true,
    "requireNumbers": true,
    "requireSpecialChars": true,
    "preventCommonPasswords": true,
    "preventUsernameInPassword": true,
    "passwordHistoryCount": 5,
    "temporaryPasswordDefaults": {
      "expiresIn": "24h",
      "minLength": 16,
      "includeSpecialChars": true
    },
    "resetLimits": {
      "maxPerDay": 5,
      "cooldownMinutes": 5
    }
  }
}
```

#### 2.3.5 Update Password Policy

```
PUT /admin/settings/password-policy
```

**Request Body:**
```json
{
  "minLength": 14,
  "maxLength": 128,
  "requireUppercase": true,
  "requireLowercase": true,
  "requireNumbers": true,
  "requireSpecialChars": true,
  "preventCommonPasswords": true,
  "preventUsernameInPassword": true,
  "passwordHistoryCount": 10,
  "temporaryPasswordDefaults": {
    "expiresIn": "48h",
    "minLength": 20
  },
  "resetLimits": {
    "maxPerDay": 3,
    "cooldownMinutes": 10
  }
}
```

### 2.4 Data Models

#### 2.4.1 Password Reset Record

```typescript
interface PasswordResetRecord {
  id: string;                  // Primary key
  userId: string;
  email: string;
  resetType: 'admin_set' | 'admin_generate' | 'user_reset';
  temporary: boolean;
  expiresAt?: string;          // ISO 8601
  forceChangeOnLogin: boolean;
  createdAt: string;
  createdBy: string;           // Admin user ID
  reason?: string;
  notifications: {
    userNotified: boolean;
    adminNotified: boolean;
    includePasswordInEmail: boolean;
  };
  status: 'active' | 'used' | 'expired' | 'revoked';
  usedAt?: string;             // When user logged in and changed password
  ttl?: number;                // DynamoDB TTL for auto-cleanup
}
```

#### 2.4.2 Password Policy Settings

```typescript
interface PasswordPolicy {
  id: string;                  // 'default' for system-wide policy
  minLength: number;
  maxLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  allowedSpecialChars: string;
  preventCommonPasswords: boolean;
  preventUsernameInPassword: boolean;
  passwordHistoryCount: number;
  temporaryPasswordDefaults: {
    expiresIn: string;         // Duration string (e.g., '24h', '7d')
    minLength: number;
    includeSpecialChars: boolean;
  };
  resetLimits: {
    maxPerDay: number;
    cooldownMinutes: number;
  };
  updatedAt: string;
  updatedBy: string;
}
```

#### 2.4.3 Password History (for Cognito)

```typescript
interface PasswordHistoryEntry {
  userId: string;
  passwordHash: string;        // Only hash, never plain text
  setAt: string;
  setBy: string;               // 'user' or admin user ID
  method: 'user_change' | 'admin_reset' | 'admin_generate';
  ttl: number;                 // Auto-delete after retention period
}
```

#### 2.4.4 Audit Log for Password Operations

```typescript
interface PasswordAuditLog {
  id: string;
  event: 'PASSWORD_SET' | 'PASSWORD_GENERATED' | 'PASSWORD_POLICY_UPDATED' | 
         'PASSWORD_EXPIRED' | 'PASSWORD_CHANGED_BY_USER' | 'RESET_LIMIT_EXCEEDED';
  severity: 'info' | 'warning' | 'critical';
  timestamp: string;
  actor: {
    userId: string;
    email: string;
    type: 'admin' | 'user' | 'system';
    ipAddress: string;
    userAgent: string;
  };
  target: {
    userId: string;
    email: string;
  };
  details: {
    passwordType?: 'custom' | 'generated';
    temporary?: boolean;
    expiresAt?: string;
    forceChangeOnLogin?: boolean;
    reason?: string;
    policyChanges?: Record<string, { old: any; new: any }>;
  };
  notifications: {
    userNotified: boolean;
    adminNotified: boolean;
  };
}
```

### 2.5 Security Considerations

#### 2.5.1 Password Handling

- **Never store plain text passwords**: All passwords are hashed using Cognito's built-in hashing
- **Temporary password display**: Generated passwords shown only once in UI, transmitted via HTTPS
- **Password transmission**: Always over HTTPS/TLS 1.3
- **Memory handling**: Clear password from memory after use

#### 2.5.2 Password Generation

```typescript
function generateSecurePassword(options: {
  length: number;
  includeUppercase: boolean;
  includeLowercase: boolean;
  includeNumbers: boolean;
  includeSpecialChars: boolean;
}): string {
  const { length, includeUppercase, includeLowercase, includeNumbers, includeSpecialChars } = options;
  
  const charSets = {
    uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    lowercase: 'abcdefghijklmnopqrstuvwxyz',
    numbers: '0123456789',
    special: '!@#$%^&*()_+-='
  };
  
  let chars = '';
  let password = '';
  
  // Build character set and ensure at least one of each required type
  if (includeUppercase) {
    chars += charSets.uppercase;
    password += charSets.uppercase[crypto.randomInt(charSets.uppercase.length)];
  }
  if (includeLowercase) {
    chars += charSets.lowercase;
    password += charSets.lowercase[crypto.randomInt(charSets.lowercase.length)];
  }
  if (includeNumbers) {
    chars += charSets.numbers;
    password += charSets.numbers[crypto.randomInt(charSets.numbers.length)];
  }
  if (includeSpecialChars) {
    chars += charSets.special;
    password += charSets.special[crypto.randomInt(charSets.special.length)];
  }
  
  // Fill remaining length with random characters
  const remainingLength = length - password.length;
  for (let i = 0; i < remainingLength; i++) {
    password += chars[crypto.randomInt(chars.length)];
  }
  
  // Shuffle the password to randomize required character positions
  return shuffleString(password);
}
```

#### 2.5.3 Rate Limiting

```typescript
interface RateLimitConfig {
  maxPasswordResetsPerUserPerDay: 5;
  maxPasswordResetsPerAdminPerHour: 20;
  cooldownBetweenResets: 5; // minutes
  lockoutAfterFailedValidations: 10;
}

async function checkRateLimit(adminId: string, targetUserId: string): Promise<void> {
  const userResetsToday = await getPasswordResetCount(targetUserId, '24h');
  const adminResetsHour = await getAdminResetCount(adminId, '1h');
  
  if (userResetsToday >= config.maxPasswordResetsPerUserPerDay) {
    throw new RateLimitError(
      'USER_RESET_LIMIT',
      `User has reached maximum password resets for today (${config.maxPasswordResetsPerUserPerDay})`
    );
  }
  
  if (adminResetsHour >= config.maxPasswordResetsPerAdminPerHour) {
    throw new RateLimitError(
      'ADMIN_RESET_LIMIT',
      'You have reached the maximum password resets for this hour'
    );
  }
  
  const lastReset = await getLastPasswordReset(targetUserId);
  if (lastReset) {
    const minutesSinceReset = (Date.now() - new Date(lastReset.createdAt).getTime()) / 60000;
    if (minutesSinceReset < config.cooldownBetweenResets) {
      throw new RateLimitError(
        'COOLDOWN_ACTIVE',
        `Please wait ${Math.ceil(config.cooldownBetweenResets - minutesSinceReset)} minutes before resetting again`
      );
    }
  }
}
```

#### 2.5.4 Password Strength Validation

```typescript
interface PasswordValidationResult {
  valid: boolean;
  strength: 'weak' | 'medium' | 'strong' | 'very_strong';
  score: number; // 0-100
  issues: string[];
  suggestions: string[];
}

async function validatePasswordStrength(
  password: string,
  userId?: string
): Promise<PasswordValidationResult> {
  const policy = await getPasswordPolicy();
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 0;
  
  // Length checks
  if (password.length < policy.minLength) {
    issues.push(`Password must be at least ${policy.minLength} characters`);
  } else {
    score += 20;
    if (password.length >= 16) score += 10;
    if (password.length >= 20) score += 10;
  }
  
  // Character type checks
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    issues.push('Password must contain at least one uppercase letter');
  } else if (/[A-Z]/.test(password)) {
    score += 15;
  }
  
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    issues.push('Password must contain at least one lowercase letter');
  } else if (/[a-z]/.test(password)) {
    score += 15;
  }
  
  if (policy.requireNumbers && !/[0-9]/.test(password)) {
    issues.push('Password must contain at least one number');
  } else if (/[0-9]/.test(password)) {
    score += 15;
  }
  
  if (policy.requireSpecialChars && !/[!@#$%^&*()_+\-=]/.test(password)) {
    issues.push('Password must contain at least one special character (!@#$%^&*()_+-=)');
    suggestions.push('Add a special character like ! @ # $ % ^ & *');
  } else if (/[!@#$%^&*()_+\-=]/.test(password)) {
    score += 15;
  }
  
  // Common password check
  if (policy.preventCommonPasswords) {
    const isCommon = await checkCommonPassword(password);
    if (isCommon) {
      issues.push('Password is too common');
      suggestions.push('Choose a more unique password');
      score -= 30;
    }
  }
  
  // Username/email check
  if (userId && policy.preventUsernameInPassword) {
    const user = await getUser(userId);
    const lowerPassword = password.toLowerCase();
    if (user.email && lowerPassword.includes(user.email.split('@')[0].toLowerCase())) {
      issues.push('Password cannot contain your username or email');
      score -= 20;
    }
  }
  
  // Password history check
  if (userId && policy.passwordHistoryCount > 0) {
    const isReused = await checkPasswordHistory(userId, password, policy.passwordHistoryCount);
    if (isReused) {
      issues.push(`Password was used recently. Choose a different password.`);
      score -= 20;
    }
  }
  
  // Determine strength
  let strength: PasswordValidationResult['strength'];
  if (score >= 90) strength = 'very_strong';
  else if (score >= 70) strength = 'strong';
  else if (score >= 50) strength = 'medium';
  else strength = 'weak';
  
  return {
    valid: issues.length === 0,
    strength,
    score: Math.max(0, Math.min(100, score)),
    issues,
    suggestions
  };
}
```

#### 2.5.5 Email Security

- Password included in email only if explicitly opted-in
- Emails sent via AWS SES with DKIM/SPF verification
- Email links expire after use or timeout (24 hours default)
- Password reset links use secure random tokens

### 2.6 Permission Levels

#### 2.6.1 Permission Hierarchy

| Permission | Description | Can Perform |
|------------|-------------|-------------|
| `users:password:read` | View password reset history | View reset history for users |
| `users:password:set` | Set custom passwords | Set/change user passwords |
| `users:password:generate` | Generate temporary passwords | Generate temp passwords |
| `users:password:policy:read` | View password policy | View password requirements |
| `users:password:policy:write` | Modify password policy | Change password requirements |
| `users:password:*` | All password permissions | All password operations |

#### 2.6.2 Role-Based Permissions

```typescript
const rolePasswordPermissions = {
  'super-admin': [
    'users:password:set',
    'users:password:generate',
    'users:password:policy:read',
    'users:password:policy:write'
  ],
  'admin': [
    'users:password:set',
    'users:password:generate',
    'users:password:policy:read'
  ],
  'user-manager': [
    'users:password:generate',
    'users:password:policy:read'
  ],
  'helpdesk': [
    'users:password:generate'
  ],
  'viewer': []
};
```

#### 2.6.3 Scope Limitations

```typescript
async function checkPasswordPermission(
  adminId: string,
  targetUserId: string,
  operation: 'set' | 'generate'
): Promise<void> {
  const requiredPermission = operation === 'set' 
    ? 'users:password:set' 
    : 'users:password:generate';
    
  const hasPermission = await userHasPermission(adminId, requiredPermission);
  if (!hasPermission) {
    throw new ForbiddenError(
      'INSUFFICIENT_PERMISSIONS',
      `Missing permission: ${requiredPermission}`
    );
  }
  
  // Cannot reset own password through admin interface
  if (adminId === targetUserId) {
    throw new ForbiddenError(
      'SELF_PASSWORD_RESET',
      'Cannot reset your own password. Use the profile settings instead.'
    );
  }
  
  // Check privilege levels
  const adminPrivilegeLevel = await getUserPrivilegeLevel(adminId);
  const targetPrivilegeLevel = await getUserPrivilegeLevel(targetUserId);
  
  if (targetPrivilegeLevel > adminPrivilegeLevel) {
    throw new ForbiddenError(
      'PRIVILEGE_ESCALATION',
      'Cannot reset password for user with higher privilege level'
    );
  }
}
```

### 2.7 Error Handling

#### 2.7.1 Error Scenarios

| Scenario | Error Code | HTTP Status | User Message |
|----------|------------|-------------|--------------|
| User not found | USER_NOT_FOUND | 404 | The specified user could not be found |
| Invalid password | INVALID_PASSWORD | 400 | Password does not meet requirements |
| Password too weak | PASSWORD_TOO_WEAK | 400 | Password strength is insufficient |
| Password matches history | PASSWORD_REUSED | 400 | This password was used recently |
| Self password reset | SELF_PASSWORD_RESET | 400 | Cannot reset your own password through admin |
| Rate limit exceeded | RATE_LIMIT_EXCEEDED | 429 | Too many password reset attempts |
| Cooldown active | COOLDOWN_ACTIVE | 429 | Please wait before resetting again |
| Insufficient permissions | FORBIDDEN | 403 | You do not have permission to reset passwords |
| Privilege escalation | PRIVILEGE_ESCALATION | 403 | Cannot reset password for higher privilege user |
| Cognito error | COGNITO_ERROR | 500 | Failed to update password in authentication system |
| Email send failure | EMAIL_ERROR | 500 | Failed to send notification email |
| Policy update conflict | POLICY_CONFLICT | 409 | Password policy is being updated by another admin |
| Invalid expiration | INVALID_EXPIRATION | 400 | Invalid password expiration value |

#### 2.7.2 Error Response Format

```typescript
interface PasswordErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: {
      requirements?: PasswordRequirement[];
      suggestions?: string[];
      retryAfter?: number; // seconds for rate limit errors
    };
    timestamp: string;
    requestId: string;
  };
}
```

#### 2.7.3 Handling Partial Failures

```typescript
async function setPasswordWithRetry(
  userId: string,
  password: string,
  options: SetPasswordOptions
): Promise<SetPasswordResult> {
  const maxRetries = 3;
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Step 1: Validate password
      const validation = await validatePasswordStrength(password, userId);
      if (!validation.valid) {
        throw new ValidationError('INVALID_PASSWORD', validation.issues.join('; '));
      }
      
      // Step 2: Update Cognito
      await updateCognitoPassword(userId, password, options);
      
      // Step 3: Update password history (non-critical)
      try {
        await updatePasswordHistory(userId, password);
      } catch (historyError) {
        console.warn('Failed to update password history:', historyError);
        // Continue - not critical
      }
      
      // Step 4: Create password reset record
      const resetRecord = await createPasswordResetRecord(userId, options);
      
      // Step 5: Send notifications (non-critical)
      const notifications = await sendPasswordNotifications(userId, password, options);
      
      // Step 6: Create audit log
      await createPasswordAuditLog(userId, options);
      
      return {
        success: true,
        resetRecord,
        notifications
      };
      
    } catch (error) {
      lastError = error as Error;
      
      // Don't retry validation errors
      if (error instanceof ValidationError) {
        throw error;
      }
      
      // Don't retry permission errors
      if (error instanceof ForbiddenError) {
        throw error;
      }
      
      // Retry on transient errors
      if (attempt < maxRetries) {
        await sleep(1000 * attempt); // Exponential backoff
        continue;
      }
    }
  }
  
  throw lastError || new Error('Failed to set password after retries');
}
```

### 2.8 Email Notifications

#### 2.8.1 Email Templates

**Password Reset Notification (Without Password)**

```html
Subject: Your password has been reset - [Application Name]

Dear {{userName}},

Your password for {{applicationName}} has been reset by an administrator.

Details:
- Reset Time: {{resetTime}}
- Reset By: {{adminName}}
- Reason: {{reason}}

{{#if forceChangeOnLogin}}
You will be required to change your password when you next log in.
{{/if}}

{{#if temporary}}
Important: This is a temporary password that will expire on {{expiresAt}}.
Please log in and change your password before then.
{{/if}}

If you did not request this password reset, please contact your administrator immediately.

To log in, visit: {{loginUrl}}

Best regards,
{{applicationName}} Team

---
This is an automated message. Please do not reply to this email.
```

**Password Reset Notification (With Password)**

```html
Subject: Your new password - [Application Name]

Dear {{userName}},

Your password for {{applicationName}} has been reset by an administrator.

Your new password is: {{newPassword}}

⚠️ Important Security Notice:
- This password should be changed immediately after logging in
- Do not share this password with anyone
- Delete this email after noting your password

{{#if temporary}}
This is a temporary password that will expire on {{expiresAt}}.
{{/if}}

To log in, visit: {{loginUrl}}

If you did not request this password reset, please contact your administrator immediately at {{supportEmail}}.

Best regards,
{{applicationName}} Team

---
This is an automated message. Please do not reply to this email.
```

**Admin Notification**

```html
Subject: Password reset performed - {{targetUserEmail}}

Password Reset Notification

An administrator has reset a user's password.

Details:
- Target User: {{targetUserName}} ({{targetUserEmail}})
- Reset By: {{adminName}} ({{adminEmail}})
- Reset Time: {{resetTime}}
- Reset Type: {{resetType}}
- Reason: {{reason}}

{{#if temporary}}
Password Expiration: {{expiresAt}}
{{/if}}

Force Change on Login: {{forceChangeOnLogin}}

Audit Log ID: {{auditLogId}}

---
This notification was sent to all administrators as part of security monitoring.
```

#### 2.8.2 Email Configuration

```typescript
interface EmailNotificationConfig {
  enabled: boolean;
  provider: 'ses' | 'smtp';
  fromAddress: string;
  replyToAddress?: string;
  templates: {
    passwordResetWithPassword: string;
    passwordResetWithoutPassword: string;
    adminNotification: string;
  };
  sendToUser: {
    enabled: boolean;
    allowPasswordInEmail: boolean;
    defaultIncludePassword: boolean;
  };
  sendToAdmin: {
    enabled: boolean;
    recipients: string[]; // Admin email addresses
  };
}
```

#### 2.8.3 Email Sending Logic

```typescript
async function sendPasswordNotifications(
  userId: string,
  password: string | null,
  options: NotificationOptions
): Promise<NotificationResult> {
  const result: NotificationResult = {
    userNotified: false,
    adminNotified: false,
    errors: []
  };
  
  const user = await getUser(userId);
  const config = await getEmailNotificationConfig();
  
  // Send to user
  if (options.notifyUser && config.sendToUser.enabled) {
    try {
      const template = options.includePasswordInEmail && password
        ? config.templates.passwordResetWithPassword
        : config.templates.passwordResetWithoutPassword;
      
      await sendEmail({
        to: user.email,
        template,
        data: {
          userName: user.name,
          applicationName: config.applicationName,
          newPassword: options.includePasswordInEmail ? password : undefined,
          resetTime: new Date().toISOString(),
          forceChangeOnLogin: options.forceChangeOnLogin,
          temporary: options.temporary,
          expiresAt: options.expiresAt,
          loginUrl: config.loginUrl,
          supportEmail: config.supportEmail
        }
      });
      
      result.userNotified = true;
    } catch (error) {
      result.errors.push(`Failed to send user notification: ${error.message}`);
    }
  }
  
  // Send to admins
  if (options.notifyAdmin && config.sendToAdmin.enabled) {
    try {
      const admin = await getCurrentAdmin();
      
      for (const adminEmail of config.sendToAdmin.recipients) {
        await sendEmail({
          to: adminEmail,
          template: config.templates.adminNotification,
          data: {
            targetUserName: user.name,
            targetUserEmail: user.email,
            adminName: admin.name,
            adminEmail: admin.email,
            resetTime: new Date().toISOString(),
            resetType: options.temporary ? 'Temporary' : 'Permanent',
            reason: options.reason || 'Not specified',
            forceChangeOnLogin: options.forceChangeOnLogin,
            temporary: options.temporary,
            expiresAt: options.expiresAt,
            auditLogId: options.auditLogId
          }
        });
      }
      
      result.adminNotified = true;
    } catch (error) {
      result.errors.push(`Failed to send admin notification: ${error.message}`);
    }
  }
  
  return result;
}
```

---

## Implementation Plan

### Phase 1: Backend Infrastructure (Week 1-2)

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Create DeletedUsers DynamoDB table | High | 2 days | None |
| Create PasswordResetRecords DynamoDB table | High | 1 day | None |
| Create PasswordPolicy settings table | Medium | 1 day | None |
| Update user-management-service Lambda | High | 3 days | Tables created |
| Update cognito-admin-service Lambda | High | 3 days | Tables created |
| Implement password validation service | High | 2 days | None |
| Add audit logging extensions | Medium | 2 days | Lambda updates |

### Phase 2: API Development (Week 2-3)

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Implement deletion preview endpoint | High | 1 day | Phase 1 complete |
| Implement soft delete endpoint | High | 2 days | Phase 1 complete |
| Implement hard delete endpoint | High | 2 days | Phase 1 complete |
| Implement restore endpoint | Medium | 1 day | Phase 1 complete |
| Implement password set endpoint | High | 2 days | Phase 1 complete |
| Implement password generate endpoint | High | 1 day | Phase 1 complete |
| Implement password validate endpoint | High | 1 day | Phase 1 complete |
| Implement password policy endpoints | Medium | 1 day | Phase 1 complete |
| Add rate limiting | High | 1 day | API endpoints |

### Phase 3: Frontend Development (Week 3-4)

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Create DeleteUserDialog component | High | 2 days | Phase 2 complete |
| Create PasswordManagementDialog component | High | 2 days | Phase 2 complete |
| Create PasswordStrengthIndicator component | Medium | 1 day | None |
| Update UserManagementModal with new buttons | High | 1 day | Dialog components |
| Add password policy settings UI | Medium | 1 day | Phase 2 complete |
| Implement loading and error states | High | 1 day | All components |
| Add confirmation dialogs | High | 1 day | Dialog components |

### Phase 4: Email & Notifications (Week 4)

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Create email templates | High | 1 day | None |
| Configure SES integration | High | 1 day | Templates |
| Implement notification service | High | 2 days | SES config |
| Add notification toggle UI | Medium | 0.5 day | Frontend complete |

### Phase 5: Testing & Documentation (Week 5)

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Unit tests for backend services | High | 2 days | All code complete |
| Integration tests for APIs | High | 2 days | All code complete |
| E2E tests for UI flows | High | 2 days | All code complete |
| Security penetration testing | High | 1 day | All tests pass |
| Documentation updates | Medium | 1 day | All features complete |
| Admin training materials | Low | 1 day | All features complete |

---

## Testing Requirements

### Unit Tests

```typescript
describe('User Deletion Service', () => {
  describe('getDeletionPreview', () => {
    it('should return user data and associated resources');
    it('should return correct workstation counts');
    it('should return deletion restrictions for admins');
    it('should return 404 for non-existent users');
  });
  
  describe('softDeleteUser', () => {
    it('should change user status to deleted');
    it('should stop active workstations');
    it('should remove group memberships');
    it('should disable Cognito user');
    it('should create audit log');
    it('should prevent self-deletion');
    it('should prevent deleting last admin');
    it('should rollback on partial failure');
  });
  
  describe('hardDeleteUser', () => {
    it('should permanently delete user data');
    it('should terminate workstations');
    it('should anonymize audit logs');
    it('should delete Cognito user');
    it('should require email confirmation');
    it('should require acknowledgements');
  });
  
  describe('restoreUser', () => {
    it('should restore soft-deleted users');
    it('should optionally restore group memberships');
    it('should enable Cognito user');
    it('should fail for hard-deleted users');
    it('should fail for expired retention period');
  });
});

describe('Password Management Service', () => {
  describe('validatePassword', () => {
    it('should enforce minimum length');
    it('should require uppercase letters');
    it('should require lowercase letters');
    it('should require numbers');
    it('should require special characters');
    it('should reject common passwords');
    it('should reject passwords containing username');
    it('should check password history');
  });
  
  describe('setPassword', () => {
    it('should update Cognito password');
    it('should create reset record');
    it('should update password history');
    it('should send notifications when enabled');
    it('should create audit log');
    it('should prevent self-reset through admin');
    it('should enforce rate limits');
  });
  
  describe('generatePassword', () => {
    it('should generate password meeting policy');
    it('should include all required character types');
    it('should generate unique passwords');
    it('should set correct expiration');
  });
});
```

### Integration Tests

```typescript
describe('User Deletion API', () => {
  it('GET /admin/users/{id}/deletion-preview - returns preview data');
  it('POST /admin/users/{id}/soft-delete - soft deletes user');
  it('DELETE /admin/users/{id} - hard deletes user');
  it('POST /admin/users/{id}/restore - restores user');
  it('returns 401 for unauthenticated requests');
  it('returns 403 for non-admin users');
  it('returns 404 for non-existent users');
});

describe('Password Management API', () => {
  it('POST /admin/users/{id}/password - sets password');
  it('POST /admin/users/{id}/password/generate - generates password');
  it('POST /admin/password/validate - validates password');
  it('GET /admin/settings/password-policy - returns policy');
  it('PUT /admin/settings/password-policy - updates policy');
  it('returns 400 for invalid passwords');
  it('returns 429 when rate limited');
});
```

### E2E Tests

```typescript
describe('User Deletion Flow', () => {
  it('should complete soft delete workflow');
  it('should complete hard delete workflow with confirmations');
  it('should restore soft-deleted user');
  it('should show error for self-deletion attempt');
  it('should show error for last admin deletion');
});

describe('Password Management Flow', () => {
  it('should set custom password');
  it('should generate temporary password');
  it('should display password strength indicator');
  it('should send email notifications');
  it('should enforce password policy');
});
```

---

## Rollback Strategy

### Database Rollback

If issues are discovered after deployment:

1. **DynamoDB Tables**: Tables are additive and don't affect existing functionality
2. **User Status Changes**: Can be reverted by changing status back to 'active'
3. **Cognito Users**: Can be re-enabled using AWS Console or CLI

### Lambda Rollback

```bash
# Rollback to previous Lambda version
aws lambda update-function-code \
  --function-name user-management-service \
  --s3-bucket deployment-bucket \
  --s3-key lambdas/user-management-service-v1.x.zip

aws lambda update-function-code \
  --function-name cognito-admin-service \
  --s3-bucket deployment-bucket \
  --s3-key lambdas/cognito-admin-service-v1.x.zip
```

### Frontend Rollback

```bash
# Rollback to previous frontend version
aws s3 sync s3://backup-bucket/frontend-v1.x/ s3://frontend-bucket/
aws cloudfront create-invalidation --distribution-id XXXXX --paths "/*"
```

### Data Recovery

For accidentally deleted users:

1. **Soft Delete**: Restore via UI or API within retention period
2. **Hard Delete**: Restore from DynamoDB point-in-time recovery
3. **Cognito Users**: Re-create user with AdminCreateUser command

---

## Appendices

### Appendix A: Common Password List

The system maintains a list of 10,000+ commonly used passwords that are blocked. The list is sourced from:
- [SecLists Common Passwords](https://github.com/danielmiessler/SecLists)
- NCSC Top 100,000 passwords
- Previous breach databases (anonymized)

### Appendix B: Compliance Considerations

| Regulation | Requirement | Implementation |
|------------|-------------|----------------|
| GDPR | Right to erasure | Hard delete removes all PII |
| GDPR | Audit trail | All deletions logged for 7 years |
| SOC 2 | Access logging | All password changes audited |
| HIPAA | Access controls | Permission-based deletion access |
| PCI DSS | Strong passwords | Configurable password policy |

### Appendix C: API Rate Limits

| Endpoint | Rate Limit | Window |
|----------|------------|--------|
| GET /deletion-preview | 100 | 1 hour |
| POST /soft-delete | 10 | 1 hour |
| DELETE (hard delete) | 5 | 1 hour |
| POST /password | 20 | 1 hour |
| POST /password/generate | 20 | 1 hour |
| POST /password/validate | 100 | 1 minute |

### Appendix D: Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-12-18 | System Architect | Initial specification |

---

*End of Technical Specification*