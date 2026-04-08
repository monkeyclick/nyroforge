import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';

export interface WorkstationApiStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  tables: {
    workstations: dynamodb.Table;
    costs: dynamodb.Table;
    userSessions: dynamodb.Table;
    userProfiles: dynamodb.Table;
    users: dynamodb.Table;
    roles: dynamodb.Table;
    groups: dynamodb.Table;
    groupMemberships: dynamodb.Table;
    groupAuditLogs: dynamodb.Table;
    auditLogs: dynamodb.Table;
    bootstrapPackages: dynamodb.Table;
    analytics: dynamodb.Table;
    feedback: dynamodb.Table;
    packageQueue: dynamodb.Table;
    groupPackageBindings: dynamodb.Table;
  };
  userPool: cognito.UserPool;
  kmsKey: kms.Key;
}

export class WorkstationApiStack extends cdk.Stack {
  public api: apigateway.RestApi;
  private cognitoAuthorizer: apigateway.CognitoUserPoolsAuthorizer;
  public lambdaFunctions: {
    ec2Management: lambda.Function;
    statusMonitor: lambda.Function;
    costAnalytics: lambda.Function;
    configService: lambda.Function;
    credentialsService: lambda.Function;
    userProfileService: lambda.Function;
    userManagementService: lambda.Function;
    groupManagementService: lambda.Function;
    securityGroupService: lambda.Function;
    cognitoAdminService: lambda.Function;
    amiValidationService: lambda.Function;
    instanceTypeService: lambda.Function;
    bootstrapConfigService: lambda.Function;
    analyticsService: lambda.Function;
    userAttributeChangeProcessor: lambda.Function;
    groupMembershipReconciliation: lambda.Function;
    groupPackageService: lambda.Function;
    storageService: lambda.Function;
  };

  constructor(scope: Construct, id: string, props: WorkstationApiStackProps) {
    super(scope, id, props);

    // Create Lambda functions
    this.createLambdaFunctions(props);

    // Create API Gateway
    this.createApiGateway(props);

    // Create authorizers
    this.createAuthorizers(props);

    // Create API resources and methods
    this.createApiResources(props);

    // Create EventBridge rule for auto-termination
    this.createAutoTerminationSchedule();

    // Output API endpoint
    this.createOutputs();
  }

  private createLambdaFunctions(props: WorkstationApiStackProps): void {
    // Import bootstrap packages table by name (manually created outside CDK)
    const bootstrapPackagesTable = dynamodb.Table.fromTableName(
      this,
      'ImportedBootstrapPackagesTable',
      'WorkstationBootstrapPackages'
    );

    // Import analytics tables by name (manually created outside CDK)
    const analyticsTable = dynamodb.Table.fromTableName(
      this,
      'ImportedAnalyticsTable',
      'UserAnalytics'
    );

    const feedbackTable = dynamodb.Table.fromTableName(
      this,
      'ImportedFeedbackTable',
      'UserFeedback'
    );

    // Common Lambda configuration
    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      logRetention: logs.RetentionDays.ONE_MONTH,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      handler: 'index.handler',
      environment: {
        WORKSTATIONS_TABLE_NAME: props.tables.workstations.tableName,
        COSTS_TABLE_NAME: props.tables.costs.tableName,
        USER_SESSIONS_TABLE_NAME: props.tables.userSessions.tableName,
        USER_PROFILES_TABLE: props.tables.userProfiles.tableName,
        USERS_TABLE: props.tables.users.tableName,
        ROLES_TABLE: props.tables.roles.tableName,
        GROUPS_TABLE: props.tables.groups.tableName,
        GROUP_MEMBERSHIPS_TABLE: props.tables.groupMemberships.tableName,
        GROUP_AUDIT_LOGS_TABLE: props.tables.groupAuditLogs.tableName,
        AUDIT_TABLE: props.tables.auditLogs.tableName,
        BOOTSTRAP_PACKAGES_TABLE: bootstrapPackagesTable.tableName,
        ANALYTICS_TABLE_NAME: analyticsTable.tableName,
        FEEDBACK_TABLE_NAME: feedbackTable.tableName,
        PACKAGE_QUEUE_TABLE: props.tables.packageQueue.tableName,
        GROUP_PACKAGE_BINDINGS_TABLE: props.tables.groupPackageBindings.tableName,
        USER_POOL_ID: props.userPool.userPoolId,
        KMS_KEY_ID: props.kmsKey.keyId,
        VPC_ID: props.vpc.vpcId,
      },
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
    };

