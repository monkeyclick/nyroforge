# Enterprise Storage Module for AWS and Third-Party Platforms

A comprehensive Terraform module for deploying enterprise-grade storage solutions on AWS and third-party platforms. This module provides a unified interface for managing diverse storage technologies with consistent security, monitoring, and operational practices.

## Features

### AWS FSx File Systems
- **FSx for Windows File Server**: Active Directory integration, SMB protocol, MULTI_AZ deployments
- **FSx for Lustre**: High-performance parallel file system with S3 data repository integration
- **FSx for NetApp ONTAP**: Multi-protocol (NFS/SMB/iSCSI), storage virtual machines, tiering policies
- **FSx for OpenZFS**: Data compression, snapshots, NFS with advanced features

### Amazon EFS
- Elastic File System with lifecycle policies
- Throughput modes (bursting, elastic, provisioned)
- Mount targets across availability zones
- Access points for application isolation
- Cross-region replication

### Third-Party Storage Integration
- **NetApp Cloud Volumes ONTAP**: Enterprise NAS in the cloud
- **Pure Storage Cloud Block Store**: High-performance block storage
- **Portworx**: Container-native storage for Kubernetes
- **MinIO**: S3-compatible object storage

### Module Capabilities
- 🔐 KMS encryption with customer-managed keys
- 🛡️ Security groups for storage access control
- 📦 AWS Backup integration with retention policies
- 🔄 Cross-region replication for disaster recovery
- 📊 CloudWatch monitoring and alerting
- 🏷️ Comprehensive tagging strategy
- 👤 IAM policies for fine-grained access control

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Enterprise Storage Module                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ FSx Windows  │  │ FSx Lustre   │  │ FSx ONTAP    │  │ FSx OpenZFS  │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  Amazon EFS  │  │ NetApp CVO   │  │ Pure Storage │  │  Portworx    │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                              │
│  ┌──────────────┐                                                           │
│  │    MinIO     │                                                           │
│  └──────────────┘                                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                           Shared Resources                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │     KMS      │  │Security Grps │  │     IAM      │  │  CloudWatch  │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Requirements

| Name | Version |
|------|---------|
| terraform | >= 1.5.0 |
| aws | >= 5.0 |
| kubernetes | >= 2.20 |
| helm | >= 2.10 |
| tls | >= 4.0 |
| random | >= 3.5 |

## Providers

| Name | Version |
|------|---------|
| aws | >= 5.0 |
| kubernetes | >= 2.20 (for Portworx/MinIO) |
| helm | >= 2.10 (for Portworx/MinIO) |

## Quick Start

### Basic Usage - Amazon EFS

```hcl
module "enterprise_storage" {
  source = "path/to/enterprise-storage"

  project_name = "myapp"
  environment  = "production"
  vpc_id       = "vpc-12345678"

  efs_config = {
    enabled          = true
    performance_mode = "generalPurpose"
    throughput_mode  = "elastic"
    subnet_ids       = ["subnet-1a", "subnet-1b", "subnet-1c"]
    
    lifecycle_policies = {
      transition_to_ia                    = "AFTER_30_DAYS"
      transition_to_primary_storage_class = "AFTER_1_ACCESS"
      transition_to_archive               = "AFTER_90_DAYS"
    }
    
    access_points = {
      app = {
        root_directory_path = "/app"
        posix_user = {
          uid = 1000
          gid = 1000
        }
      }
    }
    
    enable_backup      = true
    enable_replication = true
    replication_region = "us-west-2"
  }

  encryption_config = {
    create_kms_key = true
  }

  security_config = {
    allowed_cidr_blocks = ["10.0.0.0/8"]
  }
}
```

### FSx for Windows with Active Directory

```hcl
module "enterprise_storage" {
  source = "path/to/enterprise-storage"

  project_name = "enterprise"
  environment  = "production"
  vpc_id       = var.vpc_id

  fsx_windows_config = {
    enabled             = true
    subnet_ids          = var.subnet_ids
    storage_capacity_gb = 2048
    throughput_capacity = 256
    deployment_type     = "MULTI_AZ_1"
    
    # AWS Managed AD
    active_directory_id = "d-1234567890"
    
    # Or self-managed AD
    # self_managed_ad_config = {
    #   domain_name = "corp.example.com"
    #   dns_ips     = ["10.0.1.10", "10.0.2.10"]
    #   username    = "Admin"
    #   password    = var.ad_password
    # }
    
    automatic_backup_retention_days = 35
    copy_tags_to_backups           = true
  }
}
```

### FSx for Lustre with S3 Integration

