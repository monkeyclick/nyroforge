import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

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
}

export class WorkstationAdminApiStack extends cdk.Stack {
  public readonly adminApi: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: WorkstationAdminApiStackProps) {
    super(scope, id, props);

    const { vpc, tables, userPool, kmsKey } = props;

    // Lambda execution role for admin services
    const adminLambdaRole = new iam.Role(this, 'AdminLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });

    // Add CloudWatch Logs permissions
    adminLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: ['*'],
    }));

    // Add DynamoDB permissions
    adminLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Query',
        'dynamodb:Scan',
        'dynamodb:BatchGetItem',
        'dynamodb:BatchWriteItem',
      ],
      resources: [
        tables.workstations.tableArn,
        `${tables.workstations.tableArn}/index/*`,
        tables.userProfiles.tableArn,
        `${tables.userProfiles.tableArn}/index/*`,
        tables.users.tableArn,
        `${tables.users.tableArn}/index/*`,
        tables.roles.tableArn,
        `${tables.roles.tableArn}/index/*`,
        tables.groups.tableArn,
        `${tables.groups.tableArn}/index/*`,
        tables.groupMemberships.tableArn,
        `${tables.groupMemberships.tableArn}/index/*`,
        tables.groupAuditLogs.tableArn,
        `${tables.groupAuditLogs.tableArn}/index/*`,
        tables.auditLogs.tableArn,
        `${tables.auditLogs.tableArn}/index/*`,
        tables.bootstrapPackages.tableArn,
        `${tables.bootstrapPackages.tableArn}/index/*`,
        tables.analytics.tableArn,
        `${tables.analytics.tableArn}/index/*`,
        tables.groupPackageBindings.tableArn,
        `${tables.groupPackageBindings.tableArn}/index/*`,
        // New tables for user deletion and password management
        tables.deletedUsers.tableArn,
        `${tables.deletedUsers.tableArn}/index/*`,
        tables.passwordResetRecords.tableArn,
        `${tables.passwordResetRecords.tableArn}/index/*`,
        tables.passwordPolicy.tableArn,
        `${tables.passwordPolicy.tableArn}/index/*`,
      ],
    }));

    // Add SES permissions for sending notification emails
    adminLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'ses:SendEmail',
        'ses:SendRawEmail',
        'ses:SendTemplatedEmail',
      ],
      resources: ['*'], // SES doesn't support resource-level permissions for most operations
    }));

    // Add Cognito permissions for user management
    adminLambdaRole.addToPolicy(new iam.PolicyStatement({
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

    // Add EC2 read-only permissions (Describe actions do not support resource-level restrictions)
    adminLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'ec2:DescribeSecurityGroups',
        'ec2:DescribeSecurityGroupRules',
        'ec2:DescribeInstances',
        'ec2:DescribeInstanceTypes',
        'ec2:DescribeImages',
      ],
      resources: ['*'],
      conditions: {
        'StringEquals': {
          'aws:RequestedRegion': cdk.Stack.of(this).region
        }
      }
    }));

    // Add EC2 mutating permissions scoped to project-tagged resources
    adminLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'ec2:AuthorizeSecurityGroupIngress',
        'ec2:AuthorizeSecurityGroupEgress',
        'ec2:RevokeSecurityGroupIngress',
        'ec2:RevokeSecurityGroupEgress',
        'ec2:CreateSecurityGroup',
        'ec2:DeleteSecurityGroup',
        'ec2:ModifySecurityGroupRules',
        'ec2:ModifyInstanceAttribute',
        'ec2:CreateTags',
        'ec2:DeleteTags',
      ],
      resources: ['*'],
      conditions: {
        'StringEquals': {
          'aws:RequestedRegion': cdk.Stack.of(this).region,
          'aws:ResourceTag/Project': 'NyroForge',
        }
      }
    }));

    // Add S3 permissions for storage management scoped to workstation buckets
    adminLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        's3:ListBucket',
        's3:GetBucketLocation',
      ],
      resources: [`arn:aws:s3:::nyroforge-workstation-*`],
    }));
    adminLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        's3:GetObject',
        's3:PutObject',
        's3:DeleteObject',
      ],
      resources: [`arn:aws:s3:::nyroforge-workstation-*/*`],
    }));

    // Add FSx and EFS permissions for storage management scoped to project-tagged resources
    adminLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'fsx:DescribeFileSystems',
        'elasticfilesystem:DescribeFileSystems',
        'elasticfilesystem:DescribeMountTargets',
      ],
      resources: ['*'],
    }));
    adminLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'fsx:DeleteFileSystem',
        'elasticfilesystem:DeleteFileSystem',
        'elasticfilesystem:DeleteMountTarget',
      ],
      resources: ['*'],
      conditions: {
        'StringEquals': {
          'aws:ResourceTag/Project': 'NyroForge',
        }
      }
    }));

    // Add SSM permissions for instance family configuration
    adminLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'ssm:GetParameter',
        'ssm:PutParameter',
        'ssm:DeleteParameter',
      ],
      resources: [`arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter/workstation/*`],
    }));

    // Add KMS permissions
    adminLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'kms:Decrypt',
        'kms:GenerateDataKey',
      ],
      resources: [kmsKey.keyArn],
    }));

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
      // New tables for user deletion and password management
      DELETED_USERS_TABLE: tables.deletedUsers.tableName,
      PASSWORD_RESET_TABLE: tables.passwordResetRecords.tableName,
      PASSWORD_POLICY_TABLE: tables.passwordPolicy.tableName,
      // SES configuration for email notifications
      SES_FROM_EMAIL: process.env.SES_FROM_EMAIL || 'noreply@example.com', // Override via SES_FROM_EMAIL env var
      USER_POOL_ID: userPool.userPoolId,
      KMS_KEY_ID: kmsKey.keyId,
      VPC_ID: vpc.vpcId,
    };

    // Lambda function defaults
    const lambdaDefaults = {
      runtime: lambda.Runtime.NODEJS_20_X,
      logRetention: logs.RetentionDays.ONE_MONTH,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      role: adminLambdaRole,
      environment: commonEnv,
    };

    // ============================================
    // Lambda Functions for Admin APIs
    // ============================================

    // Cognito Admin Service
    const cognitoAdminServiceFunction = new lambda.Function(this, 'CognitoAdminService', {
      ...lambdaDefaults,
      functionName: 'workstation-cognito-admin-service',
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist/lambda/cognito-admin-service')),
      description: 'Handles Cognito user and group administration',
    });

    // Group Management Service
    const groupManagementServiceFunction = new lambda.Function(this, 'GroupManagementService', {
      ...lambdaDefaults,
      functionName: 'workstation-group-management-service',
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist/lambda/group-management-service')),
      description: 'Handles group management operations',
    });

    // Security Group Service
    const securityGroupServiceFunction = new lambda.Function(this, 'SecurityGroupService', {
      ...lambdaDefaults,
      functionName: 'workstation-security-group-service',
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist/lambda/security-group-service')),
      description: 'Handles security group management',
      environment: {
        ...commonEnv,
        VPC_ID: vpc.vpcId,
      },
    });

    // AMI Validation Service
    const amiValidationServiceFunction = new lambda.Function(this, 'AmiValidationService', {
      ...lambdaDefaults,
      functionName: 'workstation-ami-validation-service',
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist/lambda/ami-validation-service')),
      description: 'Validates AMI IDs and retrieves AMI information',
    });

    // Instance Type Service
    const instanceTypeServiceFunction = new lambda.Function(this, 'InstanceTypeService', {
      ...lambdaDefaults,
      functionName: 'workstation-instance-type-service',
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist/lambda/instance-type-service')),
      description: 'Manages allowed instance types',
    });

    // Bootstrap Config Service
    const bootstrapConfigServiceFunction = new lambda.Function(this, 'BootstrapConfigService', {
      ...lambdaDefaults,
      functionName: 'workstation-bootstrap-config-service',
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist/lambda/bootstrap-config-service')),
      description: 'Manages bootstrap package configurations',
    });

    // Group Package Service
    const groupPackageServiceFunction = new lambda.Function(this, 'GroupPackageService', {
      ...lambdaDefaults,
      functionName: 'workstation-group-package-service',
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist/lambda/group-package-service')),
      description: 'Manages group-specific package assignments',
    });

    // Storage Service
    const storageServiceFunction = new lambda.Function(this, 'StorageService', {
      ...lambdaDefaults,
      functionName: 'workstation-storage-service',
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist/lambda/storage-service')),
      description: 'Handles storage management operations',
    });

    // EC2 Discovery Service
    const ec2DiscoveryServiceFunction = new lambda.Function(this, 'Ec2DiscoveryService', {
      ...lambdaDefaults,
      functionName: 'workstation-ec2-discovery-service',
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist/lambda/ec2-discovery-service')),
      description: 'Discovers and imports existing EC2 instances',
    });

    // Instance Family Service
    const instanceFamilyServiceFunction = new lambda.Function(this, 'InstanceFamilyService', {
      ...lambdaDefaults,
      functionName: 'workstation-instance-family-service',
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist/lambda/instance-family-service')),
      description: 'Manages allowed EC2 instance families for deployments',
    });

    // User Management Service (user deletion and password management)
    const userManagementServiceFunction = new lambda.Function(this, 'UserManagementService', {
      ...lambdaDefaults,
      functionName: 'workstation-user-management-service',
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist/lambda/user-management-service')),
      description: 'Handles user deletion (soft/hard) and password management operations',
      timeout: cdk.Duration.seconds(60), // Longer timeout for deletion operations
    });

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

    // Lambda integrations
    const cognitoAdminIntegration = new apigateway.LambdaIntegration(cognitoAdminServiceFunction);
    const groupManagementIntegration = new apigateway.LambdaIntegration(groupManagementServiceFunction);
    const securityGroupIntegration = new apigateway.LambdaIntegration(securityGroupServiceFunction);
    const amiValidationIntegration = new apigateway.LambdaIntegration(amiValidationServiceFunction);
    const instanceTypeIntegration = new apigateway.LambdaIntegration(instanceTypeServiceFunction);
    const bootstrapConfigIntegration = new apigateway.LambdaIntegration(bootstrapConfigServiceFunction);
    const groupPackageIntegration = new apigateway.LambdaIntegration(groupPackageServiceFunction);
    const storageIntegration = new apigateway.LambdaIntegration(storageServiceFunction);
    const ec2DiscoveryIntegration = new apigateway.LambdaIntegration(ec2DiscoveryServiceFunction);
    const instanceFamilyIntegration = new apigateway.LambdaIntegration(instanceFamilyServiceFunction);
    const userManagementIntegration = new apigateway.LambdaIntegration(userManagementServiceFunction);

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

    // /bootstrap-packages/{packageId}
    const bootstrapPackageResource = bootstrapPackagesResource.addResource('{packageId}');
    bootstrapPackageResource.addMethod('GET', bootstrapConfigIntegration, authorizedMethodOptions);
    bootstrapPackageResource.addMethod('PUT', bootstrapConfigIntegration, authorizedMethodOptions);
    bootstrapPackageResource.addMethod('DELETE', bootstrapConfigIntegration, authorizedMethodOptions);

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