    // EC2 Management Lambda
    const ec2ManagementFunction = new lambda.Function(this, 'EC2ManagementFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-EC2Management',
      code: lambda.Code.fromAsset('dist/lambda/ec2-management'),
      description: 'Manages EC2 workstation lifecycle (launch, terminate, status)',
    });

    // Status Monitor Lambda
    const statusMonitorFunction = new lambda.Function(this, 'StatusMonitorFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-StatusMonitor',
      code: lambda.Code.fromAsset('dist/lambda/status-monitor'),
      description: 'Monitors workstation status and provides dashboard data',
    });

    // Cost Analytics Lambda
    const costAnalyticsFunction = new lambda.Function(this, 'CostAnalyticsFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-CostAnalytics',
      code: lambda.Code.fromAsset('dist/lambda/cost-analytics'),
      description: 'Provides cost tracking and analytics data',
      timeout: cdk.Duration.minutes(10), // Cost API can be slow
    });

    // Configuration Service Lambda
    const configServiceFunction = new lambda.Function(this, 'ConfigServiceFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-ConfigService',
      code: lambda.Code.fromAsset('dist/lambda/config-service'),
      description: 'Provides configuration data (regions, instance types, etc.)',
      timeout: cdk.Duration.minutes(2),
    });

    // Credentials Service Lambda
    const credentialsServiceFunction = new lambda.Function(this, 'CredentialsServiceFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-CredentialsService',
      code: lambda.Code.fromAsset('dist/lambda/credentials-service'),
      description: 'Manages workstation credentials and domain join operations',
    });

    // User Profile Service Lambda
    const userProfileServiceFunction = new lambda.Function(this, 'UserProfileServiceFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-UserProfileService',
      code: lambda.Code.fromAsset('dist/lambda/user-profile-service'),
      description: 'Manages user profiles and preferences',
      timeout: cdk.Duration.minutes(1),
    });

    // User Management Service Lambda
    const userManagementServiceFunction = new lambda.Function(this, 'UserManagementServiceFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-UserManagementService',
      code: lambda.Code.fromAsset('dist/lambda/user-management-service'),
      description: 'Manages users and roles',
      timeout: cdk.Duration.minutes(2),
    });

    // Group Management Service Lambda
    const groupManagementServiceFunction = new lambda.Function(this, 'GroupManagementServiceFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-GroupManagementService',
      code: lambda.Code.fromAsset('dist/lambda/group-management-service'),
      description: 'Manages groups, memberships and dynamic rules',
      timeout: cdk.Duration.minutes(2),
    });

    // Security Group Service Lambda
    const securityGroupServiceFunction = new lambda.Function(this, 'SecurityGroupServiceFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-SecurityGroupService',
      code: lambda.Code.fromAsset('dist/lambda/security-group-service'),
      description: 'Manages security groups and firewall rules',
      timeout: cdk.Duration.minutes(2),
    });

    // Cognito Admin Service Lambda
    const cognitoAdminServiceFunction = new lambda.Function(this, 'CognitoAdminServiceFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-CognitoAdminService',
      code: lambda.Code.fromAsset('dist/lambda/cognito-admin-service'),
      description: 'Handles Cognito user management operations for admins',
      timeout: cdk.Duration.minutes(2),
    });

    // AMI Validation Service Lambda
    const amiValidationServiceFunction = new lambda.Function(this, 'AmiValidationServiceFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-AmiValidationService',
      code: lambda.Code.fromAsset('dist/lambda/ami-validation-service'),
      description: 'Validates AMI availability in AWS account and region',
      timeout: cdk.Duration.minutes(1),
    });

    // Instance Type Service Lambda
    const instanceTypeServiceFunction = new lambda.Function(this, 'InstanceTypeServiceFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-InstanceTypeService',
      code: lambda.Code.fromAsset('dist/lambda/instance-type-service'),
      description: 'Manages allowed EC2 instance types and discovers new types',
      timeout: cdk.Duration.minutes(3),
    });

    // Bootstrap Config Service Lambda
    const bootstrapConfigServiceFunction = new lambda.Function(this, 'BootstrapConfigServiceFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-BootstrapConfigService',
      code: lambda.Code.fromAsset('dist/lambda/bootstrap-config-service'),
      description: 'Manages bootstrap packages for driver and software installation',
      timeout: cdk.Duration.minutes(2),
    });

    // Analytics Service Lambda
    const analyticsServiceFunction = new lambda.Function(this, 'AnalyticsServiceFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-AnalyticsService',
      code: lambda.Code.fromAsset('dist/lambda/analytics-service'),
      description: 'Tracks user analytics and manages feedback submissions',
      timeout: cdk.Duration.minutes(2),
    });

    // User Attribute Change Processor Lambda (DynamoDB Stream processor)
    const userAttributeChangeProcessorFunction = new lambda.Function(this, 'UserAttributeChangeProcessorFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-UserAttributeChangeProcessor',
      code: lambda.Code.fromAsset('dist/lambda/user-attribute-change-processor'),
      description: 'Processes user attribute changes and updates dynamic group memberships',
      timeout: cdk.Duration.minutes(5),
      reservedConcurrentExecutions: 10, // Limit concurrent executions for stream processing
    });

    // Add DynamoDB stream event source to process user changes
    userAttributeChangeProcessorFunction.addEventSource(new DynamoEventSource(props.tables.users, {
      startingPosition: lambda.StartingPosition.LATEST,
      batchSize: 10,
      maxBatchingWindow: cdk.Duration.seconds(5),
      retryAttempts: 3,
      bisectBatchOnError: true,
      reportBatchItemFailures: true,
    }));

    // Group Membership Reconciliation Lambda (Scheduled full re-evaluation)
    const groupMembershipReconciliationFunction = new lambda.Function(this, 'GroupMembershipReconciliationFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-GroupMembershipReconciliation',
      code: lambda.Code.fromAsset('dist/lambda/group-membership-reconciliation'),
      description: 'Scheduled reconciliation of group memberships against dynamic rules',
      timeout: cdk.Duration.minutes(15), // Longer timeout for processing all users
      memorySize: 1024, // More memory for batch processing
    });

    // Group Package Service Lambda
    const groupPackageServiceFunction = new lambda.Function(this, 'GroupPackageServiceFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-GroupPackageService',
      code: lambda.Code.fromAsset('dist/lambda/group-package-service'),
      description: 'Manages group package bindings and installation queue',
      timeout: cdk.Duration.minutes(2),
    });

    // Storage Service Lambda
    const storageServiceFunction = new lambda.Function(this, 'StorageServiceFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-StorageService',
      code: lambda.Code.fromAsset('dist/lambda/storage-service'),
      description: 'Manages S3 file transfers and EFS storage operations',
      timeout: cdk.Duration.minutes(5),
      environment: {
        ...commonLambdaProps.environment,
        ENVIRONMENT: process.env.ENVIRONMENT || 'dev',
      },
    });

    // Grant permissions to Lambda functions
    this.grantLambdaPermissions(props, {
      ec2Management: ec2ManagementFunction,
      statusMonitor: statusMonitorFunction,
      costAnalytics: costAnalyticsFunction,
      configService: configServiceFunction,
      credentialsService: credentialsServiceFunction,
      userProfileService: userProfileServiceFunction,
      userManagementService: userManagementServiceFunction,
      groupManagementService: groupManagementServiceFunction,
      securityGroupService: securityGroupServiceFunction,
      cognitoAdminService: cognitoAdminServiceFunction,
      amiValidationService: amiValidationServiceFunction,
      instanceTypeService: instanceTypeServiceFunction,
      bootstrapConfigService: bootstrapConfigServiceFunction,
      analyticsService: analyticsServiceFunction,
      userAttributeChangeProcessor: userAttributeChangeProcessorFunction,
      groupMembershipReconciliation: groupMembershipReconciliationFunction,
      groupPackageService: groupPackageServiceFunction,
      storageService: storageServiceFunction,
    });

    // Store functions for later use
    this.lambdaFunctions = {
      ec2Management: ec2ManagementFunction,
      statusMonitor: statusMonitorFunction,
      costAnalytics: costAnalyticsFunction,
      configService: configServiceFunction,
      credentialsService: credentialsServiceFunction,
      userProfileService: userProfileServiceFunction,
      userManagementService: userManagementServiceFunction,
      groupManagementService: groupManagementServiceFunction,
      securityGroupService: securityGroupServiceFunction,
      cognitoAdminService: cognitoAdminServiceFunction,
      amiValidationService: amiValidationServiceFunction,
      instanceTypeService: instanceTypeServiceFunction,
      bootstrapConfigService: bootstrapConfigServiceFunction,
      analyticsService: analyticsServiceFunction,
      userAttributeChangeProcessor: userAttributeChangeProcessorFunction,
      groupMembershipReconciliation: groupMembershipReconciliationFunction,
      groupPackageService: groupPackageServiceFunction,
      storageService: storageServiceFunction,
    };
  }

  private grantLambdaPermissions(props: WorkstationApiStackProps, functions: any): void {
    // Import bootstrap packages table by name
    const bootstrapPackagesTable = dynamodb.Table.fromTableName(
      this,
      'ImportedBootstrapPackagesTableForPermissions',
      'WorkstationBootstrapPackages'
    );

    // Import analytics tables by name
    const analyticsTable = dynamodb.Table.fromTableName(
      this,
      'ImportedAnalyticsTableForPermissions',
      'UserAnalytics'
    );

    const feedbackTable = dynamodb.Table.fromTableName(
      this,
      'ImportedFeedbackTableForPermissions',
      'UserFeedback'
    );

    // DynamoDB permissions
    Object.values(functions).forEach((func) => {
      const lambdaFunction = func as lambda.Function;
      props.tables.workstations.grantReadWriteData(lambdaFunction);
      props.tables.costs.grantReadWriteData(lambdaFunction);
      props.tables.userSessions.grantReadWriteData(lambdaFunction);
      props.tables.userProfiles.grantReadWriteData(lambdaFunction);
      props.tables.users.grantReadWriteData(lambdaFunction);
      props.tables.roles.grantReadWriteData(lambdaFunction);
      props.tables.groups.grantReadWriteData(lambdaFunction);
      props.tables.groupMemberships.grantReadWriteData(lambdaFunction);
      props.tables.groupAuditLogs.grantReadWriteData(lambdaFunction);
      props.tables.auditLogs.grantReadWriteData(lambdaFunction);
      bootstrapPackagesTable.grantReadWriteData(lambdaFunction);
      analyticsTable.grantReadWriteData(lambdaFunction);
      feedbackTable.grantReadWriteData(lambdaFunction);
      props.tables.packageQueue.grantReadWriteData(lambdaFunction);
      props.tables.groupPackageBindings.grantReadWriteData(lambdaFunction);
    });

    // EC2 Management specific permissions — Describe actions require resources: ['*']
    functions.ec2Management.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ec2:DescribeInstances',
        'ec2:DescribeInstanceStatus',
        'ec2:DescribeImages',
        'ec2:DescribeSubnets',
        'ec2:DescribeSecurityGroups',
        'ec2:DescribeInstanceAttribute',
      ],
      resources: ['*'],
    }));
    // EC2 mutating actions scoped to project-tagged resources
    functions.ec2Management.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ec2:RunInstances',
        'ec2:TerminateInstances',
        'ec2:StopInstances',
        'ec2:StartInstances',
        'ec2:CreateTags',
        'ec2:ModifyInstanceAttribute',
        'ec2:AuthorizeSecurityGroupIngress',
      ],
      resources: ['*'],
      conditions: {
        'StringEquals': {
          'aws:ResourceTag/Project': 'NyroForge',
        }
      }
    }));

    functions.ec2Management.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ssm:SendCommand',
        'ssm:GetCommandInvocation',
      ],
      resources: ['*'], // ssm:SendCommand targets instances; GetCommandInvocation is not resource-scoped
    }));
    functions.ec2Management.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ssm:GetParameter',
        'ssm:GetParameters',
        'ssm:GetParametersByPath',
      ],
      resources: [
        `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter/workstation/*`,
      ],
    }));

    functions.ec2Management.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'secretsmanager:CreateSecret',
        'secretsmanager:GetSecretValue',
        'secretsmanager:PutSecretValue',
        'secretsmanager:UpdateSecret',
        'secretsmanager:TagResource',
      ],
      resources: [`arn:aws:secretsmanager:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:secret:workstation/*`],
    }));

    functions.ec2Management.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'iam:PassRole',
      ],
      resources: [`arn:aws:iam::${cdk.Stack.of(this).account}:role/WorkstationInfrastructure-WorkstationInstanceRole*`],
    }));

    // Status Monitor specific permissions — Describe/CloudWatch actions require resources: ['*']
    functions.statusMonitor.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ec2:DescribeInstances',
        'ec2:DescribeInstanceStatus',
        'cloudwatch:GetMetricStatistics',
        'cloudwatch:ListMetrics',
      ],
      resources: ['*'],
    }));
    // TerminateInstances scoped to project-tagged resources
    functions.statusMonitor.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ec2:TerminateInstances',
      ],
      resources: ['*'],
      conditions: {
        'StringEquals': {
          'aws:ResourceTag/Project': 'NyroForge',
        }
      }
    }));

    // Cost Analytics specific permissions
    functions.costAnalytics.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ce:GetCostAndUsage',
        'ce:GetUsageReport',
        'ce:GetCostCategories',
        'ce:GetDimensionValues',
        'ce:GetReservationCoverage',
        'ce:GetReservationPurchaseRecommendation',
        'ce:GetReservationUtilization',
        'ce:ListCostCategoryDefinitions',
      ],
      resources: ['*'],
    }));

    // Config Service specific permissions — EC2 Describe actions require resources: ['*']
    functions.configService.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ec2:DescribeRegions',
        'ec2:DescribeAvailabilityZones',
        'ec2:DescribeInstanceTypes',
        'ec2:DescribeImages',
      ],
      resources: ['*'],
    }));
    functions.configService.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ssm:GetParameter',
        'ssm:GetParameters',
        'ssm:GetParametersByPath',
      ],
      resources: [
        `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter/workstation/*`,
      ],
    }));

    // Credentials Service specific permissions
    functions.credentialsService.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'secretsmanager:CreateSecret',
        'secretsmanager:GetSecretValue',
        'secretsmanager:PutSecretValue',
        'secretsmanager:UpdateSecret',
        'secretsmanager:DeleteSecret',
        'secretsmanager:TagResource',
        'secretsmanager:UntagResource',
      ],
      resources: [`arn:aws:secretsmanager:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:secret:workstation/*`],
    }));

    // User Management Service specific permissions
    functions.userManagementService.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminDeleteUser',
        'cognito-idp:AdminUpdateUserAttributes',
        'cognito-idp:AdminDisableUser',
        'cognito-idp:AdminEnableUser',
        'cognito-idp:AdminGetUser',
        'cognito-idp:ListUsers',
        'cognito-idp:AdminSetUserPassword',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminRemoveUserFromGroup',
      ],
      resources: [props.userPool.userPoolArn],
    }));

    // Security Group Service specific permissions
    functions.securityGroupService.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ec2:DescribeSecurityGroups',
        'ec2:DescribeSecurityGroupRules',
        'ec2:DescribeInstances',
        'ec2:ModifyInstanceAttribute',
        'ec2:AuthorizeSecurityGroupIngress',
        'ec2:AuthorizeSecurityGroupEgress',
        'ec2:RevokeSecurityGroupIngress',
        'ec2:RevokeSecurityGroupEgress',
        'ec2:CreateSecurityGroup',
        'ec2:DeleteSecurityGroup',
        'ec2:ModifySecurityGroupRules',
        'ec2:UpdateSecurityGroupRuleDescriptionsIngress',
        'ec2:UpdateSecurityGroupRuleDescriptionsEgress',
        'ec2:CreateTags',
      ],
      resources: ['*'],
    }));

    // Cognito Admin Service specific permissions
    functions.cognitoAdminService.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cognito-idp:ListUsers',
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminDeleteUser',
        'cognito-idp:AdminGetUser',
        'cognito-idp:AdminUpdateUserAttributes',
        'cognito-idp:AdminDisableUser',
        'cognito-idp:AdminEnableUser',
        'cognito-idp:AdminSetUserPassword',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminRemoveUserFromGroup',
        'cognito-idp:AdminListGroupsForUser',
        'cognito-idp:ListGroups',
        'cognito-idp:GetGroup',
      ],
      resources: [props.userPool.userPoolArn],
    }));

    // AMI Validation Service specific permissions
    functions.amiValidationService.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ec2:DescribeImages',
        'ec2:DescribeRegions',
      ],
      resources: ['*'],
    }));

    // Instance Type Service specific permissions — EC2 Describe actions require resources: ['*']
    functions.instanceTypeService.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ec2:DescribeInstanceTypes',
        'ec2:DescribeRegions',
      ],
      resources: ['*'],
    }));
    functions.instanceTypeService.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ssm:GetParameter',
        'ssm:PutParameter',
      ],
      resources: [
        `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter/workstation/*`,
      ],
    }));

    // Storage Service specific permissions — scoped to workstation buckets; DeleteBucket removed
    functions.storageService.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:ListAllMyBuckets',
      ],
      resources: ['*'], // s3:ListAllMyBuckets requires resource: '*'
    }));
    functions.storageService.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:ListBucket',
        's3:GetBucketLocation',
        's3:HeadBucket',
        's3:ListBucketVersions',
      ],
      resources: [`arn:aws:s3:::nyroforge-workstation-*`],
    }));
    functions.storageService.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:PutObject',
        's3:DeleteObject',
        's3:HeadObject',
        's3:DeleteObjectVersion',
      ],
      resources: [`arn:aws:s3:::nyroforge-workstation-*/*`],
    }));

    functions.storageService.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ssm:GetParameter',
        'ssm:GetParameters',
        'ssm:GetParametersByPath',
        'ssm:DeleteParameter',
        'ssm:PutParameter',
      ],
      resources: [`arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter/*`],
    }));

    // EFS read-only (Describe actions require resources: ['*'])
    functions.storageService.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'elasticfilesystem:DescribeFileSystems',
        'elasticfilesystem:DescribeMountTargets',
        'elasticfilesystem:DescribeAccessPoints',
      ],
      resources: ['*'],
    }));
    // EFS delete actions scoped to project-tagged resources
    functions.storageService.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'elasticfilesystem:DeleteFileSystem',
        'elasticfilesystem:DeleteMountTarget',
        'elasticfilesystem:DeleteAccessPoint',
      ],
      resources: ['*'],
      conditions: {
        'StringEquals': {
          'aws:ResourceTag/Project': 'NyroForge',
        }
      }
    }));

    // FSx permissions for Storage Service — read-only actions require resources: ['*']
    functions.storageService.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'fsx:DescribeFileSystems',
        'fsx:DescribeVolumes',
        'fsx:DescribeStorageVirtualMachines',
      ],
      resources: ['*'],
    }));
    // FSx delete actions scoped to project-tagged resources
    functions.storageService.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'fsx:DeleteFileSystem',
        'fsx:DeleteVolume',
        'fsx:DeleteStorageVirtualMachine',
      ],
      resources: ['*'],
      conditions: {
        'StringEquals': {
          'aws:ResourceTag/Project': 'NyroForge',
        }
      }
    }));

    // KMS permissions for all functions
    Object.values(functions).forEach((func) => {
      const lambdaFunction = func as lambda.Function;
      props.kmsKey.grantDecrypt(lambdaFunction);
    });
  }

  private createApiGateway(props: WorkstationApiStackProps): void {
    const api = new apigateway.RestApi(this, 'WorkstationApi', {
      restApiName: 'Media Workstation Management API',
      description: 'API for managing media workstations',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS, // TODO: Restrict to specific CloudFront domain in production
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
      },
      deployOptions: {
        stageName: 'api',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: false, // Disabled to prevent logging sensitive request/response data
        metricsEnabled: true,
      },
      cloudWatchRole: true,
    });

    // Add usage plan for rate limiting
    const usagePlan = api.addUsagePlan('WorkstationApiUsagePlan', {
      name: 'MediaWorkstationUsagePlan',
      description: 'Usage plan for Media Workstation API',
      throttle: {
        rateLimit: 100,
        burstLimit: 200,
      },
      quota: {
        limit: 10000,
        period: apigateway.Period.DAY,
      },
    });

    usagePlan.addApiStage({
      stage: api.deploymentStage,
    });

    // Store API for later use
    this.api = api;
  }

  private createAuthorizers(props: WorkstationApiStackProps): void {
    // Cognito authorizer
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [props.userPool],
      identitySource: 'method.request.header.Authorization',
      authorizerName: 'WorkstationCognitoAuthorizer',
    });

    // Store authorizer for use in API methods
    this.cognitoAuthorizer = cognitoAuthorizer;
  }

  private createApiResources(props: WorkstationApiStackProps): void {
    const authorizer = this.cognitoAuthorizer;

    // Request validators
    const requestValidator = new apigateway.RequestValidator(this, 'RequestValidator', {
      restApi: this.api,
      validateRequestBody: true,
      validateRequestParameters: true,
    });

    // /workstations resource
    const workstationsResource = this.api.root.addResource('workstations');
    
    // GET /workstations - List all workstations
    workstationsResource.addMethod('GET', 
      new apigateway.LambdaIntegration(this.lambdaFunctions.ec2Management), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestParameters: {
          'method.request.querystring.userId': false,
          'method.request.querystring.status': false,
        },
      }
    );

    // POST /workstations - Launch new workstation
    workstationsResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.ec2Management), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
        requestModels: {
          'application/json': this.createLaunchWorkstationModel(),
        },
      }
    );

    // PUT /workstations/reconcile - Reconcile EC2 instances with DynamoDB
    const reconcileResource = workstationsResource.addResource('reconcile');
    reconcileResource.addMethod('PUT',
      new apigateway.LambdaIntegration(this.lambdaFunctions.ec2Management), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /workstations/{workstationId} resource
    const workstationResource = workstationsResource.addResource('{workstationId}');
    
    // GET /workstations/{workstationId} - Get workstation details
    workstationResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.ec2Management), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // DELETE /workstations/{workstationId} - Terminate workstation
    workstationResource.addMethod('DELETE',
      new apigateway.LambdaIntegration(this.lambdaFunctions.ec2Management), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PATCH /workstations/{workstationId} - Update workstation (friendlyName, etc.)
    workstationResource.addMethod('PATCH',
      new apigateway.LambdaIntegration(this.lambdaFunctions.ec2Management), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /workstations/{workstationId}/credentials resource
    const credentialsResource = workstationResource.addResource('credentials');
    credentialsResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.credentialsService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /dashboard resource
    const dashboardResource = this.api.root.addResource('dashboard');
    
    // GET /dashboard/status - Real-time status dashboard
    const statusResource = dashboardResource.addResource('status');
    statusResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.statusMonitor), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /costs resource
    const costsResource = this.api.root.addResource('costs');
    costsResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.costAnalytics), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestParameters: {
          'method.request.querystring.period': false,
          'method.request.querystring.userId': false,
        },
      }
    );

    // /regions resource
    const regionsResource = this.api.root.addResource('regions');
    regionsResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.configService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /instance-types resource
    const instanceTypesResource = this.api.root.addResource('instance-types');
    instanceTypesResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.configService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /profile resource
    const profileResource = this.api.root.addResource('profile');
    
    // GET /profile - Get user profile
    profileResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.userProfileService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PUT /profile - Update user profile
    profileResource.addMethod('PUT',
      new apigateway.LambdaIntegration(this.lambdaFunctions.userProfileService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
        requestModels: {
          'application/json': this.createUserProfileModel(),
        },
      }
    );

    // /preferences resource
    const preferencesResource = this.api.root.addResource('preferences');
    
    // PATCH /preferences - Update user preferences
    preferencesResource.addMethod('PATCH',
      new apigateway.LambdaIntegration(this.lambdaFunctions.userProfileService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
        requestModels: {
          'application/json': this.createUserPreferencesModel(),
        },
      }
    );

    // Admin routes
    const adminResource = this.api.root.addResource('admin');

    // /admin/users resource
    const adminUsersResource = adminResource.addResource('users');
    adminUsersResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.userManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestParameters: {
          'method.request.querystring.page': false,
          'method.request.querystring.limit': false,
          'method.request.querystring.status': false,
          'method.request.querystring.search': false,
          'method.request.querystring.roleId': false,
          'method.request.querystring.groupId': false,
        },
      }
    );

    adminUsersResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.userManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        // Removed requestValidator - Lambda handles validation
      }
    );

    const adminUserResource = adminUsersResource.addResource('{userId}');
    adminUserResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.userManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    adminUserResource.addMethod('PUT',
      new apigateway.LambdaIntegration(this.lambdaFunctions.userManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    adminUserResource.addMethod('DELETE',
      new apigateway.LambdaIntegration(this.lambdaFunctions.userManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /admin/users/{userId}/suspend - Suspend user
    const suspendUserResource = adminUserResource.addResource('suspend');
    suspendUserResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.userManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /admin/users/{userId}/activate - Activate user
    const activateUserResource = adminUserResource.addResource('activate');
    activateUserResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.userManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /admin/roles resource
    const adminRolesResource = adminResource.addResource('roles');
    adminRolesResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.userManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    adminRolesResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.userManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    const adminRoleResource = adminRolesResource.addResource('{roleId}');
    adminRoleResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.userManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    adminRoleResource.addMethod('PUT',
      new apigateway.LambdaIntegration(this.lambdaFunctions.userManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    adminRoleResource.addMethod('DELETE',
      new apigateway.LambdaIntegration(this.lambdaFunctions.userManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /admin/groups resource
    const adminGroupsResource = adminResource.addResource('groups');
    adminGroupsResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.groupManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    adminGroupsResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.groupManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    const adminGroupResource = adminGroupsResource.addResource('{groupId}');
    adminGroupResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.groupManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    adminGroupResource.addMethod('PUT',
      new apigateway.LambdaIntegration(this.lambdaFunctions.groupManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    adminGroupResource.addMethod('DELETE',
      new apigateway.LambdaIntegration(this.lambdaFunctions.groupManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /admin/groups/{groupId}/members resource - Group membership management
    const adminGroupMembersResource = adminGroupResource.addResource('members');
    adminGroupMembersResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.groupManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    adminGroupMembersResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.groupManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    const adminGroupMemberResource = adminGroupMembersResource.addResource('{userId}');
    adminGroupMemberResource.addMethod('DELETE',
      new apigateway.LambdaIntegration(this.lambdaFunctions.groupManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /admin/groups/{groupId}/evaluate-rules - Evaluate dynamic group rules
    const evaluateRulesResource = adminGroupResource.addResource('evaluate-rules');
    evaluateRulesResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.groupManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /admin/group-audit-logs resource - Group audit log management
    const adminGroupAuditLogsResource = adminResource.addResource('group-audit-logs');
    adminGroupAuditLogsResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.groupManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestParameters: {
          'method.request.querystring.groupId': false,
          'method.request.querystring.limit': false,
        },
      }
    );

    // /admin/permissions resource
    const adminPermissionsResource = adminResource.addResource('permissions');
    adminPermissionsResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.userManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /admin/audit-logs resource
    const adminAuditLogsResource = adminResource.addResource('audit-logs');
    adminAuditLogsResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.userManagementService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestParameters: {
          'method.request.querystring.page': false,
          'method.request.querystring.limit': false,
          'method.request.querystring.userId': false,
          'method.request.querystring.action': false,
          'method.request.querystring.resource': false,
          'method.request.querystring.startDate': false,
          'method.request.querystring.endDate': false,
        },
      }
    );

    // /admin/security-groups resource
    const adminSecurityGroupsResource = adminResource.addResource('security-groups');
    adminSecurityGroupsResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.securityGroupService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    adminSecurityGroupsResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.securityGroupService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    const adminSecurityGroupResource = adminSecurityGroupsResource.addResource('{groupId}');
    adminSecurityGroupResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.securityGroupService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    adminSecurityGroupResource.addMethod('DELETE',
      new apigateway.LambdaIntegration(this.lambdaFunctions.securityGroupService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /admin/security-groups/add-rule
    const addRuleResource = adminSecurityGroupsResource.addResource('add-rule');
    addRuleResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.securityGroupService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    // /admin/security-groups/remove-rule
    const removeRuleResource = adminSecurityGroupsResource.addResource('remove-rule');
    removeRuleResource.addMethod('DELETE',
      new apigateway.LambdaIntegration(this.lambdaFunctions.securityGroupService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    // /admin/security-groups/common-ports
    const commonPortsResource = adminSecurityGroupsResource.addResource('common-ports');
    commonPortsResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.securityGroupService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /admin/security-groups/workstations - List workstations for a security group
    const securityGroupWorkstationsResource = adminSecurityGroupsResource.addResource('workstations');
    securityGroupWorkstationsResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.securityGroupService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestParameters: {
          'method.request.querystring.groupId': true,
        },
      }
    );

    // /admin/security-groups/attach-to-workstation - Attach security group to workstation
    const attachToWorkstationResource = adminSecurityGroupsResource.addResource('attach-to-workstation');
    attachToWorkstationResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.securityGroupService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    // /admin/security-groups/allow-my-ip - Add user's IP to workstation security group
    const allowMyIpResource = adminSecurityGroupsResource.addResource('allow-my-ip');
    allowMyIpResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.securityGroupService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    // Cognito Admin API routes
    const cognitoUsersResource = adminResource.addResource('cognito-users');
    cognitoUsersResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.cognitoAdminService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    cognitoUsersResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.cognitoAdminService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    const cognitoUserResource = cognitoUsersResource.addResource('{username}');
    cognitoUserResource.addMethod('DELETE',
      new apigateway.LambdaIntegration(this.lambdaFunctions.cognitoAdminService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    const enableUserResource = cognitoUserResource.addResource('enable');
    enableUserResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.cognitoAdminService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    const disableUserResource = cognitoUserResource.addResource('disable');
    disableUserResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.cognitoAdminService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    const userGroupsResource = cognitoUserResource.addResource('groups');
    userGroupsResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.cognitoAdminService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    userGroupsResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.cognitoAdminService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    const userGroupResource = userGroupsResource.addResource('{groupName}');
    userGroupResource.addMethod('DELETE',
      new apigateway.LambdaIntegration(this.lambdaFunctions.cognitoAdminService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    const cognitoGroupsResource = adminResource.addResource('cognito-groups');
    cognitoGroupsResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.cognitoAdminService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /admin/validate-ami resource
    const validateAmiResource = adminResource.addResource('validate-ami');
    validateAmiResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.amiValidationService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    // /admin/instance-types resource - Manage allowed instance types
    const adminInstanceTypesResource = adminResource.addResource('instance-types');
    
    // GET /admin/instance-types - Get allowed instance types
    adminInstanceTypesResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.instanceTypeService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PUT /admin/instance-types - Update allowed instance types
    adminInstanceTypesResource.addMethod('PUT',
      new apigateway.LambdaIntegration(this.lambdaFunctions.instanceTypeService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    // POST /admin/instance-types/discover - Discover available instance types
    const discoverInstanceTypesResource = adminInstanceTypesResource.addResource('discover');
    discoverInstanceTypesResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.instanceTypeService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /admin/instance-types/discover - Also support GET for convenience
    discoverInstanceTypesResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.instanceTypeService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /admin/bootstrap-packages resource - Manage bootstrap packages
    const adminBootstrapPackagesResource = adminResource.addResource('bootstrap-packages');
    
    // GET /admin/bootstrap-packages - List all packages
    adminBootstrapPackagesResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.bootstrapConfigService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // POST /admin/bootstrap-packages - Create new package
    adminBootstrapPackagesResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.bootstrapConfigService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    const adminBootstrapPackageResource = adminBootstrapPackagesResource.addResource('{packageId}');
    
    // GET /admin/bootstrap-packages/{packageId} - Get package details
    adminBootstrapPackageResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.bootstrapConfigService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // PUT /admin/bootstrap-packages/{packageId} - Update package
    adminBootstrapPackageResource.addMethod('PUT',
      new apigateway.LambdaIntegration(this.lambdaFunctions.bootstrapConfigService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    // DELETE /admin/bootstrap-packages/{packageId} - Delete package
    adminBootstrapPackageResource.addMethod('DELETE',
      new apigateway.LambdaIntegration(this.lambdaFunctions.bootstrapConfigService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /bootstrap-packages resource (user-facing) - List available packages for selection
    const bootstrapPackagesResource = this.api.root.addResource('bootstrap-packages');
    bootstrapPackagesResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.bootstrapConfigService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /analytics resource - User analytics and feedback
    const analyticsResource = this.api.root.addResource('analytics');
    
    // POST /analytics/track - Track user event
    const trackResource = analyticsResource.addResource('track');
    trackResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.analyticsService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    // POST /analytics/feedback - Submit user feedback
    const feedbackResource = analyticsResource.addResource('feedback');
    feedbackResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.analyticsService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    // GET /analytics/feedback - Get feedback list (admin only)
    feedbackResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.analyticsService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestParameters: {
          'method.request.querystring.status': false,
        },
      }
    );

    // GET /analytics/summary - Get analytics summary (admin only)
    const summaryResource = analyticsResource.addResource('summary');
    summaryResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.analyticsService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestParameters: {
          'method.request.querystring.timeframe': false,
        },
      }
    );

    // GET /analytics/user/{userId} - Get user-specific analytics
    const userAnalyticsResource = analyticsResource.addResource('user');
    const userAnalyticsIdResource = userAnalyticsResource.addResource('{userId}');
    userAnalyticsIdResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.analyticsService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /user/group-packages resource - Get packages from user's groups
    const userResource = this.api.root.addResource('user');
    const userGroupPackagesResource = userResource.addResource('group-packages');
    userGroupPackagesResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.groupPackageService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /workstations/{workstationId}/packages resource - Package installation status
    const workstationPackagesResource = workstationResource.addResource('packages');
    workstationPackagesResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.groupPackageService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // POST /workstations/{workstationId}/packages - Add packages to workstation (admin)
    workstationPackagesResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.groupPackageService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    // /workstations/{workstationId}/packages/{packageId} resource
    const workstationPackageResource = workstationPackagesResource.addResource('{packageId}');
    
    // DELETE /workstations/{workstationId}/packages/{packageId} - Remove from queue
    workstationPackageResource.addMethod('DELETE',
      new apigateway.LambdaIntegration(this.lambdaFunctions.groupPackageService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /workstations/{workstationId}/packages/{packageId}/retry - Retry failed installation
    const retryPackageResource = workstationPackageResource.addResource('retry');
    retryPackageResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.groupPackageService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /admin/groups/{groupId}/packages resource - Group package management
    const adminGroupPackagesResource = adminGroupResource.addResource('packages');
    
    // GET /admin/groups/{groupId}/packages - List group packages
    adminGroupPackagesResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.groupPackageService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // POST /admin/groups/{groupId}/packages - Add package to group
    adminGroupPackagesResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.groupPackageService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    // /admin/groups/{groupId}/packages/{packageId} resource
    const adminGroupPackageResource = adminGroupPackagesResource.addResource('{packageId}');
    
    // PUT /admin/groups/{groupId}/packages/{packageId} - Update package settings
    adminGroupPackageResource.addMethod('PUT',
      new apigateway.LambdaIntegration(this.lambdaFunctions.groupPackageService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    // DELETE /admin/groups/{groupId}/packages/{packageId} - Remove package from group
    adminGroupPackageResource.addMethod('DELETE',
      new apigateway.LambdaIntegration(this.lambdaFunctions.groupPackageService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // /admin/storage resource - Storage management
    const adminStorageResource = adminResource.addResource('storage');
    
    // GET /admin/storage/config - Get storage configuration
    const storageConfigResource = adminStorageResource.addResource('config');
    storageConfigResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.storageService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /admin/storage/list - List objects in S3 bucket
    const storageListResource = adminStorageResource.addResource('list');
    storageListResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.storageService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestParameters: {
          'method.request.querystring.prefix': false,
        },
      }
    );

    // GET /admin/storage/download - Get download URL for object
    const storageDownloadResource = adminStorageResource.addResource('download');
    storageDownloadResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.storageService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestParameters: {
          'method.request.querystring.key': true,
        },
      }
    );

    // POST /admin/storage/upload-url - Get presigned upload URL
    const storageUploadUrlResource = adminStorageResource.addResource('upload-url');
    storageUploadUrlResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.storageService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    // DELETE /admin/storage/delete - Delete objects
    const storageDeleteResource = adminStorageResource.addResource('delete');
    storageDeleteResource.addMethod('DELETE',
      new apigateway.LambdaIntegration(this.lambdaFunctions.storageService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    // GET /admin/storage/filesystems - List all deployed file systems
    const storageFileSystemsResource = adminStorageResource.addResource('filesystems');
    storageFileSystemsResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.storageService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // DELETE /admin/storage/filesystem - Delete a file system
    const storageFileSystemResource = adminStorageResource.addResource('filesystem');
    storageFileSystemResource.addMethod('DELETE',
      new apigateway.LambdaIntegration(this.lambdaFunctions.storageService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestValidator,
      }
    );

    // Note: EC2 discovery endpoints are in the separate WorkstationAdminApi stack

    // /health resource (no auth required)
    const healthResource = this.api.root.addResource('health');
    healthResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.statusMonitor)
    );
  }

  private createLaunchWorkstationModel(): apigateway.Model {
    return this.api.addModel('LaunchWorkstationModel', {
      contentType: 'application/json',
      modelName: 'LaunchWorkstation',
      schema: {
        schema: apigateway.JsonSchemaVersion.DRAFT4,
        title: 'Launch Workstation Request',
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          region: {
            type: apigateway.JsonSchemaType.STRING,
            description: 'AWS region for workstation deployment',
          },
          instanceType: {
            type: apigateway.JsonSchemaType.STRING,
            description: 'EC2 instance type (g4dn.xlarge, g5.xlarge, etc.)',
          },
          osVersion: {
            type: apigateway.JsonSchemaType.STRING,
            description: 'Windows Server version',
          },
          authMethod: {
            type: apigateway.JsonSchemaType.STRING,
            enum: ['domain', 'local'],
            description: 'Authentication method: domain join or local admin',
          },
          domainConfig: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
              domainName: { type: apigateway.JsonSchemaType.STRING },
              ouPath: { type: apigateway.JsonSchemaType.STRING },
            },
          },
          localAdminConfig: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
              username: { type: apigateway.JsonSchemaType.STRING },
            },
          },
          autoTerminateHours: {
            type: apigateway.JsonSchemaType.NUMBER,
            description: 'Hours before auto-termination',
          },
          tags: {
            type: apigateway.JsonSchemaType.OBJECT,
            description: 'Additional tags for the workstation',
          },
        },
        required: ['region', 'instanceType', 'osVersion', 'authMethod'],
      },
    });
  }

  private createUserProfileModel(): apigateway.Model {
    return this.api.addModel('UserProfileModel', {
      contentType: 'application/json',
      modelName: 'UserProfile',
      schema: {
        schema: apigateway.JsonSchemaVersion.DRAFT4,
        title: 'User Profile Update Request',
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          defaultRegion: {
            type: apigateway.JsonSchemaType.STRING,
            description: 'Default AWS region for workstation deployment',
          },
          defaultInstanceType: {
            type: apigateway.JsonSchemaType.STRING,
            description: 'Default EC2 instance type',
          },
          defaultAutoTerminateHours: {
            type: apigateway.JsonSchemaType.NUMBER,
            description: 'Default hours before auto-termination',
          },
          preferredWindowsVersion: {
            type: apigateway.JsonSchemaType.STRING,
            description: 'Preferred Windows Server version',
          },
          theme: {
            type: apigateway.JsonSchemaType.STRING,
            enum: ['light', 'dark'],
            description: 'UI theme preference',
          },
          notifications: {
            type: apigateway.JsonSchemaType.BOOLEAN,
            description: 'Enable notifications',
          },
        },
      },
    });
  }

  private createUserPreferencesModel(): apigateway.Model {
    return this.api.addModel('UserPreferencesModel', {
      contentType: 'application/json',
      modelName: 'UserPreferences',
      schema: {
        schema: apigateway.JsonSchemaVersion.DRAFT4,
        title: 'User Preferences Update Request',
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          defaultRegion: {
            type: apigateway.JsonSchemaType.STRING,
            description: 'Default AWS region for workstation deployment',
          },
          defaultInstanceType: {
            type: apigateway.JsonSchemaType.STRING,
            description: 'Default EC2 instance type',
          },
          defaultAutoTerminateHours: {
            type: apigateway.JsonSchemaType.NUMBER,
            description: 'Default hours before auto-termination',
          },
          preferredWindowsVersion: {
            type: apigateway.JsonSchemaType.STRING,
            description: 'Preferred Windows Server version',
          },
          theme: {
            type: apigateway.JsonSchemaType.STRING,
            enum: ['light', 'dark'],
            description: 'UI theme preference',
          },
          notifications: {
            type: apigateway.JsonSchemaType.BOOLEAN,
            description: 'Enable notifications',
          },
        },
      },
    });
  }

  private createAutoTerminationSchedule(): void {
    // Create EventBridge rule to check for expired workstations every 5 minutes
    const autoTerminationRule = new events.Rule(this, 'AutoTerminationRule', {
      ruleName: 'MediaWorkstation-AutoTerminationCheck',
      description: 'Periodically checks for and terminates expired workstations',
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      enabled: true,
    });

    // Add the status monitor Lambda as a target
    autoTerminationRule.addTarget(new targets.LambdaFunction(this.lambdaFunctions.statusMonitor, {
      retryAttempts: 2,
    }));

    // Output the rule ARN
    new cdk.CfnOutput(this, 'AutoTerminationRuleArn', {
      value: autoTerminationRule.ruleArn,
      description: 'EventBridge rule ARN for auto-termination checks',
      exportName: 'AutoTerminationRuleArn',
    });

    // Create EventBridge rule for group membership reconciliation (daily at 2 AM UTC)
    const reconciliationRule = new events.Rule(this, 'GroupMembershipReconciliationRule', {
      ruleName: 'MediaWorkstation-GroupMembershipReconciliation',
      description: 'Daily reconciliation of group memberships against dynamic rules',
      schedule: events.Schedule.cron({
        hour: '2',
        minute: '0',
      }),
      enabled: true,
    });

    // Add the reconciliation Lambda as a target
    reconciliationRule.addTarget(new targets.LambdaFunction(this.lambdaFunctions.groupMembershipReconciliation, {
      retryAttempts: 2,
    }));

    // Output the rule ARN
    new cdk.CfnOutput(this, 'GroupReconciliationRuleArn', {
      value: reconciliationRule.ruleArn,
      description: 'EventBridge rule ARN for group membership reconciliation',
      exportName: 'GroupReconciliationRuleArn',
    });
  }

  private createOutputs(): void {
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.api.url,
      description: 'API Gateway endpoint URL',
      exportName: 'WorkstationApiEndpoint',
    });

    new cdk.CfnOutput(this, 'ApiId', {
      value: this.api.restApiId,
      description: 'API Gateway ID',
      exportName: 'WorkstationApiId',
    });
  }
}