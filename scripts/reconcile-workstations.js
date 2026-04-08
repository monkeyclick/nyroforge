#!/usr/bin/env node

/**
 * Script to reconcile EC2 workstations with DynamoDB
 * This will find any running EC2 instances and create DynamoDB records for them
 */

const https = require('https');
const { CognitoIdentityProviderClient, InitiateAuthCommand } = require('@aws-sdk/client-cognito-identity-provider');

// Configuration - set via environment variables
const API_ENDPOINT = process.env.API_ENDPOINT;
const USER_POOL_ID = process.env.USER_POOL_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-2';

const USERNAME = process.env.ADMIN_USERNAME || process.env.COGNITO_USERNAME || process.argv[2];
const PASSWORD = process.env.ADMIN_PASSWORD || process.env.COGNITO_PASSWORD || process.argv[3];

if (!USER_POOL_ID || !CLIENT_ID || !USERNAME || !PASSWORD) {
  console.error('Missing required environment variables: USER_POOL_ID, CLIENT_ID, ADMIN_USERNAME, ADMIN_PASSWORD');
  console.error('');
  console.error('Usage:');
  console.error('  USER_POOL_ID=xxx CLIENT_ID=xxx ADMIN_USERNAME=user ADMIN_PASSWORD=pass node scripts/reconcile-workstations.js');
  console.error('');
  console.error('Or provide username/password as arguments:');
  console.error('  USER_POOL_ID=xxx CLIENT_ID=xxx node scripts/reconcile-workstations.js <username> <password>');
  process.exit(1);
}

if (!API_ENDPOINT) {
  console.error('Missing required environment variable: API_ENDPOINT');
  console.error('  Example: API_ENDPOINT=https://xxxxx.execute-api.us-west-2.amazonaws.com/api');
  process.exit(1);
}

async function getAuthToken() {
  console.log('🔐 Authenticating with Cognito...');
  
  if (!USERNAME || !PASSWORD) {
    throw new Error('Please provide USERNAME and PASSWORD as environment variables or command line arguments');
  }

  const client = new CognitoIdentityProviderClient({ region: AWS_REGION });
  
  const command = new InitiateAuthCommand({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: {
      USERNAME: USERNAME,
      PASSWORD: PASSWORD,
    },
  });

  try {
    const response = await client.send(command);
    if (!response.AuthenticationResult?.IdToken) {
      throw new Error('No ID token received from Cognito');
    }
    console.log('✅ Authentication successful\n');
    return response.AuthenticationResult.IdToken;
  } catch (error) {
    console.error('❌ Authentication failed:', error.message);
    throw error;
  }
}

function callReconcileAPI(authToken) {
  return new Promise((resolve, reject) => {
    console.log('🔄 Calling reconciliation endpoint...');
    console.log(`   URL: ${API_ENDPOINT}/workstations/reconcile\n`);

    const url = new URL(`${API_ENDPOINT}/workstations/reconcile`);
    
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`API returned status ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

async function main() {
  console.log('='.repeat(60));
  console.log('   Workstation Reconciliation Script');
  console.log('='.repeat(60));
  console.log();

  try {
    // Get auth token
    const authToken = await getAuthToken();
    
    // Call reconciliation API
    const result = await callReconcileAPI(authToken);
    
    // Display results
    console.log('✅ Reconciliation completed successfully!\n');
    console.log('📊 Summary:');
    console.log(`   Total EC2 Instances:    ${result.summary.totalEC2Instances}`);
    console.log(`   Total DynamoDB Records: ${result.summary.totalDynamoRecords}`);
    console.log(`   Orphaned Instances:     ${result.summary.orphanedInstances}`);
    console.log(`   Reconciled:             ${result.summary.reconciledCount}`);
    console.log(`   Errors:                 ${result.summary.errorCount}`);
    console.log();

    if (result.reconciledRecords && result.reconciledRecords.length > 0) {
      console.log('🔧 Reconciled Workstations:');
      result.reconciledRecords.forEach((record, index) => {
        console.log(`   ${index + 1}. ${record.workstationId} (${record.instanceId}) - ${record.status}`);
      });
      console.log();
    }

    if (result.errors && result.errors.length > 0) {
      console.log('⚠️  Errors encountered:');
      result.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. Instance ${error.instanceId}: ${error.error}`);
      });
      console.log();
    }

    console.log('='.repeat(60));
    console.log('✨ Done! Your workstations should now appear in the dashboard.');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
}

main();