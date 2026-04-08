#------------------------------------------------------------------------------
# Enterprise Storage Module - Production Environment Example
#------------------------------------------------------------------------------
# This example demonstrates a comprehensive production configuration with:
# - FSx for Windows (Active Directory integrated) for Windows workloads
# - FSx for NetApp ONTAP for multi-protocol enterprise storage
# - Amazon EFS for Linux shared storage
# - Full backup and disaster recovery configuration
# - Cross-region replication for critical data
# - Comprehensive monitoring and alerting
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
      Environment = "production"
      Project     = "enterprise-storage"
      ManagedBy   = "terraform"
      Compliance  = "SOC2"
    }
  }
}

# Secondary region provider for replication
provider "aws" {
  alias  = "dr"
  region = var.dr_region

  default_tags {
    tags = {
      Environment = "production-dr"
      Project     = "enterprise-storage"
      ManagedBy   = "terraform"
      Compliance  = "SOC2"
    }
  }
}

#------------------------------------------------------------------------------
# Variables
#------------------------------------------------------------------------------

variable "aws_region" {
  description = "Primary AWS region"
  type        = string
  default     = "us-east-1"
}

variable "dr_region" {
  description = "Disaster recovery AWS region"
  type        = string
  default     = "us-west-2"
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs for storage (multi-AZ, at least 2)"
  type        = list(string)
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to access storage"
  type        = list(string)
  default     = ["10.0.0.0/8"]
}

variable "management_cidr_blocks" {
  description = "CIDR blocks for management access"
  type        = list(string)
  default     = ["10.0.0.0/24"]
}

variable "alert_emails" {
  description = "Email addresses for alerts"
  type        = list(string)
}

variable "active_directory_id" {
  description = "AWS Directory Service directory ID"
  type        = string
  default     = null
}

variable "self_managed_ad" {
  description = "Self-managed Active Directory configuration"
  type = object({
    domain_name                            = string
    dns_ips                                = list(string)
    username                               = string
    password                               = string
    organizational_unit_distinguished_name = optional(string)
    file_system_administrators_group       = optional(string, "Domain Admins")
  })
  default   = null
  sensitive = true
}

variable "kms_key_administrators" {
  description = "IAM ARNs that can administer the KMS key"
  type        = list(string)
  default     = []
}

variable "trusted_account_ids" {
  description = "AWS account IDs that can assume storage roles"
  type        = list(string)
  default     = []
}

variable "dr_backup_vault_arn" {
  description = "ARN of backup vault in DR region"
  type        = string
  default     = null
}

#------------------------------------------------------------------------------
# Enterprise Storage Module - Production Configuration
#------------------------------------------------------------------------------

module "enterprise_storage" {
  source = "../../"

  project_name = "enterprise"
  environment  = "production"
  vpc_id       = var.vpc_id

  tags = {
    Team           = "platform"
    CostCenter     = "infrastructure"
    Application    = "enterprise-storage"
    DataClass      = "confidential"
    BackupEnabled  = "true"
    Compliance     = "SOC2"
  }

  #----------------------------------------------------------------------------
  # Encryption Configuration - Production grade
  #----------------------------------------------------------------------------
  encryption_config = {
    create_kms_key             = true
    kms_key_arn                = null
    key_deletion_window_days   = 30
    enable_key_rotation        = true
    multi_region               = true  # Enable for DR
    key_administrators         = var.kms_key_administrators
    key_users                  = []
  }

  #----------------------------------------------------------------------------
  # Security Configuration
  #----------------------------------------------------------------------------
  security_config = {
    allowed_cidr_blocks        = var.allowed_cidr_blocks
    allowed_security_group_ids = []
    management_cidr_blocks     = var.management_cidr_blocks
  }

  #----------------------------------------------------------------------------
  # FSx for Windows File Server - Enterprise Windows storage
  #----------------------------------------------------------------------------
  fsx_windows_config = var.active_directory_id != null || var.self_managed_ad != null ? {
    enabled                        = true
    subnet_ids                     = var.subnet_ids
    additional_security_group_ids  = []
    storage_capacity_gb            = 2048
    storage_type                   = "SSD"
    throughput_capacity            = 256  # MB/s
    deployment_type                = "MULTI_AZ_1"  # High availability
    preferred_subnet_id            = var.subnet_ids[0]
    
    # Active Directory configuration
    active_directory_id = var.active_directory_id
    self_managed_ad_config = var.self_managed_ad != null ? {
      domain_name                            = var.self_managed_ad.domain_name
      dns_ips                                = var.self_managed_ad.dns_ips
      username                               = var.self_managed_ad.username
      password                               = var.self_managed_ad.password
      organizational_unit_distinguished_name = var.self_managed_ad.organizational_unit_distinguished_name
      file_system_administrators_group       = var.self_managed_ad.file_system_administrators_group
    } : null
    
    # Backup configuration
    automatic_backup_retention_days   = 35
    daily_automatic_backup_start_time = "03:00"
    copy_tags_to_backups              = true
    skip_final_backup                 = false
    
    weekly_maintenance_start_time = "sun:04:00"
    aliases                       = []
    audit_log_destination         = null  # Configure CloudWatch log group
  } : null

