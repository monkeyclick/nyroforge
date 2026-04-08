#------------------------------------------------------------------------------
# FSx for NetApp ONTAP Submodule - Variables
#------------------------------------------------------------------------------

variable "enabled" {
  description = "Whether to create FSx ONTAP resources"
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
  description = "Storage capacity in GB (1024-196608)"
  type        = number
  default     = 1024

  validation {
    condition     = var.storage_capacity_gb >= 1024 && var.storage_capacity_gb <= 196608
    error_message = "Storage capacity must be between 1,024 GB and 196,608 GB."
  }
}

variable "throughput_capacity_mbs" {
  description = "Throughput capacity in MB/s (deprecated, use throughput_capacity_per_ha_pair)"
  type        = number
  default     = 128

  validation {
    condition     = contains([128, 256, 512, 1024, 2048, 4096], var.throughput_capacity_mbs)
    error_message = "Throughput capacity must be one of: 128, 256, 512, 1024, 2048, 4096 MB/s."
  }
}

variable "throughput_capacity_per_ha_pair" {
  description = "Throughput capacity per HA pair in MB/s"
  type        = number
  default     = null

  validation {
    condition     = var.throughput_capacity_per_ha_pair == null || contains([128, 256, 512, 1024, 2048, 4096], var.throughput_capacity_per_ha_pair)
    error_message = "Throughput capacity per HA pair must be one of: 128, 256, 512, 1024, 2048, 4096 MB/s."
  }
}

variable "deployment_type" {
  description = "Deployment type: SINGLE_AZ_1, SINGLE_AZ_2, MULTI_AZ_1, MULTI_AZ_2"
  type        = string
  default     = "MULTI_AZ_1"

  validation {
    condition     = contains(["SINGLE_AZ_1", "SINGLE_AZ_2", "MULTI_AZ_1", "MULTI_AZ_2"], var.deployment_type)
    error_message = "Deployment type must be SINGLE_AZ_1, SINGLE_AZ_2, MULTI_AZ_1, or MULTI_AZ_2."
  }
}

variable "ha_pairs" {
  description = "Number of HA pairs (1-12)"
  type        = number
  default     = 1

  validation {
    condition     = var.ha_pairs >= 1 && var.ha_pairs <= 12
    error_message = "HA pairs must be between 1 and 12."
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
# ONTAP Configuration
#------------------------------------------------------------------------------

variable "fsx_admin_password" {
  description = "ONTAP administrative password (8-50 characters)"
  type        = string
  sensitive   = true
  default     = null

  validation {
    condition     = var.fsx_admin_password == null || (length(var.fsx_admin_password) >= 8 && length(var.fsx_admin_password) <= 50)
    error_message = "FSx admin password must be between 8 and 50 characters."
  }
}

#------------------------------------------------------------------------------
# Storage Virtual Machines Configuration
#------------------------------------------------------------------------------

variable "storage_virtual_machines" {
  description = "List of Storage Virtual Machines (SVMs) to create"
  type = list(object({
    name                       = string
    root_volume_security_style = optional(string, "UNIX")
    svm_admin_password         = optional(string)

    active_directory_configuration = optional(object({
      netbios_name = string
      self_managed_active_directory_configuration = optional(object({
        dns_ips                                = list(string)
        domain_name                            = string
        username                               = string
        password                               = string
        file_system_administrators_group       = optional(string, "Domain Admins")
        organizational_unit_distinguished_name = optional(string)
      }))
    }))

    volumes = optional(list(object({
      name                       = string
      junction_path              = string
      size_in_megabytes          = number
      storage_efficiency_enabled = optional(bool, true)
      security_style             = optional(string, "UNIX")
      ontap_volume_type          = optional(string, "RW")
      snapshot_policy            = optional(string, "default")
      copy_tags_to_backups       = optional(bool, true)
      skip_final_backup          = optional(bool, false)

      tiering_policy = optional(object({
        name           = string
        cooling_period = optional(number)
      }))

      snaplock_configuration = optional(object({
        snaplock_type = string
        autocommit_period = optional(object({
          type  = string
          value = number
        }))
        retention_period = optional(object({
          default_retention = optional(object({
            type  = string
            value = number
          }))
          maximum_retention = optional(object({
            type  = string
            value = number
          }))
          minimum_retention = optional(object({
            type  = string
            value = number
          }))
        }))
      }))
    })), [])
  }))
  default = []

  validation {
    condition     = alltrue([for svm in var.storage_virtual_machines : contains(["UNIX", "NTFS", "MIXED"], svm.root_volume_security_style)])
    error_message = "Root volume security style must be UNIX, NTFS, or MIXED."
  }
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

variable "ssd_utilization_threshold" {
  description = "SSD utilization threshold percentage for alarm"
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