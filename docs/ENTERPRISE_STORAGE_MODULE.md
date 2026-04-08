# Enterprise Storage Module for AWS CDK

A comprehensive AWS CDK construct for deploying enterprise storage solutions on AWS and third-party platforms.

## Features

### AWS FSx File Systems

- **FSx for Windows File Server**: Active Directory integration, storage capacity configuration, throughput settings, and backup policies
- **FSx for Lustre**: Scratch and persistent deployment types, S3 data repository associations, performance optimization
- **FSx for NetApp ONTAP**: Multi-protocol support (NFS, SMB, iSCSI), storage virtual machines, volumes, and tiering policies
- **FSx for OpenZFS**: Data compression, snapshots, volume configurations

### AWS EFS (Elastic File System)

- Lifecycle policies for automatic tiering
- Throughput modes (bursting, provisioned)
- Mount targets across availability zones
- Access points for fine-grained access control

### Third-Party Storage Integration

- **MinIO**: S3-compatible object storage deployment
- **NetApp Cloud Volumes ONTAP** (placeholder)
- **Pure Storage Cloud Block Store** (placeholder)
- **Portworx** (placeholder)

### Module Features

- Configurable storage tiers and performance classes
- Encryption at rest using AWS KMS with customer-managed keys
- Security group configurations for storage access control
- Backup and snapshot scheduling with retention policies
- Monitoring and alerting integration with CloudWatch
- Tagging strategy for cost allocation and resource management
- IAM policies for fine-grained access control

## Installation

The module is part of the ec2mgr4me CDK project. Ensure you have the following dependencies:

```bash
npm install aws-cdk-lib constructs
```

## Usage

### Basic Usage

```typescript
import { EnterpriseStorageConstruct } from './lib/enterprise-storage-construct';

const storage = new EnterpriseStorageConstruct(this, 'Storage', {
  vpc: myVpc,
  subnetIds: myVpc.privateSubnets.map(s => s.subnetId),
  projectName: 'my-project',
  environment: 'dev',
  enableEfs: true,
  enableS3Transfer: true,
});
```

### FSx for Windows File Server

```typescript
const storage = new EnterpriseStorageConstruct(this, 'Storage', {
  vpc: myVpc,
  subnetIds: myVpc.privateSubnets.map(s => s.subnetId),
  projectName: 'my-project',
  environment: 'prod',
  enableFsxWindows: true,
  fsxWindowsConfig: {
    storageCapacity: 300, // GB
    throughputCapacity: 32, // MB/s
    deploymentType: 'MULTI_AZ_1',
    storageType: 'SSD',
    activeDirectory: {
      type: 'aws_managed',
      directoryId: 'd-1234567890',
    },
    backup: {
      automaticBackupRetentionDays: 30,
      dailyBackupStartTime: '02:00',
      copyTagsToBackups: true,
    },
    auditLogConfig: {
      fileAccessAuditLogLevel: 'SUCCESS_AND_FAILURE',
      fileShareAccessAuditLogLevel: 'SUCCESS_AND_FAILURE',
    },
  },
});
```

### FSx for Lustre with S3 Integration

```typescript
const storage = new EnterpriseStorageConstruct(this, 'Storage', {
  vpc: myVpc,
  subnetIds: myVpc.privateSubnets.map(s => s.subnetId),
  projectName: 'my-project',
  environment: 'prod',
  enableFsxLustre: true,
  fsxLustreConfig: {
    storageCapacity: 1200, // GB
    deploymentType: 'PERSISTENT_2',
    perUnitStorageThroughput: 250, // MB/s/TiB
    dataCompressionType: 'LZ4',
    dataRepositoryAssociations: {
      'data': {
        fileSystemPath: '/data',
        dataRepositoryPath: 's3://my-bucket/data/',
        autoExportEvents: ['NEW', 'CHANGED', 'DELETED'],
        autoImportEvents: ['NEW', 'CHANGED', 'DELETED'],
      },
    },
    backup: {
      automaticBackupRetentionDays: 7,
      dailyBackupStartTime: '03:00',
    },
  },
});
```