  #----------------------------------------------------------------------------
  # FSx for NetApp ONTAP - Multi-protocol enterprise storage
  #----------------------------------------------------------------------------
  fsx_ontap_config = {
    enabled                        = true
    subnet_ids                     = var.subnet_ids
    preferred_subnet_id            = var.subnet_ids[0]
    additional_security_group_ids  = []
    route_table_ids                = []
    endpoint_ip_address_range      = null
    
    storage_capacity_gb            = 2048
    storage_type                   = "SSD"
    throughput_capacity            = 512   # MB/s
    deployment_type                = "MULTI_AZ_1"
    ha_pairs                       = 1
    
    disk_iops_mode = "AUTOMATIC"
    disk_iops      = null
    
    automatic_backup_retention_days   = 35
    daily_automatic_backup_start_time = "03:00"
    weekly_maintenance_start_time     = "sun:04:00"
    
    # Storage Virtual Machines
    storage_virtual_machines = {
      svm_prod = {
        name                       = "svm-prod"
        root_volume_security_style = "MIXED"  # Support both NFS and SMB
        
        active_directory_configuration = var.self_managed_ad != null ? {
          self_managed_active_directory = {
            domain_name                            = var.self_managed_ad.domain_name
            dns_ips                                = var.self_managed_ad.dns_ips
            username                               = var.self_managed_ad.username
            password                               = var.self_managed_ad.password
            organizational_unit_distinguished_name = var.self_managed_ad.organizational_unit_distinguished_name
            file_system_administrators_group       = var.self_managed_ad.file_system_administrators_group
          }
        } : null
      }
    }
    
    # Volumes
    volumes = {
      data_vol = {
        name                       = "data"
        storage_virtual_machine    = "svm_prod"
        size_in_megabytes          = 512000  # 500 GB
        junction_path              = "/data"
        security_style             = "MIXED"
        storage_efficiency_enabled = true
        
        tiering_policy = {
          name           = "AUTO"
          cooling_period = 31
        }
        
        snaplock_configuration = null
      }
      
      share_vol = {
        name                       = "share"
        storage_virtual_machine    = "svm_prod"
        size_in_megabytes          = 256000  # 250 GB
        junction_path              = "/share"
        security_style             = "NTFS"
        storage_efficiency_enabled = true
        
        tiering_policy = {
          name           = "SNAPSHOT_ONLY"
          cooling_period = null
        }
        
        snaplock_configuration = null
      }
      
      archive_vol = {
        name                       = "archive"
        storage_virtual_machine    = "svm_prod"
        size_in_megabytes          = 1024000  # 1 TB
        junction_path              = "/archive"
        security_style             = "UNIX"
        storage_efficiency_enabled = true
        
        tiering_policy = {
          name           = "ALL"  # Tier all data to capacity pool
          cooling_period = null
        }
        
        snaplock_configuration = null
      }
    }
  }