```hcl
module "enterprise_storage" {
  source = "path/to/enterprise-storage"

  project_name = "hpc"
  environment  = "production"
  vpc_id       = var.vpc_id

  fsx_lustre_config = {
    enabled                     = true
    subnet_ids                  = [var.subnet_ids[0]]
    storage_capacity_gb         = 4800
    deployment_type             = "PERSISTENT_2"
    per_unit_storage_throughput = 250
    
    s3_import_path     = "s3://my-data-bucket/input"
    s3_export_path     = "s3://my-data-bucket/output"
    auto_import_policy = "NEW_CHANGED"
    
    data_repository_associations = {
      datasets = {
        data_repository_path = "s3://my-data-bucket/datasets"
        file_system_path     = "/datasets"
        import_policy        = "NEW_CHANGED_DELETED"
      }
    }
    
    data_compression_type = "LZ4"
  }
}
```

### FSx for NetApp ONTAP

```hcl
module "enterprise_storage" {
  source = "path/to/enterprise-storage"

  project_name = "enterprise"
  environment  = "production"
  vpc_id       = var.vpc_id

  fsx_ontap_config = {
    enabled              = true
    subnet_ids           = var.subnet_ids
    storage_capacity_gb  = 2048
    throughput_capacity  = 512
    deployment_type      = "MULTI_AZ_1"
    
    storage_virtual_machines = {
      svm_prod = {
        name                       = "svm-prod"
        root_volume_security_style = "MIXED"
      }
    }
    
    volumes = {
      data_vol = {
        name                    = "data"
        storage_virtual_machine = "svm_prod"
        size_in_megabytes       = 512000
        junction_path           = "/data"
        security_style          = "MIXED"
        tiering_policy = {
          name           = "AUTO"
          cooling_period = 31
        }
      }
    }
  }
}
```

### Kubernetes Storage (Portworx + MinIO)

```hcl
module "enterprise_storage" {
  source = "path/to/enterprise-storage"

  project_name = "k8s-storage"
  environment  = "production"
  vpc_id       = var.vpc_id

  portworx_config = {
    enabled          = true
    namespace        = "portworx"
    cluster_name     = "px-cluster"
    internal_kvdb    = true
    enable_stork     = true
    enable_autopilot = true
    enable_csi       = true
    
    storage_classes = {
      px-db = {
        replication_factor = 3
        io_profile         = "db"
        is_default         = false
      }
      px-storage = {
        replication_factor = 2
        io_profile         = "auto"
        is_default         = true
      }
    }
    
    enable_backup    = true
    backup_s3_bucket = "my-px-backup-bucket"
  }

  minio_config = {
    enabled            = true
    namespace          = "minio"
    tenant_name        = "minio"
    servers            = 4
    volumes_per_server = 4
    volume_size        = "100Gi"
    storage_class      = "px-storage"
    
    enable_tls     = true
    enable_console = true
    
    buckets = {
      data = {
        name       = "data"
        versioning = true
      }
    }
  }
}
```

## Module Structure

```
enterprise-storage/
├── main.tf                 # Main orchestration
├── variables.tf            # Input variables
├── outputs.tf             # Output values
├── versions.tf            # Provider requirements
├── README.md              # Documentation
├── modules/
│   ├── fsx-windows/       # FSx Windows submodule
│   ├── fsx-lustre/        # FSx Lustre submodule
│   ├── fsx-ontap/         # FSx ONTAP submodule
│   ├── fsx-openzfs/       # FSx OpenZFS submodule
│   ├── efs/               # Amazon EFS submodule
│   ├── netapp-cloud-volumes/  # NetApp CVO submodule
│   ├── pure-storage-cbs/  # Pure Storage CBS submodule
│   ├── portworx/          # Portworx submodule
│   ├── minio/             # MinIO submodule
│   └── shared/            # Shared resources (KMS, SG, IAM, CloudWatch)
└── examples/
    ├── dev/               # Development configuration
    ├── staging/           # Staging configuration
    ├── production/        # Production configuration
    └── kubernetes/        # Kubernetes storage configuration
```

## Input Variables

### Required Variables

| Name | Description | Type |
|------|-------------|------|
| `project_name` | Project name for resource naming | `string` |
| `environment` | Environment name (dev, staging, production) | `string` |
| `vpc_id` | VPC ID for storage resources | `string` |

### Encryption Configuration

```hcl
encryption_config = {
  create_kms_key           = true
  kms_key_arn              = null  # Use existing key
  key_deletion_window_days = 30
  enable_key_rotation      = true
  multi_region             = false
  key_administrators       = []
  key_users                = []
}
```

