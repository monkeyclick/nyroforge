# Admin System Setup Guide

This document describes the comprehensive Role-Based Access Control (RBAC) system that has been implemented for the EC2 Workstation Manager.

## Overview

The admin system provides:

- **User Management**: Create, edit, suspend, and delete users
- **Role-Based Access Control**: Assign granular permissions through roles
- **Group Management**: Organize users into groups with shared roles
- **User Isolation**: Ensure users can only access their own resources
- **Audit Logging**: Complete audit trail of all administrative actions
- **Permission System**: 19 granular permissions for fine-grained access control

## System Architecture

### Permission Model

The system uses a hierarchical permission model:

```
Users → Groups → Roles → Permissions
     → Direct Roles → Permissions  
     → Direct Permissions
```

#### Available Permissions

- `workstations:read` - View workstations
- `workstations:write` - Create/modify workstations  
- `workstations:delete` - Delete workstations
- `workstations:manage-all` - Access all users' workstations
- `users:read` - View users
- `users:write` - Create/modify users
- `users:delete` - Delete users
- `groups:read` - View groups
- `groups:write` - Create/modify groups
- `groups:delete` - Delete groups
- `roles:read` - View roles
- `roles:write` - Create/modify roles
- `roles:delete` - Delete roles
- `analytics:read` - View analytics and audit logs
- `settings:read` - View system settings
- `settings:write` - Modify system settings
- `admin:full-access` - Full administrative access

### Default System Roles

1. **System Administrator** (`system-admin`)
   - Full system access (`admin:full-access`)
   - Cannot be deleted

2. **User Administrator** (`user-admin`)
   - Manage users, roles, groups
   - View analytics
   - Cannot modify system settings

3. **Workstation Administrator** (`workstation-admin`)
   - Manage all workstations (`workstations:manage-all`)
   - View analytics

4. **Workstation User** (`workstation-user`)
   - Standard user permissions for own workstations
   - Default role for new users

5. **Read Only** (`read-only`)
   - Read-only access to workstations and analytics

## Deployment Steps

### 1. Infrastructure Deployment

Deploy the CDK stacks in order:

```bash
# Deploy infrastructure (DynamoDB tables, VPC, etc.)
cdk deploy WorkstationInfrastructure

# Deploy API stack (Lambda functions, API Gateway)
cdk deploy WorkstationApi

# Deploy frontend stack
cdk deploy WorkstationFrontend

# Deploy website stack (if using)
cdk deploy WorkstationWebsite
```

### 2. Initialize Admin System

After infrastructure deployment, initialize the admin system:

```bash
# Set required environment variables
export USER_POOL_ID="us-east-1_XXXXXXXXX"  # From CDK output
export AWS_REGION="us-east-1"
export ADMIN_EMAIL="admin@yourcompany.com"
export ADMIN_NAME="System Administrator"
export ADMIN_PASSWORD="YourSecurePassword123!"

# Optional: Override default table names if needed
export USERS_TABLE="WorkstationInfrastructure-Users"
export ROLES_TABLE="WorkstationInfrastructure-Roles"
export GROUPS_TABLE="WorkstationInfrastructure-Groups"
export AUDIT_TABLE="WorkstationInfrastructure-AuditLogs"

# Run initialization script
node scripts/init-admin-system.js
```

This script will:
- Create default system roles
- Create system administrators group
- Create initial admin user
- Set up the admin user in Cognito and DynamoDB

### 3. First Login

1. Navigate to your application URL
2. Login with the admin credentials created in step 2
3. **Important**: Change the default password immediately
4. Access the admin interface via the "Manage Users" button

### 4. Create Additional Users

Using the admin interface:

1. Open the User Management modal
2. Click "Add User" in the Users tab
3. Fill in user details and assign appropriate roles
4. Users will receive Cognito invitation emails (if enabled)

## User Interface Components

### Admin Dashboard

- **Location**: Accessible to users with appropriate permissions
- **Features**: 
  - Workstation management overview
  - Cost analytics
  - System metrics

### User Management Modal

Tabbed interface with:

#### Users Tab
- List all users with search and filtering
- Create, edit, suspend, activate, delete users
- Assign roles and groups
- Permission-based UI (only shows actions user can perform)

#### Roles Tab  
- View all system and custom roles
- Create custom roles with specific permissions
- Edit role permissions (non-system roles only)
- Delete custom roles
- Grouped permission assignment by category

#### Groups Tab
- Manage user groups
- Assign roles to groups
- Set default groups for auto-assignment
- Tag groups for organization
- Manage group membership