### FSx for NetApp ONTAP

```typescript
const storage = new EnterpriseStorageConstruct(this, 'Storage', {
  vpc: myVpc,
  subnetIds: myVpc.privateSubnets.map(s => s.subnetId),
  projectName: 'my-project',
  environment: 'prod',
  enableFsxOntap: true,
  fsxOntapConfig: {
    storageCapacity: 1024, // GB
    throughputCapacity: 512, // MB/s
    deploymentType: 'MULTI_AZ_1',
    storageType: 'SSD',
    fsxAdminPassword: 'MySecurePassword123!',
    storageVirtualMachines: {
      'main': {
        name: 'svm-main',
        rootVolumeSecurityStyle: 'UNIX',
      },
    },
    volumes: {
      'data': {
        name: 'data',
        junctionPath: '/data',
        sizeInMegabytes: 500000,
        svmKey: 'main',
        storageEfficiencyEnabled: true,
        securityStyle: 'UNIX',
        tieringPolicy: {
          name: 'AUTO',
          coolingPeriod: 31,
        },
      },
      'home': {
        name: 'home',
        junctionPath: '/home',
        sizeInMegabytes: 100000,
        svmKey: 'main',
        storageEfficiencyEnabled: true,
        securityStyle: 'UNIX',
      },
    },
  },
});
```

### FSx for OpenZFS

```typescript
const storage = new EnterpriseStorageConstruct(this, 'Storage', {
  vpc: myVpc,
  subnetIds: myVpc.privateSubnets.map(s => s.subnetId),
  projectName: 'my-project',
  environment: 'prod',
  enableFsxOpenZfs: true,
  fsxOpenZfsConfig: {
    storageCapacity: 512, // GB
    throughputCapacity: 256, // MB/s
    deploymentType: 'SINGLE_AZ_1',
    rootVolumeConfig: {
      dataCompressionType: 'ZSTD',
      recordSizeKib: 128,
      nfsExports: {
        clientConfigurations: [{
          clients: '*',
          options: ['rw', 'crossmnt', 'no_root_squash'],
        }],
      },
    },
    volumes: {
      'projects': {
        name: 'projects',
        storageCapacityQuotaGib: 200,
        dataCompressionType: 'ZSTD',
        nfsExports: {
          clientConfigurations: [{
            clients: '10.0.0.0/16',
            options: ['rw', 'no_root_squash'],
          }],
        },
      },
    },
    backup: {
      automaticBackupRetentionDays: 14,
      dailyBackupStartTime: '04:00',
    },
  },
});
```

### EFS with Access Points

```typescript
const storage = new EnterpriseStorageConstruct(this, 'Storage', {
  vpc: myVpc,
  subnetIds: myVpc.privateSubnets.map(s => s.subnetId),
  projectName: 'my-project',
  environment: 'prod',
  enableEfs: true,
  efsConfig: {
    performanceMode: efs.PerformanceMode.MAX_IO,
    throughputMode: efs.ThroughputMode.PROVISIONED,
    provisionedThroughputPerSecond: cdk.Size.mebibytes(100),
    lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
    enableAutomaticBackups: true,
    accessPoints: {
      'lambda': {
        path: '/lambda',
        posixUser: { gid: '1000', uid: '1000' },
        creationInfo: { ownerGid: '1000', ownerUid: '1000', permissions: '755' },
      },
      'containers': {
        path: '/containers',
        posixUser: { gid: '1001', uid: '1001' },
        creationInfo: { ownerGid: '1001', ownerUid: '1001', permissions: '755' },
      },
    },
  },
});
```

## Environment Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ENVIRONMENT` | Environment type (dev/staging/prod) | `dev` |
| `ENABLE_FSX_WINDOWS` | Enable FSx for Windows | `false` |
| `ENABLE_FSX_LUSTRE` | Enable FSx for Lustre | `false` |
| `ENABLE_FSX_ONTAP` | Enable FSx for ONTAP | `false` |
| `ENABLE_FSX_OPENZFS` | Enable FSx for OpenZFS | `false` |
| `COST_CENTER` | Cost center tag | - |
| `ALARM_EMAIL` | Email for CloudWatch alarms | - |

