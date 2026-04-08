
//------------------------------------------------------------------------------
// Enterprise Storage Construct - AWS CDK Implementation
// Comprehensive enterprise storage solutions for AWS and third-party platforms
//------------------------------------------------------------------------------

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as fsx from 'aws-cdk-lib/aws-fsx';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as backup from 'aws-cdk-lib/aws-backup';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

//==============================================================================
// Type Definitions & Interfaces
//==============================================================================

export type StorageEnvironment = 'dev' | 'staging' | 'prod';

export interface ActiveDirectoryConfig {
  type: 'self_managed' | 'aws_managed';
  directoryId?: string;
  domainName?: string;
  dnsIps?: string[];
  username?: string;
  /** Use cdk.SecretValue.secretsManager() or cdk.SecretValue.ssmSecure() — never a plain string */
  password?: cdk.SecretValue;
  organizationalUnit?: string;
  fileSystemAdministratorsGroup?: string;
  netbiosName?: string;
}

export interface DiskIopsConfiguration {
  mode: 'AUTOMATIC' | 'USER_PROVISIONED';
  iops?: number;
}

export interface BackupConfig {
  automaticBackupRetentionDays: number;
  dailyBackupStartTime?: string;
  weeklyMaintenanceStartTime?: string;
  copyTagsToBackups?: boolean;
}

export interface MonitoringConfig {
  enableAlarms?: boolean;
  enableDashboard?: boolean;
  alarmEmail?: string;
  storageUtilizationThreshold?: number;
}

//------------------------------------------------------------------------------
// FSx Windows Configuration
//------------------------------------------------------------------------------

export interface FsxWindowsConfig {
  storageCapacity: number;
  throughputCapacity: number;
  deploymentType: 'SINGLE_AZ_1' | 'SINGLE_AZ_2' | 'MULTI_AZ_1';
  storageType?: 'SSD' | 'HDD';
  activeDirectory?: ActiveDirectoryConfig;
  backup?: BackupConfig;
  diskIops?: DiskIopsConfiguration;
  preferredSubnetId?: string;
  auditLogConfig?: {
    destination?: string;
    fileAccessAuditLogLevel?: 'DISABLED' | 'SUCCESS_ONLY' | 'FAILURE_ONLY' | 'SUCCESS_AND_FAILURE';
    fileShareAccessAuditLogLevel?: 'DISABLED' | 'SUCCESS_ONLY' | 'FAILURE_ONLY' | 'SUCCESS_AND_FAILURE';
  };
  aliases?: string[];
}

//------------------------------------------------------------------------------
// FSx Lustre Configuration
//------------------------------------------------------------------------------

export interface LustreDataRepositoryAssociation {
  fileSystemPath: string;
  dataRepositoryPath: string;
  batchImportMetaDataOnCreate?: boolean;
  autoExportEvents?: ('NEW' | 'CHANGED' | 'DELETED')[];
  autoImportEvents?: ('NEW' | 'CHANGED' | 'DELETED')[];
}

export interface FsxLustreConfig {
  storageCapacity: number;
  deploymentType: 'SCRATCH_1' | 'SCRATCH_2' | 'PERSISTENT_1' | 'PERSISTENT_2';
  perUnitStorageThroughput?: number;
  storageType?: 'SSD' | 'HDD';
  dataCompressionType?: 'LZ4' | 'NONE';
  driveCacheType?: 'NONE' | 'READ';
  s3ImportPath?: string;
  s3ExportPath?: string;
  importedFileChunkSize?: number;
  autoImportPolicy?: 'NONE' | 'NEW' | 'NEW_CHANGED' | 'NEW_CHANGED_DELETED';
  dataRepositoryAssociations?: { [key: string]: LustreDataRepositoryAssociation };
  backup?: BackupConfig;
}

//------------------------------------------------------------------------------
// FSx ONTAP Configuration
//------------------------------------------------------------------------------

export interface OntapStorageVirtualMachine {
  name: string;
  rootVolumeSecurityStyle?: 'UNIX' | 'NTFS' | 'MIXED';
  /** Use cdk.SecretValue.secretsManager() or cdk.SecretValue.ssmSecure() — never a plain string */
  svmAdminPassword?: cdk.SecretValue;
  activeDirectory?: ActiveDirectoryConfig;
}

export interface OntapTieringPolicy {
  name: 'SNAPSHOT_ONLY' | 'AUTO' | 'ALL' | 'NONE';
  coolingPeriod?: number;
}

export interface OntapVolume {
  name: string;
  junctionPath: string;
  sizeInMegabytes: number;
  svmKey: string;
  storageEfficiencyEnabled?: boolean;
  securityStyle?: 'UNIX' | 'NTFS' | 'MIXED';
  ontapVolumeType?: 'RW' | 'DP' | 'LS';
  tieringPolicy?: OntapTieringPolicy;
  snapshotPolicy?: string;
  copyTagsToBackups?: boolean;
  skipFinalBackup?: boolean;
}

export interface FsxOntapConfig {
  storageCapacity: number;
  throughputCapacity: number;
  deploymentType: 'SINGLE_AZ_1' | 'SINGLE_AZ_2' | 'MULTI_AZ_1' | 'MULTI_AZ_2';
  storageType?: 'SSD' | 'HDD';
  /** Use cdk.SecretValue.secretsManager() or cdk.SecretValue.ssmSecure() — never a plain string */
  fsxAdminPassword?: cdk.SecretValue;
  haPairs?: number;
  throughputCapacityPerHaPair?: number;
  endpointIpAddressRange?: string;
  routeTableIds?: string[];
  preferredSubnetId?: string;
  diskIops?: DiskIopsConfiguration;
  backup?: BackupConfig;
  storageVirtualMachines: { [key: string]: OntapStorageVirtualMachine };
  volumes: { [key: string]: OntapVolume };
}

//------------------------------------------------------------------------------
// FSx OpenZFS Configuration
//------------------------------------------------------------------------------

export interface OpenZfsNfsExportConfig {
  clientConfigurations: {
    clients: string;
    options: string[];
  }[];
}

export interface OpenZfsQuotaConfig {
  id: number;
  storageCapacityQuotaGib: number;
  type: 'USER' | 'GROUP';
}

export interface OpenZfsVolumeConfig {
  name: string;
  parentVolumeId?: string;
  storageCapacityQuotaGib?: number;
  storageCapacityReservationGib?: number;
  dataCompressionType?: 'NONE' | 'ZSTD' | 'LZ4';
  readOnly?: boolean;
  recordSizeKib?: number;
  nfsExports?: OpenZfsNfsExportConfig;
  userAndGroupQuotas?: OpenZfsQuotaConfig[];
  copyTagsToSnapshots?: boolean;
}