#### Audit Logs Tab
- Complete system audit trail
- Filter by user, action, resource, date range
- Export audit logs
- Real-time activity monitoring

## Security Features

### User Isolation

- Users can only see their own workstations by default
- Admin users with `workstations:manage-all` can see all workstations
- Permission checks on all API endpoints
- Frontend UI adapts based on user permissions

### Permission Checking

Backend middleware checks permissions on every request:

```typescript
// Check if user has specific permission
if (!(await hasPermission(userId, 'workstations:create'))) {
  return 403; // Forbidden
}

// Check if user can access specific workstation
if (!(await canAccessWorkstation(userId, workstationUserId))) {
  return 403; // Forbidden  
}
```

### Audit Trail

All administrative actions are logged:

- User creation, modification, deletion
- Role and permission changes
- Workstation access attempts
- Permission denials
- System configuration changes

## API Endpoints

### User Management (`/admin/users`)
- `GET /admin/users` - List users (with filtering)
- `POST /admin/users` - Create user
- `GET /admin/users/{userId}` - Get user details
- `PUT /admin/users/{userId}` - Update user
- `DELETE /admin/users/{userId}` - Delete user

### Role Management (`/admin/roles`)
- `GET /admin/roles` - List roles
- `POST /admin/roles` - Create role
- `PUT /admin/roles/{roleId}` - Update role
- `DELETE /admin/roles/{roleId}` - Delete role

### Group Management (`/admin/groups`)
- `GET /admin/groups` - List groups
- `POST /admin/groups` - Create group
- `PUT /admin/groups/{groupId}` - Update group
- `DELETE /admin/groups/{groupId}` - Delete group

### Audit Logs (`/admin/audit-logs`)
- `GET /admin/audit-logs` - Get audit trail (with filtering)

All endpoints require appropriate permissions and use Cognito authorization.

## Database Schema

### Users Table
```
PK: userId (email)
- email, name, status
- roleIds[], groupIds[], directPermissions[]
- attributes, preferences, loginHistory
- timestamps, createdBy
```

### Roles Table
```
PK: roleId
- name, description, permissions[]
- isSystem (prevents deletion)
- timestamps, createdBy
```

### Groups Table  
```
PK: groupId
- name, description, roleIds[]
- members[], tags, isDefault
- timestamps, createdBy
```

### Audit Logs Table
```
PK: auditId
- userId, action, resourceType, resourceId
- details, timestamp, ipAddress
```

## Troubleshooting

### Common Issues

1. **Permission Denied Errors**
   - Check user has appropriate role assignments
   - Verify role has required permissions
   - Check audit logs for access attempts

2. **User Creation Fails**
   - Verify Cognito User Pool permissions
   - Check email format and uniqueness
   - Ensure required fields are provided

3. **Admin User Cannot Access System**
   - Run initialization script again
   - Check DynamoDB user record exists
   - Verify Cognito user has correct attributes

4. **Frontend Shows "Access Denied"**
   - Check user authentication status
   - Verify user has required permissions
   - Check browser console for errors

### Logs and Monitoring

- Lambda logs in CloudWatch
- Audit trail in DynamoDB AuditLogs table
- Frontend errors in browser console
- API Gateway access logs

## Best Practices

### Role Assignment Strategy

1. **Principle of Least Privilege**: Only grant minimum required permissions
2. **Use Groups**: Assign roles to groups, add users to groups
3. **Regular Audits**: Review user permissions regularly
4. **System Roles**: Don't modify system roles, create custom ones instead

### User Management

1. **Strong Passwords**: Enforce strong password policy in Cognito
2. **Regular Cleanup**: Remove inactive users periodically
3. **Audit Reviews**: Monitor audit logs for suspicious activity
4. **Backup Strategy**: Regular backups of user/role data

### Security Monitoring

1. **Failed Login Attempts**: Monitor authentication failures
2. **Permission Escalations**: Watch for role/permission changes
3. **Unusual Access Patterns**: Review workstation access logs
4. **Administrative Actions**: Monitor all admin operations

## Migration from Legacy System

If migrating from an existing system:

1. **Export Users**: Extract user list with current permissions
2. **Map Roles**: Create new roles matching old permission sets
3. **Bulk Import**: Use initialization script as template for bulk user creation
4. **Validate Access**: Test user permissions after migration
5. **Clean Legacy**: Remove old permission systems

This completes the comprehensive admin system implementation for the EC2 Workstation Manager.