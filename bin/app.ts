#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WorkstationInfrastructureStack } from '../lib/workstation-infrastructure-stack';
import { WorkstationApiStack } from '../lib/workstation-api-stack';
import { WorkstationAdminApiStack } from '../lib/workstation-admin-api-stack';
import { WorkstationFrontendStack } from '../lib/workstation-frontend-stack';
import { WorkstationWebsiteStack } from '../lib/workstation-website-stack';
import { EnterpriseStorageStack } from '../lib/enterprise-storage-stack';

const app = new cdk.App();

// Get environment variables or use defaults
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-west-2',
};

// Determine environment type
const environmentType = (process.env.ENVIRONMENT || 'dev') as 'dev' | 'staging' | 'prod';

// Core infrastructure stack (VPC, DynamoDB, Cognito, IAM)
// NOTE: VPC resources are set to RETAIN by default to prevent deletion failures
// when external resources (EKS clusters, Lambda ENIs) are using the subnets.
// Set RETAIN_VPC_ON_DELETE=false to disable this behavior.
const infraStack = new WorkstationInfrastructureStack(app, 'WorkstationInfrastructure', {
  env,
  description: 'Core infrastructure for Media Workstation Automation System',
  // Retain VPC resources on delete to prevent "subnet has dependencies" errors
  // This is critical when EKS clusters or other services share the VPC
  retainVpcOnDelete: process.env.RETAIN_VPC_ON_DELETE !== 'false',
  // Enable termination protection for production environments
  enableTerminationProtection: environmentType === 'prod',
});

// Enterprise Storage stack (EFS, FSx, S3 Transfer)
const storageStack = new EnterpriseStorageStack(app, 'WorkstationStorage', {
  env,
  description: 'Enterprise storage solutions for Media Workstation System',
  vpc: infraStack.vpc,
  subnetIds: infraStack.vpc.privateSubnets.map(s => s.subnetId),
  projectName: 'workstation',
  kmsKey: infraStack.kmsKey,
  workstationSecurityGroup: infraStack.workstationSecurityGroup,
  environment: environmentType,
  costCenter: process.env.COST_CENTER,
  // Enable EFS and S3 transfer by default, FSx optional
  enableEfs: true,
  enableS3Transfer: true,
  enableFsxWindows: process.env.ENABLE_FSX_WINDOWS === 'true',
  enableFsxLustre: process.env.ENABLE_FSX_LUSTRE === 'true',
  enableFsxOntap: process.env.ENABLE_FSX_ONTAP === 'true',
  enableFsxOpenZfs: process.env.ENABLE_FSX_OPENZFS === 'true',
  // Monitoring configuration
  monitoringConfig: {
    enableAlarms: environmentType === 'prod',
    enableDashboard: true,
    alarmEmail: process.env.ALARM_EMAIL,
  },
  // Enable backup for production
  enableBackup: environmentType === 'prod',
  // Create IAM policies for storage access
  createIamPolicies: true,
});

// API stack (Lambda functions, API Gateway - core user-facing endpoints)
const apiStack = new WorkstationApiStack(app, 'WorkstationApi', {
  env,
  description: 'API services for Media Workstation Automation System',
  vpc: infraStack.vpc,
  tables: infraStack.tables,
  userPool: infraStack.userPool,
  kmsKey: infraStack.kmsKey,
});

// Admin API stack (Lambda functions, API Gateway - admin endpoints)
const adminApiStack = new WorkstationAdminApiStack(app, 'WorkstationAdminApi', {
  env,
  description: 'Admin API services for Media Workstation Automation System',
  vpc: infraStack.vpc,
  tables: infraStack.tables,
  userPool: infraStack.userPool,
  kmsKey: infraStack.kmsKey,
});

// Frontend stack (Amplify app)
const frontendStack = new WorkstationFrontendStack(app, 'WorkstationFrontend', {
  env,
  description: 'Frontend application for Media Workstation Automation System',
  userPool: infraStack.userPool,
  userPoolClient: infraStack.userPoolClient,
  api: apiStack.api,
});

// Website stack (S3 + CloudFront for web interface)
const websiteStack = new WorkstationWebsiteStack(app, 'WorkstationWebsite', {
  env,
  description: 'Static website hosting for Media Workstation Management UI',
});

// Add dependencies
storageStack.addDependency(infraStack);
apiStack.addDependency(infraStack);
adminApiStack.addDependency(infraStack);
frontendStack.addDependency(apiStack);
frontendStack.addDependency(adminApiStack);

// Add tags to all stacks
cdk.Tags.of(app).add('Project', 'MediaWorkstationAutomation');
cdk.Tags.of(app).add('Environment', environmentType);
cdk.Tags.of(app).add('Owner', 'MediaTeam');