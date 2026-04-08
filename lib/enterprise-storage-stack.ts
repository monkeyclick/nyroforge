//------------------------------------------------------------------------------
// Enterprise Storage Stack - CDK Stack Wrapper for Storage Construct
//------------------------------------------------------------------------------

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';
import { EnterpriseStorageConstruct, EnterpriseStorageProps as ConstructProps } from './enterprise-storage-construct';

//------------------------------------------------------------------------------
// Stack Props Interface
//------------------------------------------------------------------------------

export interface EnterpriseStorageStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  subnetIds: string[];
  projectName: string;
  kmsKey?: kms.IKey;
  workstationSecurityGroup: ec2.SecurityGroup;
  environment: 'dev' | 'staging' | 'prod';
  costCenter?: string;
  
  // Storage enablement flags
  enableEfs?: boolean;
  enableFsxWindows?: boolean;
  enableFsxLustre?: boolean;
  enableFsxOntap?: boolean;
  enableFsxOpenZfs?: boolean;
  enableS3Transfer?: boolean;
  
  // EFS Configuration
  efsConfig?: ConstructProps['efsConfig'];
  
  // FSx Windows Configuration
  fsxWindowsConfig?: ConstructProps['fsxWindowsConfig'];
  
  // FSx Lustre Configuration
  fsxLustreConfig?: ConstructProps['fsxLustreConfig'];
  
  // FSx ONTAP Configuration
  fsxOntapConfig?: ConstructProps['fsxOntapConfig'];
  
  // FSx OpenZFS Configuration
  fsxOpenZfsConfig?: ConstructProps['fsxOpenZfsConfig'];
  
  // S3 Transfer Configuration
  s3TransferConfig?: ConstructProps['s3TransferConfig'];
  
  // MinIO Configuration
  minioConfig?: ConstructProps['minioConfig'];
  
  // Monitoring
  monitoringConfig?: ConstructProps['monitoringConfig'];
  
  // Backup
  enableBackup?: boolean;
  
  // IAM
  createIamPolicies?: boolean;
  
  // Additional tags
  tags?: { [key: string]: string };
}

//------------------------------------------------------------------------------
// Enterprise Storage Stack
//------------------------------------------------------------------------------

export class EnterpriseStorageStack extends cdk.Stack {
  public readonly storage: EnterpriseStorageConstruct;

  constructor(scope: Construct, id: string, props: EnterpriseStorageStackProps) {
    super(scope, id, props);

    // Create the enterprise storage construct
    this.storage = new EnterpriseStorageConstruct(this, 'EnterpriseStorage', {
      vpc: props.vpc,
      subnetIds: props.subnetIds,
      projectName: props.projectName,
      kmsKey: props.kmsKey,
      environment: props.environment,
      costCenter: props.costCenter,
      enableEfs: props.enableEfs,
      enableFsxWindows: props.enableFsxWindows,
      enableFsxLustre: props.enableFsxLustre,
      enableFsxOntap: props.enableFsxOntap,
      enableFsxOpenZfs: props.enableFsxOpenZfs,
      enableS3Transfer: props.enableS3Transfer,
      efsConfig: props.efsConfig,
      fsxWindowsConfig: props.fsxWindowsConfig,
      fsxLustreConfig: props.fsxLustreConfig,
      fsxOntapConfig: props.fsxOntapConfig,
      fsxOpenZfsConfig: props.fsxOpenZfsConfig,
      s3TransferConfig: props.s3TransferConfig,
      minioConfig: props.minioConfig,
      monitoringConfig: props.monitoringConfig,
      enableBackup: props.enableBackup,
      createIamPolicies: props.createIamPolicies,
      tags: props.tags,
    });

    // Allow workstations to access storage
    this.storage.allowConnectionFrom(
      props.workstationSecurityGroup,
      'Allow workstations to access enterprise storage'
    );

    // Create SSM parameters for storage configuration
    this.createSSMParameters(props);
  }

  private createSSMParameters(props: EnterpriseStorageStackProps): void {
    const outputs = this.storage.outputs;

    // Store EFS configuration
    if (outputs.efsFileSystem) {
      new cdk.aws_ssm.StringParameter(this, 'EfsFileSystemIdParam', {
        parameterName: `/${props.projectName}/storage/efs/fileSystemId`,
        stringValue: outputs.efsFileSystem.fileSystemId,
        description: 'EFS File System ID for workstation storage',
      });
    }

    // Store default EFS access point
    if (outputs.efsAccessPoints && outputs.efsAccessPoints['default']) {
      new cdk.aws_ssm.StringParameter(this, 'EfsAccessPointIdParam', {
        parameterName: `/${props.projectName}/storage/efs/accessPointId`,
        stringValue: outputs.efsAccessPoints['default'].accessPointId,
        description: 'EFS Access Point ID for workstation data',
      });
    }

    // Store S3 bucket configuration
    if (outputs.transferBucket) {
      new cdk.aws_ssm.StringParameter(this, 'TransferBucketNameParam', {
        parameterName: `/${props.projectName}/storage/s3/transferBucketName`,
        stringValue: outputs.transferBucket.bucketName,
        description: 'S3 Transfer Bucket name',
      });

      new cdk.aws_ssm.StringParameter(this, 'TransferBucketArnParam', {
        parameterName: `/${props.projectName}/storage/s3/transferBucketArn`,
        stringValue: outputs.transferBucket.bucketArn,
        description: 'S3 Transfer Bucket ARN',
      });
    }

    // Store FSx Windows configuration
    if (outputs.fsxWindowsFileSystem) {
      new cdk.aws_ssm.StringParameter(this, 'FsxWindowsIdParam', {
        parameterName: `/${props.projectName}/storage/fsx/windowsFileSystemId`,
        stringValue: outputs.fsxWindowsFileSystem.ref,
        description: 'FSx for Windows File System ID',
      });
    }

    // Store FSx Lustre configuration
    if (outputs.fsxLustreFileSystem) {
      new cdk.aws_ssm.StringParameter(this, 'FsxLustreIdParam', {
        parameterName: `/${props.projectName}/storage/fsx/lustreFileSystemId`,
        stringValue: outputs.fsxLustreFileSystem.ref,
        description: 'FSx for Lustre File System ID',
      });
    }

    // Store FSx ONTAP configuration
    if (outputs.fsxOntapFileSystem) {
      new cdk.aws_ssm.StringParameter(this, 'FsxOntapIdParam', {
        parameterName: `/${props.projectName}/storage/fsx/ontapFileSystemId`,
        stringValue: outputs.fsxOntapFileSystem.ref,
        description: 'FSx for NetApp ONTAP File System ID',
      });
    }

    // Store FSx OpenZFS configuration
    if (outputs.fsxOpenZfsFileSystem) {
      new cdk.aws_ssm.StringParameter(this, 'FsxOpenZfsIdParam', {
        parameterName: `/${props.projectName}/storage/fsx/openzfsFileSystemId`,
        stringValue: outputs.fsxOpenZfsFileSystem.ref,
        description: 'FSx for OpenZFS File System ID',
      });
    }

    // Store security group ID
    new cdk.aws_ssm.StringParameter(this, 'StorageSecurityGroupIdParam', {
      parameterName: `/${props.projectName}/storage/securityGroupId`,
      stringValue: outputs.storageSecurityGroup.securityGroupId,
      description: 'Security Group ID for storage access',
    });
  }
}