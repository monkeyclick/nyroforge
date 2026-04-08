#------------------------------------------------------------------------------
# Enterprise Storage Module - Staging Environment Example
#------------------------------------------------------------------------------
# This example demonstrates a staging configuration using Amazon EFS for
# general file storage and FSx for Lustre for high-performance compute
# workloads. Staging environments should mirror production capabilities
# but with reduced capacity.
#------------------------------------------------------------------------------

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Environment = "staging"
      Project     = "enterprise-storage-example"
      ManagedBy   = "terraform"
    }
  }
}

#------------------------------------------------------------------------------
# Variables
#------------------------------------------------------------------------------

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-west-2"
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs for storage (multi-AZ)"
  type        = list(string)
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to access storage"
  type        = list(string)
  default     = ["10.0.0.0/8"]
}

variable "alert_emails" {
  description = "Email addresses for alerts"
  type        = list(string)
  default     = []
}

variable "s3_data_bucket" {
  description = "S3 bucket for FSx Lustre data repository"
  type        = string
  default     = null
}

#------------------------------------------------------------------------------
# Enterprise Storage Module - Staging Configuration
#------------------------------------------------------------------------------

module "enterprise_storage" {
  source = "../../"

  project_name = "myapp"
  environment  = "staging"
  vpc_id       = var.vpc_id

  tags = {
    Team        = "platform"
    CostCenter  = "engineering"
    Application = "myapp"
    DataClass   = "internal"
  }

  #----------------------------------------------------------------------------
  # Encryption Configuration
  #----------------------------------------------------------------------------
  encryption_config = {
    create_kms_key             = true
    kms_key_arn                = null
    key_deletion_window_days   = 14
    enable_key_rotation        = true
    multi_region               = false
    key_administrators         = []
    key_users                  = []
  }

  #----------------------------------------------------------------------------
  # Security Configuration
  #----------------------------------------------------------------------------
  security_config = {
    allowed_cidr_blocks        = var.allowed_cidr_blocks
    allowed_security_group_ids = []
    management_cidr_blocks     = var.allowed_cidr_blocks
  }

  #----------------------------------------------------------------------------
  # Amazon EFS - General purpose shared storage
  #----------------------------------------------------------------------------
  efs_config = {
    enabled                        = true
    performance_mode               = "generalPurpose"
    throughput_mode                = "elastic"  # Elastic for better performance
    provisioned_throughput_in_mibps = null
    subnet_ids                     = var.subnet_ids
    additional_security_group_ids  = []
    
    lifecycle_policies = {
      transition_to_ia                    = "AFTER_14_DAYS"
      transition_to_primary_storage_class = "AFTER_1_ACCESS"
      transition_to_archive               = "AFTER_90_DAYS"
    }
    
    access_points = {
      app = {
        root_directory_path = "/app"
        posix_user = {
          uid            = 1000
          gid            = 1000
          secondary_gids = []
        }
        root_directory_creation_info = {
          owner_uid   = 1000
          owner_gid   = 1000
          permissions = "755"
        }
      }
      data = {
        root_directory_path = "/data"
        posix_user = {
          uid            = 1000
          gid            = 1000
          secondary_gids = []
        }
        root_directory_creation_info = {
          owner_uid   = 1000
          owner_gid   = 1000
          permissions = "755"
        }
      }
      logs = {
        root_directory_path = "/logs"
        posix_user = {
          uid            = 1000
          gid            = 1000
          secondary_gids = []
        }
        root_directory_creation_info = {
          owner_uid   = 1000
          owner_gid   = 1000
          permissions = "755"
        }
      }
      shared = {
        root_directory_path = "/shared"
        posix_user = {
          uid            = 1000
          gid            = 1000
          secondary_gids = []
        }
        root_directory_creation_info = {
          owner_uid   = 1000
          owner_gid   = 1000
          permissions = "755"
        }
      }
    }
    
    enable_policy         = true
    bypass_policy_lockout = true
    policy_statements = [
      {
        sid       = "EnforceEncryption"
        effect    = "Deny"
        principals = {
          type        = "*"
          identifiers = ["*"]
        }
        actions   = ["*"]
        resources = ["*"]
        conditions = [
          {
            test     = "Bool"
            variable = "aws:SecureTransport"
            values   = ["false"]
          }
        ]
      }
    ]
    
    enable_backup         = true
    enable_replication    = false  # No cross-region for staging
    replication_region    = null
    replication_kms_key_id = null
  }

