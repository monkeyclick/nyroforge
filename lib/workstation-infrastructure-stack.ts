import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as guardduty from 'aws-cdk-lib/aws-guardduty';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { resourceName } from './constants';

/**
 * Stack properties for WorkstationInfrastructureStack
 *
 * @property retainVpcOnDelete - If true, VPC and subnets will be retained on stack deletion
 *                               to prevent deletion failures when external resources (like EKS)
 *                               are using the VPC. Default: true for safety.
 * @property enableTerminationProtection - If true, prevents accidental stack deletion.
 *                                          Default: false for dev, should be true for production.
 */
export interface WorkstationInfrastructureStackProps extends cdk.StackProps {
  /**
   * Whether to retain VPC resources on stack deletion.
   * Set to true when VPC may be shared with external resources like EKS clusters.
   * @default true
   */
  retainVpcOnDelete?: boolean;
  
  /**
   * Whether to enable CloudFormation termination protection.
   * @default false
   */
  enableTerminationProtection?: boolean;

  /**
   * Deployment environment. Drives the removal policy for stateful resources
   * (DynamoDB tables, KMS key, Cognito user pool): 'prod' retains, everything
   * else destroys. Must use the same enum as bin/app.ts so prod deploys are
   * consistently protected.
   * @default 'dev'
   */
  environment?: 'dev' | 'staging' | 'prod';
}

export class WorkstationInfrastructureStack extends cdk.Stack {
  public readonly vpc: ec2.IVpc;
  public tables: {
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
    deletedUsers: dynamodb.Table;
    passwordResetRecords: dynamodb.Table;
    passwordPolicy: dynamodb.Table;
  };
  public userPool: cognito.UserPool;
  public userPoolClient: cognito.UserPoolClient;
  public readonly kmsKey: kms.Key;
  /**
   * Holds admin-uploaded installer binaries for bootstrap packages. Two
   * prefixes with different reachability: `quarantine/` (freshly uploaded,
   * unreviewed) and `packages/` (admin-approved). The workstation instance
   * role can read `packages/*` and nothing else, so promoting an object
   * between prefixes is what actually makes it installable.
   */
  public packagesBucket: s3.Bucket;
  public readonly workstationSecurityGroup: ec2.SecurityGroup;
  private readonly removalPolicy: cdk.RemovalPolicy;

  constructor(scope: Construct, id: string, props?: WorkstationInfrastructureStackProps) {
    super(scope, id, {
      ...props,
      // Enable termination protection if specified (recommended for production)
      terminationProtection: props?.enableTerminationProtection ?? false,
    });

    // Environment-aware removal policy. Driven by the `environment` prop (set
    // once in bin/app.ts) so every stack agrees on what "prod" means — reading
    // process.env here previously diverged from bin/app.ts ('prod' vs
    // 'production'), leaving prod tables/keys/user-pool on DESTROY.
    const isProd = props?.environment === 'prod';
    this.removalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // Create KMS key for encryption
    this.kmsKey = new kms.Key(this, 'WorkstationKMSKey', {
      description: 'KMS key for Media Workstation Automation System',
      enableKeyRotation: true,
      removalPolicy: this.removalPolicy, // Environment-aware: RETAIN in production, DESTROY otherwise
    });

    this.kmsKey.addAlias('alias/media-workstation-automation');

    // Use existing VPC instead of creating a new one.
    // Set WORKSTATION_VPC_ID to your VPC; the placeholder default matches the
    // cached lookup in cdk.context.json so `cdk synth` works without credentials.
    this.vpc = ec2.Vpc.fromLookup(this, 'WorkstationVPC', {
      vpcId: process.env.WORKSTATION_VPC_ID || 'vpc-0123456789abcdef0',
    });

    // Create VPC endpoints for AWS services
    this.createVpcEndpoints();

    // Create Security Groups
    this.workstationSecurityGroup = new ec2.SecurityGroup(this, 'WorkstationSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for media workstations',
      allowAllOutbound: true,
    });

    // Allow RDP access from corporate networks only
    this.workstationSecurityGroup.addIngressRule(
      ec2.Peer.ipv4('10.0.0.0/8'),
      ec2.Port.tcp(3389),
      'RDP access from corporate networks'
    );