export interface FsxOpenZfsConfig {
  storageCapacity: number;
  throughputCapacity: number;
  deploymentType: 'SINGLE_AZ_1' | 'SINGLE_AZ_2' | 'MULTI_AZ_1';
  storageType?: 'SSD';
  diskIops?: DiskIopsConfiguration;
  preferredSubnetId?: string;
  routeTableIds?: string[];
  backup?: BackupConfig;
  rootVolumeConfig: {
    dataCompressionType?: 'NONE' | 'ZSTD' | 'LZ4';
    readOnly?: boolean;
    recordSizeKib?: number;
    nfsExports?: OpenZfsNfsExportConfig;
    userAndGroupQuotas?: OpenZfsQuotaConfig[];
    copyTagsToSnapshots?: boolean;
  };
  volumes?: { [key: string]: OpenZfsVolumeConfig };
  copyTagsToBackups?: boolean;
  copyTagsToVolumes?: boolean;
  skipFinalBackup?: boolean;
}

//------------------------------------------------------------------------------
// EFS Configuration
//------------------------------------------------------------------------------

export interface EfsAccessPointConfig {
  path: string;
  posixUser: {
    gid: string;
    uid: string;
    secondaryGids?: string[];
  };
  creationInfo: {
    ownerGid: string;
    ownerUid: string;
    permissions: string;
  };
}

export interface EfsConfig {
  performanceMode?: efs.PerformanceMode;
  throughputMode?: efs.ThroughputMode;
  provisionedThroughputPerSecond?: cdk.Size;
  lifecyclePolicy?: efs.LifecyclePolicy;
  enableAutomaticBackups?: boolean;
  mountTargetSubnetIds?: string[];
  accessPoints?: { [key: string]: EfsAccessPointConfig };
  encrypted?: boolean;
}

//------------------------------------------------------------------------------
// Third-Party Storage Configurations
//------------------------------------------------------------------------------

export interface MinioConfig {
  enabled: boolean;
  mode: 'standalone' | 'distributed';
  instanceType?: string;
  nodeCount?: number;
  drivesPerNode?: number;
  driveSize?: number;
  driveStorageClass?: 'gp3' | 'io2' | 'st1';
  tlsEnabled?: boolean;
  buckets?: {
    name: string;
    versioning?: boolean;
    quotaGb?: number;
  }[];
  consoleEnabled?: boolean;
  consolePort?: number;
  apiPort?: number;
}

//------------------------------------------------------------------------------
// Main Props Interface
//------------------------------------------------------------------------------

export interface EnterpriseStorageProps {
  vpc: ec2.IVpc;
  subnetIds: string[];
  kmsKey?: kms.IKey;
  environment: StorageEnvironment;
  projectName: string;
  costCenter?: string;
  
  enableEfs?: boolean;
  enableFsxWindows?: boolean;
  enableFsxLustre?: boolean;
  enableFsxOntap?: boolean;
  enableFsxOpenZfs?: boolean;
  enableS3Transfer?: boolean;
  
  efsConfig?: EfsConfig;
  fsxWindowsConfig?: FsxWindowsConfig;
  fsxLustreConfig?: FsxLustreConfig;
  fsxOntapConfig?: FsxOntapConfig;
  fsxOpenZfsConfig?: FsxOpenZfsConfig;
  minioConfig?: MinioConfig;
  
  s3TransferConfig?: {
    enableVersioning?: boolean;
    enableAccessLogging?: boolean;
    lifecycleRules?: {
      transitionToIaDays?: number;
      transitionToGlacierDays?: number;
      expirationDays?: number;
    };
    corsOrigins?: string[];
  };
  
  allowedCidrBlocks?: string[];
  additionalSecurityGroupIds?: string[];
  createIamPolicies?: boolean;
  createKmsKey?: boolean;
  kmsKeyDeletionWindow?: number;
  kmsKeyRotationEnabled?: boolean;
  
  monitoringConfig?: MonitoringConfig;
  enableBackup?: boolean;
  tags?: { [key: string]: string };
}

//------------------------------------------------------------------------------
// Storage Outputs Interface
//------------------------------------------------------------------------------

export interface StorageOutputs {
  storageSecurityGroup: ec2.SecurityGroup;
  kmsKey: kms.IKey;
  efsFileSystem?: efs.FileSystem;
  efsAccessPoints?: { [key: string]: efs.AccessPoint };
  fsxWindowsFileSystem?: fsx.CfnFileSystem;
  fsxLustreFileSystem?: fsx.CfnFileSystem;
  fsxOntapFileSystem?: fsx.CfnFileSystem;
  fsxOntapStorageVirtualMachines?: { [key: string]: fsx.CfnStorageVirtualMachine };
  fsxOntapVolumes?: { [key: string]: fsx.CfnVolume };
  fsxOpenZfsFileSystem?: fsx.CfnFileSystem;
  fsxOpenZfsVolumes?: { [key: string]: fsx.CfnVolume };
  transferBucket?: s3.Bucket;
  accessLogsBucket?: s3.Bucket;
  minioInstances?: ec2.CfnInstance[];
  fsxAccessPolicy?: iam.ManagedPolicy;
  efsAccessPolicy?: iam.ManagedPolicy;
  s3AccessPolicy?: iam.ManagedPolicy;
  alarmTopic?: sns.Topic;
  dashboard?: cloudwatch.Dashboard;
}

//==============================================================================
// Enterprise Storage Construct
//==============================================================================

export class EnterpriseStorageConstruct extends Construct {
  public readonly outputs: StorageOutputs;
  
  private readonly vpc: ec2.IVpc;
  private readonly kmsKey: kms.IKey;
  private readonly environment: StorageEnvironment;
  private readonly projectName: string;
  private readonly subnetIds: string[];
  
