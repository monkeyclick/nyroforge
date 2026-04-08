#------------------------------------------------------------------------------
# FSx for Windows File Server Submodule - Variables
#------------------------------------------------------------------------------

variable "enabled" {
  description = "Whether to create FSx Windows resources"
  type        = bool
  default     = true
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "tags" {
  description = "Common tags to apply to resources"
  type        = map(string)
  default     = {}
}

#------------------------------------------------------------------------------
# Network Configuration
#------------------------------------------------------------------------------

variable "vpc_id" {
  description = "VPC ID for the file system"
  type        = string
}

variable "subnet_ids" {
  description = "List of subnet IDs for the file system"
  type        = list(string)
}

variable "preferred_subnet_id" {
  description = "Preferred subnet ID for Single-AZ deployments"
  type        = string
  default     = null
}

variable "security_group_ids" {
  description = "List of security group IDs"
  type        = list(string)
}

#------------------------------------------------------------------------------
# Storage Configuration
#------------------------------------------------------------------------------

variable "storage_capacity_gb" {
  description = "Storage capacity in GB (32-65536)"
  type        = number
  default     = 300

  validation {
    condition     = var.storage_capacity_gb >= 32 && var.storage_capacity_gb <= 65536
    error_message = "Storage capacity must be between 32 GB and 65,536 GB."
  }
}

variable "storage_type" {
  description = "Storage type: SSD or HDD"
  type        = string
  default     = "SSD"

  validation {
    condition     = contains(["SSD", "HDD"], var.storage_type)
    error_message = "Storage type must be SSD or HDD."
  }
}

variable "throughput_capacity_mbs" {
  description = "Throughput capacity in MB/s"
  type        = number
  default     = 64

  validation {
    condition     = contains([8, 16, 32, 64, 128, 256, 512, 1024, 2048], var.throughput_capacity_mbs)
    error_message = "Throughput capacity must be one of: 8, 16, 32, 64, 128, 256, 512, 1024, 2048 MB/s."
  }
}

variable "deployment_type" {
  description = "Deployment type: SINGLE_AZ_1, SINGLE_AZ_2, or MULTI_AZ_1"
  type        = string
  default     = "SINGLE_AZ_2"

  validation {
    condition     = contains(["SINGLE_AZ_1", "SINGLE_AZ_2", "MULTI_AZ_1"], var.deployment_type)
    error_message = "Deployment type must be SINGLE_AZ_1, SINGLE_AZ_2, or MULTI_AZ_1."
  }
}

variable "disk_iops_configuration" {
  description = "Disk IOPS configuration for SSD storage"
  type = object({
    mode = string
    iops = optional(number)
  })
  default = null

  validation {
    condition     = var.disk_iops_configuration == null || contains(["AUTOMATIC", "USER_PROVISIONED"], var.disk_iops_configuration.mode)
    error_message = "Disk IOPS mode must be AUTOMATIC or USER_PROVISIONED."
  }
}

#------------------------------------------------------------------------------
# Active Directory Configuration
#------------------------------------------------------------------------------

variable "active_directory_id" {
  description = "AWS Managed Active Directory ID"
  type        = string
  default     = null
}

variable "self_managed_active_directory" {
  description = "Self-managed Active Directory configuration"
  type = object({
    dns_ips                                = list(string)
    domain_name                            = string
    username                               = string
    password                               = string
    file_system_administrators_group       = optional(string, "Domain Admins")
    organizational_unit_distinguished_name = optional(string)
  })
  default = null
}

#------------------------------------------------------------------------------
# Backup Configuration
#------------------------------------------------------------------------------

variable "automatic_backup_retention_days" {
  description = "Number of days to retain automatic backups (0-90)"
  type        = number
  default     = 7

  validation {
    condition     = var.automatic_backup_retention_days >= 0 && var.automatic_backup_retention_days <= 90
    error_message = "Backup retention must be between 0 and 90 days."
  }
}

variable "daily_automatic_backup_start_time" {
  description = "Daily backup start time in HH:MM format (UTC)"
  type        = string
  default     = "02:00"

  validation {
    condition     = can(regex("^([01][0-9]|2[0-3]):[0-5][0-9]$", var.daily_automatic_backup_start_time))
    error_message = "Backup start time must be in HH:MM format."
  }
}

variable "copy_tags_to_backups" {
  description = "Copy tags to backups"
  type        = bool
  default     = true
}

variable "skip_final_backup" {
  description = "Skip final backup when deleting file system"
  type        = bool
  default     = false
}

#------------------------------------------------------------------------------
# Maintenance Configuration
#------------------------------------------------------------------------------

variable "weekly_maintenance_start_time" {
  description = "Weekly maintenance start time in d:HH:MM format"
  type        = string
  default     = "sat:03:00"

  validation {
    condition     = can(regex("^(mon|tue|wed|thu|fri|sat|sun):([01][0-9]|2[0-3]):[0-5][0-9]$", var.weekly_maintenance_start_time))
    error_message = "Maintenance time must be in d:HH:MM format (e.g., sat:03:00)."
  }
}

#------------------------------------------------------------------------------
# DNS Aliases
#------------------------------------------------------------------------------

variable "aliases" {
  description = "List of DNS aliases for the file system"
  type        = list(string)
  default     = []
}

#------------------------------------------------------------------------------
# Audit Logging Configuration
#------------------------------------------------------------------------------

variable "audit_log_destination" {
  description = "ARN of CloudWatch Logs log group for audit logging"
  type        = string
  default     = null
}

variable "file_access_audit_log_level" {
  description = "File access audit log level: DISABLED, SUCCESS_ONLY, FAILURE_ONLY, SUCCESS_AND_FAILURE"
  type        = string
  default     = "SUCCESS_AND_FAILURE"

  validation {
    condition     = contains(["DISABLED", "SUCCESS_ONLY", "FAILURE_ONLY", "SUCCESS_AND_FAILURE"], var.file_access_audit_log_level)
    error_message = "Invalid file access audit log level."
  }
}

variable "file_share_access_audit_log_level" {
  description = "File share access audit log level"
  type        = string
  default     = "SUCCESS_AND_FAILURE"

  validation {
    condition     = contains(["DISABLED", "SUCCESS_ONLY", "FAILURE_ONLY", "SUCCESS_AND_FAILURE"], var.file_share_access_audit_log_level)
    error_message = "Invalid file share access audit log level."
  }
}

variable "create_audit_log_group" {
  description = "Create CloudWatch log group for audit logs"
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 30
}

#------------------------------------------------------------------------------
# Encryption Configuration
#------------------------------------------------------------------------------

variable "kms_key_id" {
  description = "KMS key ID for encryption at rest"
  type        = string
  default     = null
}

#------------------------------------------------------------------------------
# Data Repository Configuration
#------------------------------------------------------------------------------

variable "data_repository_associations" {
  description = "List of data repository associations for S3 integration"
  type = list(object({
    file_system_path                 = string
    data_repository_path             = string
    batch_import_meta_data_on_create = optional(bool, false)
    imported_file_chunk_size         = optional(number, 1024)
    s3_auto_export_policy = optional(object({
      events = list(string)
    }))
    s3_auto_import_policy = optional(object({
      events = list(string)
    }))
  }))
  default = null
}

#------------------------------------------------------------------------------
# Monitoring Configuration
#------------------------------------------------------------------------------

variable "enable_cloudwatch_alarms" {
  description = "Enable CloudWatch alarms"
  type        = bool
  default     = true
}

variable "storage_utilization_threshold" {
  description = "Storage utilization threshold percentage for alarm"
  type        = number
  default     = 80
}

variable "throughput_utilization_threshold" {
  description = "Throughput utilization threshold percentage for alarm"
  type        = number
  default     = 80
}

variable "alarm_actions" {
  description = "List of ARNs to notify when alarm triggers"
  type        = list(string)
  default     = []
}

variable "ok_actions" {
  description = "List of ARNs to notify when alarm returns to OK"
  type        = list(string)
  default     = []
}

variable "create_sns_topic" {
  description = "Create SNS topic for alerts"
  type        = bool
  default     = false
}