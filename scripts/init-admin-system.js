#!/usr/bin/env node

/**
 * Admin bootstrap.
 *
 * Creates the initial administrator in Cognito and grants admin rights by
 * adding them to the `workstation-admin` Cognito group.
 *
 * Cognito is the authoritative store for identity and group membership — the
 * API authorizer and user-management service read groups from the user pool and
 * fall back to DynamoDB only for optional profile detail. This script used to
 * also seed `UserRoles`, `UserGroups` and a profile row, but it wrote them with
 * partition keys (`roleId`, `groupId`, `userId`) that do not match the real
 * tables (all keyed on `id`), so every one of those writes failed validation —
 * and nothing reads them anyway. It also imported AdminAddUserToGroupCommand
 * without ever calling it, so the "admin" it created had no admin access.
 *
 * Usage: USER_POOL_ID=... node scripts/init-admin-system.js
 */

const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const crypto = require('crypto');

// Generate a secure random password if none provided. The suffix guarantees one
// character from each class the pool requires (upper, lower, digit, symbol)
// regardless of what the random bytes produced.
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ||
  crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, '') + '!A1a';

if (!process.env.ADMIN_PASSWORD) {
  console.log('\n⚠️  No ADMIN_PASSWORD environment variable set. Generated random password:');
  console.log(`   ${ADMIN_PASSWORD}`);
  console.log('   Save this password - it will not be shown again.\n');
}

const ADMIN_NAME = process.env.ADMIN_NAME || 'System Administrator';

// Cognito marks given_name and family_name as REQUIRED on this user pool, so
// AdminCreateUser is rejected without both. Split a full name when the caller
// only supplies ADMIN_NAME.
const nameParts = ADMIN_NAME.trim().split(/\s+/);

const config = {
  region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-2',
  userPoolId: process.env.USER_POOL_ID,
  adminEmail: process.env.ADMIN_EMAIL || 'admin@company.com',
  adminName: ADMIN_NAME,
  adminFirstName: process.env.ADMIN_FIRST_NAME || nameParts[0] || 'System',
  adminLastName: process.env.ADMIN_LAST_NAME || nameParts.slice(1).join(' ') || 'Administrator',
  adminPassword: ADMIN_PASSWORD,
  adminGroupName: process.env.ADMIN_GROUP_NAME || 'workstation-admin',
};

const cognitoClient = new CognitoIdentityProviderClient({ region: config.region });

async function createAdminUser() {
  console.log('Creating admin user...');

  let created = true;

  try {
    await cognitoClient.send(
      new AdminCreateUserCommand({
        UserPoolId: config.userPoolId,
        Username: config.adminEmail,
        UserAttributes: [
          { Name: 'email', Value: config.adminEmail },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name', Value: config.adminName },
          // Required attributes on this pool — omitting them fails the call.
          { Name: 'given_name', Value: config.adminFirstName },
          { Name: 'family_name', Value: config.adminLastName },
        ],
        // Deliberately a TEMPORARY password, so Cognito forces a change at first
        // login as the deployment docs promise. This previously followed up with
        // AdminSetUserPassword(Permanent: true), which contradicted the docs and
        // left the generated password valid indefinitely.
        TemporaryPassword: config.adminPassword,
        MessageAction: 'SUPPRESS', // Don't send welcome email for system setup
      })
    );
    console.log('✅ Created admin user in Cognito');
  } catch (error) {
    if (error.name === 'UsernameExistsException') {
      created = false;
      console.log(`⚠️  Cognito user already exists: ${config.adminEmail} (password unchanged)`);
    } else {
      throw error;
    }
  }

  // Grant admin rights. Idempotent server-side, so it is safe on a re-run and
  // also repairs an existing user that is missing the group.
  await cognitoClient.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: config.userPoolId,
      Username: config.adminEmail,
      GroupName: config.adminGroupName,
    })
  );
  console.log(`✅ Admin user is in the Cognito group: ${config.adminGroupName}`);

  if (created) {
    console.log(`
🎉 Admin user created successfully!

   Email: ${config.adminEmail}
   Password: ${config.adminPassword}

   ⚠️  IMPORTANT: This is a temporary password. You will be prompted to
       change it at first login.
    `);
  } else {
    console.log(`
✅ Admin user is ready.

   Email: ${config.adminEmail}
   Password: unchanged (this user already existed)
    `);
  }
}

function validateConfiguration() {
  console.log('Validating configuration...');

  if (!config.userPoolId) {
    console.error('❌ Missing required environment variable: USER_POOL_ID');
    console.log(`
Required environment variables:
- USER_POOL_ID: The Cognito User Pool ID

Optional environment variables:
- AWS_REGION: AWS region (default: us-west-2)
- ADMIN_EMAIL: Admin user email (default: admin@company.com)
- ADMIN_NAME: Admin full name (default: System Administrator)
- ADMIN_FIRST_NAME / ADMIN_LAST_NAME: Override the name split
- ADMIN_PASSWORD: Admin temporary password (auto-generated if not set)
- ADMIN_GROUP_NAME: Cognito admin group (default: workstation-admin)
    `);
    process.exit(1);
  }

  console.log('✅ Configuration validated');
}

async function main() {
  console.log('🚀 Initializing Admin System...\n');

  try {
    validateConfiguration();
    await createAdminUser();

    console.log('\n✅ Admin system initialization completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('   1. Build and deploy the web UI: ./scripts/deploy-frontend.sh');
    console.log('   2. Login with the admin credentials');
    console.log('   3. Set a permanent password when prompted');
    console.log('   4. Create additional users and assign Cognito groups');
  } catch (error) {
    // Rethrown failures used to be caught and logged inside createAdminUser,
    // so the script printed "initialization completed successfully" even when
    // the admin user was never created.
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
  createAdminUser,
};