  constructor(scope: Construct, id: string, props: EnterpriseStorageProps) {
    super(scope, id);
    
    this.vpc = props.vpc;
    this.environment = props.environment;
    this.projectName = props.projectName;
    this.subnetIds = props.subnetIds;
    
    // Create or use KMS key
    this.kmsKey = this.createOrGetKmsKey(props);
    
    // Create storage security group
    const storageSecurityGroup = this.createStorageSecurityGroup(props);
    
    // Initialize outputs
    this.outputs = {
      storageSecurityGroup,
      kmsKey: this.kmsKey,
    };
    
    // Create alarm topic if monitoring enabled
    if (props.monitoringConfig?.enableAlarms) {
      this.outputs.alarmTopic = this.createAlarmTopic(props);
    }
    
    // Create EFS if enabled
    if (props.enableEfs !== false) {
      const efsOutputs = this.createEfsFileSystem(props, storageSecurityGroup);
      this.outputs.efsFileSystem = efsOutputs.fileSystem;
      this.outputs.efsAccessPoints = efsOutputs.accessPoints;
    }
    
    // Create FSx for Windows if enabled
    if (props.enableFsxWindows && props.fsxWindowsConfig) {
      this.outputs.fsxWindowsFileSystem = this.createFsxWindows(props, storageSecurityGroup);
    }
    
    // Create FSx for Lustre if enabled
    if (props.enableFsxLustre && props.fsxLustreConfig) {
      this.outputs.fsxLustreFileSystem = this.createFsxLustre(props, storageSecurityGroup);
    }
    
    // Create FSx for ONTAP if enabled
    if (props.enableFsxOntap && props.fsxOntapConfig) {
      const ontapOutputs = this.createFsxOntap(props, storageSecurityGroup);
      this.outputs.fsxOntapFileSystem = ontapOutputs.fileSystem;
      this.outputs.fsxOntapStorageVirtualMachines = ontapOutputs.svms;
      this.outputs.fsxOntapVolumes = ontapOutputs.volumes;
    }
    
    // Create FSx for OpenZFS if enabled
    if (props.enableFsxOpenZfs && props.fsxOpenZfsConfig) {
      const openzfsOutputs = this.createFsxOpenZfs(props, storageSecurityGroup);
      this.outputs.fsxOpenZfsFileSystem = openzfsOutputs.fileSystem;
      this.outputs.fsxOpenZfsVolumes = openzfsOutputs.volumes;
    }
    
    // Create S3 transfer bucket if enabled
    if (props.enableS3Transfer !== false) {
      const s3Outputs = this.createS3TransferBucket(props);
      this.outputs.transferBucket = s3Outputs.bucket;
      this.outputs.accessLogsBucket = s3Outputs.logsBucket;
    }
    
    // Create MinIO deployment if enabled
    if (props.minioConfig?.enabled) {
      this.outputs.minioInstances = this.createMinioDeployment(props, storageSecurityGroup);
    }
    
    // Create IAM policies if requested
    if (props.createIamPolicies) {
      this.createIamPolicies(props);
    }
    
    // Create backup plan for production
    if (props.enableBackup && props.environment === 'prod') {
      this.createBackupPlan(props);
    }
    
    // Create CloudWatch dashboard
    if (props.monitoringConfig?.enableDashboard !== false) {
      this.outputs.dashboard = this.createCloudWatchDashboard(props);
    }
    
    // Create CloudWatch alarms
    if (props.monitoringConfig?.enableAlarms) {
      this.createCloudWatchAlarms(props);
    }
    
    // Create SSM parameters for service discovery
    this.createSsmParameters(props);
    
    // Create stack outputs
    this.createStackOutputs(props);
    
    // Apply tags
    this.applyTags(props);
  }
  
  //============================================================================
  // KMS Key
  //============================================================================
  