  #----------------------------------------------------------------------------
  # Amazon EFS - Linux shared storage with replication
  #----------------------------------------------------------------------------
  efs_config = {
    enabled                        = true
    performance_mode               = "generalPurpose"
    throughput_mode                = "elastic"
    provisioned_throughput_in_mibps = null
    subnet_ids                     = var.subnet_ids
    additional_security_group_ids  = []
    
    lifecycle_policies = {
      transition_to_ia                    = "AFTER_30_DAYS"
      transition_to_primary_storage_class = "AFTER_1_ACCESS"
      transition_to_archive               = "AFTER_90_DAYS"
    }
    
    access_points = {
      app = {
        root_directory_path = "/app"
        posix_user = {
          uid            = 1000
          gid            = 1000
          secondary_gids = [1001]
        }
        root_directory_creation_info = {
          owner_uid   = 1000
          owner_gid   = 1000
          permissions = "750"
        }
      }
      data = {
        root_directory_path = "/data"
        posix_user = {
          uid            = 1000
          gid            = 1000
          secondary_gids = [1001]
        }
        root_directory_creation_info = {
          owner_uid   = 1000
          owner_gid   = 1000
          permissions = "750"
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
      config = {
        root_directory_path = "/config"
        posix_user = {
          uid            = 0
          gid            = 0
          secondary_gids = []
        }
        root_directory_creation_info = {
          owner_uid   = 0
          owner_gid   = 0
          permissions = "700"
        }
      }
    }
    
    # Enforce encryption in transit
    enable_policy         = true
    bypass_policy_lockout = false
    policy_statements = [
      {
        sid       = "EnforceEncryptionInTransit"
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
      },
      {
        sid       = "EnforceRootAccess"
        effect    = "Deny"
        principals = {
          type        = "*"
          identifiers = ["*"]
        }
        actions   = ["elasticfilesystem:ClientRootAccess"]
        resources = ["*"]
        conditions = [
          {
            test     = "Bool"
            variable = "elasticfilesystem:AccessedViaMountTarget"
            values   = ["true"]
          }
        ]
      }
    ]
    
    enable_backup         = true
    enable_replication    = true
    replication_region    = var.dr_region
    replication_kms_key_id = null  # Use AWS-managed key in DR region
  }

  #----------------------------------------------------------------------------
  # Disable other storage types
  #----------------------------------------------------------------------------
  fsx_lustre_config  = null
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
  trusted_account_ids    = var.trusted_account_ids
  require_mfa_for_admin  = true

  #----------------------------------------------------------------------------
  # Monitoring Configuration - Full production monitoring
  #----------------------------------------------------------------------------
  monitoring_config = {
    create_dashboard          = true
    dashboard_name            = "enterprise-storage-production"
    create_log_group          = true
    log_retention_days        = 365  # 1 year retention
    create_sns_topic          = true
    alert_email_addresses     = var.alert_emails
    create_event_rules        = true
    capacity_alarm_enabled    = true
    capacity_warning_threshold  = 70
    capacity_critical_threshold = 85
  }

  #----------------------------------------------------------------------------
  # Backup Configuration - Comprehensive backup strategy
  #----------------------------------------------------------------------------
  backup_config = {
    enabled      = true
    create_vault = true
    vault_name   = null
    backup_rules = [
      {
        name                        = "hourly-backup"
        schedule                    = "cron(0 * ? * * *)"  # Every hour
        start_window_minutes        = 60
        completion_window_minutes   = 120
        lifecycle = {
          cold_storage_after_days = null
          delete_after_days       = 1  # Keep 24 hourly backups
        }
        copy_to_vault_arn = null
        copy_lifecycle    = null
      },
      {
        name                        = "daily-backup"
        schedule                    = "cron(0 3 ? * * *)"  # 3 AM daily
        start_window_minutes        = 60
        completion_window_minutes   = 180
        lifecycle = {
          cold_storage_after_days = 30
          delete_after_days       = 90  # 90 day retention
        }
        copy_to_vault_arn = var.dr_backup_vault_arn  # Copy to DR region
        copy_lifecycle = {
          cold_storage_after_days = 30
          delete_after_days       = 90
        }
      },
      {
        name                        = "weekly-backup"
        schedule                    = "cron(0 4 ? * SUN *)"  # Sunday 4 AM
        start_window_minutes        = 60
        completion_window_minutes   = 240
        lifecycle = {
          cold_storage_after_days = 30
          delete_after_days       = 365  # 1 year retention
        }
        copy_to_vault_arn = var.dr_backup_vault_arn
        copy_lifecycle = {
          cold_storage_after_days = 30
          delete_after_days       = 365
        }
      },
      {
        name                        = "monthly-backup"
        schedule                    = "cron(0 5 1 * ? *)"  # 1st of month 5 AM
        start_window_minutes        = 60
        completion_window_minutes   = 480
        lifecycle = {
          cold_storage_after_days = 90
          delete_after_days       = 2555  # 7 year retention (compliance)
        }
        copy_to_vault_arn = var.dr_backup_vault_arn
        copy_lifecycle = {
          cold_storage_after_days = 90
          delete_after_days       = 2555
        }
      }
    ]
  }

  #----------------------------------------------------------------------------
  # Replication Configuration
  #----------------------------------------------------------------------------
  replication_config = {
    target_region       = var.dr_region
    source_cidr_blocks  = var.allowed_cidr_blocks
  }
}

#------------------------------------------------------------------------------
# Outputs
#------------------------------------------------------------------------------

output "fsx_windows" {
  description = "FSx Windows file system details"
  value       = module.enterprise_storage.fsx_windows
  sensitive   = false
}

output "fsx_ontap" {
  description = "FSx ONTAP file system details"
  value       = module.enterprise_storage.fsx_ontap
  sensitive   = false
}

output "efs" {
  description = "EFS file system details"
  value       = module.enterprise_storage.efs
  sensitive   = false
}

output "security_groups" {
  description = "Storage security group IDs"
  value       = module.enterprise_storage.security_groups
}

output "iam_roles" {
  description = "IAM role ARNs"
  value       = module.enterprise_storage.iam_roles
}

output "kms_key_arn" {
  description = "KMS key ARN"
  value       = module.enterprise_storage.kms_key_arn
}

output "backup_vault_arn" {
  description = "AWS Backup vault ARN"
  value       = module.enterprise_storage.backup_vault_arn
}

output "backup_plan_arn" {
  description = "AWS Backup plan ARN"
  value       = module.enterprise_storage.backup_plan_arn
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
  description = "Summary of all deployed storage"
  value       = module.enterprise_storage.storage_summary
}

output "connection_info" {
  description = "Storage connection information"
  value       = module.enterprise_storage.connection_info
}