    // Allow Systems Manager Session Manager access
    this.workstationSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      'HTTPS for Systems Manager'
    );

    // Create DynamoDB Tables
    this.createDynamoDBTables();

    // Create Cognito User Pool
    this.createCognitoUserPool();

    // Create SSM Parameters for configuration
    this.createSSMParameters();

    // Bootstrap package artifact storage. Must precede createIAMRoles(): the
    // workstation instance role grants read on this bucket's approved prefix.
    this.createPackagesBucket(isProd);

    // Create IAM roles and policies
    this.createIAMRoles();

    // Output important resources
    this.createOutputs();
  }

  private createVpcEndpoints(): void {
    // scripts/check-vpc-endpoints.js runs before synthesis and writes the service
    // short-names of endpoints that already exist in the VPC (but are NOT owned by
    // this stack) into cdk.context.json under 'nyroforge:vpc-endpoints'.
    //
    // Example: ['s3', 'dynamodb'] when deploying into a VPC that already has
    // those gateway endpoints — recreating them would fail with
    // "route table already has a route".
    //
    // Endpoints this stack created on a previous deployment have the
    // aws:cloudformation:stack-name tag, so the pre-check script excludes them
    // and CDK continues to manage them normally.
    const existingEndpoints: string[] = this.node.tryGetContext('nyroforge:vpc-endpoints') ?? [];
    const skip = (name: string): boolean => {
      if (existingEndpoints.includes(name)) {
        process.stdout.write(`[vpc-endpoints] Skipping ${name} — already exists in VPC (not CDK-managed)\n`);
        return true;
      }
      return false;
    };

    // Gateway endpoints — add routes to all VPC route tables.
    // Skip if the VPC already has them; duplicates cause deployment errors.
    if (!skip('s3')) {
      new ec2.GatewayVpcEndpoint(this, 'S3GatewayEndpoint', {
        service: ec2.GatewayVpcEndpointAwsService.S3,
        vpc: this.vpc,
      });
    }

    if (!skip('dynamodb')) {
      new ec2.GatewayVpcEndpoint(this, 'DynamoDBGatewayEndpoint', {
        service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
        vpc: this.vpc,
      });
    }

    // Interface endpoints — private DNS within the VPC for each AWS service.
    const interfaceEndpoints: Array<{ shortName: string; service: ec2.InterfaceVpcEndpointAwsService; id: string }> = [
      { shortName: 'ec2',            service: ec2.InterfaceVpcEndpointAwsService.EC2,             id: 'EC2Endpoint' },
      { shortName: 'ssm',            service: ec2.InterfaceVpcEndpointAwsService.SSM,             id: 'SSMEndpoint' },
      { shortName: 'ssmmessages',    service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,    id: 'SSMMessagesEndpoint' },
      { shortName: 'ec2messages',    service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,    id: 'EC2MessagesEndpoint' },
      { shortName: 'secretsmanager', service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER, id: 'SecretsManagerEndpoint' },
      { shortName: 'kms',            service: ec2.InterfaceVpcEndpointAwsService.KMS,             id: 'KMSEndpoint' },
    ];

    for (const ep of interfaceEndpoints) {
      if (!skip(ep.shortName)) {
        new ec2.InterfaceVpcEndpoint(this, ep.id, {
          service: ep.service,
          vpc: this.vpc,
          privateDnsEnabled: true,
        });
      }
    }
  }

  private createDynamoDBTables(): void {
    // Workstations table
    const workstationsTable = new dynamodb.Table(this, 'WorkstationsTable', {
      tableName: resourceName('WorkstationManagement'),
      partitionKey: {
        name: 'PK',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'SK',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: this.removalPolicy,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // Add Global Secondary Indexes
    workstationsTable.addGlobalSecondaryIndex({
      indexName: 'UserIdIndex',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    workstationsTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: {
        name: 'status',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Cost tracking table
    const costsTable = new dynamodb.Table(this, 'CostTrackingTable', {
      tableName: resourceName('CostAnalytics'),
      partitionKey: {
        name: 'PK',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'SK',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: this.removalPolicy,
      timeToLiveAttribute: 'ttl', // Auto-delete old cost data
    });

    // User sessions table
    const userSessionsTable = new dynamodb.Table(this, 'UserSessionsTable', {
      tableName: resourceName('UserSessions'),
      partitionKey: {
        name: 'PK',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'SK',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: false,
      },
      removalPolicy: this.removalPolicy,
      timeToLiveAttribute: 'ttl',
    });

    // User profiles table for storing user preferences
    const userProfilesTable = new dynamodb.Table(this, 'UserProfilesTable', {
      tableName: resourceName('UserProfiles'),
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: this.removalPolicy,
    });

    // Enhanced Users table for RBAC system
    const usersTable = new dynamodb.Table(this, 'UsersTable', {
      tableName: resourceName('EnhancedUsers'),
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: this.removalPolicy,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // Enable streams for change detection
    });

    // Add GSI for searching by email
    usersTable.addGlobalSecondaryIndex({
      indexName: 'EmailIndex',
      partitionKey: {
        name: 'email',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Add GSI for searching by status
    usersTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: {
        name: 'status',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Roles table
    const rolesTable = new dynamodb.Table(this, 'RolesTable', {
      tableName: resourceName('UserRoles'),
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: this.removalPolicy,
    });

    // Add GSI for system roles
    rolesTable.addGlobalSecondaryIndex({
      indexName: 'SystemRoleIndex',
      partitionKey: {
        name: 'isSystem',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'name',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Groups table (enhanced for comprehensive management)
    const groupsTable = new dynamodb.Table(this, 'GroupsTable', {
      tableName: resourceName('UserGroups'),
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: this.removalPolicy,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // Enable streams for change detection
    });

    // Add GSI for default groups
    groupsTable.addGlobalSecondaryIndex({
      indexName: 'DefaultGroupIndex',
      partitionKey: {
        name: 'isDefault',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'name',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // PHASE 1B Deployment 2: Add ParentGroupIndex (ACTIVE)
    groupsTable.addGlobalSecondaryIndex({
      indexName: 'ParentGroupIndex',
      partitionKey: {
        name: 'parentGroupId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Phase 1B Deployment 3: Add MembershipTypeIndex (ACTIVE)
    groupsTable.addGlobalSecondaryIndex({
      indexName: 'MembershipTypeIndex',
      partitionKey: {
        name: 'membershipType',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'lastEvaluatedAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Phase 1B Deployment 4: Add CreatorIndex (ACTIVE)
    groupsTable.addGlobalSecondaryIndex({
      indexName: 'CreatorIndex',
      partitionKey: {
        name: 'createdBy',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Group Memberships table (many-to-many relationships)
    const groupMembershipsTable = new dynamodb.Table(this, 'GroupMembershipsTable', {
      tableName: resourceName('GroupMemberships'),
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING, // Format: "user#<userId>#group#<groupId>"
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: this.removalPolicy,
      timeToLiveAttribute: 'expiresAt', // Optional expiry for temporary memberships
    });

    // GSI for querying all groups a user belongs to
    groupMembershipsTable.addGlobalSecondaryIndex({
      indexName: 'UserGroupsIndex',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'groupId',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // GSI for querying all members of a group
    groupMembershipsTable.addGlobalSecondaryIndex({
      indexName: 'GroupMembersIndex',
      partitionKey: {
        name: 'groupId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // GSI for querying by membership type (static, dynamic, nested)
    groupMembershipsTable.addGlobalSecondaryIndex({
      indexName: 'MembershipTypeIndex',
      partitionKey: {
        name: 'membershipType',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'addedAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Group Audit Logs table (separate from general audit logs)
    const groupAuditLogsTable = new dynamodb.Table(this, 'GroupAuditLogsTable', {
      tableName: resourceName('GroupAuditLogs'),
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: this.removalPolicy,
      timeToLiveAttribute: 'ttl', // Auto-delete old logs (e.g., after 2 years)
    });

    // GSI for querying group-specific activity
    groupAuditLogsTable.addGlobalSecondaryIndex({
      indexName: 'GroupActivityIndex',
      partitionKey: {
        name: 'groupId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // GSI for querying by action type
    groupAuditLogsTable.addGlobalSecondaryIndex({
      indexName: 'ActionIndex',
      partitionKey: {
        name: 'action',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // GSI for querying by performer
    groupAuditLogsTable.addGlobalSecondaryIndex({
      indexName: 'PerformerIndex',
      partitionKey: {
        name: 'performedBy',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Audit logs table
    const auditLogsTable = new dynamodb.Table(this, 'AuditLogsTable', {
      tableName: resourceName('AuditLogs'),
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: this.removalPolicy,
      timeToLiveAttribute: 'ttl', // Auto-delete old audit logs (e.g., after 2 years)
    });

    // Add GSI for searching by user
    auditLogsTable.addGlobalSecondaryIndex({
      indexName: 'UserActionIndex',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Add GSI for searching by resource
    auditLogsTable.addGlobalSecondaryIndex({
      indexName: 'ResourceIndex',
      partitionKey: {
        name: 'resource',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Bootstrap packages table
    const bootstrapPackagesTable = new dynamodb.Table(this, 'BootstrapPackagesTable', {
      tableName: resourceName('WorkstationBootstrapPackages'),
      partitionKey: {
        name: 'packageId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: this.removalPolicy,
    });

    // Add GSI for searching by type
    bootstrapPackagesTable.addGlobalSecondaryIndex({
      indexName: 'TypeIndex',
      partitionKey: {
        name: 'type',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'order',
        type: dynamodb.AttributeType.NUMBER,
      },
    });

    // Add GSI for searching by category
    bootstrapPackagesTable.addGlobalSecondaryIndex({
      indexName: 'CategoryIndex',
      partitionKey: {
        name: 'category',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'order',
        type: dynamodb.AttributeType.NUMBER,
      },
    });

    // Add GSI for required packages
    bootstrapPackagesTable.addGlobalSecondaryIndex({
      indexName: 'RequiredIndex',
      partitionKey: {
        name: 'isRequired',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'order',
        type: dynamodb.AttributeType.NUMBER,
      },
    });

    // Drives the admin review queue: list every upload awaiting review
    // (status = 'needs_review') oldest-first, without scanning the catalog.
    //
    // Sorted by createdAt rather than uploadedAt because DynamoDB omits an item
    // from an index when a key attribute is missing, and hand-entered URL
    // packages have no uploadedAt — they would silently vanish from any
    // status query.
    bootstrapPackagesTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: {
        name: 'status',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Analytics events table
    const analyticsTable = new dynamodb.Table(this, 'AnalyticsTable', {
      tableName: resourceName('UserAnalytics'),
      partitionKey: {
        name: 'eventId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: this.removalPolicy,
      timeToLiveAttribute: 'ttl', // Auto-delete old analytics data
    });

    // Add GSI for searching by user
    analyticsTable.addGlobalSecondaryIndex({
      indexName: 'UserIndex',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Add GSI for searching by event type
    analyticsTable.addGlobalSecondaryIndex({
      indexName: 'EventTypeIndex',
      partitionKey: {
        name: 'eventType',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Add GSI for date-range queries. eventDate is a YYYY-MM-DD daily bucket
    // written by analytics-service; the summary endpoint queries one partition
    // per day in the requested timeframe instead of scanning the whole table.
    analyticsTable.addGlobalSecondaryIndex({
      indexName: 'DateIndex',
      partitionKey: {
        name: 'eventDate',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Add GSI for searching by category
    analyticsTable.addGlobalSecondaryIndex({
      indexName: 'CategoryIndex',
      partitionKey: {
        name: 'eventCategory',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Feedback submissions table
    const feedbackTable = new dynamodb.Table(this, 'FeedbackTable', {
      tableName: resourceName('UserFeedback'),
      partitionKey: {
        name: 'feedbackId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: this.removalPolicy,
    });

    // Add GSI for searching by user
    feedbackTable.addGlobalSecondaryIndex({
      indexName: 'UserIndex',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Add GSI for searching by status
    feedbackTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: {
        name: 'status',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Add GSI for searching by type
    feedbackTable.addGlobalSecondaryIndex({
      indexName: 'TypeIndex',
      partitionKey: {
        name: 'feedbackType',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Workstation Package Queue table (Phase 1: Post-Boot Package Installation)
    const packageQueueTable = new dynamodb.Table(this, 'PackageQueueTable', {
      tableName: resourceName('WorkstationPackageQueue'),
      partitionKey: {
        name: 'PK',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'SK',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: this.removalPolicy,
      timeToLiveAttribute: 'ttl', // Auto-delete completed queue items after 30 days
    });

    // GSI for querying by status
    packageQueueTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: {
        name: 'status',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // GSI for querying by groupId (audit trail)
    packageQueueTable.addGlobalSecondaryIndex({
      indexName: 'GroupIndex',
      partitionKey: {
        name: 'groupId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Group Package Bindings table (Phase 1: Post-Boot Package Installation)
    const groupPackageBindingsTable = new dynamodb.Table(this, 'GroupPackageBindingsTable', {
      tableName: resourceName('GroupPackageBindings'),
      partitionKey: {
        name: 'PK',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'SK',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: this.removalPolicy,
    });

    // GSI for querying by packageId (which groups use this package)
    groupPackageBindingsTable.addGlobalSecondaryIndex({
      indexName: 'PackageIndex',
      partitionKey: {
        name: 'packageId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'groupId',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // GSI for querying auto-install packages
    groupPackageBindingsTable.addGlobalSecondaryIndex({
      indexName: 'AutoInstallIndex',
      partitionKey: {
        name: 'autoInstall',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'installOrder',
        type: dynamodb.AttributeType.NUMBER,
      },
    });

    // Deleted Users table (for soft-delete with data retention)
    const deletedUsersTable = new dynamodb.Table(this, 'DeletedUsersTable', {
      tableName: resourceName('DeletedUsers'),
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: this.removalPolicy,
      timeToLiveAttribute: 'ttl', // Auto-delete after retention period
    });

    // GSI for querying by deletion date
    deletedUsersTable.addGlobalSecondaryIndex({
      indexName: 'DeletionDateIndex',
      partitionKey: {
        name: 'deletionType',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'deletedAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // GSI for querying by deleted by admin
    deletedUsersTable.addGlobalSecondaryIndex({
      indexName: 'DeletedByIndex',
      partitionKey: {
        name: 'deletedBy',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'deletedAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // GSI for querying by scheduled purge date
    deletedUsersTable.addGlobalSecondaryIndex({
      indexName: 'PurgeDateIndex',
      partitionKey: {
        name: 'restorable',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'scheduledPurgeDate',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Password Reset Records table (for tracking password changes)
    const passwordResetRecordsTable = new dynamodb.Table(this, 'PasswordResetRecordsTable', {
      tableName: resourceName('PasswordResetRecords'),
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: this.removalPolicy,
      timeToLiveAttribute: 'ttl', // Auto-delete old records
    });

    // GSI for querying by user
    passwordResetRecordsTable.addGlobalSecondaryIndex({
      indexName: 'UserResetIndex',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // GSI for querying by reset type
    passwordResetRecordsTable.addGlobalSecondaryIndex({
      indexName: 'ResetTypeIndex',
      partitionKey: {
        name: 'resetType',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // GSI for querying by admin who performed reset
    passwordResetRecordsTable.addGlobalSecondaryIndex({
      indexName: 'AdminResetIndex',
      partitionKey: {
        name: 'createdBy',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Password Policy table (for storing password requirements)
    const passwordPolicyTable = new dynamodb.Table(this, 'PasswordPolicyTable', {
      tableName: resourceName('PasswordPolicy'),
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING, // 'default' or custom policy IDs
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: this.removalPolicy,
    });

    // Assign tables
    this.tables = {
      workstations: workstationsTable,
      costs: costsTable,
      userSessions: userSessionsTable,
      userProfiles: userProfilesTable,
      users: usersTable,
      roles: rolesTable,
      groups: groupsTable,
      groupMemberships: groupMembershipsTable,
      groupAuditLogs: groupAuditLogsTable,
      auditLogs: auditLogsTable,
      bootstrapPackages: bootstrapPackagesTable,
      analytics: analyticsTable,
      feedback: feedbackTable,
      packageQueue: packageQueueTable,
      groupPackageBindings: groupPackageBindingsTable,
      deletedUsers: deletedUsersTable,
      passwordResetRecords: passwordResetRecordsTable,
      passwordPolicy: passwordPolicyTable,
    };
  }

  private createCognitoUserPool(): void {
    const userPool = new cognito.UserPool(this, 'WorkstationUserPool', {
      userPoolName: resourceName('MediaWorkstationUsers'),
      selfSignUpEnabled: false, // Disabled - admins must create users for security
      signInAliases: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        givenName: {
          required: true,
          mutable: true,
        },
        familyName: {
          required: true,
          mutable: true,
        },
      },
      customAttributes: {
        role: new cognito.StringAttribute({ mutable: true }),
        department: new cognito.StringAttribute({ mutable: true }),
        costCenter: new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      mfa: cognito.Mfa.OPTIONAL, // Allow users to optionally enable MFA
      mfaSecondFactor: {
        sms: true,
        otp: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      autoVerify: {
        email: true,
      },
      removalPolicy: this.removalPolicy,
    });

    // Create User Pool Client
    const userPoolClient = new cognito.UserPoolClient(this, 'WorkstationUserPoolClient', {
      userPool: userPool,
      userPoolClientName: resourceName('MediaWorkstationApp'),
      generateSecret: false, // Frontend apps don't use client secrets
      authFlows: {
        adminUserPassword: true,
        custom: true,
        userSrp: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
      },
      preventUserExistenceErrors: true,
      refreshTokenValidity: cdk.Duration.days(30),
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
    });

    // Create User Pool Groups
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'workstation-admin',
      description: 'Admin users with full access to workstation management',
      precedence: 1,
    });

    new cognito.CfnUserPoolGroup(this, 'UserGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'workstation-user',
      description: 'Regular users with access to their own workstations',
      precedence: 2,
    });

    // Assign to properties
    this.userPool = userPool;
    this.userPoolClient = userPoolClient;
  }

  private createSSMParameters(): void {
    // Store configuration parameters
    new ssm.StringParameter(this, 'DefaultInstanceType', {
      parameterName: '/workstation/config/defaultInstanceType',
      stringValue: 'g4dn.xlarge',
      description: 'Default EC2 instance type for workstations',
    });

    new ssm.StringParameter(this, 'AllowedInstanceTypes', {
      parameterName: '/workstation/config/allowedInstanceTypes',
      stringValue: JSON.stringify([
        'g4dn.xlarge', 'g4dn.2xlarge', 'g4dn.4xlarge',
        'g5.xlarge', 'g5.2xlarge', 'g5.4xlarge',
        'g6.xlarge', 'g6.2xlarge', 'g6.4xlarge'
      ]),
      description: 'Allowed EC2 instance types for workstations',
    });

    new ssm.StringParameter(this, 'DefaultAutoTerminateHours', {
      parameterName: '/workstation/config/defaultAutoTerminateHours',
      stringValue: '24',
      description: 'Default hours before auto-terminating idle workstations',
    });

    new ssm.StringParameter(this, 'WindowsServerVersions', {
      parameterName: '/workstation/config/windowsVersions',
      stringValue: JSON.stringify([
        'Windows Server 2019',
        'Windows Server 2022'
      ]),
      description: 'Supported Windows Server versions',
    });
  }

  /**
   * S3 bucket for admin-uploaded bootstrap package installers.
   *
   * Deliberately NOT the enterprise transfer bucket: that one carries
   * expiration lifecycle rules and `autoDeleteObjects: true` outside prod,
   * either of which would silently delete a multi-GB installer that the
   * package catalog still points at.
   *
   * Layout — the prefix boundary is the security boundary:
   *   quarantine/{packageId}/{fileName}  uploaded, unreviewed. No workstation
   *                                      can read this prefix.
   *   packages/{packageId}/{fileName}    admin-approved. The workstation
   *                                      instance role has GetObject here.
   */
  private createPackagesBucket(isProd: boolean): void {
    this.packagesBucket = new s3.Bucket(this, 'PackagesBucket', {
      bucketName: `workstation-packages-${cdk.Stack.of(this).account}-${cdk.Stack.of(this).region}`,
      // Same CMK the workstation instance role can already decrypt, so an
      // approved installer needs no extra key grant to be downloadable.
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.kmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      // Always RETAIN, even in dev. Re-uploading a 4 GB installer because a
      // dev stack was torn down is a genuinely bad afternoon.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          // A browser that closes mid-upload leaves orphaned parts that are
          // billed as storage but invisible in ListObjects.
          id: 'abort-incomplete-multipart-uploads',
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
        {
          // Uploads nobody ever reviewed shouldn't accumulate forever.
          id: 'expire-unreviewed-quarantine',
          prefix: 'quarantine/',
          expiration: cdk.Duration.days(14),
        },
        {
          id: 'expire-superseded-package-versions',
          prefix: 'packages/',
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
        {
          // Trial-install copies are staged here so a workstation can read
          // them; they are deleted after the run and swept up shortly after.
          id: 'expire-verification-copies',
          prefix: 'verify/',
          expiration: cdk.Duration.days(2),
        },
      ],
      cors: [
        {
          // Browser uploads go straight to S3 (API Gateway caps bodies at
          // 10 MB). ETag must be exposed or the browser cannot read the part
          // ETags it has to send back to CompleteMultipartUpload.
          allowedMethods: [
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.HEAD,
            s3.HttpMethods.GET,
          ],
          allowedOrigins: process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : ['*'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3600,
        },
      ],
    });

    cdk.Tags.of(this.packagesBucket).add('Name', 'workstation-packages');

    new ssm.StringParameter(this, 'PackagesBucketNameParam', {
      parameterName: '/workstation/config/packagesBucket',
      stringValue: this.packagesBucket.bucketName,
      description: 'S3 bucket holding bootstrap package installers',
    });

    new cdk.CfnOutput(this, 'PackagesBucketName', {
      value: this.packagesBucket.bucketName,
      description: 'S3 bucket holding bootstrap package installers',
      exportName: 'WorkstationPackagesBucketName',
    });

    this.createMalwareProtection();

    // isProd is accepted for symmetry with the other stateful resources even
    // though this bucket is RETAIN in every environment; referencing it keeps
    // the signature honest if that policy is ever relaxed.
    void isProd;
  }

  /**
   * GuardDuty Malware Protection for the quarantine prefix.
   *
   * Any authenticated user can now upload an executable into this account, so
   * the binaries get scanned before an admin can publish them. GuardDuty tags
   * each object with `GuardDutyMalwareScanStatus`, and package-upload-service
   * refuses to approve anything tagged THREATS_FOUND.
   *
   * Scoped to `quarantine/` because that is where unreviewed uploads land;
   * objects only reach `packages/` after passing this gate. Opt out with
   * ENABLE_MALWARE_SCANNING=false — GuardDuty must be enabled in the account
   * for the plan to deploy.
   */
  private createMalwareProtection(): void {
    if (process.env.ENABLE_MALWARE_SCANNING === 'false') {
      return;
    }

    const scanRole = new iam.Role(this, 'PackagesMalwareScanRole', {
      assumedBy: new iam.ServicePrincipal('malware-protection-plan.guardduty.amazonaws.com'),
      description: 'Lets GuardDuty scan and tag uploaded bootstrap packages',
    });

    scanRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        's3:GetObject',
        's3:GetObjectVersion',
        's3:GetObjectTagging',
        's3:GetObjectVersionTagging',
        's3:PutObjectTagging',
        's3:PutObjectVersionTagging',
      ],
      resources: [`${this.packagesBucket.bucketArn}/quarantine/*`],
    }));
    scanRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:ListBucket', 's3:GetBucketLocation'],
      resources: [this.packagesBucket.bucketArn],
    }));
    // Objects are SSE-KMS; GuardDuty cannot read them without the key.
    scanRole.addToPolicy(new iam.PolicyStatement({
      actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
      resources: [this.kmsKey.keyArn],
    }));
    scanRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'events:PutRule',
        'events:DeleteRule',
        'events:PutTargets',
        'events:RemoveTargets',
        'events:DescribeRule',
        'events:ListTargetsByRule',
      ],
      resources: [
        `arn:aws:events:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtection*`,
      ],
    }));

    new guardduty.CfnMalwareProtectionPlan(this, 'PackagesMalwareProtectionPlan', {
      role: scanRole.roleArn,
      protectedResource: {
        s3Bucket: {
          bucketName: this.packagesBucket.bucketName,
          objectPrefixes: ['quarantine/'],
        },
      },
      actions: {
        // Tagging is what package-upload-service reads at approval time.
        tagging: { status: 'ENABLED' },
      },
    });
  }

  private createIAMRoles(): void {
    // EC2 Instance Role for workstations
    const workstationInstanceRole = new iam.Role(this, 'WorkstationInstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'IAM role for EC2 workstation instances',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });

    // Allow access to Secrets Manager for credentials
    workstationInstanceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'secretsmanager:GetSecretValue',
        'secretsmanager:DescribeSecret',
      ],
      resources: [`arn:aws:secretsmanager:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:secret:workstation/*`],
    }));

    // Allow KMS access for decryption
    workstationInstanceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'kms:Decrypt',
        'kms:DescribeKey',
      ],
      resources: [this.kmsKey.keyArn],
    }));

    // Allow a workstation to read and update ITS OWN package queue partition.
    //
    // The queue is partitioned by instance ARN specifically so this condition
    // can be written. `ec2:SourceInstanceARN` is the only IAM condition key
    // that identifies the calling instance, and it expands to a full ARN — so
    // the partition key has to be the ARN for the two to line up.
    //
    // An earlier version of this statement used the same condition against a
    // bare-instance-id key layout. It could never match, and because a policy
    // variable that fails to resolve fails closed, it denied every request the
    // installer service made. Changing the key format is what makes the
    // intended scoping actually enforceable.
    workstationInstanceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:Query',
        'dynamodb:GetItem',
        'dynamodb:UpdateItem',
      ],
      resources: [
        this.tables.packageQueue.tableArn,
        `${this.tables.packageQueue.tableArn}/index/*`,
      ],
      conditions: {
        'ForAllValues:StringEquals': {
          'dynamodb:LeadingKeys': ['workstation#${ec2:SourceInstanceARN}'],
        },
      },
    }));

    // Phase 1: Allow workstation to write installation logs to CloudWatch
    workstationInstanceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        'logs:DescribeLogStreams',
      ],
      resources: [
        `arn:aws:logs:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:log-group:/aws/workstation/package-installer`,
        `arn:aws:logs:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:log-group:/aws/workstation/package-installer:*`,
      ],
    }));

    // Phase 1: Allow workstation to read bootstrap package configurations
    workstationInstanceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:Query',
      ],
      resources: [
        this.tables.bootstrapPackages.tableArn,
        `${this.tables.bootstrapPackages.tableArn}/index/*`,
      ],
    }));

    // Phase 1: Allow workstation to download NVIDIA drivers from AWS S3
    workstationInstanceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:ListBucket',
      ],
      resources: [
        'arn:aws:s3:::ec2-windows-nvidia-drivers',
        'arn:aws:s3:::ec2-windows-nvidia-drivers/*',
      ],
    }));

    // Allow the package installer service to download ADMIN-APPROVED uploaded
    // installers using instance profile credentials (no presigned URL, so
    // nothing expires while a workstation sits stopped).
    //
    // Scoped to `packages/*` on purpose: `quarantine/*` holds binaries that no
    // admin has reviewed yet, and this deliberate omission is what stops an
    // unreviewed upload from ever executing on a workstation. kms:Decrypt on
    // the CMK is already granted above, which covers the SSE-KMS object.
    workstationInstanceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject'],
      resources: [
        `${this.packagesBucket.bucketArn}/packages/*`,
        // Trial installs of a not-yet-approved package. An admin explicitly
        // stages a single object here and names the workstation to run it on;
        // objects expire after 2 days via lifecycle rule.
        `${this.packagesBucket.bucketArn}/verify/*`,
      ],
    }));

    // Create instance profile
    const workstationInstanceProfile = new iam.CfnInstanceProfile(this, 'WorkstationInstanceProfile', {
      roles: [workstationInstanceRole.roleName],
      instanceProfileName: 'MediaWorkstationInstanceProfile',
    });

    // Store instance profile ARN in SSM for Lambda functions to use
    new ssm.StringParameter(this, 'InstanceProfileArn', {
      parameterName: '/workstation/config/instanceProfileArn',
      stringValue: workstationInstanceProfile.attrArn,
      description: 'ARN of the EC2 instance profile for workstations',
    });

    // Store instance role ARN in SSM for reference
    new ssm.StringParameter(this, 'InstanceRoleArn', {
      parameterName: '/workstation/config/instanceRoleArn',
      stringValue: workstationInstanceRole.roleArn,
      description: 'ARN of the IAM role for workstation instances',
    });
  }

  private createOutputs(): void {
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID for workstation deployment',
      exportName: resourceName('WorkstationVpcId'),
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: resourceName('WorkstationUserPoolId'),
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: resourceName('WorkstationUserPoolClientId'),
    });

    new cdk.CfnOutput(this, 'WorkstationsTableName', {
      value: this.tables.workstations.tableName,
      description: 'DynamoDB workstations table name',
      exportName: resourceName('WorkstationsTableName'),
    });

    new cdk.CfnOutput(this, 'UserProfilesTableName', {
      value: this.tables.userProfiles.tableName,
      description: 'DynamoDB user profiles table name',
      exportName: resourceName('UserProfilesTableName'),
    });

    new cdk.CfnOutput(this, 'KMSKeyArn', {
      value: this.kmsKey.keyArn,
      description: 'KMS key ARN for encryption',
      exportName: resourceName('WorkstationKMSKeyArn'),
    });

    new cdk.CfnOutput(this, 'BootstrapPackagesTableName', {
      value: this.tables.bootstrapPackages.tableName,
      description: 'DynamoDB bootstrap packages table name',
      exportName: resourceName('BootstrapPackagesTableName'),
    });

    new cdk.CfnOutput(this, 'PackageQueueTableName', {
      value: this.tables.packageQueue.tableName,
      description: 'DynamoDB package queue table name',
      exportName: resourceName('PackageQueueTableName'),
    });

    new cdk.CfnOutput(this, 'GroupPackageBindingsTableName', {
      value: this.tables.groupPackageBindings.tableName,
      description: 'DynamoDB group package bindings table name',
      exportName: resourceName('GroupPackageBindingsTableName'),
    });

    new cdk.CfnOutput(this, 'DeletedUsersTableName', {
      value: this.tables.deletedUsers.tableName,
      description: 'DynamoDB deleted users table name (soft-delete retention)',
      exportName: resourceName('DeletedUsersTableName'),
    });

    new cdk.CfnOutput(this, 'PasswordResetRecordsTableName', {
      value: this.tables.passwordResetRecords.tableName,
      description: 'DynamoDB password reset records table name',
      exportName: resourceName('PasswordResetRecordsTableName'),
    });

    new cdk.CfnOutput(this, 'PasswordPolicyTableName', {
      value: this.tables.passwordPolicy.tableName,
      description: 'DynamoDB password policy table name',
      exportName: resourceName('PasswordPolicyTableName'),
    });
  }

  /**
   * Apply removal policy to VPC and all its child resources.
   *
   * This method addresses the common "subnet has dependencies and cannot be deleted" error
   * that occurs when external resources (EKS clusters, Lambda ENIs, EFS mount targets)
   * are using the VPC subnets.
   *
   * By setting the removal policy to RETAIN, CloudFormation will skip deletion of these
   * resources instead of failing the entire stack deletion.
   *
   * Resources affected:
   * - VPC
   * - All Subnets (Public and Private)
   * - Internet Gateway
   * - NAT Gateways
   * - Route Tables
   * - Security Groups
   * - VPC Endpoints
   *
   * @param removalPolicy - The removal policy to apply (RETAIN or DESTROY)
   */
}