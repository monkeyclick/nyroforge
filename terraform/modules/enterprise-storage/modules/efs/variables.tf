#------------------------------------------------------------------------------
# AWS EFS Submodule - Variables
#------------------------------------------------------------------------------

variable "enabled" {
  description = "Whether to create EFS resources"
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
  description = "List of subnet IDs for mount targets"
  type        = list(string)
}

variable "mount_target_subnet_ids" {
  description = "Specific subnet IDs for mount targets (overrides subnet_ids)"
  type        = list(string)
  default     = null
}

variable "security_group_ids" {
  description = "List of security group IDs for mount targets"
  type        = list(string)
}

#------------------------------------------------------------------------------
# Performance Configuration
#------------------------------------------------------------------------------

variable "performance_mode" {
  description = "Performance mode: generalPurpose or maxIO"
  type        = string
  default     = "generalPurpose"

  validation {
    condition     = contains(["generalPurpose", "maxIO"], var.performance_mode)
    error_message = "Performance mode must be generalPurpose or maxIO."
  }
}

variable "throughput_mode" {
  description = "Throughput mode: bursting, provisioned, or elastic"
  type        = string
  default     = "bursting"

  validation {
    condition     = contains(["bursting", "provisioned", "elastic"], var.throughput_mode)
    error_message = "Throughput mode must be bursting, provisioned, or elastic."
  }
}

variable "provisioned_throughput_in_mibps" {
  description = "Provisioned throughput in MiB/s (required for provisioned mode)"
  type        = number
  default     = null

  validation {
    condition     = var.provisioned_throughput_in_mibps == null || (var.provisioned_throughput_in_mibps >= 1 && var.provisioned_throughput_in_mibps <= 3414)
    error_message = "Provisioned throughput must be between 1 and 3414 MiB/s."
  }
}

#------------------------------------------------------------------------------
# Availability Configuration
#------------------------------------------------------------------------------

variable "availability_zone_name" {
  description = "Availability zone for One Zone storage class"
  type        = string
  default     = null
}

#------------------------------------------------------------------------------
# Lifecycle Policies
#------------------------------------------------------------------------------

variable "lifecycle_policies" {
  description = "List of lifecycle policies"
  type = list(object({
    transition_to_ia                    = optional(string)
    transition_to_primary_storage_class = optional(string)
    transition_to_archive               = optional(string)
  }))
  default = [
    {
      transition_to_ia = "AFTER_30_DAYS"
    }
  ]

  validation {
    condition = alltrue([
      for policy in var.lifecycle_policies :
      (policy.transition_to_ia == null || contains(
        ["AFTER_1_DAY", "AFTER_7_DAYS", "AFTER_14_DAYS", "AFTER_30_DAYS", "AFTER_60_DAYS", "AFTER_90_DAYS", "AFTER_180_DAYS", "AFTER_270_DAYS", "AFTER_365_DAYS"],
        policy.transition_to_ia
      ))
    ])
    error_message = "Invalid transition_to_ia value."
  }
}

#------------------------------------------------------------------------------
# Backup Configuration
#------------------------------------------------------------------------------

variable "enable_backup_policy" {
  description = "Enable automatic backups with AWS Backup"
  type        = bool
  default     = true
}

#------------------------------------------------------------------------------
# Access Points
#------------------------------------------------------------------------------

variable "access_points" {
  description = "List of EFS access points to create"
  type = list(object({
    name = string
    posix_user = optional(object({
      gid            = number
      uid            = number
      secondary_gids = optional(list(number))
    }))
    root_directory = optional(object({
      path = string
      creation_info = optional(object({
        owner_gid   = number
        owner_uid   = number
        permissions = string
      }))
    }))
  }))
  default = []
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
# File System Policy
#------------------------------------------------------------------------------

variable "enable_file_system_policy" {
  description = "Enable file system policy"
  type        = bool
  default     = false
}

variable "file_system_policy_bypass_policy_lockout_safety_check" {
  description = "Bypass policy lockout safety check"
  type        = bool
  default     = false
}

variable "enforce_encryption_in_transit" {
  description = "Enforce encryption in transit in the file system policy"
  type        = bool
  default     = true
}

variable "restrict_root_access" {
  description = "Restrict root access in the file system policy"
  type        = bool
  default     = false
}

variable "allowed_principals" {
  description = "List of IAM principal ARNs allowed to access EFS"
  type        = list(string)
  default     = []
}

#------------------------------------------------------------------------------
# Protection Configuration
#------------------------------------------------------------------------------

variable "enable_replication_overwrite_protection" {
  description = "Enable replication overwrite protection"
  type        = bool
  default     = true
}

#------------------------------------------------------------------------------
# Replication Configuration
#------------------------------------------------------------------------------

variable "replication_configuration" {
  description = "Replication configuration for cross-region replication"
  type = object({
    destination = object({
      region                 = optional(string)
      availability_zone_name = optional(string)
      kms_key_id            = optional(string)
      file_system_id        = optional(string)
    })
  })
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

variable "burst_credit_balance_threshold" {
  description = "Threshold for burst credit balance alarm (bytes)"
  type        = number
  default     = 1000000000000  # 1 TB
}

variable "percent_io_limit_threshold" {
  description = "Threshold for percent I/O limit alarm (%)"
  type        = number
  default     = 80
}

variable "throughput_threshold_bytes" {
  description = "Threshold for throughput alarm (bytes per 5 minutes)"
  type        = number
  default     = 5368709120  # 5 GB per 5 minutes = 100 MB/s average
}

variable "client_connections_threshold" {
  description = "Threshold for client connections alarm"
  type        = number
  default     = 1000
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