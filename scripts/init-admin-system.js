#!/usr/bin/env node

/**
 * System Initialization Script
 * 
 * This script initializes the admin system with:
 * - Default system roles with appropriate permissions
 * - Default admin user group  
 * - Initial system administrator user
 * 
 * Usage: node scripts/init-admin-system.js
 */

const { DynamoDBClient, PutItemCommand, GetItemCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminSetUserPasswordCommand, AdminAddUserToGroupCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// Generate a secure random password if none provided
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, '') + '!A1';

if (!process.env.ADMIN_PASSWORD) {
  console.log('\n⚠️  No ADMIN_PASSWORD environment variable set. Generated random password:');
  console.log(`   ${ADMIN_PASSWORD}`);
  console.log('   Save this password - it will not be shown again.\n');
}

// Configuration - these should be set via environment variables
const config = {
  region: process.env.AWS_REGION || 'us-east-1',
  usersTableName: process.env.USERS_TABLE || 'WorkstationInfrastructure-Users',
  rolesTableName: process.env.ROLES_TABLE || 'WorkstationInfrastructure-Roles',
  groupsTableName: process.env.GROUPS_TABLE || 'WorkstationInfrastructure-Groups',
  auditLogsTableName: process.env.AUDIT_TABLE || 'WorkstationInfrastructure-AuditLogs',
  userPoolId: process.env.USER_POOL_ID,
  adminEmail: process.env.ADMIN_EMAIL || 'admin@company.com',
  adminName: process.env.ADMIN_NAME || 'System Administrator',
  adminPassword: ADMIN_PASSWORD,
};

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({ region: config.region });
const cognitoClient = new CognitoIdentityProviderClient({ region: config.region });

// System roles with predefined permissions
const systemRoles = [
  {
    roleId: 'system-admin',
    name: 'System Administrator',
    description: 'Full system access with all administrative privileges',
    permissions: ['admin:full-access'],
    isSystem: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'system'
  },
  {
    roleId: 'user-admin',
    name: 'User Administrator', 
    description: 'Manage users, roles, and groups but not system settings',
    permissions: [
      'users:read', 'users:write', 'users:delete',
      'roles:read', 'roles:write', 'roles:delete',
      'groups:read', 'groups:write', 'groups:delete',
      'analytics:read'
    ],
    isSystem: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'system'
  },
  {
    roleId: 'workstation-admin',
    name: 'Workstation Administrator',
    description: 'Manage all workstations and view analytics',
    permissions: [
      'workstations:read', 'workstations:write', 'workstations:delete', 'workstations:manage-all',
      'analytics:read'
    ],
    isSystem: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'system'
  },
  {
    roleId: 'workstation-user',
    name: 'Workstation User',
    description: 'Standard user who can manage their own workstations',
    permissions: [
      'workstations:read', 'workstations:write', 'workstations:delete'
    ],
    isSystem: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'system'
  },
  {
    roleId: 'read-only',
    name: 'Read Only',
    description: 'Read-only access to workstations and analytics',
    permissions: [
      'workstations:read', 'analytics:read'
    ],
    isSystem: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'system'
  }
];

// Default admin group
const defaultGroup = {
  groupId: 'system-administrators',
  name: 'System Administrators',
  description: 'Default group for system administrators',
  roleIds: ['system-admin'],
  members: [],
  tags: { type: 'system', level: 'admin' },
  isDefault: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  createdBy: 'system'
};

async function checkIfItemExists(tableName, key) {
  try {
    const result = await dynamoClient.send(new GetItemCommand({
      TableName: tableName,
      Key: marshall(key)
    }));
    return !!result.Item;
  } catch (error) {
    console.error(`Error checking if item exists in ${tableName}:`, error);
    return false;
  }
}

async function createSystemRoles() {
  console.log('Creating system roles...');
  
  for (const role of systemRoles) {
    const exists = await checkIfItemExists(config.rolesTableName, { roleId: role.roleId });
    
    if (!exists) {
      try {
        await dynamoClient.send(new PutItemCommand({
          TableName: config.rolesTableName,
          Item: marshall(role)
        }));
        console.log(`✅ Created role: ${role.name}`);
      } catch (error) {
        console.error(`❌ Failed to create role ${role.name}:`, error);
      }
    } else {
      console.log(`⚠️  Role already exists: ${role.name}`);
    }
  }
}

async function createDefaultGroup() {
  console.log('Creating default admin group...');
  
  const exists = await checkIfItemExists(config.groupsTableName, { groupId: defaultGroup.groupId });
  
  if (!exists) {
    try {
      await dynamoClient.send(new PutItemCommand({
        TableName: config.groupsTableName,
        Item: marshall(defaultGroup)
      }));
      console.log(`✅ Created group: ${defaultGroup.name}`);
    } catch (error) {
      console.error(`❌ Failed to create group ${defaultGroup.name}:`, error);
    }
  } else {
    console.log(`⚠️  Group already exists: ${defaultGroup.name}`);
  }
}