### Security Configuration

```hcl
security_config = {
  allowed_cidr_blocks        = ["10.0.0.0/8"]
  allowed_security_group_ids = []
  management_cidr_blocks     = ["10.0.0.0/24"]
}
```

### Backup Configuration

```hcl
backup_config = {
  enabled      = true
  create_vault = true
  vault_name   = null  # Auto-generated
  backup_rules = [
    {
      name                      = "daily-backup"
      schedule                  = "cron(0 3 ? * * *)"
      start_window_minutes      = 60
      completion_window_minutes = 180
      lifecycle = {
        cold_storage_after_days = 30
        delete_after_days       = 90
      }
      copy_to_vault_arn = "arn:aws:backup:us-west-2:..."  # DR region
      copy_lifecycle = {
        cold_storage_after_days = 30
        delete_after_days       = 90
      }
    }
  ]
}
```

### Monitoring Configuration

```hcl
monitoring_config = {
  create_dashboard            = true
  dashboard_name              = null  # Auto-generated
  create_log_group            = true
  log_retention_days          = 90
  create_sns_topic            = true
  alert_email_addresses       = ["ops@example.com"]
  create_event_rules          = true
  capacity_alarm_enabled      = true
  capacity_warning_threshold  = 80
  capacity_critical_threshold = 95
}
```

## Outputs

### Storage Identifiers

| Output | Description |
|--------|-------------|
| `fsx_windows_file_system_id` | FSx Windows file system ID |
| `fsx_lustre_file_system_id` | FSx Lustre file system ID |
| `fsx_ontap_file_system_id` | FSx ONTAP file system ID |
| `fsx_openzfs_file_system_id` | FSx OpenZFS file system ID |
| `efs_file_system_id` | EFS file system ID |

### Connection Information

| Output | Description |
|--------|-------------|
| `fsx_windows_dns_name` | DNS name for FSx Windows |
| `fsx_lustre_dns_name` | DNS name for FSx Lustre |
| `fsx_lustre_mount_name` | Mount name for FSx Lustre |
| `efs_dns_name` | DNS name for EFS |
| `minio_api_endpoint` | MinIO API endpoint |
| `minio_console_endpoint` | MinIO Console endpoint |

### Security Resources

| Output | Description |
|--------|-------------|
| `kms_key_arn` | KMS key ARN |
| `security_groups` | Map of security group IDs |
| `storage_client_security_group_id` | SG ID to attach to clients |
| `iam_roles` | Map of IAM role ARNs |
| `ec2_client_instance_profile_name` | Instance profile for EC2 |

### Comprehensive Output

```hcl
output "storage_summary" {
  description = "Summary of all deployed storage"
  value       = module.enterprise_storage.storage_summary
}

output "connection_info" {
  description = "Connection information for all storage"
  value       = module.enterprise_storage.connection_info
}
```

## Examples

### Development Environment

Minimal configuration with EFS for cost-effective shared storage:
- EFS with bursting throughput
- Quick lifecycle transitions to IA
- No backup (cost savings)
- Basic monitoring

See: [`examples/dev/`](examples/dev/)

### Staging Environment

Production-like configuration for testing:
- EFS with elastic throughput
- FSx Lustre for HPC workloads
- Daily backups with 14-day retention
- Full monitoring with alerts

See: [`examples/staging/`](examples/staging/)

### Production Environment

Enterprise-grade configuration:
- FSx Windows with Multi-AZ and AD integration
- FSx ONTAP for multi-protocol storage
- EFS with cross-region replication
- Comprehensive backup strategy
- Full monitoring and alerting

See: [`examples/production/`](examples/production/)

### Kubernetes Environment

Container-native storage:
- Portworx for persistent volumes
- MinIO for S3-compatible object storage
- Multiple storage classes
- PX-Backup integration

See: [`examples/kubernetes/`](examples/kubernetes/)

## Security Best Practices

### Encryption

1. **Always enable encryption at rest**
   ```hcl
   encryption_config = {
     create_kms_key      = true
     enable_key_rotation = true
   }
   ```

2. **Use customer-managed KMS keys for compliance**
   ```hcl
   encryption_config = {
     kms_key_arn        = "arn:aws:kms:..."
     key_administrators = ["arn:aws:iam::..."]
   }
   ```

3. **Enable multi-region keys for DR**
   ```hcl
   encryption_config = {
     multi_region = true
   }
   ```

### Network Security

