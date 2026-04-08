#------------------------------------------------------------------------------
# Portworx Enterprise Storage Submodule - Variables
#------------------------------------------------------------------------------

variable "enabled" {
  description = "Whether to create Portworx resources"
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
# Cluster Configuration
#------------------------------------------------------------------------------

variable "cluster_name" {
  description = "Name for the Portworx cluster"
  type        = string
}

variable "namespace" {
  description = "Kubernetes namespace for Portworx"
  type        = string
  default     = "portworx"
}

variable "create_namespace" {
  description = "Create the Kubernetes namespace"
  type        = bool
  default     = true
}

variable "portworx_version" {
  description = "Portworx version to deploy"
  type        = string
  default     = "3.0"
}

#------------------------------------------------------------------------------
# License Configuration
#------------------------------------------------------------------------------

variable "license_type" {
  description = "License type: px-essentials, px-enterprise, px-enterprise-dr"
  type        = string
  default     = "px-enterprise"

  validation {
    condition     = contains(["px-essentials", "px-enterprise", "px-enterprise-dr"], var.license_type)
    error_message = "License type must be px-essentials, px-enterprise, or px-enterprise-dr."
  }
}

variable "license_key" {
  description = "Portworx license key"
  type        = string
  sensitive   = true
  default     = null
}

#------------------------------------------------------------------------------
# Storage Configuration
#------------------------------------------------------------------------------

variable "storage_type" {
  description = "Storage type: cloud or local"
  type        = string
  default     = "cloud"

  validation {
    condition     = contains(["cloud", "local"], var.storage_type)
    error_message = "Storage type must be cloud or local."
  }
}

variable "cloud_storage_type" {
  description = "Cloud storage type for AWS: gp3, gp2, io1, io2"
  type        = string
  default     = "gp3"

  validation {
    condition     = var.cloud_storage_type == null || contains(["gp3", "gp2", "io1", "io2"], var.cloud_storage_type)
    error_message = "Cloud storage type must be gp3, gp2, io1, or io2."
  }
}

variable "storage_device_size_gb" {
  description = "Storage device size in GB per node"
  type        = number
  default     = 150

  validation {
    condition     = var.storage_device_size_gb >= 50 && var.storage_device_size_gb <= 16000
    error_message = "Storage device size must be between 50 GB and 16,000 GB."
  }
}

variable "max_storage_nodes" {
  description = "Maximum number of storage nodes"
  type        = number
  default     = 3
}

variable "max_storage_nodes_per_zone" {
  description = "Maximum storage nodes per availability zone"
  type        = number
  default     = 1
}

variable "storage_drives" {
  description = "Storage drives specification"
  type        = string
  default     = "type=gp3,size=150"
}

variable "use_all_devices" {
  description = "Use all available devices"
  type        = bool
  default     = false
}

variable "journal_device" {
  description = "Journal device specification"
  type        = string
  default     = null
}

#------------------------------------------------------------------------------
# Network Configuration
#------------------------------------------------------------------------------

variable "data_interface" {
  description = "Data network interface"
  type        = string
  default     = null
}

variable "management_interface" {
  description = "Management network interface"
  type        = string
  default     = null
}

#------------------------------------------------------------------------------
# Feature Toggles
#------------------------------------------------------------------------------

variable "enable_stork" {
  description = "Enable Stork storage orchestration"
  type        = bool
  default     = true
}

variable "enable_lighthouse" {
  description = "Enable Lighthouse UI"
  type        = bool
  default     = true
}

variable "enable_autopilot" {
  description = "Enable Autopilot for capacity management"
  type        = bool
  default     = false
}

variable "enable_csi" {
  description = "Enable CSI driver"
  type        = bool
  default     = true
}

variable "enable_security" {
  description = "Enable Portworx security"
  type        = bool
  default     = true
}

variable "enable_prometheus" {
  description = "Enable Prometheus metrics"
  type        = bool
  default     = true
}

variable "enable_grafana" {
  description = "Enable Grafana dashboards"
  type        = bool
  default     = true
}

#------------------------------------------------------------------------------
# IAM Configuration
#------------------------------------------------------------------------------

variable "create_iam_role" {
  description = "Create IAM role for Portworx"
  type        = bool
  default     = true
}

variable "iam_role_arn" {
  description = "Existing IAM role ARN (if not creating)"
  type        = string
  default     = null
}

variable "oidc_provider_url" {
  description = "EKS OIDC provider URL"
  type        = string
  default     = null
}

variable "oidc_provider_arn" {
  description = "EKS OIDC provider ARN"
  type        = string
  default     = null
}

#------------------------------------------------------------------------------
# Storage Classes Configuration
#------------------------------------------------------------------------------

variable "storage_classes" {
  description = "List of storage classes to create"
  type = list(object({
    name                   = string
    replication_factor     = optional(number, 3)
    io_profile             = optional(string, "auto")
    priority               = optional(string, "high")
    secure                 = optional(bool, true)
    journal                = optional(bool, false)
    sharedv4               = optional(bool, false)
    fs_type                = optional(string, "ext4")
    allow_volume_expansion = optional(bool, true)
  }))
  default = []
}

variable "default_storage_class" {
  description = "Name of the default storage class"
  type        = string
  default     = "px-replicated"
}

#------------------------------------------------------------------------------
# Backup Configuration
#------------------------------------------------------------------------------

variable "enable_backup" {
  description = "Enable Portworx backup"
  type        = bool
  default     = true
}

variable "create_backup_bucket" {
  description = "Create S3 bucket for backup"
  type        = bool
  default     = true
}

variable "backup_s3_bucket" {
  description = "S3 bucket name for backup"
  type        = string
  default     = null
}

variable "backup_s3_region" {
  description = "S3 bucket region for backup"
  type        = string
  default     = null
}

variable "backup_retention_days" {
  description = "Backup retention in days"
  type        = number
  default     = 365
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

variable "enable_cloudwatch_dashboard" {
  description = "Enable CloudWatch dashboard"
  type        = bool
  default     = true
}