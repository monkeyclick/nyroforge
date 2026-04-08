#------------------------------------------------------------------------------
# FSx for Lustre Submodule - Variables
#------------------------------------------------------------------------------

variable "enabled" {
  description = "Whether to create FSx Lustre resources"
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

variable "subnet_id" {
  description = "Subnet ID for the file system (Lustre uses single subnet)"
  type        = string
}

variable "security_group_ids" {
  description = "List of security group IDs"
  type        = list(string)
}

#------------------------------------------------------------------------------
# Storage Configuration
#------------------------------------------------------------------------------

variable "storage_capacity_gb" {
  description = "Storage capacity in GB"
  type        = number
  default     = 1200

  validation {
    condition     = var.storage_capacity_gb >= 1200
    error_message = "Storage capacity must be at least 1200 GB for FSx Lustre."
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

variable "deployment_type" {
  description = "Deployment type: SCRATCH_1, SCRATCH_2, PERSISTENT_1, PERSISTENT_2"
  type        = string
  default     = "PERSISTENT_2"

  validation {
    condition     = contains(["SCRATCH_1", "SCRATCH_2", "PERSISTENT_1", "PERSISTENT_2"], var.deployment_type)
    error_message = "Deployment type must be SCRATCH_1, SCRATCH_2, PERSISTENT_1, or PERSISTENT_2."
  }
}

variable "per_unit_storage_throughput" {
  description = "Throughput per unit of storage (MB/s/TiB) for persistent deployments"
  type        = number
  default     = null

  validation {
    condition     = var.per_unit_storage_throughput == null || contains([12, 40, 50, 100, 125, 200, 250, 500, 1000], var.per_unit_storage_throughput)
    error_message = "Per unit storage throughput must be a valid value for the deployment type."
  }
}

variable "drive_cache_type" {
  description = "Drive cache type for HDD storage: NONE or READ"
  type        = string
  default     = "NONE"

  validation {
    condition     = contains(["NONE", "READ"], var.drive_cache_type)
    error_message = "Drive cache type must be NONE or READ."
  }
}

variable "file_system_type_version" {
  description = "Lustre file system version: 2.10, 2.12, or 2.15"
  type        = string
  default     = null

  validation {
    condition     = var.file_system_type_version == null || contains(["2.10", "2.12", "2.15"], var.file_system_type_version)
    error_message = "File system type version must be 2.10, 2.12, or 2.15."
  }
}

#------------------------------------------------------------------------------
# Data Compression
#------------------------------------------------------------------------------

variable "data_compression_type" {
  description = "Data compression type: NONE or LZ4"
  type        = string
  default     = "LZ4"

  validation {
    condition     = contains(["NONE", "LZ4"], var.data_compression_type)
    error_message = "Data compression type must be NONE or LZ4."
  }
}

#------------------------------------------------------------------------------
# S3 Data Repository Configuration (Legacy)
#------------------------------------------------------------------------------

variable "import_path" {
  description = "S3 URI for importing data (legacy, for SCRATCH deployments)"
  type        = string
  default     = null
}

variable "export_path" {
  description = "S3 URI for exporting data (legacy, for SCRATCH deployments)"
  type        = string
  default     = null
}

variable "imported_file_chunk_size" {
  description = "Chunk size for imported files in MiB"
  type        = number
  default     = 1024

  validation {
    condition     = var.imported_file_chunk_size >= 1 && var.imported_file_chunk_size <= 512000
    error_message = "Imported file chunk size must be between 1 and 512000 MiB."
  }
}

variable "auto_import_policy" {
  description = "Auto import policy: NONE, NEW, NEW_CHANGED, or NEW_CHANGED_DELETED"
  type        = string
  default     = "NEW_CHANGED"

  validation {
    condition     = contains(["NONE", "NEW", "NEW_CHANGED", "NEW_CHANGED_DELETED"], var.auto_import_policy)
    error_message = "Auto import policy must be NONE, NEW, NEW_CHANGED, or NEW_CHANGED_DELETED."
  }
}

#------------------------------------------------------------------------------
# Data Repository Associations (for PERSISTENT deployments)
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

variable "s3_bucket_name" {
  description = "S3 bucket name for data repository (used to create bucket policy)"
  type        = string
  default     = null
}

variable "create_s3_bucket_policy" {
  description = "Create S3 bucket policy for FSx access"
  type        = bool
  default     = false
}

#------------------------------------------------------------------------------
# Backup Configuration
#------------------------------------------------------------------------------

variable "automatic_backup_retention_days" {
  description = "Number of days to retain automatic backups (0-90)"
  type        = number
  default     = 0

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
# Logging Configuration
#------------------------------------------------------------------------------

variable "log_configuration" {
  description = "Logging configuration"
  type = object({
    destination = string
    level       = string
  })
  default = null

  validation {
    condition     = var.log_configuration == null || contains(["WARN_ONLY", "ERROR_ONLY", "WARN_ERROR"], var.log_configuration.level)
    error_message = "Log level must be WARN_ONLY, ERROR_ONLY, or WARN_ERROR."
  }
}

variable "create_log_group" {
  description = "Create CloudWatch log group for Lustre logs"
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 30
}

#------------------------------------------------------------------------------
# Root Squash Configuration
#------------------------------------------------------------------------------

variable "root_squash_configuration" {
  description = "Root squash configuration"
  type = object({
    root_squash    = string
    no_squash_nids = optional(list(string), [])
  })
  default = null
}

#------------------------------------------------------------------------------
# Metadata Configuration (PERSISTENT_2 only)
#------------------------------------------------------------------------------

variable "metadata_configuration" {
  description = "Metadata configuration for PERSISTENT_2 deployments"
  type = object({
    iops = optional(number)
    mode = string
  })
  default = null

  validation {
    condition     = var.metadata_configuration == null || contains(["AUTOMATIC", "USER_PROVISIONED"], var.metadata_configuration.mode)
    error_message = "Metadata configuration mode must be AUTOMATIC or USER_PROVISIONED."
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

variable "metadata_operations_threshold" {
  description = "Metadata operations threshold for alarm"
  type        = number
  default     = 10000
}

variable "data_throughput_threshold_bytes" {
  description = "Data throughput threshold in bytes for alarm"
  type        = number
  default     = 1073741824  # 1 GB
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