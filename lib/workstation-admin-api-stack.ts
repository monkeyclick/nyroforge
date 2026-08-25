import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { PROJECT_TAG } from './constants';
import { ServiceLambda } from './service-lambda';

interface WorkstationAdminApiStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  tables: {
    workstations: dynamodb.ITable;
    costs: dynamodb.ITable;
    userSessions: dynamodb.ITable;
    userProfiles: dynamodb.ITable;
    users: dynamodb.ITable;
    roles: dynamodb.ITable;
    groups: dynamodb.ITable;
    groupMemberships: dynamodb.ITable;
    groupAuditLogs: dynamodb.ITable;
    auditLogs: dynamodb.ITable;
    bootstrapPackages: dynamodb.ITable;
    analytics: dynamodb.ITable;
    feedback: dynamodb.ITable;
    packageQueue: dynamodb.ITable;
    groupPackageBindings: dynamodb.ITable;
    deletedUsers: dynamodb.ITable;
    passwordResetRecords: dynamodb.ITable;
    passwordPolicy: dynamodb.ITable;
  };
  userPool: cognito.IUserPool;
  kmsKey: kms.IKey;
  /** Bucket holding uploaded bootstrap package installers. */
  packagesBucket: s3.IBucket;
}

export class WorkstationAdminApiStack extends cdk.Stack {
  public readonly adminApi: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: WorkstationAdminApiStackProps) {
    super(scope, id, props);

    const { vpc, tables, userPool, kmsKey, packagesBucket } = props;

    /**
     * Create a dedicated execution role for a single admin service Lambda.
     *
     * Every admin function previously shared one `adminLambdaRole` ("god
     * role") with every permission any of the 11 functions needed — meaning
     * e.g. cognito-admin-service (which only touches Roles + AuditLogs) could
     * also delete security groups, delete EFS/FSx filesystems, and read/write
     * every other DynamoDB table. Giving each function its own role lets
     * IAM/CloudFormation actually enforce least privilege: callers below
     * attach only the specific grants each function's handler code uses.
     */
    const createFunctionRole = (functionId: string): iam.Role => {
      const role = new iam.Role(this, `${functionId}Role`, {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
        ],
      });
      role.addToPolicy(new iam.PolicyStatement({
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: ['*'],
      }));
      return role;
    };

    // KMS decrypt for a function that touches at least one CMK-encrypted
    // DynamoDB table. Uses an explicit PolicyStatement (rather than
    // kmsKey.grantDecrypt(), which also adds kms:DescribeKey) so each role
    // gets exactly the two actions the shared role granted today.
    const grantKmsDecrypt = (fn: ServiceLambda): void => {
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'kms:Decrypt',
          'kms:GenerateDataKey',
        ],
        resources: [kmsKey.keyArn],
      }));
    };

    const ssmWorkstationParameterArn = `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter/workstation/*`;

    // Common Lambda environment variables
    const commonEnv = {
      WORKSTATIONS_TABLE_NAME: tables.workstations.tableName,
      WORKSTATION_TABLE: tables.workstations.tableName,
      USER_PROFILE_TABLE: tables.userProfiles.tableName,
      USER_TABLE: tables.users.tableName,
      USERS_TABLE: tables.users.tableName,
      ROLE_TABLE: tables.roles.tableName,
      ROLES_TABLE: tables.roles.tableName,
      GROUP_TABLE: tables.groups.tableName,
      GROUPS_TABLE: tables.groups.tableName,
      GROUP_MEMBERSHIPS_TABLE: tables.groupMemberships.tableName,
      GROUP_AUDIT_LOGS_TABLE: tables.groupAuditLogs.tableName,
      AUDIT_LOGS_TABLE: tables.auditLogs.tableName,
      AUDIT_TABLE: tables.auditLogs.tableName,
      BOOTSTRAP_PACKAGES_TABLE: tables.bootstrapPackages.tableName,
      ANALYTICS_TABLE: tables.analytics.tableName,
      GROUP_PACKAGE_BINDINGS_TABLE: tables.groupPackageBindings.tableName,
      PACKAGE_QUEUE_TABLE: tables.packageQueue.tableName,
      PACKAGES_BUCKET: packagesBucket.bucketName,
      // New tables for user deletion and password management
      DELETED_USERS_TABLE: tables.deletedUsers.tableName,
      PASSWORD_RESET_TABLE: tables.passwordResetRecords.tableName,
      PASSWORD_POLICY_TABLE: tables.passwordPolicy.tableName,
      // SES configuration for email notifications
      SES_FROM_EMAIL: process.env.SES_FROM_EMAIL || 'noreply@example.com', // Override via SES_FROM_EMAIL env var
      USER_POOL_ID: userPool.userPoolId,
      KMS_KEY_ID: kmsKey.keyId,
      // Needed to build the instance ARN the package queue is partitioned
      // by, for invocations that do not carry an API Gateway request context.
      DEPLOY_ACCOUNT_ID: cdk.Stack.of(this).account,
      VPC_ID: vpc.vpcId,
    };

    // Lambda function defaults. NOTE: no `role` here — each function below
    // gets its own dedicated role passed directly, not a shared default.
    const lambdaDefaults = {
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: commonEnv,
    };

    // ============================================
    // Lambda Functions for Admin APIs
    // Each function gets its own iam.Role with only the grants its handler
    // code actually uses (verified against src/lambda/<service>/index.ts).
    // ============================================

    // --- Cognito Admin Service ---
    // Only real consumer of Cognito group/user administration actions across
    // the admin API; DynamoDB access limited to Roles (RW) and AuditLogs
    // (read-only — listAuditLogs only ever Scans, never writes).
    const cognitoAdminServiceRole = createFunctionRole('CognitoAdminService');
    const cognitoAdminServiceFunction = new ServiceLambda(this, 'CognitoAdminService', {
      ...lambdaDefaults,
      functionName: 'workstation-cognito-admin-service',
      serviceDir: 'cognito-admin-service',
      description: 'Handles Cognito user and group administration',
      role: cognitoAdminServiceRole,
    });
    tables.roles.grantReadWriteData(cognitoAdminServiceFunction);
    tables.auditLogs.grantReadData(cognitoAdminServiceFunction);
    grantKmsDecrypt(cognitoAdminServiceFunction);
    cognitoAdminServiceFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminDeleteUser',
        'cognito-idp:AdminDisableUser',
        'cognito-idp:AdminEnableUser',
        'cognito-idp:AdminGetUser',
        'cognito-idp:AdminListGroupsForUser',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminRemoveUserFromGroup',
        'cognito-idp:AdminUpdateUserAttributes',
        'cognito-idp:AdminSetUserPassword',
        'cognito-idp:ListUsers',
        'cognito-idp:ListUsersInGroup',
        'cognito-idp:ListGroups',
        'cognito-idp:CreateGroup',
        'cognito-idp:DeleteGroup',
        'cognito-idp:GetGroup',
        'cognito-idp:UpdateGroup',
      ],
      resources: [userPool.userPoolArn],
    }));

    // --- Group Management Service ---
    // Owns Groups/GroupAuditLogs/GroupMemberships; only ever reads Users
    // (Scan in evaluateGroupRules), never writes it.
    const groupManagementServiceRole = createFunctionRole('GroupManagementService');
    const groupManagementServiceFunction = new ServiceLambda(this, 'GroupManagementService', {
      ...lambdaDefaults,
      functionName: 'workstation-group-management-service',
      serviceDir: 'group-management-service',
      description: 'Handles group management operations',
      role: groupManagementServiceRole,
    });
    tables.groups.grantReadWriteData(groupManagementServiceFunction);
    tables.groupAuditLogs.grantReadWriteData(groupManagementServiceFunction);
    tables.groupMemberships.grantReadWriteData(groupManagementServiceFunction);
    tables.users.grantReadData(groupManagementServiceFunction);
    grantKmsDecrypt(groupManagementServiceFunction);

    // --- Security Group Service ---
    // DynamoDB: Workstations (RW — Scan + UpdateItem to attach an SG),
    // AuditLogs (write path for logAuditEvent), Users (read-only permission
    // lookups). EC2 Describe is limited to DescribeSecurityGroups/Rules and
    // DescribeInstances — DescribeInstanceTypes/DescribeImages are NOT used
    // by this handler (verified: not imported). The "mutating" statement is
    // narrowed to the four actions actually called (Authorize/Revoke
    // *Ingress*, DeleteSecurityGroup, ModifyInstanceAttribute) — the Egress
    // variants, ModifySecurityGroupRules, and standalone CreateTags/DeleteTags
    // are not imported/used by this handler.
    const securityGroupServiceRole = createFunctionRole('SecurityGroupService');
    const securityGroupServiceFunction = new ServiceLambda(this, 'SecurityGroupService', {
      ...lambdaDefaults,
      functionName: 'workstation-security-group-service',
      serviceDir: 'security-group-service',
      description: 'Handles security group management',
      role: securityGroupServiceRole,
      environment: {
        ...commonEnv,
        VPC_ID: vpc.vpcId,
      },
    });
    tables.workstations.grantReadWriteData(securityGroupServiceFunction);
    tables.auditLogs.grantReadWriteData(securityGroupServiceFunction);
    tables.users.grantReadData(securityGroupServiceFunction);
    grantKmsDecrypt(securityGroupServiceFunction);
    securityGroupServiceFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ec2:DescribeSecurityGroups',
        'ec2:DescribeSecurityGroupRules',
        'ec2:DescribeInstances',
      ],
      resources: ['*'],
      conditions: {
        'StringEquals': {
          'aws:RequestedRegion': cdk.Stack.of(this).region,
        }
      }
    }));
    // Create a new security group. A brand-new security group has no tags
    // yet, so it cannot be scoped by aws:ResourceTag; enforce the Project tag
    // at creation via aws:RequestTag (applied through TagSpecifications) so
    // the group is manageable by the statement below.
    securityGroupServiceFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ec2:CreateSecurityGroup'],
      resources: ['*'],
      conditions: {
        'StringEquals': {
          'aws:RequestedRegion': cdk.Stack.of(this).region,
          'aws:RequestTag/Project': PROJECT_TAG,
        }
      }
    }));
    // Tag-on-create: CreateSecurityGroup's TagSpecifications requires
    // ec2:CreateTags too; scope it to only fire alongside that call.
    securityGroupServiceFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ec2:CreateTags'],
      resources: ['*'],
      conditions: {
        'StringEquals': {
          'ec2:CreateAction': 'CreateSecurityGroup',
        }
      }
    }));
    // Mutating actions on existing project-tagged resources.
    securityGroupServiceFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ec2:AuthorizeSecurityGroupIngress',
        'ec2:RevokeSecurityGroupIngress',
        'ec2:DeleteSecurityGroup',
        'ec2:ModifyInstanceAttribute',
      ],
      resources: ['*'],
      conditions: {
        'StringEquals': {
          'aws:RequestedRegion': cdk.Stack.of(this).region,
          'aws:ResourceTag/Project': PROJECT_TAG,
        }
      }
    }));

    // --- AMI Validation Service ---
    // No DynamoDB access at all. Only calls ec2:DescribeImages.
    const amiValidationServiceRole = createFunctionRole('AmiValidationService');
    const amiValidationServiceFunction = new ServiceLambda(this, 'AmiValidationService', {
      ...lambdaDefaults,
      functionName: 'workstation-ami-validation-service',
      serviceDir: 'ami-validation-service',
      description: 'Validates AMI IDs and retrieves AMI information',
      role: amiValidationServiceRole,
    });
    amiValidationServiceFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ec2:DescribeImages'],
      resources: ['*'],
      conditions: {
        'StringEquals': {
          'aws:RequestedRegion': cdk.Stack.of(this).region,
        }
      }
    }));

    // --- Instance Type Service ---
    // No DynamoDB access. Only ec2:DescribeInstanceTypes (DescribeImages is
    // not called by this handler). SSM statement copied as-is from the
    // shared role (Get/Put/Delete on /workstation/*) even though this
    // handler only exercises Get/Put — Delete is kept to match the existing
    // grantable statement rather than splitting a single policy mid-action.
    // No SecureString/KMS-encrypted params are involved (the parameter this
    // handler writes is a plain String type), so no KMS grant is needed.
    const instanceTypeServiceRole = createFunctionRole('InstanceTypeService');
    const instanceTypeServiceFunction = new ServiceLambda(this, 'InstanceTypeService', {
      ...lambdaDefaults,
      functionName: 'workstation-instance-type-service',
      serviceDir: 'instance-type-service',
      description: 'Manages allowed instance types',
      role: instanceTypeServiceRole,
    });
    instanceTypeServiceFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ec2:DescribeInstanceTypes'],
      resources: ['*'],
      conditions: {
        'StringEquals': {
          'aws:RequestedRegion': cdk.Stack.of(this).region,
        }
      }
    }));
    instanceTypeServiceFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ssm:GetParameter',
        'ssm:PutParameter',
        'ssm:DeleteParameter',
      ],
      resources: [ssmWorkstationParameterArn],
    }));

    // --- Bootstrap Config Service ---
    // Only ever touches the BootstrapPackages table.
    const bootstrapConfigServiceRole = createFunctionRole('BootstrapConfigService');
    const bootstrapConfigServiceFunction = new ServiceLambda(this, 'BootstrapConfigService', {
      ...lambdaDefaults,
      functionName: 'workstation-bootstrap-config-service',
      serviceDir: 'bootstrap-config-service',
      description: 'Manages bootstrap package configurations',
      role: bootstrapConfigServiceRole,
    });
    tables.bootstrapPackages.grantReadWriteData(bootstrapConfigServiceFunction);
    // Reads the live outcome of a trial install when serving a single package.
    tables.packageQueue.grantReadData(bootstrapConfigServiceFunction);
    // Deleting a catalog entry also removes its uploaded artifact, so an
    // orphaned multi-GB object is not left behind paying rent.
    packagesBucket.grantDelete(bootstrapConfigServiceFunction);
    grantKmsDecrypt(bootstrapConfigServiceFunction);

    // --- Package Analyzer ---
    // Streams an uploaded installer once to compute its SHA-256 and fingerprint
    // the installer framework. Long timeout and large ephemeral storage: a
    // multi-GB artifact is written to /tmp so archive entries can be inspected.
    const packageAnalyzerRole = createFunctionRole('PackageAnalyzer');
    const packageAnalyzerFunction = new ServiceLambda(this, 'PackageAnalyzer', {
      ...lambdaDefaults,
      functionName: 'workstation-package-analyzer',
      serviceDir: 'package-analyzer',
      description: 'Hashes and fingerprints uploaded installers',
      role: packageAnalyzerRole,
      timeout: cdk.Duration.minutes(15),
      memorySize: 2048,
      ephemeralStorageSize: cdk.Size.gibibytes(10),
    });
    tables.bootstrapPackages.grantReadWriteData(packageAnalyzerFunction);
    // Emails the admin group when a package lands in the review queue, and the
    // uploader when analysis could not identify their installer.
    packageAnalyzerFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: ['*'],
    }));
    packageAnalyzerFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:ListUsersInGroup'],
      resources: [userPool.userPoolArn],
    }));
    // Reads only the unreviewed prefix — it never needs approved artifacts.
    packageAnalyzerFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [`${packagesBucket.bucketArn}/quarantine/*`],
    }));
    grantKmsDecrypt(packageAnalyzerFunction);

    // --- Package Upload Service ---
    // Owns the artifact lifecycle: multipart upload, abort, and the review
    // actions that promote an object from `quarantine/` to `packages/`.
    const packageUploadServiceRole = createFunctionRole('PackageUploadService');
    const packageUploadServiceFunction = new ServiceLambda(this, 'PackageUploadService', {
      ...lambdaDefaults,
      functionName: 'workstation-package-upload-service',
      serviceDir: 'package-upload-service',
      description: 'Manages uploads, review and promotion of bootstrap packages',
      role: packageUploadServiceRole,
      // Promoting a >5 GiB artifact runs a multipart copy part-by-part in
      // process. Parts go 8-wide, but a 20 GB upload is still 20 server-side
      // copies, so give it the full Lambda ceiling rather than a tight bound.
      timeout: cdk.Duration.minutes(15),
      environment: {
        ...commonEnv,
        ANALYZER_FUNCTION_NAME: packageAnalyzerFunction.functionName,
      },
    });
    tables.bootstrapPackages.grantReadWriteData(packageUploadServiceFunction);
    tables.workstations.grantReadData(packageUploadServiceFunction);
    // Queues a trial install for the verify action.
    tables.packageQueue.grantReadWriteData(packageUploadServiceFunction);
    // Migrates group bindings forward when a new version supersedes an old one.
    tables.groupPackageBindings.grantReadWriteData(packageUploadServiceFunction);
    packageAnalyzerFunction.grantInvoke(packageUploadServiceFunction);
    packageUploadServiceFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        's3:PutObject',
        's3:GetObject',
        's3:DeleteObject',
        's3:AbortMultipartUpload',
        's3:ListMultipartUploadParts',
      ],
      resources: [
        `${packagesBucket.bucketArn}/quarantine/*`,
        `${packagesBucket.bucketArn}/packages/*`,
        `${packagesBucket.bucketArn}/verify/*`,
      ],
    }));
    packageUploadServiceFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:ListBucketMultipartUploads'],
      resources: [packagesBucket.bucketArn],
    }));
    // GuardDuty Malware Protection publishes its verdict as an object tag; the
    // approve handler reads it and refuses to publish a flagged artifact.
    packageUploadServiceFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObjectTagging'],
      resources: [`${packagesBucket.bucketArn}/quarantine/*`],
    }));
    // Tells the uploader what an admin decided about their package.
    packageUploadServiceFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: ['*'],
    }));
    // Presigned PUTs are signed with this role's credentials, and the bucket
    // encrypts with the CMK, so the role needs to be able to use the key.
    grantKmsDecrypt(packageUploadServiceFunction);

    // --- Group Package Service ---
    // BootstrapPackages and Workstations are only ever read (GetItem) by
    // this handler; GroupPackageBindings and PackageQueue are read-written.
    const groupPackageServiceRole = createFunctionRole('GroupPackageService');
    const groupPackageServiceFunction = new ServiceLambda(this, 'GroupPackageService', {
      ...lambdaDefaults,
      functionName: 'workstation-group-package-service',
      serviceDir: 'group-package-service',
      description: 'Manages group-specific package assignments',
      role: groupPackageServiceRole,
    });
    tables.bootstrapPackages.grantReadData(groupPackageServiceFunction);
    tables.groupPackageBindings.grantReadWriteData(groupPackageServiceFunction);
    tables.packageQueue.grantReadWriteData(groupPackageServiceFunction);
    tables.workstations.grantReadData(groupPackageServiceFunction);
    grantKmsDecrypt(groupPackageServiceFunction);

    // --- Storage Service ---
    // No DynamoDB access. S3 and FSx/EFS statements copied as-is from the
    // shared role. This handler's getStorageConfig() unconditionally reads
    // SSM parameters under /workstation/storage/* for the EFS file system
    // and access point IDs (falling back to SSM for the transfer bucket
    // name too), so it needs the same /workstation/* SSM statement as
    // instance-type-service/instance-family-service — the original grant
    // matrix omitted this, but the handler cannot fetch its own config
    // without it. Those SSM parameters are plain String type (see
    // lib/enterprise-storage-construct.ts / enterprise-storage-stack.ts:
    // ssm.StringParameter, not SecureString), so no KMS grant is needed.
    const storageServiceRole = createFunctionRole('StorageService');
    const storageServiceFunction = new ServiceLambda(this, 'StorageService', {
      ...lambdaDefaults,
      functionName: 'workstation-storage-service',
      serviceDir: 'storage-service',
      description: 'Handles storage management operations',
      role: storageServiceRole,
      environment: {
        ...commonEnv,
        // The enterprise storage construct names the transfer bucket
        // `${projectName}-transfer-${account}` (projectName='workstation'; see
        // bin/app.ts and enterprise-storage-construct.ts). Pass it directly so
        // the service no longer depends on SSM parameter paths that never
        // matched what CDK actually wrote (`/dev/storage/transfer-bucket` read
        // vs `/workstation/storage/s3/transfer-bucket` written).
        STORAGE_TRANSFER_BUCKET: `workstation-transfer-${cdk.Stack.of(this).account}`,
      },
    });
    storageServiceFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        's3:ListBucket',
        's3:GetBucketLocation',
      ],
      resources: [`arn:aws:s3:::workstation-transfer-*`],
    }));
    storageServiceFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        's3:GetObject',
        's3:PutObject',
        's3:DeleteObject',
      ],
      resources: [`arn:aws:s3:::workstation-transfer-*/*`],
    }));
    storageServiceFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'fsx:DescribeFileSystems',
        'elasticfilesystem:DescribeFileSystems',
        'elasticfilesystem:DescribeMountTargets',
      ],
      resources: ['*'],
    }));
    storageServiceFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'fsx:DeleteFileSystem',
        'elasticfilesystem:DeleteFileSystem',
        'elasticfilesystem:DeleteMountTarget',
      ],
      resources: ['*'],
      conditions: {
        'StringEquals': {
          'aws:ResourceTag/Project': PROJECT_TAG,
        }
      }
    }));
    storageServiceFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ssm:GetParameter',
        'ssm:PutParameter',
        'ssm:DeleteParameter',
      ],
      resources: [ssmWorkstationParameterArn],
    }));

    // --- EC2 Discovery Service ---
    // DynamoDB: AuditLogs (RW), Workstations (RW — imports discovered
    // instances as new workstation records / tracks excluded instances),
    // Groups/Roles/Users are read-only permission lookups. EC2: this
    // handler calls DescribeInstances AND DescribeInstanceTypes (not
    // DescribeSecurityGroups, despite that being the matrix's example), plus
    // standalone ec2:CreateTags/DeleteTags when importing/removing an
    // instance from management scope — neither of those two tag actions
    // was called out in the original grant matrix, but both are exercised
    // by this handler (see createTagsCommand/deleteTagsCommand usage).
    const ec2DiscoveryServiceRole = createFunctionRole('Ec2DiscoveryService');
    const ec2DiscoveryServiceFunction = new ServiceLambda(this, 'Ec2DiscoveryService', {
      ...lambdaDefaults,
      functionName: 'workstation-ec2-discovery-service',
      serviceDir: 'ec2-discovery-service',
      description: 'Discovers and imports existing EC2 instances',
      role: ec2DiscoveryServiceRole,
    });
    tables.auditLogs.grantReadWriteData(ec2DiscoveryServiceFunction);
    tables.groups.grantReadData(ec2DiscoveryServiceFunction);
    tables.roles.grantReadData(ec2DiscoveryServiceFunction);
    tables.users.grantReadData(ec2DiscoveryServiceFunction);
    tables.workstations.grantReadWriteData(ec2DiscoveryServiceFunction);
    grantKmsDecrypt(ec2DiscoveryServiceFunction);
    ec2DiscoveryServiceFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ec2:DescribeInstances',
        'ec2:DescribeInstanceTypes',
      ],
      resources: ['*'],
      conditions: {
        'StringEquals': {
          'aws:RequestedRegion': cdk.Stack.of(this).region,
        }
      }
    }));
    ec2DiscoveryServiceFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ec2:CreateTags',
        'ec2:DeleteTags',
      ],
      resources: ['*'],
      conditions: {
        'StringEquals': {
          'aws:RequestedRegion': cdk.Stack.of(this).region,
          'aws:ResourceTag/Project': PROJECT_TAG,
        }
      }
    }));

    // --- Instance Family Service ---
    // Groups/Roles/Users are read-only (shared admin-permission-check
    // helper). Workstations is read-WRITE, not read-only as the original
    // matrix assumed: saveInstanceFamilyConfig() stores the instance-family
    // allowlist as an item in the Workstations table (PutItem with
    // PK=CONFIG#INSTANCE_FAMILIES). SSM statement mirrors instance-type-service.
    const instanceFamilyServiceRole = createFunctionRole('InstanceFamilyService');
    const instanceFamilyServiceFunction = new ServiceLambda(this, 'InstanceFamilyService', {
      ...lambdaDefaults,
      functionName: 'workstation-instance-family-service',
      serviceDir: 'instance-family-service',
      description: 'Manages allowed EC2 instance families for deployments',
      role: instanceFamilyServiceRole,
    });
    tables.groups.grantReadData(instanceFamilyServiceFunction);
    tables.roles.grantReadData(instanceFamilyServiceFunction);
    tables.users.grantReadData(instanceFamilyServiceFunction);
    tables.workstations.grantReadWriteData(instanceFamilyServiceFunction);
    grantKmsDecrypt(instanceFamilyServiceFunction);
    instanceFamilyServiceFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ssm:GetParameter',
        'ssm:PutParameter',
        'ssm:DeleteParameter',
      ],
      resources: [ssmWorkstationParameterArn],
    }));

    // --- User Management Service (user deletion and password management) ---
    // DynamoDB grants below are narrower than the original matrix in three
    // places, verified against src/lambda/user-management-service/index.ts:
    //  - GroupMemberships needs RW, not read-only: hardDeleteUser() reads a
    //    deleted user's memberships (Query via getUserGroups) and deletes
    //    each one as part of cleanup.
    //  - PasswordPolicy is read-only: the only DynamoDB call against this
    //    table anywhere in the file is a GetItem (getPasswordPolicy); there
    //    is no write path in this handler at all.
    //  - PasswordResetRecords is write-only: every call against this table
    //    is a PutItem (setUserPassword/generateUserPassword); nothing in
    //    this handler ever reads it back.
    // Feedback is omitted entirely: it's declared (FEEDBACK_TABLE) but never
    // referenced anywhere else in the file, AND it was never part of the
    // original shared adminLambdaRole's DynamoDB resource list either — so
    // granting it here would be a net-new permission, not a narrowing.
    // Analytics, BootstrapPackages, Groups, and GroupAuditLogs are also
    // unreferenced by this handler beyond their env-var declaration, but are
    // kept (matching the original matrix) because they WERE present in the
    // shared role's resource list; dropping them is optional least-privilege
    // hardening for a later pass, not required to preserve today's behavior.
    // Cognito actions are limited to what's imported/called in this file:
    // AdminUpdateUserAttributes is NOT imported here (that belongs solely to
    // cognito-admin-service) and is therefore omitted; AdminListGroupsForUser
    // IS used (by the last-admin check) and is added even though the
    // original matrix didn't list it. SES is limited to ses:SendEmail — the
    // only SES command this handler imports/calls.
    const userManagementServiceRole = createFunctionRole('UserManagementService');
    const userManagementServiceFunction = new ServiceLambda(this, 'UserManagementService', {
      ...lambdaDefaults,
      functionName: 'workstation-user-management-service',
      serviceDir: 'user-management-service',
      description: 'Handles user deletion (soft/hard) and password management operations',
      timeout: cdk.Duration.seconds(60), // Longer timeout for deletion operations
      role: userManagementServiceRole,
    });
    tables.analytics.grantReadWriteData(userManagementServiceFunction);
    tables.auditLogs.grantReadWriteData(userManagementServiceFunction);
    tables.bootstrapPackages.grantReadData(userManagementServiceFunction);
    tables.deletedUsers.grantReadWriteData(userManagementServiceFunction);
    tables.groups.grantReadData(userManagementServiceFunction);
    tables.groupAuditLogs.grantReadWriteData(userManagementServiceFunction);
    tables.groupMemberships.grantReadWriteData(userManagementServiceFunction);
    tables.passwordPolicy.grantReadData(userManagementServiceFunction);
    tables.passwordResetRecords.grantWriteData(userManagementServiceFunction);
    tables.roles.grantReadData(userManagementServiceFunction);
    tables.users.grantReadWriteData(userManagementServiceFunction);
    grantKmsDecrypt(userManagementServiceFunction);
    userManagementServiceFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:AdminDeleteUser',
        'cognito-idp:AdminDisableUser',
        'cognito-idp:AdminEnableUser',
        'cognito-idp:AdminGetUser',
        'cognito-idp:AdminListGroupsForUser',
        'cognito-idp:AdminSetUserPassword',
        'cognito-idp:ListUsers',
      ],
      resources: [userPool.userPoolArn],
    }));
    userManagementServiceFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: ['*'], // SES doesn't support resource-level permissions for most operations
    }));

    // ============================================
    // API Gateway
    // ============================================

    // Create Admin API Gateway
    this.adminApi = new apigateway.RestApi(this, 'AdminApi', {
      restApiName: 'Workstation Admin API',
      description: 'Admin API for Workstation Management System',
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: false, // Disabled to prevent logging sensitive request/response data
        metricsEnabled: true,
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS, // TODO: Restrict to specific CloudFront domain in production
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        allowCredentials: true,
      },
    });

    // Cognito Authorizer
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'AdminApiAuthorizer', {
      cognitoUserPools: [userPool],
      authorizerName: 'admin-cognito-authorizer',
      identitySource: 'method.request.header.Authorization',
    });

    // Request validator
    const requestValidator = new apigateway.RequestValidator(this, 'AdminApiRequestValidator', {
      restApi: this.adminApi,
      validateRequestBody: true,
      validateRequestParameters: true,
    });

    // Common method options with authorization
    const authorizedMethodOptions: apigateway.MethodOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // Lambda integrations.
    //
    // allowTestInvoke:false suppresses the extra AWS::Lambda::Permission that
    // CDK adds per method for API Gateway's console "Test" button. At ~78
    // methods that second permission was ~half of this stack's CloudFormation
    // resources, pushing it against the hard 500-resource limit; dropping it
    // costs only the console test feature, which the deployed API never uses.
    const integrationOptions: apigateway.LambdaIntegrationOptions = { allowTestInvoke: false };

    const cognitoAdminIntegration = new apigateway.LambdaIntegration(cognitoAdminServiceFunction, integrationOptions);
    const groupManagementIntegration = new apigateway.LambdaIntegration(groupManagementServiceFunction, integrationOptions);
    const securityGroupIntegration = new apigateway.LambdaIntegration(securityGroupServiceFunction, integrationOptions);
    const amiValidationIntegration = new apigateway.LambdaIntegration(amiValidationServiceFunction, integrationOptions);
    const instanceTypeIntegration = new apigateway.LambdaIntegration(instanceTypeServiceFunction, integrationOptions);
    const bootstrapConfigIntegration = new apigateway.LambdaIntegration(bootstrapConfigServiceFunction, integrationOptions);
    const groupPackageIntegration = new apigateway.LambdaIntegration(groupPackageServiceFunction, integrationOptions);
    const storageIntegration = new apigateway.LambdaIntegration(storageServiceFunction, integrationOptions);
    const ec2DiscoveryIntegration = new apigateway.LambdaIntegration(ec2DiscoveryServiceFunction, integrationOptions);
    const instanceFamilyIntegration = new apigateway.LambdaIntegration(instanceFamilyServiceFunction, integrationOptions);
    const userManagementIntegration = new apigateway.LambdaIntegration(userManagementServiceFunction, integrationOptions);

    // ============================================
    // API Resources and Methods
    // ============================================

    // /users resource
    const usersResource = this.adminApi.root.addResource('users');
    usersResource.addMethod('GET', cognitoAdminIntegration, authorizedMethodOptions);
    usersResource.addMethod('POST', cognitoAdminIntegration, authorizedMethodOptions);

    // /users/{userId}
    const userResource = usersResource.addResource('{userId}');
    userResource.addMethod('GET', cognitoAdminIntegration, authorizedMethodOptions);
    userResource.addMethod('PUT', cognitoAdminIntegration, authorizedMethodOptions);
    userResource.addMethod('DELETE', cognitoAdminIntegration, authorizedMethodOptions);

    // /users/{userId}/groups - Cognito group membership for a user
    const userGroupsResource = userResource.addResource('groups');
    userGroupsResource.addMethod('GET', cognitoAdminIntegration, authorizedMethodOptions);
    userGroupsResource.addMethod('POST', cognitoAdminIntegration, authorizedMethodOptions);

    // /users/{userId}/groups/{groupName}
    const userGroupResource = userGroupsResource.addResource('{groupName}');
    userGroupResource.addMethod('DELETE', cognitoAdminIntegration, authorizedMethodOptions);

    // /users/{userId}/suspend
    const suspendUserResource = userResource.addResource('suspend');
    suspendUserResource.addMethod('POST', cognitoAdminIntegration, authorizedMethodOptions);

    // /users/{userId}/activate
    const activateUserResource = userResource.addResource('activate');
    activateUserResource.addMethod('POST', cognitoAdminIntegration, authorizedMethodOptions);

    // /users/{userId}/deletion-preview - Get deletion impact preview
    const deletionPreviewResource = userResource.addResource('deletion-preview');
    deletionPreviewResource.addMethod('GET', userManagementIntegration, authorizedMethodOptions);

    // /users/{userId}/soft-delete - Soft delete a user (disables account, preserves data)
    const softDeleteResource = userResource.addResource('soft-delete');
    softDeleteResource.addMethod('POST', userManagementIntegration, authorizedMethodOptions);

    // /users/{userId}/hard-delete - Hard delete a user (permanent removal)
    const hardDeleteResource = userResource.addResource('hard-delete');
    hardDeleteResource.addMethod('POST', userManagementIntegration, authorizedMethodOptions);

    // /users/{userId}/restore - Restore a soft-deleted user
    const restoreUserResource = userResource.addResource('restore');
    restoreUserResource.addMethod('POST', userManagementIntegration, authorizedMethodOptions);

    // /users/{userId}/password - Password management
    const passwordResource = userResource.addResource('password');
    passwordResource.addMethod('POST', userManagementIntegration, authorizedMethodOptions); // Set password

    // /users/{userId}/password/generate - Generate a new password
    const generatePasswordResource = passwordResource.addResource('generate');
    generatePasswordResource.addMethod('POST', userManagementIntegration, authorizedMethodOptions);

    // /deleted-users resource - List and manage deleted users
    const deletedUsersResource = this.adminApi.root.addResource('deleted-users');
    deletedUsersResource.addMethod('GET', userManagementIntegration, authorizedMethodOptions);

    // /password-policy resource - Get/Set password policy
    const passwordPolicyResource = this.adminApi.root.addResource('password-policy');
    passwordPolicyResource.addMethod('GET', userManagementIntegration, authorizedMethodOptions);
    passwordPolicyResource.addMethod('PUT', userManagementIntegration, authorizedMethodOptions);

    // /cognito-groups resource - native Cognito user-pool groups (the ones
    // that appear in JWT claims and drive authorization)
    const cognitoGroupsResource = this.adminApi.root.addResource('cognito-groups');
    cognitoGroupsResource.addMethod('GET', cognitoAdminIntegration, authorizedMethodOptions);
    cognitoGroupsResource.addMethod('POST', cognitoAdminIntegration, authorizedMethodOptions);

    // /cognito-groups/{groupName}
    const cognitoGroupResource = cognitoGroupsResource.addResource('{groupName}');
    cognitoGroupResource.addMethod('DELETE', cognitoAdminIntegration, authorizedMethodOptions);

    // /roles resource
    const rolesResource = this.adminApi.root.addResource('roles');
    rolesResource.addMethod('GET', cognitoAdminIntegration, authorizedMethodOptions);
    rolesResource.addMethod('POST', cognitoAdminIntegration, authorizedMethodOptions);

    // /roles/{roleId}
    const roleResource = rolesResource.addResource('{roleId}');
    roleResource.addMethod('GET', cognitoAdminIntegration, authorizedMethodOptions);
    roleResource.addMethod('PUT', cognitoAdminIntegration, authorizedMethodOptions);
    roleResource.addMethod('DELETE', cognitoAdminIntegration, authorizedMethodOptions);

    // /groups resource
    const groupsResource = this.adminApi.root.addResource('groups');
    groupsResource.addMethod('GET', groupManagementIntegration, authorizedMethodOptions);
    groupsResource.addMethod('POST', groupManagementIntegration, authorizedMethodOptions);

    // /groups/{groupId}
    const groupResource = groupsResource.addResource('{groupId}');
    groupResource.addMethod('GET', groupManagementIntegration, authorizedMethodOptions);
    groupResource.addMethod('PUT', groupManagementIntegration, authorizedMethodOptions);
    groupResource.addMethod('DELETE', groupManagementIntegration, authorizedMethodOptions);

    // /groups/{groupId}/members
    const groupMembersResource = groupResource.addResource('members');
    groupMembersResource.addMethod('GET', groupManagementIntegration, authorizedMethodOptions);
    groupMembersResource.addMethod('POST', groupManagementIntegration, authorizedMethodOptions);
    groupMembersResource.addMethod('DELETE', groupManagementIntegration, authorizedMethodOptions);

    // /groups/{groupId}/members/{userId} — the frontend removes members via
    // DELETE on the specific member resource.
    const groupMemberResource = groupMembersResource.addResource('{userId}');
    groupMemberResource.addMethod('DELETE', groupManagementIntegration, authorizedMethodOptions);

    // /groups/{groupId}/evaluate-rules
    const evaluateRulesResource = groupResource.addResource('evaluate-rules');
    evaluateRulesResource.addMethod('POST', groupManagementIntegration, authorizedMethodOptions);

    // /groups/{groupId}/packages
    const groupPackagesResource = groupResource.addResource('packages');
    groupPackagesResource.addMethod('GET', groupPackageIntegration, authorizedMethodOptions);
    groupPackagesResource.addMethod('POST', groupPackageIntegration, authorizedMethodOptions);

    // /groups/{groupId}/packages/{packageId}
    const groupPackageResource = groupPackagesResource.addResource('{packageId}');
    groupPackageResource.addMethod('PUT', groupPackageIntegration, authorizedMethodOptions);
    groupPackageResource.addMethod('DELETE', groupPackageIntegration, authorizedMethodOptions);

    // /group-audit-logs resource
    const groupAuditLogsResource = this.adminApi.root.addResource('group-audit-logs');
    groupAuditLogsResource.addMethod('GET', groupManagementIntegration, authorizedMethodOptions);

    // /permissions resource
    const permissionsResource = this.adminApi.root.addResource('permissions');
    permissionsResource.addMethod('GET', cognitoAdminIntegration, authorizedMethodOptions);

    // /audit-logs resource
    const auditLogsResource = this.adminApi.root.addResource('audit-logs');
    auditLogsResource.addMethod('GET', cognitoAdminIntegration, authorizedMethodOptions);
    auditLogsResource.addMethod('POST', cognitoAdminIntegration, authorizedMethodOptions);

    // /security-groups resource
    const securityGroupsResource = this.adminApi.root.addResource('security-groups');
    securityGroupsResource.addMethod('GET', securityGroupIntegration, authorizedMethodOptions);
    securityGroupsResource.addMethod('POST', securityGroupIntegration, authorizedMethodOptions);

    // /security-groups/{sgId}
    const sgResource = securityGroupsResource.addResource('{sgId}');
    sgResource.addMethod('GET', securityGroupIntegration, authorizedMethodOptions);
    sgResource.addMethod('DELETE', securityGroupIntegration, authorizedMethodOptions);

    // /security-groups/add-rule
    const addRuleResource = securityGroupsResource.addResource('add-rule');
    addRuleResource.addMethod('POST', securityGroupIntegration, authorizedMethodOptions);

    // /security-groups/remove-rule
    const removeRuleResource = securityGroupsResource.addResource('remove-rule');
    removeRuleResource.addMethod('POST', securityGroupIntegration, authorizedMethodOptions);

    // /security-groups/common-ports
    const commonPortsResource = securityGroupsResource.addResource('common-ports');
    commonPortsResource.addMethod('GET', securityGroupIntegration, authorizedMethodOptions);

    // /security-groups/workstations
    const sgWorkstationsResource = securityGroupsResource.addResource('workstations');
    sgWorkstationsResource.addMethod('GET', securityGroupIntegration, authorizedMethodOptions);

    // /security-groups/attach-to-workstation
    const attachToWorkstationResource = securityGroupsResource.addResource('attach-to-workstation');
    attachToWorkstationResource.addMethod('POST', securityGroupIntegration, authorizedMethodOptions);

    // /security-groups/allow-my-ip
    const allowMyIpResource = securityGroupsResource.addResource('allow-my-ip');
    allowMyIpResource.addMethod('POST', securityGroupIntegration, authorizedMethodOptions);

    // /validate-ami resource
    const validateAmiResource = this.adminApi.root.addResource('validate-ami');
    validateAmiResource.addMethod('GET', amiValidationIntegration, authorizedMethodOptions);
    validateAmiResource.addMethod('POST', amiValidationIntegration, authorizedMethodOptions);

    // /instance-types resource
    const instanceTypesResource = this.adminApi.root.addResource('instance-types');
    instanceTypesResource.addMethod('GET', instanceTypeIntegration, authorizedMethodOptions);
    instanceTypesResource.addMethod('PUT', instanceTypeIntegration, authorizedMethodOptions);

    // /instance-types/discover
    const discoverInstanceTypesResource = instanceTypesResource.addResource('discover');
    discoverInstanceTypesResource.addMethod('POST', instanceTypeIntegration, authorizedMethodOptions);
    discoverInstanceTypesResource.addMethod('GET', instanceTypeIntegration, authorizedMethodOptions);

    // /bootstrap-packages resource
    const bootstrapPackagesResource = this.adminApi.root.addResource('bootstrap-packages');
    bootstrapPackagesResource.addMethod('GET', bootstrapConfigIntegration, authorizedMethodOptions);
    bootstrapPackagesResource.addMethod('POST', bootstrapConfigIntegration, authorizedMethodOptions);

    // /bootstrap-packages/uploads — declared before {packageId} for clarity;
    // API Gateway matches the literal segment ahead of the path parameter
    // regardless of declaration order.
    const packageUploadIntegration = new apigateway.LambdaIntegration(packageUploadServiceFunction, integrationOptions);
    const packageUploadsResource = bootstrapPackagesResource.addResource('uploads');
    packageUploadsResource.addMethod('POST', packageUploadIntegration, authorizedMethodOptions);

    // /bootstrap-packages/uploads/{packageId}
    const packageUploadResource = packageUploadsResource.addResource('{packageId}');
    packageUploadResource.addMethod('DELETE', packageUploadIntegration, authorizedMethodOptions);

    // /bootstrap-packages/uploads/{packageId}/parts
    const packageUploadPartsResource = packageUploadResource.addResource('parts');
    packageUploadPartsResource.addMethod('POST', packageUploadIntegration, authorizedMethodOptions);

    // /bootstrap-packages/uploads/{packageId}/complete
    const packageUploadCompleteResource = packageUploadResource.addResource('complete');
    packageUploadCompleteResource.addMethod('POST', packageUploadIntegration, authorizedMethodOptions);

    // /bootstrap-packages/{packageId}
    const bootstrapPackageResource = bootstrapPackagesResource.addResource('{packageId}');
    bootstrapPackageResource.addMethod('GET', bootstrapConfigIntegration, authorizedMethodOptions);
    bootstrapPackageResource.addMethod('PUT', bootstrapConfigIntegration, authorizedMethodOptions);
    bootstrapPackageResource.addMethod('DELETE', bootstrapConfigIntegration, authorizedMethodOptions);

    // /bootstrap-packages/{packageId}/review — approve, reject or trial-install.
    // One resource rather than three: the admin API stack is close to the
    // CloudFormation 500-resource ceiling.
    const bootstrapPackageReviewResource = bootstrapPackageResource.addResource('review');
    bootstrapPackageReviewResource.addMethod('POST', packageUploadIntegration, authorizedMethodOptions);

    // /storage resource
    const storageResource = this.adminApi.root.addResource('storage');

    // /storage/config
    const storageConfigResource = storageResource.addResource('config');
    storageConfigResource.addMethod('GET', storageIntegration, authorizedMethodOptions);

    // /storage/list
    const storageListResource = storageResource.addResource('list');
    storageListResource.addMethod('GET', storageIntegration, authorizedMethodOptions);

    // /storage/download
    const storageDownloadResource = storageResource.addResource('download');
    storageDownloadResource.addMethod('GET', storageIntegration, authorizedMethodOptions);

    // /storage/upload-url
    const storageUploadUrlResource = storageResource.addResource('upload-url');
    storageUploadUrlResource.addMethod('POST', storageIntegration, authorizedMethodOptions);

    // /storage/delete
    const storageDeleteResource = storageResource.addResource('delete');
    storageDeleteResource.addMethod('DELETE', storageIntegration, authorizedMethodOptions);

    // /storage/filesystems
    const storageFileSystemsResource = storageResource.addResource('filesystems');
    storageFileSystemsResource.addMethod('GET', storageIntegration, authorizedMethodOptions);

    // /storage/filesystem
    const storageFileSystemResource = storageResource.addResource('filesystem');
    storageFileSystemResource.addMethod('DELETE', storageIntegration, authorizedMethodOptions);

    // /ec2 resource - EC2 instance discovery and import
    const ec2Resource = this.adminApi.root.addResource('ec2');

    // /ec2/families
    const ec2FamiliesResource = ec2Resource.addResource('families');
    ec2FamiliesResource.addMethod('GET', ec2DiscoveryIntegration, authorizedMethodOptions);

    // /ec2/suggestions
    const ec2SuggestionsResource = ec2Resource.addResource('suggestions');

    // /ec2/suggestions/names
    const ec2NameSuggestionsResource = ec2SuggestionsResource.addResource('names');
    ec2NameSuggestionsResource.addMethod('GET', ec2DiscoveryIntegration, authorizedMethodOptions);

    // /ec2/suggestions/types
    const ec2TypeSuggestionsResource = ec2SuggestionsResource.addResource('types');
    ec2TypeSuggestionsResource.addMethod('GET', ec2DiscoveryIntegration, authorizedMethodOptions);

    // /ec2/discover
    const ec2DiscoverResource = ec2Resource.addResource('discover');
    ec2DiscoverResource.addMethod('POST', ec2DiscoveryIntegration, authorizedMethodOptions);

    // /ec2/import
    const ec2ImportResource = ec2Resource.addResource('import');
    ec2ImportResource.addMethod('POST', ec2DiscoveryIntegration, authorizedMethodOptions);

    // /ec2/scope resource - Instance scope management
    const ec2ScopeResource = ec2Resource.addResource('scope');

    // /ec2/scope/status - Get all instances with scope status
    const ec2ScopeStatusResource = ec2ScopeResource.addResource('status');
    ec2ScopeStatusResource.addMethod('GET', ec2DiscoveryIntegration, authorizedMethodOptions);

    // /ec2/scope/set - Set instance scope (in-scope or out-of-scope)
    const ec2ScopeSetResource = ec2ScopeResource.addResource('set');
    ec2ScopeSetResource.addMethod('POST', ec2DiscoveryIntegration, authorizedMethodOptions);

    // /ec2/scope/remove - Remove instance from management (make unassigned)
    const ec2ScopeRemoveResource = ec2ScopeResource.addResource('remove');
    ec2ScopeRemoveResource.addMethod('POST', ec2DiscoveryIntegration, authorizedMethodOptions);

    // /admin resource - Admin-specific configuration endpoints
    const adminResource = this.adminApi.root.addResource('admin');

    // /admin/instance-families - Instance family whitelist management
    const instanceFamiliesResource = adminResource.addResource('instance-families');
    instanceFamiliesResource.addMethod('GET', instanceFamilyIntegration, authorizedMethodOptions);
    instanceFamiliesResource.addMethod('POST', instanceFamilyIntegration, authorizedMethodOptions);

    // ============================================
    // Outputs
    // ============================================

    new cdk.CfnOutput(this, 'AdminApiUrl', {
      value: this.adminApi.url,
      description: 'Admin API Gateway URL',
      exportName: 'WorkstationAdminApiUrl',
    });

    new cdk.CfnOutput(this, 'AdminApiId', {
      value: this.adminApi.restApiId,
      description: 'Admin API Gateway ID',
      exportName: 'WorkstationAdminApiId',
    });
  }
}
