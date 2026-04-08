/**
 * Staging Environment Storage Configuration
 * 
 * Balanced configuration for pre-production testing.
 * Includes FSx Windows for Active Directory testing and EFS.
 */

import * as cdk from 'aws-cdk-lib';
import * as efs from 'aws-cdk-lib/aws-efs';
import { EnterpriseStorageProps } from '../../lib/enterprise-storage-construct';

export const stagingStorageConfig: Partial<EnterpriseStorageProps> = {
  environment: 'staging',
  
  // Enable more storage options for testing
  enableEfs: true,
  enableS3Transfer: true,
  enableFsxWindows: true,
  enableFsxLustre: false, // Enable only if HPC workloads are tested
  enableFsxOntap: false,
  enableFsxOpenZfs: false,
  
  // EFS Configuration - Production-like but smaller scale
  efsConfig: {
    performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
    throughputMode: efs.ThroughputMode.BURSTING,
    lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
    enableAutomaticBackups: true,
    encrypted: true,
    accessPoints: {
      'default': {
        path: '/data',
        posixUser: { gid: '1000', uid: '1000' },
        creationInfo: { ownerGid: '1000', ownerUid: '1000', permissions: '755' },
      },
      'staging-apps': {
        path: '/apps',
        posixUser: { gid: '1001', uid: '1001' },
        creationInfo: { ownerGid: '1001', ownerUid: '1001', permissions: '755' },
      },
    },
  },
  
  // FSx Windows - Smaller config for testing
  fsxWindowsConfig: {
    storageCapacity: 32, // Minimum for testing
    throughputCapacity: 8, // Minimum throughput
    deploymentType: 'SINGLE_AZ_2', // No multi-AZ for staging cost savings
    storageType: 'SSD',
    backup: {
      automaticBackupRetentionDays: 7,
      dailyBackupStartTime: '03:00',
      copyTagsToBackups: true,
    },
  },
  
  // S3 Transfer Configuration
  s3TransferConfig: {
    enableVersioning: true,
    enableAccessLogging: true,
    lifecycleRules: {
      transitionToIaDays: 30,
      expirationDays: 90,
    },
    corsOrigins: ['https://staging.example.com'],
  },
  
  // Monitoring - Enable dashboard, limited alarms
  monitoringConfig: {
    enableAlarms: false, // No pages for staging
    enableDashboard: true,
  },
  
  // Enable backup but with shorter retention
  enableBackup: true,
  
  // Create policies
  createIamPolicies: true,
  
  // Tags
  tags: {
    Environment: 'staging',
    AutoDelete: 'false',
    DataClassification: 'internal',
  },
};

/**
 * Example usage in CDK app:
 * 
 * import { stagingStorageConfig } from './examples/storage/staging-config';
 * 
 * const storage = new EnterpriseStorageConstruct(this, 'Storage', {
 *   vpc: myVpc,
 *   subnetIds: myVpc.privateSubnets.map(s => s.subnetId),
 *   projectName: 'my-project',
 *   ...stagingStorageConfig,
 * });
 */