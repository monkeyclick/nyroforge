#------------------------------------------------------------------------------
# FSx for OpenZFS Submodule - Variables
#------------------------------------------------------------------------------

variable "enabled" {
  description = "Whether to create FSx OpenZFS resources"
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
  description = "List of subnet IDs (2 required for Multi-AZ)"
  type        = list(string)
}

variable "preferred_subnet_id" {
  description = "Preferred subnet ID for Multi-AZ deployments"
  type        = string
  default     = null
}

variable "security_group_ids" {
  description = "List of security group IDs"
  type        = list(string)
}

variable "endpoint_ip_address_range" {
  description = "IP address range for Multi-AZ endpoint (CIDR notation)"
  type        = string
  default     = null
}

variable "route_table_ids" {
  description = "List of route table IDs for Multi-AZ failover"
  type        = list(string)
  default     = []
}

#------------------------------------------------------------------------------
# Storage Configuration
#------------------------------------------------------------------------------

variable "storage_capacity_gb" {
  description = "Storage capacity in GB (64-524288)"
  type        = number
  default     = 64

  validation {
    condition     = var.storage_capacity_gb >= 64 && var.storage_capacity_gb <= 524288
    error_message = "Storage capacity must be between 64 GB and 524,288 GB."
  }
}

variable "storage_type" {
  description = "Storage type: SSD"
  type        = string
  default     = "SSD"

  validation {
    condition     = var.storage_type == "SSD"
    error_message = "Storage type must be SSD for OpenZFS."
  }
}

variable "throughput_capacity_mbs" {
  description = "Throughput capacity in MB/s"
  type        = number
  default     = 64

  validation {
    condition     = contains([64, 128, 256, 512, 1024, 2048, 3072, 4096], var.throughput_capacity_mbs)
    error_message = "Throughput capacity must be one of: 64, 128, 256, 512, 1024, 2048, 3072, 4096 MB/s."
  }
}

variable "deployment_type" {
  description = "Deployment type: SINGLE_AZ_1, SINGLE_AZ_2, MULTI_AZ_1"
  type        = string
  default     = "SINGLE_AZ_1"

  validation {
    condition     = contains(["SINGLE_AZ_1", "SINGLE_AZ_2", "MULTI_AZ_1"], var.deployment_type)
    error_message = "Deployment type must be SINGLE_AZ_1, SINGLE_AZ_2, or MULTI_AZ_1."
  }
}

variable "disk_iops_configuration" {
  description = "Disk IOPS configuration"
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
# Root Volume Configuration
#------------------------------------------------------------------------------

variable "root_volume_configuration" {
  description = "Root volume configuration"
  type = object({
    data_compression_type   = optional(string, "ZSTD")
    read_only               = optional(bool, false)
    record_size_kib         = optional(number, 128)
    copy_tags_to_snapshots  = optional(bool, true)

    nfs_exports = optional(object({
      client_configurations = list(object({
        clients = string
        options = list(string)
      }))
    }))

    user_and_group_quotas = optional(list(object({
      id                         = number
      storage_capacity_quota_gib = number
      type                       = string
    })), [])
  })
  default = null

  validation {
    condition = var.root_volume_configuration == null || contains(
      ["NONE", "ZSTD", "LZ4"],
      try(var.root_volume_configuration.data_compression_type, "ZSTD")
    )
    error_message = "Data compression type must be NONE, ZSTD, or LZ4."
  }

  validation {
    condition = var.root_volume_configuration == null || contains(
      [4, 8, 16, 32, 64, 128, 256, 512, 1024],
      try(var.root_volume_configuration.record_size_kib, 128)
    )
    error_message = "Record size must be one of: 4, 8, 16, 32, 64, 128, 256, 512, 1024 KiB."
  }
}

#------------------------------------------------------------------------------
# Volumes Configuration
#------------------------------------------------------------------------------

variable "volumes" {
  description = "List of OpenZFS volumes to create"
  type = list(object({
    name                             = string
    parent_volume_id                 = optional(string)
    data_compression_type            = optional(string, "ZSTD")
    read_only                        = optional(bool, false)
    record_size_kib                  = optional(number, 128)
    storage_capacity_quota_gib       = optional(number)
    storage_capacity_reservation_gib = optional(number)
    copy_tags_to_snapshots           = optional(bool, true)

    nfs_exports = optional(object({
      client_configurations = list(object({
        clients = string
        options = list(string)
      }))
    }))

    user_and_group_quotas = optional(list(object({
      id                         = number
      storage_capacity_quota_gib = number
      type                       = string
    })), [])

    origin_snapshot = optional(object({
      snapshot_arn  = string
      copy_strategy = string
    }))
  }))
  default = []
}

#------------------------------------------------------------------------------
# Snapshots Configuration
#------------------------------------------------------------------------------

variable "snapshots" {
  description = "List of snapshots to create"
  type = list(object({
    name        = string
    volume_name = optional(string)
  }))
  default = []
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

variable "copy_tags_to_volumes" {
  description = "Copy tags to volumes"
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
# Encryption Configuration
#------------------------------------------------------------------------------

variable "kms_key_id" {
  description = "KMS key ID for encryption at rest"
  type        = string
  default     = null
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

variable "iops_utilization_threshold" {
  description = "IOPS utilization threshold percentage for alarm"
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