  private createOrGetKmsKey(props: EnterpriseStorageProps): kms.IKey {
    if (props.kmsKey) {
      return props.kmsKey;
    }
    
    if (props.createKmsKey === false) {
      return kms.Alias.fromAliasName(this, 'AwsManagedKey', 'alias/aws/fsx');
    }
    
    const key = new kms.Key(this, 'StorageKmsKey', {
      description: `KMS key for enterprise storage - ${this.projectName}`,
      enableKeyRotation: props.kmsKeyRotationEnabled ?? true,
      removalPolicy: props.environment === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
      pendingWindow: cdk.Duration.days(props.kmsKeyDeletionWindow ?? 30),
    });
    
    key.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowFSxService',
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('fsx.amazonaws.com')],
      actions: [
        'kms:Encrypt',
        'kms:Decrypt',
        'kms:ReEncrypt*',
        'kms:GenerateDataKey*',
        'kms:DescribeKey',
        'kms:CreateGrant',
      ],
      resources: ['*'],
    }));
    
    key.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowEFSService',
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('elasticfilesystem.amazonaws.com')],
      actions: [
        'kms:Encrypt',
        'kms:Decrypt',
        'kms:ReEncrypt*',
        'kms:GenerateDataKey*',
        'kms:DescribeKey',
        'kms:CreateGrant',
      ],
      resources: ['*'],
    }));
    
    new kms.Alias(this, 'StorageKmsKeyAlias', {
      aliasName: `alias/${this.projectName}-storage`,
      targetKey: key,
    });
    
    return key;
  }
  
  //============================================================================
  // Alarm Topic
  //============================================================================
  
  private createAlarmTopic(props: EnterpriseStorageProps): sns.Topic {
    const topic = new sns.Topic(this, 'StorageAlarmTopic', {
      topicName: `${this.projectName}-storage-alarms`,
      displayName: `${this.projectName} Storage Alarms`,
    });
    
    if (props.monitoringConfig?.alarmEmail) {
      new sns.Subscription(this, 'AlarmEmailSubscription', {
        topic,
        protocol: sns.SubscriptionProtocol.EMAIL,
        endpoint: props.monitoringConfig.alarmEmail,
      });
    }
    
    return topic;
  }
  
  //============================================================================
  // Security Group
  //============================================================================
  
  private createStorageSecurityGroup(props: EnterpriseStorageProps): ec2.SecurityGroup {
    const sg = new ec2.SecurityGroup(this, 'StorageSecurityGroup', {
      vpc: this.vpc,
      description: `Security group for ${this.projectName} enterprise storage`,
      allowAllOutbound: false,
    });
    
    const allowedCidrs = props.allowedCidrBlocks || [this.vpc.vpcCidrBlock];
    
    for (const cidr of allowedCidrs) {
      // NFS ports
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(111), 'NFS portmapper');
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.udp(111), 'NFS portmapper UDP');
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(2049), 'NFS');
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.udp(2049), 'NFS UDP');
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(635), 'NFS mountd');
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.udp(635), 'NFS mountd UDP');
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcpRange(4045, 4046), 'NFS lockd');
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.udpRange(4045, 4046), 'NFS lockd UDP');
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcpRange(20001, 20003), 'OpenZFS NFS');
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.udpRange(20001, 20003), 'OpenZFS NFS UDP');
      
      // SMB ports
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(445), 'SMB');
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.udp(445), 'SMB UDP');
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(139), 'NetBIOS');
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcpRange(5985, 5986), 'WinRM');
      
      // iSCSI
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(3260), 'iSCSI');
      
      // ONTAP management
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(443), 'ONTAP REST API');
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(22), 'SSH');
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcpRange(11104, 11105), 'ONTAP intercluster');
      
      // Lustre
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(988), 'Lustre');
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcpRange(1018, 1023), 'Lustre data');
      
      // DNS
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(53), 'DNS TCP');
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.udp(53), 'DNS UDP');
      
      // MinIO
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(9000), 'MinIO API');
      sg.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(9001), 'MinIO Console');
    }
    
    sg.addEgressRule(ec2.Peer.ipv4(this.vpc.vpcCidrBlock), ec2.Port.allTraffic(), 'VPC traffic');
    sg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS for AWS APIs');
    
    cdk.Tags.of(sg).add('Name', `${this.projectName}-storage-sg`);
    
    return sg;
  }
  
  //============================================================================
  // EFS
  //============================================================================
  
  private createEfsFileSystem(
    props: EnterpriseStorageProps,
    securityGroup: ec2.SecurityGroup
  ): { fileSystem: efs.FileSystem; accessPoints: { [key: string]: efs.AccessPoint } } {
    const config = props.efsConfig || {};
    
    const fileSystem = new efs.FileSystem(this, 'EfsFileSystem', {
      vpc: this.vpc,
      securityGroup,
      encrypted: config.encrypted ?? true,
      kmsKey: config.encrypted !== false ? this.kmsKey : undefined,
      performanceMode: config.performanceMode || efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: config.throughputMode || efs.ThroughputMode.BURSTING,
      provisionedThroughputPerSecond: config.provisionedThroughputPerSecond,
      lifecyclePolicy: config.lifecyclePolicy || efs.LifecyclePolicy.AFTER_30_DAYS,
      enableAutomaticBackups: config.enableAutomaticBackups ?? (props.environment === 'prod'),
      removalPolicy: props.environment === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
      vpcSubnets: {
        subnets: this.subnetIds.map((id, index) => 
          ec2.Subnet.fromSubnetId(this, `EfsSubnet${index}`, id)
        ),
      },
    });
    
    const accessPoints: { [key: string]: efs.AccessPoint } = {};
    
    accessPoints['default'] = fileSystem.addAccessPoint('DefaultAccessPoint', {
      path: '/data',
      createAcl: {
        ownerGid: '1000',
        ownerUid: '1000',
        permissions: '755',
      },
      posixUser: {
        gid: '1000',
        uid: '1000',
      },
    });
    
    if (config.accessPoints) {
      for (const [key, apConfig] of Object.entries(config.accessPoints)) {
        accessPoints[key] = fileSystem.addAccessPoint(`AccessPoint-${key}`, {
          path: apConfig.path,
          createAcl: {
            ownerGid: apConfig.creationInfo.ownerGid,
            ownerUid: apConfig.creationInfo.ownerUid,
            permissions: apConfig.creationInfo.permissions,
          },
          posixUser: {
            gid: apConfig.posixUser.gid,
            uid: apConfig.posixUser.uid,
            secondaryGids: apConfig.posixUser.secondaryGids,
          },
        });
      }
    }
    
    cdk.Tags.of(fileSystem).add('Name', `${this.projectName}-efs`);
    
    return { fileSystem, accessPoints };
  }
  
  //============================================================================
  // FSx for Windows
  //============================================================================
  
  private createFsxWindows(
    props: EnterpriseStorageProps,
    securityGroup: ec2.SecurityGroup
  ): fsx.CfnFileSystem {
    const config = props.fsxWindowsConfig!;
    const isMultiAz = config.deploymentType === 'MULTI_AZ_1';
    
    const windowsConfig: fsx.CfnFileSystem.WindowsConfigurationProperty = {
      throughputCapacity: config.throughputCapacity,
      deploymentType: config.deploymentType,
      automaticBackupRetentionDays: config.backup?.automaticBackupRetentionDays ?? 7,
      dailyAutomaticBackupStartTime: config.backup?.dailyBackupStartTime || '02:00',
      weeklyMaintenanceStartTime: config.backup?.weeklyMaintenanceStartTime,
      copyTagsToBackups: config.backup?.copyTagsToBackups ?? true,
      preferredSubnetId: isMultiAz ? (config.preferredSubnetId || this.subnetIds[0]) : undefined,
      aliases: config.aliases,
    };
    
    if (config.activeDirectory) {
      if (config.activeDirectory.type === 'aws_managed' && config.activeDirectory.directoryId) {
        (windowsConfig as any).activeDirectoryId = config.activeDirectory.directoryId;
      } else if (config.activeDirectory.type === 'self_managed') {
        (windowsConfig as any).selfManagedActiveDirectoryConfiguration = {
          dnsIps: config.activeDirectory.dnsIps,
          domainName: config.activeDirectory.domainName,
          userName: config.activeDirectory.username,
          password: config.activeDirectory.password?.toString(),
          organizationalUnitDistinguishedName: config.activeDirectory.organizationalUnit,
          fileSystemAdministratorsGroup: config.activeDirectory.fileSystemAdministratorsGroup,
        };
      }
    }
    
    if (config.auditLogConfig?.destination) {
      (windowsConfig as any).auditLogConfiguration = {
        auditLogDestination: config.auditLogConfig.destination,
        fileAccessAuditLogLevel: config.auditLogConfig.fileAccessAuditLogLevel || 'DISABLED',
        fileShareAccessAuditLogLevel: config.auditLogConfig.fileShareAccessAuditLogLevel || 'DISABLED',
      };
    }
    
    if (config.diskIops && config.storageType !== 'HDD') {
      (windowsConfig as any).diskIopsConfiguration = {
        iops: config.diskIops.iops,
        mode: config.diskIops.mode,
      };
    }
    
    const fileSystem = new fsx.CfnFileSystem(this, 'FsxWindowsFileSystem', {
      fileSystemType: 'WINDOWS',
      storageCapacity: config.storageCapacity,
      subnetIds: isMultiAz ? this.subnetIds.slice(0, 2) : [this.subnetIds[0]],
      securityGroupIds: [securityGroup.securityGroupId, ...(props.additionalSecurityGroupIds || [])],
      storageType: config.storageType || 'SSD',
      windowsConfiguration: windowsConfig,
      kmsKeyId: this.kmsKey.keyArn,
      tags: [
        { key: 'Name', value: `${this.projectName}-fsx-windows` },
        { key: 'Environment', value: this.environment },
      ],
    });
    
    return fileSystem;
  }
  
  //============================================================================
  // FSx for Lustre
  //============================================================================
  
  private createFsxLustre(
    props: EnterpriseStorageProps,
    securityGroup: ec2.SecurityGroup
  ): fsx.CfnFileSystem {
    const config = props.fsxLustreConfig!;
    const isPersistent = config.deploymentType.startsWith('PERSISTENT');
    
    const lustreConfig: fsx.CfnFileSystem.LustreConfigurationProperty = {
      deploymentType: config.deploymentType,
      dataCompressionType: config.dataCompressionType || 'LZ4',
      perUnitStorageThroughput: isPersistent ? config.perUnitStorageThroughput : undefined,
      automaticBackupRetentionDays: isPersistent ? (config.backup?.automaticBackupRetentionDays ?? 0) : undefined,
      dailyAutomaticBackupStartTime: isPersistent ? config.backup?.dailyBackupStartTime : undefined,
      copyTagsToBackups: isPersistent ? (config.backup?.copyTagsToBackups ?? true) : undefined,
      weeklyMaintenanceStartTime: config.backup?.weeklyMaintenanceStartTime,
      importPath: config.s3ImportPath,
      exportPath: config.s3ExportPath,
      importedFileChunkSize: config.importedFileChunkSize,
      autoImportPolicy: config.autoImportPolicy,
      driveCacheType: config.driveCacheType,
    };
    
    const fileSystem = new fsx.CfnFileSystem(this, 'FsxLustreFileSystem', {
      fileSystemType: 'LUSTRE',
      storageCapacity: config.storageCapacity,
      subnetIds: [this.subnetIds[0]],
      securityGroupIds: [securityGroup.securityGroupId, ...(props.additionalSecurityGroupIds || [])],
      storageType: config.storageType || 'SSD',
      lustreConfiguration: lustreConfig,
      kmsKeyId: isPersistent ? this.kmsKey.keyArn : undefined,
      tags: [
        { key: 'Name', value: `${this.projectName}-fsx-lustre` },
        { key: 'Environment', value: this.environment },
      ],
    });
    
    if (config.dataRepositoryAssociations) {
      for (const [key, dra] of Object.entries(config.dataRepositoryAssociations)) {
        const associationConfig: any = {
          fileSystemId: fileSystem.ref,
          fileSystemPath: dra.fileSystemPath,
          dataRepositoryPath: dra.dataRepositoryPath,
          batchImportMetaDataOnCreate: dra.batchImportMetaDataOnCreate,
        };
        
        if (dra.autoExportEvents || dra.autoImportEvents) {
          associationConfig.s3 = {};
          if (dra.autoExportEvents) {
            associationConfig.s3.autoExportPolicy = { events: dra.autoExportEvents };
          }
          if (dra.autoImportEvents) {
            associationConfig.s3.autoImportPolicy = { events: dra.autoImportEvents };
          }
        }
        
        new fsx.CfnDataRepositoryAssociation(this, `LustreDra-${key}`, associationConfig);
      }
    }
    
    return fileSystem;
  }
  
  //============================================================================
  // FSx for NetApp ONTAP
  //============================================================================
  
  private createFsxOntap(
    props: EnterpriseStorageProps,
    securityGroup: ec2.SecurityGroup
  ): {
    fileSystem: fsx.CfnFileSystem;
    svms: { [key: string]: fsx.CfnStorageVirtualMachine };
    volumes: { [key: string]: fsx.CfnVolume };
  } {
    const config = props.fsxOntapConfig!;
    const isMultiAz = config.deploymentType.startsWith('MULTI_AZ');
    const isVersion2 = config.deploymentType.endsWith('_2');
    
    const ontapConfig: fsx.CfnFileSystem.OntapConfigurationProperty = {
      deploymentType: config.deploymentType,
      automaticBackupRetentionDays: config.backup?.automaticBackupRetentionDays ?? 0,
      dailyAutomaticBackupStartTime: config.backup?.dailyBackupStartTime,
      weeklyMaintenanceStartTime: config.backup?.weeklyMaintenanceStartTime,
      fsxAdminPassword: config.fsxAdminPassword?.toString(),
      preferredSubnetId: isMultiAz ? (config.preferredSubnetId || this.subnetIds[0]) : undefined,
      routeTableIds: isMultiAz ? config.routeTableIds : undefined,
      endpointIpAddressRange: isMultiAz ? config.endpointIpAddressRange : undefined,
      throughputCapacity: !isVersion2 ? config.throughputCapacity : undefined,
      throughputCapacityPerHaPair: isVersion2 ? config.throughputCapacityPerHaPair : undefined,
      haPairs: config.haPairs,
    };
    
    if (config.diskIops) {
      (ontapConfig as any).diskIopsConfiguration = {
        iops: config.diskIops.iops,
        mode: config.diskIops.mode,
      };
    }
    
    const fileSystem = new fsx.CfnFileSystem(this, 'FsxOntapFileSystem', {
      fileSystemType: 'ONTAP',
      storageCapacity: config.storageCapacity,
      subnetIds: isMultiAz ? this.subnetIds.slice(0, 2) : [this.subnetIds[0]],
      securityGroupIds: [securityGroup.securityGroupId, ...(props.additionalSecurityGroupIds || [])],
      storageType: config.storageType || 'SSD',
      ontapConfiguration: ontapConfig,
      kmsKeyId: this.kmsKey.keyArn,
      tags: [
        { key: 'Name', value: `${this.projectName}-fsx-ontap` },
        { key: 'Environment', value: this.environment },
      ],
    });
    
    const svms: { [key: string]: fsx.CfnStorageVirtualMachine } = {};
    
    for (const [key, svmConfig] of Object.entries(config.storageVirtualMachines)) {
      const svmProps: any = {
        fileSystemId: fileSystem.ref,
        name: svmConfig.name,
        rootVolumeSecurityStyle: svmConfig.rootVolumeSecurityStyle || 'UNIX',
        svmAdminPassword: svmConfig.svmAdminPassword?.toString(),
      };
      
      if (svmConfig.activeDirectory) {
        svmProps.activeDirectoryConfiguration = {
          netBiosName: svmConfig.activeDirectory.netbiosName,
        };
        
        if (svmConfig.activeDirectory.type === 'self_managed') {
          svmProps.activeDirectoryConfiguration.selfManagedActiveDirectoryConfiguration = {
            dnsIps: svmConfig.activeDirectory.dnsIps,
            domainName: svmConfig.activeDirectory.domainName,
            userName: svmConfig.activeDirectory.username,
            password: svmConfig.activeDirectory.password?.toString(),
            organizationalUnitDistinguishedName: svmConfig.activeDirectory.organizationalUnit,
            fileSystemAdministratorsGroup: svmConfig.activeDirectory.fileSystemAdministratorsGroup,
          };
        }
      }
      
      svms[key] = new fsx.CfnStorageVirtualMachine(this, `OntapSvm-${key}`, svmProps);
      cdk.Tags.of(svms[key]).add('Name', `${this.projectName}-ontap-svm-${key}`);
    }
    
    const volumes: { [key: string]: fsx.CfnVolume } = {};
    
    for (const [key, volConfig] of Object.entries(config.volumes)) {
      const volumeProps: any = {
        name: volConfig.name,
        volumeType: 'ONTAP',
        ontapConfiguration: {
          junctionPath: volConfig.junctionPath,
          sizeInMegabytes: volConfig.sizeInMegabytes.toString(),
          storageVirtualMachineId: svms[volConfig.svmKey].ref,
          storageEfficiencyEnabled: volConfig.storageEfficiencyEnabled ?? true,
          securityStyle: volConfig.securityStyle || 'UNIX',
          ontapVolumeType: volConfig.ontapVolumeType || 'RW',
          copyTagsToBackups: volConfig.copyTagsToBackups ?? true,
          snapshotPolicy: volConfig.snapshotPolicy || 'default',
        },
      };
      
      if (volConfig.tieringPolicy) {
        volumeProps.ontapConfiguration.tieringPolicy = {
          name: volConfig.tieringPolicy.name,
          coolingPeriod: volConfig.tieringPolicy.coolingPeriod,
        };
      }
      
      volumes[key] = new fsx.CfnVolume(this, `OntapVolume-${key}`, volumeProps);
      volumes[key].addDependency(svms[volConfig.svmKey]);
      cdk.Tags.of(volumes[key]).add('Name', `${this.projectName}-ontap-volume-${key}`);
    }
    
    return { fileSystem, svms, volumes };
  }
  
  //============================================================================
  // FSx for OpenZFS
  //============================================================================
  
  private createFsxOpenZfs(
    props: EnterpriseStorageProps,
    securityGroup: ec2.SecurityGroup
  ): { fileSystem: fsx.CfnFileSystem; volumes: { [key: string]: fsx.CfnVolume } } {
    const config = props.fsxOpenZfsConfig!;
    const isMultiAz = config.deploymentType === 'MULTI_AZ_1';
    
    const rootVolumeConfig: any = {
      dataCompressionType: config.rootVolumeConfig.dataCompressionType || 'ZSTD',
      readOnly: config.rootVolumeConfig.readOnly ?? false,
      recordSizeKiB: config.rootVolumeConfig.recordSizeKib || 128,
      copyTagsToSnapshots: config.rootVolumeConfig.copyTagsToSnapshots ?? true,
    };
    
    if (config.rootVolumeConfig.nfsExports) {
      rootVolumeConfig.nfsExports = [{
        clientConfigurations: config.rootVolumeConfig.nfsExports.clientConfigurations.map(cc => ({
          clients: cc.clients,
          options: cc.options,
        })),
      }];
    }
    
    if (config.rootVolumeConfig.userAndGroupQuotas) {
      rootVolumeConfig.userAndGroupQuotas = config.rootVolumeConfig.userAndGroupQuotas.map(q => ({
        id: q.id,
        storageCapacityQuotaGiB: q.storageCapacityQuotaGib,
        type: q.type,
      }));
    }
    
    const openZfsConfig: fsx.CfnFileSystem.OpenZFSConfigurationProperty = {
      deploymentType: config.deploymentType,
      automaticBackupRetentionDays: config.backup?.automaticBackupRetentionDays ?? 0,
      dailyAutomaticBackupStartTime: config.backup?.dailyBackupStartTime,
      weeklyMaintenanceStartTime: config.backup?.weeklyMaintenanceStartTime,
      copyTagsToBackups: config.copyTagsToBackups ?? true,
      copyTagsToVolumes: config.copyTagsToVolumes ?? true,
      throughputCapacity: config.throughputCapacity,
      rootVolumeConfiguration: rootVolumeConfig,
      preferredSubnetId: isMultiAz ? (config.preferredSubnetId || this.subnetIds[0]) : undefined,
      routeTableIds: isMultiAz ? config.routeTableIds : undefined,
    };
    
    if (config.diskIops) {
      (openZfsConfig as any).diskIopsConfiguration = {
        iops: config.diskIops.iops,
        mode: config.diskIops.mode,
      };
    }
    
    const fileSystem = new fsx.CfnFileSystem(this, 'FsxOpenZfsFileSystem', {
      fileSystemType: 'OPENZFS',
      storageCapacity: config.storageCapacity,
      subnetIds: isMultiAz ? this.subnetIds.slice(0, 2) : [this.subnetIds[0]],
      securityGroupIds: [securityGroup.securityGroupId, ...(props.additionalSecurityGroupIds || [])],
      storageType: config.storageType || 'SSD',
      openZfsConfiguration: openZfsConfig,
      kmsKeyId: this.kmsKey.keyArn,
      tags: [
        { key: 'Name', value: `${this.projectName}-fsx-openzfs` },
        { key: 'Environment', value: this.environment },
      ],
    });
    
    const volumes: { [key: string]: fsx.CfnVolume } = {};
    
    if (config.volumes) {
      for (const [key, volConfig] of Object.entries(config.volumes)) {
        const volumeProps: any = {
          name: volConfig.name,
          volumeType: 'OPENZFS',
          openZfsConfiguration: {
            parentVolumeId: volConfig.parentVolumeId || fileSystem.attrRootVolumeId,
            storageCapacityQuotaGiB: volConfig.storageCapacityQuotaGib,
            storageCapacityReservationGiB: volConfig.storageCapacityReservationGib,
            dataCompressionType: volConfig.dataCompressionType || 'ZSTD',
            readOnly: volConfig.readOnly ?? false,
            recordSizeKiB: volConfig.recordSizeKib || 128,
            copyTagsToSnapshots: volConfig.copyTagsToSnapshots ?? true,
          },
        };
        
        if (volConfig.nfsExports) {
          volumeProps.openZfsConfiguration.nfsExports = [{
            clientConfigurations: volConfig.nfsExports.clientConfigurations.map(cc => ({
              clients: cc.clients,
              options: cc.options,
            })),
          }];
        }
        
        if (volConfig.userAndGroupQuotas) {
          volumeProps.openZfsConfiguration.userAndGroupQuotas = volConfig.userAndGroupQuotas.map(q => ({
            id: q.id,
            storageCapacityQuotaGiB: q.storageCapacityQuotaGib,
            type: q.type,
          }));
        }
        
        volumes[key] = new fsx.CfnVolume(this, `OpenZfsVolume-${key}`, volumeProps);
        cdk.Tags.of(volumes[key]).add('Name', `${this.projectName}-openzfs-volume-${key}`);
      }
    }
    
    return { fileSystem, volumes };
  }
  
  //============================================================================
  // S3 Transfer Bucket
  //============================================================================
  
  private createS3TransferBucket(props: EnterpriseStorageProps): {
    bucket: s3.Bucket;
    logsBucket?: s3.Bucket;
  } {
    const config = props.s3TransferConfig || {};
    
    let logsBucket: s3.Bucket | undefined;
    if (config.enableAccessLogging !== false) {
      logsBucket = new s3.Bucket(this, 'TransferLogsBucket', {
        bucketName: `${this.projectName}-transfer-logs-${cdk.Stack.of(this).account}`,
        encryption: s3.BucketEncryption.S3_MANAGED,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        removalPolicy: props.environment === 'prod' 
          ? cdk.RemovalPolicy.RETAIN 
          : cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: props.environment !== 'prod',
        lifecycleRules: [
          {
            expiration: cdk.Duration.days(90),
            transitions: [
              {
                storageClass: s3.StorageClass.INTELLIGENT_TIERING,
                transitionAfter: cdk.Duration.days(30),
              },
            ],
          },
        ],
      });
    }
    
    const lifecycleRules: s3.LifecycleRule[] = [
      {
        id: 'AbortIncompleteMultipartUploads',
        abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
      },
    ];
    
    if (config.lifecycleRules) {
      const transitions: s3.Transition[] = [];
      
      if (config.lifecycleRules.transitionToIaDays) {
        transitions.push({
          storageClass: s3.StorageClass.INFREQUENT_ACCESS,
          transitionAfter: cdk.Duration.days(config.lifecycleRules.transitionToIaDays),
        });
      }
      
      if (config.lifecycleRules.transitionToGlacierDays) {
        transitions.push({
          storageClass: s3.StorageClass.GLACIER,
          transitionAfter: cdk.Duration.days(config.lifecycleRules.transitionToGlacierDays),
        });
      }
      
      if (transitions.length > 0 || config.lifecycleRules.expirationDays) {
        lifecycleRules.push({
          id: 'ArchiveOldData',
          transitions,
          expiration: config.lifecycleRules.expirationDays 
            ? cdk.Duration.days(config.lifecycleRules.expirationDays) 
            : undefined,
        });
      }
    }
    
    const bucket = new s3.Bucket(this, 'TransferBucket', {
      bucketName: `${this.projectName}-transfer-${cdk.Stack.of(this).account}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.kmsKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: config.enableVersioning ?? (props.environment === 'prod'),
      serverAccessLogsBucket: logsBucket,
      serverAccessLogsPrefix: logsBucket ? 'access-logs/' : undefined,
      removalPolicy: props.environment === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: props.environment !== 'prod',
      lifecycleRules,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.DELETE,
            s3.HttpMethods.HEAD,
          ],
          allowedOrigins: config.corsOrigins || ['*'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag', 'x-amz-server-side-encryption'],
          maxAge: 3600,
        },
      ],
    });
    
    cdk.Tags.of(bucket).add('Name', `${this.projectName}-transfer`);
    
    return { bucket, logsBucket };
  }
  
  //============================================================================
  // MinIO Deployment
  //============================================================================
  
  private createMinioDeployment(
    props: EnterpriseStorageProps,
    securityGroup: ec2.SecurityGroup
  ): ec2.CfnInstance[] {
    const config = props.minioConfig!;
    const instances: ec2.CfnInstance[] = [];
    
    // Get the latest Amazon Linux 2 AMI
    const ami = ec2.MachineImage.latestAmazonLinux2();
    
    const nodeCount = config.mode === 'distributed' ? (config.nodeCount || 4) : 1;
    
    for (let i = 0; i < nodeCount; i++) {
      const userData = ec2.UserData.forLinux();
      userData.addCommands(
        '#!/bin/bash',
        'yum update -y',
        'yum install -y docker',
        'systemctl start docker',
        'systemctl enable docker',
        `docker run -d --name minio -p ${config.apiPort || 9000}:9000 -p ${config.consolePort || 9001}:9001 ` +
        '-v /data:/data minio/minio server /data --console-address ":9001"',
      );
      
      const instance = new ec2.CfnInstance(this, `MinioInstance${i}`, {
        instanceType: config.instanceType || 't3.medium',
        imageId: ami.getImage(this).imageId,
        subnetId: this.subnetIds[i % this.subnetIds.length],
        securityGroupIds: [securityGroup.securityGroupId],
        userData: cdk.Fn.base64(userData.render()),
        tags: [
          { key: 'Name', value: `${this.projectName}-minio-${i}` },
          { key: 'Environment', value: this.environment },
        ],
      });
      
      instances.push(instance);
    }
    
    return instances;
  }
  
  //============================================================================
  // IAM Policies
  //============================================================================
  
  private createIamPolicies(props: EnterpriseStorageProps): void {
    // FSx Access Policy
    if (props.enableFsxWindows || props.enableFsxLustre || props.enableFsxOntap || props.enableFsxOpenZfs) {
      this.outputs.fsxAccessPolicy = new iam.ManagedPolicy(this, 'FsxAccessPolicy', {
        managedPolicyName: `${this.projectName}-fsx-access`,
        description: 'Policy for accessing FSx file systems',
        statements: [
          new iam.PolicyStatement({
            sid: 'FSxDescribe',
            effect: iam.Effect.ALLOW,
            actions: [
              'fsx:DescribeFileSystems',
              'fsx:DescribeBackups',
              'fsx:DescribeVolumes',
              'fsx:DescribeStorageVirtualMachines',
            ],
            resources: ['*'],
          }),
        ],
      });
    }
    
    // EFS Access Policy
    if (this.outputs.efsFileSystem) {
      this.outputs.efsAccessPolicy = new iam.ManagedPolicy(this, 'EfsAccessPolicy', {
        managedPolicyName: `${this.projectName}-efs-access`,
        description: 'Policy for accessing EFS file systems',
        statements: [
          new iam.PolicyStatement({
            sid: 'EFSAccess',
            effect: iam.Effect.ALLOW,
            actions: [
              'elasticfilesystem:ClientMount',
              'elasticfilesystem:ClientWrite',
              'elasticfilesystem:DescribeFileSystems',
              'elasticfilesystem:DescribeMountTargets',
            ],
            resources: [this.outputs.efsFileSystem.fileSystemArn],
          }),
        ],
      });
    }
    
    // S3 Access Policy
    if (this.outputs.transferBucket) {
      this.outputs.s3AccessPolicy = new iam.ManagedPolicy(this, 'S3AccessPolicy', {
        managedPolicyName: `${this.projectName}-s3-access`,
        description: 'Policy for accessing S3 transfer bucket',
        statements: [
          new iam.PolicyStatement({
            sid: 'S3ReadWrite',
            effect: iam.Effect.ALLOW,
            actions: [
              's3:GetObject',
              's3:PutObject',
              's3:DeleteObject',
              's3:ListBucket',
            ],
            resources: [
              this.outputs.transferBucket.bucketArn,
              `${this.outputs.transferBucket.bucketArn}/*`,
            ],
          }),
        ],
      });
    }
  }
  
  //============================================================================
  // Backup Plan
  //============================================================================
  
  private createBackupPlan(props: EnterpriseStorageProps): void {
    const plan = new backup.BackupPlan(this, 'StorageBackupPlan', {
      backupPlanName: `${this.projectName}-storage-backup`,
      backupPlanRules: [
        backup.BackupPlanRule.daily(),
        backup.BackupPlanRule.weekly(),
        backup.BackupPlanRule.monthly1Year(),
      ],
    });
    
    if (this.outputs.efsFileSystem) {
      plan.addSelection('EfsBackupSelection', {
        resources: [
          backup.BackupResource.fromEfsFileSystem(this.outputs.efsFileSystem),
        ],
      });
    }
  }
  
  //============================================================================
  // CloudWatch Dashboard
  //============================================================================
  
  private createCloudWatchDashboard(props: EnterpriseStorageProps): cloudwatch.Dashboard {
    const widgets: cloudwatch.IWidget[] = [];
    
    if (this.outputs.efsFileSystem) {
      widgets.push(
        new cloudwatch.GraphWidget({
          title: 'EFS Throughput',
          left: [
            new cloudwatch.Metric({
              namespace: 'AWS/EFS',
              metricName: 'DataReadIOBytes',
              dimensionsMap: { FileSystemId: this.outputs.efsFileSystem.fileSystemId },
              statistic: 'Sum',
              period: cdk.Duration.minutes(5),
            }),
            new cloudwatch.Metric({
              namespace: 'AWS/EFS',
              metricName: 'DataWriteIOBytes',
              dimensionsMap: { FileSystemId: this.outputs.efsFileSystem.fileSystemId },
              statistic: 'Sum',
              period: cdk.Duration.minutes(5),
            }),
          ],
          width: 12,
        }),
        new cloudwatch.GraphWidget({
          title: 'EFS Client Connections',
          left: [
            new cloudwatch.Metric({
              namespace: 'AWS/EFS',
              metricName: 'ClientConnections',
              dimensionsMap: { FileSystemId: this.outputs.efsFileSystem.fileSystemId },
              statistic: 'Sum',
              period: cdk.Duration.minutes(5),
            }),
          ],
          width: 12,
        })
      );
    }
    
    if (this.outputs.transferBucket) {
      widgets.push(
        new cloudwatch.GraphWidget({
          title: 'S3 Bucket Size',
          left: [
            new cloudwatch.Metric({
              namespace: 'AWS/S3',
              metricName: 'BucketSizeBytes',
              dimensionsMap: {
                BucketName: this.outputs.transferBucket.bucketName,
                StorageType: 'StandardStorage',
              },
              statistic: 'Average',
              period: cdk.Duration.days(1),
            }),
          ],
          width: 12,
        })
      );
    }
    
    return new cloudwatch.Dashboard(this, 'StorageDashboard', {
      dashboardName: `${this.projectName}-storage`,
      widgets: widgets.length > 0 ? [widgets] : undefined,
    });
  }
  
  //============================================================================
  // CloudWatch Alarms
  //============================================================================
  
  private createCloudWatchAlarms(props: EnterpriseStorageProps): void {
    if (this.outputs.efsFileSystem && this.outputs.alarmTopic) {
      const burstCreditAlarm = new cloudwatch.Alarm(this, 'EfsBurstCreditAlarm', {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/EFS',
          metricName: 'BurstCreditBalance',
          dimensionsMap: { FileSystemId: this.outputs.efsFileSystem.fileSystemId },
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 1000000000,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        alarmDescription: 'EFS burst credits are low',
      });
      
      burstCreditAlarm.addAlarmAction({
        bind: () => ({ alarmActionArn: this.outputs.alarmTopic!.topicArn }),
      });
    }
  }
  
  //============================================================================
  // SSM Parameters
  //============================================================================
  
  private createSsmParameters(props: EnterpriseStorageProps): void {
    if (this.outputs.efsFileSystem) {
      new ssm.StringParameter(this, 'EfsFileSystemIdParam', {
        parameterName: `/${this.projectName}/storage/efs/file-system-id`,
        stringValue: this.outputs.efsFileSystem.fileSystemId,
        description: 'EFS File System ID',
      });
    }
    
    if (this.outputs.transferBucket) {
      new ssm.StringParameter(this, 'TransferBucketNameParam', {
        parameterName: `/${this.projectName}/storage/s3/transfer-bucket`,
        stringValue: this.outputs.transferBucket.bucketName,
        description: 'S3 Transfer Bucket Name',
      });
    }
  }
  
  //============================================================================
  // Stack Outputs
  //============================================================================
  
  private createStackOutputs(props: EnterpriseStorageProps): void {
    new cdk.CfnOutput(this, 'StorageSecurityGroupId', {
      value: this.outputs.storageSecurityGroup.securityGroupId,
      description: 'Security group ID for storage access',
      exportName: `${this.projectName}-StorageSecurityGroupId`,
    });
    
    if (this.outputs.efsFileSystem) {
      new cdk.CfnOutput(this, 'EfsFileSystemId', {
        value: this.outputs.efsFileSystem.fileSystemId,
        description: 'EFS File System ID',
        exportName: `${this.projectName}-EfsFileSystemId`,
      });
    }
    
    if (this.outputs.fsxWindowsFileSystem) {
      new cdk.CfnOutput(this, 'FsxWindowsFileSystemId', {
        value: this.outputs.fsxWindowsFileSystem.ref,
        description: 'FSx Windows File System ID',
        exportName: `${this.projectName}-FsxWindowsId`,
      });
    }
    
    if (this.outputs.fsxLustreFileSystem) {
      new cdk.CfnOutput(this, 'FsxLustreFileSystemId', {
        value: this.outputs.fsxLustreFileSystem.ref,
        description: 'FSx Lustre File System ID',
        exportName: `${this.projectName}-FsxLustreId`,
      });
    }
    
    if (this.outputs.fsxOntapFileSystem) {
      new cdk.CfnOutput(this, 'FsxOntapFileSystemId', {
        value: this.outputs.fsxOntapFileSystem.ref,
        description: 'FSx ONTAP File System ID',
        exportName: `${this.projectName}-FsxOntapId`,
      });
    }
    
    if (this.outputs.fsxOpenZfsFileSystem) {
      new cdk.CfnOutput(this, 'FsxOpenZfsFileSystemId', {
        value: this.outputs.fsxOpenZfsFileSystem.ref,
        description: 'FSx OpenZFS File System ID',
        exportName: `${this.projectName}-FsxOpenZfsId`,
      });
    }
    
    if (this.outputs.transferBucket) {
      new cdk.CfnOutput(this, 'TransferBucketName', {
        value: this.outputs.transferBucket.bucketName,
        description: 'S3 Transfer Bucket Name',
        exportName: `${this.projectName}-TransferBucketName`,
      });
    }
  }
  
  //============================================================================
  // Apply Tags
  //============================================================================
  
  private applyTags(props: EnterpriseStorageProps): void {
    const tags: { [key: string]: string } = {
      Environment: this.environment,
      Project: this.projectName,
      ManagedBy: 'CDK',
      ...props.tags,
    };
    
    if (props.costCenter) {
      tags['CostCenter'] = props.costCenter;
    }
    
    for (const [key, value] of Object.entries(tags)) {
      cdk.Tags.of(this).add(key, value);
    }
  }
  
  //============================================================================
  // Helper Methods for Integration
  //============================================================================
  
  /**
   * Grant read/write access to the EFS file system
   */
  public grantEfsReadWrite(grantee: iam.IGrantable): iam.Grant {
    if (!this.outputs.efsFileSystem) {
      throw new Error('EFS file system is not enabled');
    }
    return this.outputs.efsFileSystem.grant(grantee,
      'elasticfilesystem:ClientMount',
      'elasticfilesystem:ClientWrite',
      'elasticfilesystem:ClientRootAccess'
    );
  }
  
  /**
   * Grant read-only access to the EFS file system
   */
  public grantEfsRead(grantee: iam.IGrantable): iam.Grant {
    if (!this.outputs.efsFileSystem) {
      throw new Error('EFS file system is not enabled');
    }
    return this.outputs.efsFileSystem.grant(grantee, 'elasticfilesystem:ClientMount');
  }
  
  /**
   * Grant read/write access to the S3 transfer bucket
   */
  public grantS3ReadWrite(grantee: iam.IGrantable): void {
    if (!this.outputs.transferBucket) {
      throw new Error('S3 transfer bucket is not enabled');
    }
    this.outputs.transferBucket.grantReadWrite(grantee);
    this.kmsKey.grantEncryptDecrypt(grantee);
  }
  
  /**
   * Grant read-only access to the S3 transfer bucket
   */
  public grantS3Read(grantee: iam.IGrantable): void {
    if (!this.outputs.transferBucket) {
      throw new Error('S3 transfer bucket is not enabled');
    }
    this.outputs.transferBucket.grantRead(grantee);
    this.kmsKey.grantDecrypt(grantee);
  }
  
  /**
   * Allow connection from a security group to all storage resources
   */
  public allowConnectionFrom(securityGroup: ec2.ISecurityGroup, description?: string): void {
    this.outputs.storageSecurityGroup.addIngressRule(
      securityGroup,
      ec2.Port.allTraffic(),
      description || 'Allow access from workstation security group'
    );
  }
}