async function createAdminUser() {
  console.log('Creating admin user...');
  
  if (!config.userPoolId) {
    console.error('❌ USER_POOL_ID environment variable is required');
    return;
  }

  // Check if user already exists in our system
  const exists = await checkIfItemExists(config.usersTableName, { userId: config.adminEmail });
  
  if (exists) {
    console.log(`⚠️  Admin user already exists: ${config.adminEmail}`);
    return;
  }

  try {
    // Create user in Cognito
    await cognitoClient.send(new AdminCreateUserCommand({
      UserPoolId: config.userPoolId,
      Username: config.adminEmail,
      UserAttributes: [
        { Name: 'email', Value: config.adminEmail },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name', Value: config.adminName }
      ],
      TemporaryPassword: config.adminPassword,
      MessageAction: 'SUPPRESS' // Don't send welcome email for system setup
    }));

    // Set permanent password
    await cognitoClient.send(new AdminSetUserPasswordCommand({
      UserPoolId: config.userPoolId,
      Username: config.adminEmail,
      Password: config.adminPassword,
      Permanent: true
    }));

    console.log('✅ Created admin user in Cognito');

    // Create user record in DynamoDB
    const adminUser = {
      userId: config.adminEmail,
      email: config.adminEmail,
      name: config.adminName,
      status: 'active',
      roleIds: ['system-admin'],
      groupIds: ['system-administrators'],
      directPermissions: [],
      attributes: { createdBy: 'system-init' },
      preferences: {
        theme: 'light',
        notifications: true,
        language: 'en',
        timezone: 'UTC'
      },
      loginHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'system'
    };

    await dynamoClient.send(new PutItemCommand({
      TableName: config.usersTableName,
      Item: marshall(adminUser)
    }));

    // Update group membership
    defaultGroup.members.push(config.adminEmail);
    await dynamoClient.send(new PutItemCommand({
      TableName: config.groupsTableName,
      Item: marshall(defaultGroup)
    }));

    console.log('✅ Created admin user in system');

    // Log the initialization
    await logAuditEvent('system', 'INIT_ADMIN_USER', 'user', config.adminEmail, {
      action: 'system_initialization',
      roles: ['system-admin'],
      groups: ['system-administrators']
    });

    console.log(`
🎉 Admin user created successfully!
   
   Email: ${config.adminEmail}
   Password: ${config.adminPassword}
   
   ⚠️  IMPORTANT: Change the password after first login!
    `);

  } catch (error) {
    console.error('❌ Failed to create admin user:', error);
  }
}

async function logAuditEvent(userId, action, resourceType, resourceId, details) {
  try {
    const auditLog = {
      auditId: uuidv4(),
      userId,
      action,
      resourceType,
      resourceId,
      details: JSON.stringify(details),
      timestamp: new Date().toISOString(),
      ipAddress: 'system-init',
    };

    await dynamoClient.send(new PutItemCommand({
      TableName: config.auditLogsTableName,
      Item: marshall(auditLog)
    }));
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
}

async function validateConfiguration() {
  console.log('Validating configuration...');
  
  const missingVars = [];
  
  if (!config.userPoolId) missingVars.push('USER_POOL_ID');
  
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingVars.join(', '));
    console.log(`
Required environment variables:
- USER_POOL_ID: The Cognito User Pool ID

Optional environment variables:
- AWS_REGION: AWS region (default: us-east-1)
- USERS_TABLE: Users table name
- ROLES_TABLE: Roles table name  
- GROUPS_TABLE: Groups table name
- AUDIT_TABLE: Audit logs table name
- ADMIN_EMAIL: Admin user email (default: admin@company.com)
- ADMIN_NAME: Admin user name (default: System Administrator)
- ADMIN_PASSWORD: Admin user password (auto-generated if not set)
    `);
    process.exit(1);
  }
  
  console.log('✅ Configuration validated');
}

async function main() {
  console.log('🚀 Initializing Admin System...\n');
  
  try {
    await validateConfiguration();
    await createSystemRoles();
    await createDefaultGroup();
    await createAdminUser();
    
    console.log('\n✅ Admin system initialization completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('   1. Deploy the application infrastructure');
    console.log('   2. Login with the admin credentials');
    console.log('   3. Change the default password');
    console.log('   4. Create additional users and assign appropriate roles');
    
  } catch (error) {
    console.error('❌ Initialization failed:', error);
    process.exit(1);
  }
}

// Run the initialization
if (require.main === module) {
  main();
}

module.exports = {
  config,
  systemRoles,
  defaultGroup,
  createSystemRoles,
  createDefaultGroup,
  createAdminUser
};