1. **Restrict CIDR blocks**
   ```hcl
   security_config = {
     allowed_cidr_blocks    = ["10.0.0.0/16"]  # VPC CIDR only
     management_cidr_blocks = ["10.0.1.0/24"]  # Admin subnet only
   }
   ```

2. **Use security group references**
   ```hcl
   security_config = {
     allowed_security_group_ids = [aws_security_group.app.id]
   }
   ```

### Access Control

1. **Enable MFA for admin roles**
   ```hcl
   require_mfa_for_admin = true
   ```

2. **Use least privilege IAM**
   - `storage_admin_role`: Full management
   - `storage_readonly_role`: Read-only access
   - `backup_role`: Backup operations only
   - `ec2_client_role`: Mount and use storage

### EFS Security

1. **Enforce encryption in transit**
   ```hcl
   efs_config = {
     enable_policy = true
     policy_statements = [{
       sid    = "EnforceEncryption"
       effect = "Deny"
       conditions = [{
         test     = "Bool"
         variable = "aws:SecureTransport"
         values   = ["false"]
       }]
     }]
   }
   ```

## Disaster Recovery

### Cross-Region Replication

1. **EFS Replication**
   ```hcl
   efs_config = {
     enable_replication = true
     replication_region = "us-west-2"
   }
   ```

2. **Backup Replication**
   ```hcl
   backup_config = {
     backup_rules = [{
       copy_to_vault_arn = "arn:aws:backup:us-west-2:..."
     }]
   }
   ```

3. **Multi-Region KMS**
   ```hcl
   encryption_config = {
     multi_region = true
   }
   ```

### Backup Strategy

| Environment | Frequency | Retention | Cold Storage | DR Copy |
|-------------|-----------|-----------|--------------|---------|
| Development | None | - | - | No |
| Staging | Daily | 14 days | No | No |
| Production | Hourly/Daily/Weekly/Monthly | 7 years | Yes | Yes |

## Monitoring

### CloudWatch Dashboard

The module creates a comprehensive dashboard with:
- Storage capacity utilization
- Throughput metrics
- IOPS metrics
- Network I/O
- Connection counts

### Alarms

| Alarm | Threshold | Severity |
|-------|-----------|----------|
| Capacity Warning | 80% | Warning |
| Capacity Critical | 95% | Critical |
| Throughput High | 90% | Warning |

### EventBridge Rules

- FSx lifecycle events
- EFS lifecycle events
- Backup job status changes

## Troubleshooting

### Common Issues

1. **FSx Windows can't join AD**
   - Verify DNS resolution from VPC
   - Check security group allows AD ports (389, 636, 3268, 3269, 88, 464)
   - Verify AD credentials have permission to join computers

2. **EFS mount fails**
   - Ensure security group allows NFS (port 2049)
   - Check mount target exists in subnet
   - Use amazon-efs-utils for TLS mounts

3. **FSx Lustre S3 association fails**
   - Verify S3 bucket exists and is accessible
   - Check IAM permissions for FSx to access S3
   - Ensure S3 bucket is in same region

4. **Portworx installation fails**
   - Verify Kubernetes cluster meets requirements
   - Check storage class for cloud drives exists
   - Ensure RBAC permissions are correct

### Mount Commands

**EFS:**
```bash
# Standard mount
sudo mount -t efs fs-12345678:/ /mnt/efs

# With TLS
sudo mount -t efs -o tls fs-12345678:/ /mnt/efs

# Via DNS
sudo mount -t nfs4 -o nfsvers=4.1 fs-12345678.efs.us-east-1.amazonaws.com:/ /mnt/efs
```

**FSx Lustre:**
```bash
sudo mount -t lustre fs-12345678.fsx.us-east-1.amazonaws.com@tcp:/abcdef /mnt/fsx
```

**FSx Windows:**
```powershell
net use Z: \\fs-12345678.example.com\share
```

**FSx ONTAP:**
```bash
# NFS
sudo mount -t nfs svm-12345678.fs-abcdefgh.fsx.us-east-1.amazonaws.com:/vol_name /mnt/ontap

# SMB
net use Z: \\svm-12345678.fs-abcdefgh.fsx.us-east-1.amazonaws.com\share
```

## Cost Optimization

1. **Use lifecycle policies** for EFS to move data to IA/Archive
2. **Choose appropriate FSx deployment type** (Single-AZ for non-critical)
3. **Right-size throughput** based on actual usage
4. **Use data compression** for FSx Lustre
5. **Enable tiering** for FSx ONTAP
6. **Review backup retention** regularly

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes and test
4. Submit a pull request

## License

Apache 2.0

## Support

For issues and feature requests, please open a GitHub issue.