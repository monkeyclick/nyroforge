/**
 * Development Environment Storage Configuration
 * 
 * Optimized for cost with minimal features enabled.
 * Uses EFS with bursting throughput and S3 for file transfer.
 */

import * as cdk from 'aws-cdk-lib';
import * as efs from 'aws-cdk-lib/aws-efs';
import { EnterpriseStorageProps } from '../../lib/enterprise-storage-construct';

export const devStorageConfig: Partial<EnterpriseStorageProps> = {
  environment: 'dev',
  
  // Enable basic storage only
  enableEfs: true,
  enableS3Transfer: true,
  enableFsxWindows: false,
  enableFsxLustre: false,
  enableFsxOntap: false,
  enableFsxOpenZfs: false,
  
  // EFS Configuration - Cost optimized
  efsConfig: {
    performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
    throughputMode: efs.ThroughputMode.BURSTING,
    lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
    enableAutomaticBackups: false, // No backups in dev
    encrypted: true,
    accessPoints: {
      'default': {
        path: '/data',
        posixUser: { gid: '1000', uid: '1000' },
        creationInfo: { ownerGid: '1000', ownerUid: '1000', permissions: '755' },
      },
    },
  },
  
  // S3 Transfer Configuration
  s3TransferConfig: {
    enableVersioning: false,
    enableAccessLogging: false,
    lifecycleRules: {
      expirationDays: 30, // Auto-delete after 30 days
    },
    corsOrigins: ['http://localhost:3000'], // Allow local development
  },
  
  // Monitoring - Minimal
  monitoringConfig: {
    enableAlarms: false,
    enableDashboard: false,
  },
  
  // No backup in dev
  enableBackup: false,
  
  // Create policies for testing
  createIamPolicies: true,
  
  // Tags
  tags: {
    Environment: 'dev',
    AutoDelete: 'true',
  },
};

/**
 * Example usage in CDK app:
 * 
 * import { devStorageConfig } from './examples/storage/dev-config';
 * 
 * const storage = new EnterpriseStorageConstruct(this, 'Storage', {
 *   vpc: myVpc,
 *   subnetIds: myVpc.privateSubnets.map(s => s.subnetId),
 *   projectName: 'my-project',
 *   ...devStorageConfig,
 * });
 */