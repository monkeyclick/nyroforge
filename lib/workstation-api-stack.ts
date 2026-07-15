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
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { DynamoEventSource, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import { PROJECT_TAG } from './constants';
import { ServiceLambda } from './service-lambda';

export interface WorkstationApiStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
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
    bootstrapConfigService: lambda.Function;
    analyticsService: lambda.Function;
    userAttributeChangeProcessor: lambda.Function;
    groupMembershipReconciliation: lambda.Function;
    groupPackageService: lambda.Function;
  };
  private userAttributeChangeProcessorDlq!: sqs.Queue;

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

    // Alarms on the event-driven Lambdas' DLQs and error rates — previously
    // a failed auto-termination sweep, stream batch, or reconciliation run
    // just vanished into CloudWatch Logs with nobody notified.
    this.createMonitoring();

    // Output API endpoint
    this.createOutputs();
  }

  private alarmTopic?: sns.Topic;

  /** Lazily-created SNS topic that every operational alarm publishes to. */
  private getAlarmTopic(): sns.Topic {
    if (!this.alarmTopic) {
      this.alarmTopic = new sns.Topic(this, 'OperationalAlarmTopic', {
        topicName: 'MediaWorkstation-OperationalAlarms',
        displayName: 'NyroForge operational alarms',
      });
      const alarmEmail = this.node.tryGetContext('alarmEmail') as string | undefined;
      if (alarmEmail) {
        this.alarmTopic.addSubscription(new snsSubscriptions.EmailSubscription(alarmEmail));
      }
      new cdk.CfnOutput(this, 'OperationalAlarmTopicArn', {
        value: this.alarmTopic.topicArn,
        description: 'SNS topic ARN for operational alarms — subscribe an email/Slack integration to it',
        exportName: 'OperationalAlarmTopicArn',
      });
    }
    return this.alarmTopic;
  }

  /** A 14-day-retention DLQ for an async/event-driven Lambda target. */
  private createDlq(id: string): sqs.Queue {
    return new sqs.Queue(this, id, {
      queueName: `MediaWorkstation-${id}`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
  }

  private createMonitoring(): void {
    const topic = this.getAlarmTopic();
    const fns = this.lambdaFunctions;

    // Error-rate alarms on every event-driven (non-request/response) Lambda —
    // these run on a schedule or stream trigger with no caller watching for
    // a failure response, so CloudWatch has to raise the flag instead.
    const eventDrivenFunctions: Array<[string, lambda.Function]> = [
      ['StatusMonitor', fns.statusMonitor],
      ['GroupMembershipReconciliation', fns.groupMembershipReconciliation],
      ['UserAttributeChangeProcessor', fns.userAttributeChangeProcessor],
    ];
    for (const [name, fn] of eventDrivenFunctions) {
      new cloudwatch.Alarm(this, `${name}ErrorsAlarm`, {
        alarmName: `MediaWorkstation-${name}-Errors`,
        metric: fn.metricErrors({ period: cdk.Duration.minutes(5) }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new cloudwatchActions.SnsAction(topic));
    }

    // DLQ depth alarms — anything landing here needs a human to re-drive it.
    const dlqs: Array<[string, sqs.Queue | undefined]> = [
      ['StatusMonitorDlq', fns.statusMonitor.deadLetterQueue as sqs.Queue | undefined],
      ['GroupMembershipReconciliationDlq', fns.groupMembershipReconciliation.deadLetterQueue as sqs.Queue | undefined],
      ['UserAttributeChangeProcessorDlq', this.userAttributeChangeProcessorDlq],
    ];
    for (const [name, dlq] of dlqs) {
      if (!dlq) continue;
      new cloudwatch.Alarm(this, `${name}DepthAlarm`, {
        alarmName: `MediaWorkstation-${name}-NotEmpty`,
        metric: dlq.metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(5) }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new cloudwatchActions.SnsAction(topic));
    }
  }

  private createLambdaFunctions(props: WorkstationApiStackProps): void {
    // Common Lambda configuration
    const commonLambdaProps = {
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        WORKSTATIONS_TABLE_NAME: props.tables.workstations.tableName,
        COSTS_TABLE_NAME: props.tables.costs.tableName,
        USER_SESSIONS_TABLE_NAME: props.tables.userSessions.tableName,
        USER_PROFILES_TABLE: props.tables.userProfiles.tableName,
        USERS_TABLE: props.tables.users.tableName,
        ROLES_TABLE: props.tables.roles.tableName,
        GROUPS_TABLE: props.tables.groups.tableName,
        GROUP_MEMBERSHIPS_TABLE: props.tables.groupMemberships.tableName,
        // The membership stream/reconciliation lambdas read MEMBERSHIPS_TABLE
        // and AUDIT_LOGS_TABLE — these keys were previously missing, so both
        // lambdas ran with empty table names.
        MEMBERSHIPS_TABLE: props.tables.groupMemberships.tableName,
        GROUP_AUDIT_LOGS_TABLE: props.tables.groupAuditLogs.tableName,
        AUDIT_LOGS_TABLE: props.tables.auditLogs.tableName,
        AUDIT_TABLE: props.tables.auditLogs.tableName,
        BOOTSTRAP_PACKAGES_TABLE: props.tables.bootstrapPackages.tableName,
        ANALYTICS_TABLE_NAME: props.tables.analytics.tableName,
        FEEDBACK_TABLE_NAME: props.tables.feedback.tableName,
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
    const ec2ManagementFunction = new ServiceLambda(this, 'EC2ManagementFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-EC2Management',
      serviceDir: 'ec2-management',
      description: 'Manages EC2 workstation lifecycle (launch, terminate, status)',
    });

    // Status Monitor Lambda
    const statusMonitorFunction = new ServiceLambda(this, 'StatusMonitorFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-StatusMonitor',
      serviceDir: 'status-monitor',
      description: 'Monitors workstation status and provides dashboard data',
      // Failed async (EventBridge) invocations land here after retries
      deadLetterQueue: this.createDlq('StatusMonitorDlq'),
    });

    // Cost Analytics Lambda
    const costAnalyticsFunction = new ServiceLambda(this, 'CostAnalyticsFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-CostAnalytics',
      serviceDir: 'cost-analytics',
      description: 'Provides cost tracking and analytics data',
      timeout: cdk.Duration.minutes(10), // Cost API can be slow
    });

    // Configuration Service Lambda
    const configServiceFunction = new ServiceLambda(this, 'ConfigServiceFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-ConfigService',
      serviceDir: 'config-service',
      description: 'Provides configuration data (regions, instance types, etc.)',
      timeout: cdk.Duration.minutes(2),
    });

    // Credentials Service Lambda
    const credentialsServiceFunction = new ServiceLambda(this, 'CredentialsServiceFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-CredentialsService',
      serviceDir: 'credentials-service',
      description: 'Manages workstation credentials and domain join operations',
    });

    // User Profile Service Lambda
    const userProfileServiceFunction = new ServiceLambda(this, 'UserProfileServiceFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-UserProfileService',
      serviceDir: 'user-profile-service',
      description: 'Manages user profiles and preferences',
      timeout: cdk.Duration.minutes(1),
    });

    // Bootstrap Config Service Lambda
    // NOTE: userManagementService, groupManagementService, securityGroupService,
    // cognitoAdminService, amiValidationService, instanceTypeService, and storageService
    // are admin-only and live in WorkstationAdminApiStack to keep this stack under
    // CloudFormation's 500-resource limit.
    const bootstrapConfigServiceFunction = new ServiceLambda(this, 'BootstrapConfigServiceFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-BootstrapConfigService',
      serviceDir: 'bootstrap-config-service',
      description: 'Manages bootstrap packages for driver and software installation',
      timeout: cdk.Duration.minutes(2),
    });

    // Analytics Service Lambda
    const analyticsServiceFunction = new ServiceLambda(this, 'AnalyticsServiceFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-AnalyticsService',
      serviceDir: 'analytics-service',
      description: 'Tracks user analytics and manages feedback submissions',
      timeout: cdk.Duration.minutes(2),
    });

    // User Attribute Change Processor Lambda (DynamoDB Stream processor)
    const userAttributeChangeProcessorFunction = new ServiceLambda(this, 'UserAttributeChangeProcessorFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-UserAttributeChangeProcessor',
      serviceDir: 'user-attribute-change-processor',
      description: 'Processes user attribute changes and updates dynamic group memberships',
      timeout: cdk.Duration.minutes(5),
      reservedConcurrentExecutions: 10, // Limit concurrent executions for stream processing
    });

    // Add DynamoDB stream event source to process user changes. Batches that
    // still fail after all retries are shunted to a DLQ instead of being
    // dropped (records only carry stream metadata, enough to re-drive).
    this.userAttributeChangeProcessorDlq = this.createDlq('UserAttributeChangeProcessorDlq');
    userAttributeChangeProcessorFunction.addEventSource(new DynamoEventSource(props.tables.users, {
      startingPosition: lambda.StartingPosition.LATEST,
      batchSize: 10,
      maxBatchingWindow: cdk.Duration.seconds(5),
      retryAttempts: 3,
      bisectBatchOnError: true,
      reportBatchItemFailures: true,
      onFailure: new SqsDlq(this.userAttributeChangeProcessorDlq),
    }));

    // Group Membership Reconciliation Lambda (Scheduled full re-evaluation)
    const groupMembershipReconciliationFunction = new ServiceLambda(this, 'GroupMembershipReconciliationFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-GroupMembershipReconciliation',
      serviceDir: 'group-membership-reconciliation',
      description: 'Scheduled reconciliation of group memberships against dynamic rules',
      timeout: cdk.Duration.minutes(15), // Longer timeout for processing all users
      memorySize: 1024, // More memory for batch processing
      deadLetterQueue: this.createDlq('GroupMembershipReconciliationDlq'),
    });

    // Group Package Service Lambda
    const groupPackageServiceFunction = new ServiceLambda(this, 'GroupPackageServiceFunction', {
      ...commonLambdaProps,
      functionName: 'MediaWorkstation-GroupPackageService',
      serviceDir: 'group-package-service',
      description: 'Manages group package bindings and installation queue',
      timeout: cdk.Duration.minutes(2),
    });

    // Grant permissions to Lambda functions
    this.grantLambdaPermissions(props, {
      ec2Management: ec2ManagementFunction,
      statusMonitor: statusMonitorFunction,
      costAnalytics: costAnalyticsFunction,
      configService: configServiceFunction,
      credentialsService: credentialsServiceFunction,
      userProfileService: userProfileServiceFunction,
      bootstrapConfigService: bootstrapConfigServiceFunction,
      analyticsService: analyticsServiceFunction,
      userAttributeChangeProcessor: userAttributeChangeProcessorFunction,
      groupMembershipReconciliation: groupMembershipReconciliationFunction,
      groupPackageService: groupPackageServiceFunction,
    });

    // Store functions for later use
    this.lambdaFunctions = {
      ec2Management: ec2ManagementFunction,
      statusMonitor: statusMonitorFunction,
      costAnalytics: costAnalyticsFunction,
      configService: configServiceFunction,
      credentialsService: credentialsServiceFunction,
      userProfileService: userProfileServiceFunction,
      bootstrapConfigService: bootstrapConfigServiceFunction,
      analyticsService: analyticsServiceFunction,
      userAttributeChangeProcessor: userAttributeChangeProcessorFunction,
      groupMembershipReconciliation: groupMembershipReconciliationFunction,
      groupPackageService: groupPackageServiceFunction,
    };
  }

  private grantLambdaPermissions(props: WorkstationApiStackProps, functions: any): void {
    // Per-function DynamoDB grants, scoped to the tables each handler's
    // source actually reads/writes (verified against process.env.*_TABLE
    // usage in each src/lambda/*/index.ts). The previous blanket
    // `grantReadWriteData` loop gave every function in this stack read-write
    // access to all 15 tables — e.g. config-service (no DynamoDB access at
    // all) could read/write user credentials-adjacent tables it never
    // touches.
    props.tables.workstations.grantReadWriteData(functions.ec2Management);
    props.tables.auditLogs.grantReadWriteData(functions.ec2Management);
    props.tables.bootstrapPackages.grantReadWriteData(functions.ec2Management);
    props.tables.groups.grantReadWriteData(functions.ec2Management);
    props.tables.groupPackageBindings.grantReadWriteData(functions.ec2Management);
    props.tables.packageQueue.grantReadWriteData(functions.ec2Management);
    props.tables.roles.grantReadWriteData(functions.ec2Management);
    props.tables.users.grantReadWriteData(functions.ec2Management);

    props.tables.workstations.grantReadWriteData(functions.statusMonitor);

    props.tables.costs.grantReadWriteData(functions.costAnalytics);
    props.tables.workstations.grantReadData(functions.costAnalytics);

    // configService has no DynamoDB access — it only reads SSM/EC2 (granted below).

    props.tables.workstations.grantReadData(functions.credentialsService);

    props.tables.userProfiles.grantReadWriteData(functions.userProfileService);

    props.tables.bootstrapPackages.grantReadWriteData(functions.bootstrapConfigService);

    props.tables.analytics.grantReadWriteData(functions.analyticsService);
    props.tables.feedback.grantReadWriteData(functions.analyticsService);

    // userAttributeChangeProcessor is stream-triggered off `users` (stream
    // read is granted by DynamoEventSource itself); it also writes group
    // memberships and audit logs.
    props.tables.groups.grantReadData(functions.userAttributeChangeProcessor);
    props.tables.groupMemberships.grantReadWriteData(functions.userAttributeChangeProcessor);
    props.tables.auditLogs.grantReadWriteData(functions.userAttributeChangeProcessor);

    props.tables.users.grantReadData(functions.groupMembershipReconciliation);
    props.tables.groups.grantReadData(functions.groupMembershipReconciliation);
    props.tables.groupMemberships.grantReadWriteData(functions.groupMembershipReconciliation);
    props.tables.auditLogs.grantReadWriteData(functions.groupMembershipReconciliation);

    props.tables.workstations.grantReadData(functions.groupPackageService);
    props.tables.bootstrapPackages.grantReadData(functions.groupPackageService);
    props.tables.groupPackageBindings.grantReadWriteData(functions.groupPackageService);
    props.tables.packageQueue.grantReadWriteData(functions.groupPackageService);

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
    // EC2 launch. RunInstances references the AMI, subnet, security group, ENI
    // and key pair in a single call; none of those carry request tags, so a
    // RequestTag condition denies the whole call. Scope to the stack region
    // instead — the Lambda always applies the Project tag via TagSpecifications.
    functions.ec2Management.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ec2:RunInstances'],
      resources: ['*'],
      conditions: {
        'StringEquals': {
          'aws:RequestedRegion': cdk.Stack.of(this).region,
        }
      }
    }));
    // Tag-on-create: allow CreateTags only as part of the RunInstances call so
    // TagSpecifications succeed without granting blanket tag-write.
    functions.ec2Management.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ec2:CreateTags'],
      resources: ['*'],
      conditions: {
        'StringEquals': {
          'ec2:CreateAction': 'RunInstances',
        }
      }
    }));
    // Actions on existing project-tagged resources: instance lifecycle,
    // attribute modification, ownership re-tagging, and per-workstation ingress
    // rules. None carry a RequestTag, so they must be scoped by the resource's
    // existing Project tag (aws:ResourceTag, not aws:RequestTag).
    functions.ec2Management.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ec2:StartInstances',
        'ec2:StopInstances',
        'ec2:RebootInstances',
        'ec2:TerminateInstances',
        'ec2:ModifyInstanceAttribute',
        'ec2:AuthorizeSecurityGroupIngress',
        'ec2:RevokeSecurityGroupIngress',
        'ec2:CreateTags',
        'ec2:DeleteTags',
      ],
      resources: ['*'],
      conditions: {
        'StringEquals': {
          'aws:ResourceTag/Project': PROJECT_TAG,
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
    // Auto-termination of expired workstations. TerminateInstances carries no
    // request tags, so it must be scoped by the instance's existing Project tag
    // (aws:ResourceTag). The previous aws:RequestTag condition never matched, so
    // every termination was denied and expired instances ran indefinitely.
    functions.statusMonitor.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ec2:TerminateInstances',
      ],
      resources: ['*'],
      conditions: {
        'StringEquals': {
          'aws:ResourceTag/Project': PROJECT_TAG,
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

    // /workstations/{workstationId}/packages - package installation status
    const workstationPackagesResource = workstationResource.addResource('packages');
    workstationPackagesResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.groupPackageService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // POST /workstations/{workstationId}/packages/{packageId}/retry
    const workstationPackageResource = workstationPackagesResource.addResource('{packageId}');
    const packageRetryResource = workstationPackageResource.addResource('retry');
    packageRetryResource.addMethod('POST',
      new apigateway.LambdaIntegration(this.lambdaFunctions.groupPackageService), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // GET /user/group-packages - auto-install packages from the user's groups
    const userResource = this.api.root.addResource('user');
    const userGroupPackagesResource = userResource.addResource('group-packages');
    userGroupPackagesResource.addMethod('GET',
      new apigateway.LambdaIntegration(this.lambdaFunctions.groupPackageService), {
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

    // Note: admin routes (/admin/*) are handled by WorkstationAdminApiStack

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