/**
 * Production Environment Storage Configuration
 * 
 * Full enterprise configuration with high availability, 
 * comprehensive backup, monitoring, and multi-protocol support.
 */

import * as cdk from 'aws-cdk-lib';
import * as efs from 'aws-cdk-lib/aws-efs';
import { EnterpriseStorageProps } from '../../lib/enterprise-storage-construct';

export const prodStorageConfig: Partial<EnterpriseStorageProps> = {
  environment: 'prod',
  costCenter: 'IT-INFRA-001',
  
  // Enable all required storage options
  enableEfs: true,
  enableS3Transfer: true,
  enableFsxWindows: true,
  enableFsxLustre: true,
  enableFsxOntap: true,
  enableFsxOpenZfs: false, // Enable if needed
  
  // EFS Configuration - Production grade
  efsConfig: {
    performanceMode: efs.PerformanceMode.MAX_IO,
    throughputMode: efs.ThroughputMode.PROVISIONED,
    provisionedThroughputPerSecond: cdk.Size.mebibytes(100),
    lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
    enableAutomaticBackups: true,
    encrypted: true,
    accessPoints: {
      'default': {
        path: '/data',
        posixUser: { gid: '1000', uid: '1000' },
        creationInfo: { ownerGid: '1000', ownerUid: '1000', permissions: '755' },
      },
      'applications': {
        path: '/apps',
        posixUser: { gid: '1001', uid: '1001' },
        creationInfo: { ownerGid: '1001', ownerUid: '1001', permissions: '755' },
      },
      'shared': {
        path: '/shared',
        posixUser: { gid: '1002', uid: '1002' },
        creationInfo: { ownerGid: '1002', ownerUid: '1002', permissions: '775' },
      },
      'backups': {
        path: '/backups',
        posixUser: { gid: '0', uid: '0' },
        creationInfo: { ownerGid: '0', ownerUid: '0', permissions: '700' },
      },
    },
  },
  
  // FSx Windows - Multi-AZ production config
  fsxWindowsConfig: {
    storageCapacity: 1000, // 1 TB
    throughputCapacity: 256, // MB/s
    deploymentType: 'MULTI_AZ_1',
    storageType: 'SSD',
    diskIops: {
      mode: 'USER_PROVISIONED',
      iops: 12000,
    },
    backup: {
      automaticBackupRetentionDays: 30,
      dailyBackupStartTime: '02:00',
      weeklyMaintenanceStartTime: '7:03:00', // Sunday 3 AM UTC
      copyTagsToBackups: true,
    },
    auditLogConfig: {
      fileAccessAuditLogLevel: 'SUCCESS_AND_FAILURE',
      fileShareAccessAuditLogLevel: 'SUCCESS_AND_FAILURE',
    },
    // Active Directory configuration - update with your AD details
    // activeDirectory: {
    //   type: 'aws_managed',
    //   directoryId: 'd-1234567890',
    // },
  },
  
  // FSx Lustre - High-performance storage for HPC/ML workloads
  fsxLustreConfig: {
    storageCapacity: 2400, // Minimum for PERSISTENT_2
    deploymentType: 'PERSISTENT_2',
    perUnitStorageThroughput: 500, // MB/s/TiB
    storageType: 'SSD',
    dataCompressionType: 'LZ4',
    backup: {
      automaticBackupRetentionDays: 14,
      dailyBackupStartTime: '03:00',
      weeklyMaintenanceStartTime: '7:04:00',
      copyTagsToBackups: true,
    },
    // S3 Data Repository Association
    dataRepositoryAssociations: {
      'training-data': {
        fileSystemPath: '/training',
        dataRepositoryPath: 's3://prod-ml-training-data/datasets/',
        batchImportMetaDataOnCreate: true,
        autoImportEvents: ['NEW', 'CHANGED', 'DELETED'],
        autoExportEvents: ['NEW', 'CHANGED', 'DELETED'],
      },
      'model-outputs': {
        fileSystemPath: '/outputs',
        dataRepositoryPath: 's3://prod-ml-model-outputs/',
        autoExportEvents: ['NEW', 'CHANGED'],
      },
    },
  },
  
  // FSx ONTAP - Multi-protocol enterprise storage
  fsxOntapConfig: {
    storageCapacity: 2048, // 2 TB
    throughputCapacity: 1024, // MB/s
    deploymentType: 'MULTI_AZ_1',
    storageType: 'SSD',
    fsxAdminPassword: 'ChangeThisSecurePassword!123', // Use Secrets Manager in production
    diskIops: {
      mode: 'USER_PROVISIONED',
      iops: 20000,
    },
    backup: {
      automaticBackupRetentionDays: 30,
      dailyBackupStartTime: '04:00',
      weeklyMaintenanceStartTime: '7:05:00',
      copyTagsToBackups: true,
    },
    storageVirtualMachines: {
      'production': {
        name: 'svm-production',
        rootVolumeSecurityStyle: 'UNIX',
        svmAdminPassword: 'SvmSecurePassword!456',
        // For SMB support, add Active Directory configuration:
        // activeDirectory: {
        //   type: 'self_managed',
        //   netbiosName: 'SVM-PROD',
        //   domainName: 'corp.example.com',
        //   dnsIps: ['10.0.1.10', '10.0.2.10'],
        //   username: 'admin',
        //   password: 'ADPassword',
        //   organizationalUnit: 'OU=FSx,DC=corp,DC=example,DC=com',
        // },
      },
      'development': {
        name: 'svm-development',
        rootVolumeSecurityStyle: 'UNIX',
        svmAdminPassword: 'SvmDevPassword!789',
      },
    },
    volumes: {
      'prod-data': {
        name: 'prod_data',
        junctionPath: '/prod/data',
        sizeInMegabytes: 500000, // 500 GB
        svmKey: 'production',
        storageEfficiencyEnabled: true,
        securityStyle: 'UNIX',
        ontapVolumeType: 'RW',
        tieringPolicy: {
          name: 'AUTO',
          coolingPeriod: 31,
        },
        snapshotPolicy: 'default',
        copyTagsToBackups: true,
      },
      'prod-home': {
        name: 'prod_home',
        junctionPath: '/prod/home',
        sizeInMegabytes: 200000, // 200 GB
        svmKey: 'production',
        storageEfficiencyEnabled: true,
        securityStyle: 'UNIX',
        tieringPolicy: {
          name: 'SNAPSHOT_ONLY',
          coolingPeriod: 14,
        },
      },
      'prod-archive': {
        name: 'prod_archive',
        junctionPath: '/prod/archive',
        sizeInMegabytes: 1000000, // 1 TB
        svmKey: 'production',
        storageEfficiencyEnabled: true,
        securityStyle: 'UNIX',
        tieringPolicy: {
          name: 'ALL',
          coolingPeriod: 2,
        },
      },
      'dev-data': {
        name: 'dev_data',
        junctionPath: '/dev/data',
        sizeInMegabytes: 100000, // 100 GB
        svmKey: 'development',
        storageEfficiencyEnabled: true,
        securityStyle: 'UNIX',
      },
    },
  },
  
  // S3 Transfer Configuration - Production grade
  s3TransferConfig: {
    enableVersioning: true,
    enableAccessLogging: true,
    lifecycleRules: {
      transitionToIaDays: 30,
      transitionToGlacierDays: 90,
      expirationDays: 365,
    },
    corsOrigins: ['https://app.example.com', 'https://admin.example.com'],
  },
  
  // Monitoring - Full production monitoring
  monitoringConfig: {
    enableAlarms: true,
    enableDashboard: true,
    alarmEmail: 'storage-ops@example.com',
    storageUtilizationThreshold: 85,
  },
  
  // Enable all backup features
  enableBackup: true,
  
  // Create policies
  createIamPolicies: true,
  
  // KMS configuration
  createKmsKey: true,
  kmsKeyRotationEnabled: true,
  kmsKeyDeletionWindow: 30,
  
  // Tags
  tags: {
    Environment: 'prod',
    DataClassification: 'confidential',
    CostCenter: 'IT-INFRA-001',
    Compliance: 'SOC2',
    BackupRequired: 'true',
    DisasterRecovery: 'tier1',
  },
};