  #----------------------------------------------------------------------------
  # FSx for Lustre - High-performance compute storage
  # Used for staging HPC/ML workloads with S3 integration
  #----------------------------------------------------------------------------
  fsx_lustre_config = var.s3_data_bucket != null ? {
    enabled                        = true
    subnet_ids                     = [var.subnet_ids[0]]  # Single AZ for staging
    additional_security_group_ids  = []
    storage_capacity_gb            = 1200  # Minimum for PERSISTENT_2
    storage_type                   = "SSD"
    deployment_type                = "PERSISTENT_2"
    per_unit_storage_throughput    = 125   # Lower tier for staging
    
    # S3 integration for data staging
    s3_import_path         = "s3://${var.s3_data_bucket}/input"
    s3_export_path         = "s3://${var.s3_data_bucket}/output"
    imported_file_chunk_size = 1024
    auto_import_policy     = "NEW_CHANGED"
    
    data_repository_associations = {
      input = {
        data_repository_path = "s3://${var.s3_data_bucket}/datasets"
        file_system_path     = "/datasets"
        import_policy        = "NEW_CHANGED_DELETED"
        export_policy        = null
      }
    }
    
    automatic_backup_retention_days   = 7
    daily_automatic_backup_start_time = "05:00"
    copy_tags_to_backups              = true
    
    drive_cache_type              = null
    data_compression_type         = "LZ4"
    weekly_maintenance_start_time = "sun:06:00"
    file_system_type_version      = "2.15"
    
    log_destination = null
    log_level       = "WARN_ERROR"
  } : null

  #----------------------------------------------------------------------------
  # Disable other storage types for staging
  #----------------------------------------------------------------------------
  fsx_windows_config = null
  fsx_ontap_config   = null
  fsx_openzfs_config = null
  netapp_cloud_volumes_config = null
  pure_storage_config = null
  portworx_config    = null
  minio_config       = null

  #----------------------------------------------------------------------------
  # IAM Configuration
  #----------------------------------------------------------------------------
  create_iam_roles       = true
  create_storage_client_sg = true
  trusted_account_ids    = []
  require_mfa_for_admin  = true

  #----------------------------------------------------------------------------
  # Monitoring Configuration
  #----------------------------------------------------------------------------
  monitoring_config = {
    create_dashboard          = true
    dashboard_name            = null
    create_log_group          = true
    log_retention_days        = 30
    create_sns_topic          = length(var.alert_emails) > 0
    alert_email_addresses     = var.alert_emails
    create_event_rules        = true
    capacity_alarm_enabled    = true
    capacity_warning_threshold  = 75
    capacity_critical_threshold = 90
  }

  #----------------------------------------------------------------------------
  # Backup Configuration
  #----------------------------------------------------------------------------
  backup_config = {
    enabled      = true
    create_vault = true
    vault_name   = null
    backup_rules = [
      {
        name                        = "daily-backup"
        schedule                    = "cron(0 5 ? * * *)"  # 5 AM daily
        start_window_minutes        = 60
        completion_window_minutes   = 180
        lifecycle = {
          cold_storage_after_days = null  # No cold storage for staging
          delete_after_days       = 14    # 2 week retention
        }
        copy_to_vault_arn = null
        copy_lifecycle    = null
      }
    ]
  }

  #----------------------------------------------------------------------------
  # Replication Configuration - Disabled for staging
  #----------------------------------------------------------------------------
  replication_config = null
}

#------------------------------------------------------------------------------
# Outputs
#------------------------------------------------------------------------------

output "efs_file_system_id" {
  description = "EFS file system ID"
  value       = module.enterprise_storage.efs_file_system_id
}

output "efs_dns_name" {
  description = "EFS DNS name"
  value       = module.enterprise_storage.efs_dns_name
}

output "efs_access_points" {
  description = "EFS access point IDs"
  value       = module.enterprise_storage.efs_access_point_ids
}

output "fsx_lustre_file_system_id" {
  description = "FSx Lustre file system ID"
  value       = module.enterprise_storage.fsx_lustre_file_system_id
}

output "fsx_lustre_dns_name" {
  description = "FSx Lustre DNS name"
  value       = module.enterprise_storage.fsx_lustre_dns_name
}

output "fsx_lustre_mount_name" {
  description = "FSx Lustre mount name"
  value       = module.enterprise_storage.fsx_lustre_mount_name
}

output "storage_client_security_group_id" {
  description = "Security group ID to attach to EC2 instances"
  value       = module.enterprise_storage.storage_client_security_group_id
}

output "ec2_instance_profile_name" {
  description = "Instance profile name for EC2 instances"
  value       = module.enterprise_storage.ec2_client_instance_profile_name
}

output "backup_vault_name" {
  description = "AWS Backup vault name"
  value       = module.enterprise_storage.backup_vault_name
}

output "cloudwatch_dashboard_name" {
  description = "CloudWatch dashboard name"
  value       = module.enterprise_storage.cloudwatch_dashboard_name
}

output "sns_topic_arn" {
  description = "SNS topic ARN for alerts"
  value       = module.enterprise_storage.sns_topic_arn
}

output "storage_summary" {
  description = "Summary of deployed storage"
  value       = module.enterprise_storage.storage_summary
}

output "connection_info" {
  description = "Storage connection information"
  value       = module.enterprise_storage.connection_info
}