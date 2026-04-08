#------------------------------------------------------------------------------
# Enterprise Storage Module - Development Environment Example
#------------------------------------------------------------------------------
# This example demonstrates a minimal development configuration using
# Amazon EFS for shared file storage. Development environments typically
# require lower costs and simpler configurations.
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
      Environment = "dev"
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
  description = "Subnet IDs for storage"
  type        = list(string)
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to access storage"
  type        = list(string)
  default     = ["10.0.0.0/8"]
}

#------------------------------------------------------------------------------
# Enterprise Storage Module - Development Configuration
#------------------------------------------------------------------------------

module "enterprise_storage" {
  source = "../../"

  project_name = "myapp"
  environment  = "dev"
  vpc_id       = var.vpc_id

  tags = {
    Team        = "development"
    CostCenter  = "engineering"
    Application = "myapp"
  }

  #----------------------------------------------------------------------------
  # Encryption Configuration
  # For dev, we use a simpler KMS configuration
  #----------------------------------------------------------------------------
  encryption_config = {
    create_kms_key             = true
    kms_key_arn                = null
    key_deletion_window_days   = 7  # Shorter for dev
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
  # Amazon EFS - Simple shared storage for development
  #----------------------------------------------------------------------------
  efs_config = {
    enabled                        = true
    performance_mode               = "generalPurpose"  # Lower cost
    throughput_mode                = "bursting"        # Bursting for variable workloads
    provisioned_throughput_in_mibps = null
    subnet_ids                     = var.subnet_ids
    additional_security_group_ids  = []
    
    # Lifecycle policies - move to IA quickly to save costs
    lifecycle_policies = {
      transition_to_ia                    = "AFTER_7_DAYS"
      transition_to_primary_storage_class = "AFTER_1_ACCESS"
      transition_to_archive               = null  # No archive for dev
    }
    
    # Access points for different applications
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
    }
    
    enable_policy         = false  # Simpler for dev
    bypass_policy_lockout = true
    policy_statements     = []
    enable_backup         = false  # No backup for dev (cost savings)
    enable_replication    = false
    replication_region    = null
    replication_kms_key_id = null
  }

  #----------------------------------------------------------------------------
  # Disable other storage types for development
  #----------------------------------------------------------------------------
  fsx_windows_config = null
  fsx_lustre_config  = null
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
  require_mfa_for_admin  = false  # Relaxed for dev

  #----------------------------------------------------------------------------
  # Monitoring Configuration - Basic monitoring for dev
  #----------------------------------------------------------------------------
  monitoring_config = {
    create_dashboard          = true
    dashboard_name            = null
    create_log_group          = true
    log_retention_days        = 7   # Short retention for dev
    create_sns_topic          = false  # No alerts for dev
    alert_email_addresses     = []
    create_event_rules        = false
    capacity_alarm_enabled    = false
    capacity_warning_threshold  = 80
    capacity_critical_threshold = 95
  }

  #----------------------------------------------------------------------------
  # Backup Configuration - Disabled for dev
  #----------------------------------------------------------------------------
  backup_config = {
    enabled      = false
    create_vault = false
    vault_name   = null
    backup_rules = []
  }

  #----------------------------------------------------------------------------
  # Replication Configuration - Disabled for dev
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

output "storage_client_security_group_id" {
  description = "Security group ID to attach to EC2 instances"
  value       = module.enterprise_storage.storage_client_security_group_id
}

output "ec2_instance_profile_name" {
  description = "Instance profile name for EC2 instances"
  value       = module.enterprise_storage.ec2_client_instance_profile_name
}

output "connection_info" {
  description = "Storage connection information"
  value       = module.enterprise_storage.connection_info
}