### Example Environment Configurations

#### Development

```bash
export ENVIRONMENT=dev
export ENABLE_FSX_WINDOWS=false
export ENABLE_FSX_LUSTRE=false
```

#### Production

```bash
export ENVIRONMENT=prod
export ENABLE_FSX_WINDOWS=true
export ENABLE_FSX_LUSTRE=true
export ENABLE_FSX_ONTAP=true
export COST_CENTER=IT-INFRA-001
export ALARM_EMAIL=ops@company.com
```

## Security Considerations

### Network Security

The module creates a security group with the following default rules:

- **NFS (2049)**: For EFS and OpenZFS access
- **SMB (445)**: For Windows File Server and ONTAP SMB access
- **iSCSI (3260)**: For ONTAP iSCSI access
- **Lustre (988, 1018-1023)**: For Lustre file system access
- **Management (443, 22)**: For ONTAP REST API and SSH

### Encryption

All storage resources are encrypted by default using AWS KMS. You can:
- Provide your own KMS key via `kmsKey` prop
- Let the module create a new key with automatic rotation
- Use AWS managed keys by setting `createKmsKey: false`

### IAM Policies

The module can create managed IAM policies for:
- FSx access (`fsxAccessPolicy`)
- EFS access (`efsAccessPolicy`)
- S3 access (`s3AccessPolicy`)

## Monitoring

### CloudWatch Dashboard

A CloudWatch dashboard is created automatically when `monitoringConfig.enableDashboard` is true, displaying:

- EFS throughput and client connections
- S3 bucket size and object count
- FSx storage metrics

### CloudWatch Alarms

When `monitoringConfig.enableAlarms` is true:

- EFS burst credit balance alarm
- Storage utilization alarms
- Custom threshold alerts

## Outputs

The construct provides the following outputs:

| Output | Description |
|--------|-------------|
| `storageSecurityGroup` | Security group for storage access |
| `kmsKey` | KMS key used for encryption |
| `efsFileSystem` | EFS file system (if enabled) |
| `efsAccessPoints` | Map of EFS access points |
| `fsxWindowsFileSystem` | FSx Windows file system (if enabled) |
| `fsxLustreFileSystem` | FSx Lustre file system (if enabled) |
| `fsxOntapFileSystem` | FSx ONTAP file system (if enabled) |
| `fsxOpenZfsFileSystem` | FSx OpenZFS file system (if enabled) |
| `transferBucket` | S3 transfer bucket (if enabled) |

## Helper Methods

### Grant Access

```typescript
// Grant EFS read/write access to a Lambda function
storage.grantEfsReadWrite(myLambda);

// Grant S3 read/write access
storage.grantS3ReadWrite(myRole);

// Allow a security group to connect to storage
storage.allowConnectionFrom(mySecurityGroup);
```

## Cost Optimization

### Development Environment

- Use EFS with bursting throughput
- Avoid FSx in development
- Use S3 Intelligent Tiering

### Production Environment

- Enable lifecycle policies for EFS
- Configure FSx backup retention appropriately
- Use tiering policies for ONTAP
- Enable data compression where supported

## Troubleshooting

### Common Issues

1. **Insufficient subnet availability**: Ensure at least 2 subnets in different AZs for Multi-AZ deployments
2. **KMS key permissions**: Verify FSx and EFS services have permissions to use the KMS key
3. **Security group rules**: Check that CIDR blocks allow access from compute resources

### Logging

Enable verbose logging for debugging:

```typescript
const storage = new EnterpriseStorageConstruct(this, 'Storage', {
  // ...
  fsxLustreConfig: {
    // ...
    logConfig: {
      level: 'WARN_ERROR',
    },
  },
});
```

## Migration Guide

### From Standalone Resources

1. Import existing file systems as data sources
2. Update security group references
3. Migrate IAM policies to use module-generated policies
4. Update application configurations to use SSM parameters

## License

This module is part of the ec2mgr4me project and is available under the MIT license.