#------------------------------------------------------------------------------
# Pure Storage Cloud Block Store Submodule - Variables
#------------------------------------------------------------------------------

variable "enabled" {
  description = "Whether to create Pure Storage CBS resources"
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
# CBS Configuration
#------------------------------------------------------------------------------

variable "array_name" {
  description = "Name for the CBS array"
  type        = string
}

variable "deployment_type" {
  description = "Deployment type: standard or premium"
  type        = string
  default     = "standard"

  validation {
    condition     = contains(["standard", "premium"], var.deployment_type)
    error_message = "Deployment type must be standard or premium."
  }
}

variable "capacity_tb" {
  description = "Capacity in TB (50-4000)"
  type        = number
  default     = 50

  validation {
    condition     = var.capacity_tb >= 50 && var.capacity_tb <= 4000
    error_message = "Capacity must be between 50 TB and 4000 TB."
  }
}

variable "performance_class" {
  description = "Performance class: standard or premium"
  type        = string
  default     = "standard"

  validation {
    condition     = contains(["standard", "premium"], var.performance_class)
    error_message = "Performance class must be standard or premium."
  }
}

variable "availability_zone" {
  description = "Availability zone for CBS deployment"
  type        = string
  default     = null
}

#------------------------------------------------------------------------------
# Network Configuration
#------------------------------------------------------------------------------

variable "vpc_id" {
  description = "VPC ID for CBS deployment"
  type        = string
}

variable "management_subnet_id" {
  description = "Subnet ID for management network"
  type        = string
}

variable "iscsi_subnet_id" {
  description = "Subnet ID for iSCSI network"
  type        = string
}

variable "replication_subnet_id" {
  description = "Subnet ID for replication network"
  type        = string
  default     = null
}

#------------------------------------------------------------------------------
# Security Configuration
#------------------------------------------------------------------------------

variable "create_security_groups" {
  description = "Create security groups for CBS"
  type        = bool
  default     = true
}

variable "management_security_group_ids" {
  description = "Existing security group IDs for management (if not creating)"
  type        = list(string)
  default     = []
}

variable "iscsi_security_group_ids" {
  description = "Existing security group IDs for iSCSI (if not creating)"
  type        = list(string)
  default     = []
}

variable "replication_security_group_ids" {
  description = "Existing security group IDs for replication (if not creating)"
  type        = list(string)
  default     = []
}

variable "management_cidr_blocks" {
  description = "CIDR blocks allowed for management access"
  type        = list(string)
  default     = []
}

variable "client_cidr_blocks" {
  description = "CIDR blocks allowed for client data access"
  type        = list(string)
  default     = []
}

variable "replication_cidr_blocks" {
  description = "CIDR blocks for replication traffic"
  type        = list(string)
  default     = []
}

#------------------------------------------------------------------------------
# IAM Configuration
#------------------------------------------------------------------------------

variable "create_iam_role" {
  description = "Create IAM role for CBS"
  type        = bool
  default     = true
}

variable "iam_role_arn" {
  description = "Existing IAM role ARN (if not creating)"
  type        = string
  default     = null
}

#------------------------------------------------------------------------------
# Protocol Configuration
#------------------------------------------------------------------------------

variable "iscsi_enabled" {
  description = "Enable iSCSI protocol"
  type        = bool
  default     = true
}

variable "nvme_enabled" {
  description = "Enable NVMe-oF protocol"
  type        = bool
  default     = false
}

#------------------------------------------------------------------------------
# Pure1 Integration
#------------------------------------------------------------------------------

variable "pure1_api_token" {
  description = "Pure1 API token for cloud connector"
  type        = string
  sensitive   = true
  default     = null
}

#------------------------------------------------------------------------------
# Host Groups Configuration
#------------------------------------------------------------------------------

variable "host_groups" {
  description = "List of host groups to create"
  type = list(object({
    name = string
    hosts = list(object({
      name = string
      iqn  = optional(string)
      nqn  = optional(string)
    }))
  }))
  default = []
}

#------------------------------------------------------------------------------
# Volumes Configuration
#------------------------------------------------------------------------------

variable "volumes" {
  description = "List of volumes to create"
  type = list(object({
    name             = string
    size_gb          = number
    host_group       = optional(string)
    protection_group = optional(string)
  }))
  default = []

  validation {
    condition     = alltrue([for v in var.volumes : v.size_gb >= 1 && v.size_gb <= 4194304])
    error_message = "Volume size must be between 1 GB and 4 PB (4194304 GB)."
  }
}

#------------------------------------------------------------------------------
# Protection Groups Configuration
#------------------------------------------------------------------------------

variable "protection_groups" {
  description = "List of protection groups for snapshots/replication"
  type = list(object({
    name           = string
    source_volumes = list(string)
    replication_schedule = optional(object({
      frequency_seconds   = number
      blackout_start_time = optional(string)
      blackout_end_time   = optional(string)
    }))
    snapshot_schedule = optional(object({
      frequency_seconds = number
      retain_count      = number
    }))
  }))
  default = []
}

#------------------------------------------------------------------------------
# Replication Configuration
#------------------------------------------------------------------------------

variable "enable_replication" {
  description = "Enable replication to another CBS or FlashArray"
  type        = bool
  default     = false
}

variable "replication_target" {
  description = "Replication target configuration"
  type = object({
    management_address = string
    iscsi_addresses    = list(string)
  })
  default = null
}

#------------------------------------------------------------------------------
# Encryption Configuration
#------------------------------------------------------------------------------

variable "kms_key_arn" {
  description = "KMS key ARN for encryption"
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

variable "capacity_utilization_threshold" {
  description = "Capacity utilization threshold for alarm (%)"
  type        = number
  default     = 80
}

variable "latency_threshold_ms" {
  description = "Latency threshold for alarm (ms)"
  type        = number
  default     = 1
}

variable "iops_threshold" {
  description = "IOPS threshold for alarm"
  type        = number
  default     = 100000
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 30
}

variable "alarm_actions" {
  description = "List of ARNs for alarm actions"
  type        = list(string)
  default     = []
}

variable "ok_actions" {
  description = "List of ARNs for OK actions"
  type        = list(string)
  default     = []
}