/**
 * Example usage in CDK app:
 * 
 * import { prodStorageConfig } from './examples/storage/prod-config';
 * 
 * const storage = new EnterpriseStorageConstruct(this, 'Storage', {
 *   vpc: myVpc,
 *   subnetIds: myVpc.privateSubnets.map(s => s.subnetId),
 *   projectName: 'my-project',
 *   ...prodStorageConfig,
 *   // Override any production-specific settings
 *   fsxWindowsConfig: {
 *     ...prodStorageConfig.fsxWindowsConfig,
 *     activeDirectory: {
 *       type: 'aws_managed',
 *       directoryId: process.env.AD_DIRECTORY_ID!,
 *     },
 *   },
 * });
 */

/**
 * Production Deployment Checklist:
 * 
 * 1. [ ] Update Active Directory configuration for FSx Windows
 * 2. [ ] Update Active Directory configuration for FSx ONTAP SVMs (if using SMB)
 * 3. [ ] Store FSx admin passwords in AWS Secrets Manager
 * 4. [ ] Update S3 bucket names for Lustre data repository associations
 * 5. [ ] Configure CORS origins for S3 transfer bucket
 * 6. [ ] Set up alarm email notifications
 * 7. [ ] Review and adjust storage capacities based on requirements
 * 8. [ ] Configure route table IDs for Multi-AZ deployments
 * 9. [ ] Review security group CIDR blocks
 * 10. [ ] Enable cross-region replication if needed
 */