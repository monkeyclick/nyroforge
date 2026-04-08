#------------------------------------------------------------------------------
# NetApp Cloud Volumes ONTAP Submodule - Variables
#------------------------------------------------------------------------------

variable "enabled" {
  description = "Whether to create NetApp CVO resources"
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
# CVO Configuration
#------------------------------------------------------------------------------

variable "cvo_name" {
  description = "Name for the Cloud Volumes ONTAP instance"
  type        = string
}

variable "deployment_mode" {
  description = "Deployment mode: single_node or ha"
  type        = string
  default     = "single_node"

  validation {
    condition     = contains(["single_node", "ha"], var.deployment_mode)
    error_message = "Deployment mode must be single_node or ha."
  }
}

variable "instance_type" {
  description = "EC2 instance type for CVO nodes"
  type        = string
  default     = "m5.2xlarge"
}

variable "license_type" {
  description = "License type for CVO"
  type        = string
  default     = "capacity-paygo"

  validation {
    condition = contains([
      "explore-paygo", "standard-paygo", "premium-paygo", "capacity-paygo",
      "explore-byol", "standard-byol", "premium-byol", "capacity-byol",
      "ha-explore-paygo", "ha-standard-paygo", "ha-premium-paygo", "ha-capacity-paygo",
      "ha-explore-byol", "ha-standard-byol", "ha-premium-byol", "ha-capacity-byol"
    ], var.license_type)
    error_message = "Invalid license type."
  }
}

variable "ontap_version" {
  description = "ONTAP version to deploy"
  type        = string
  default     = null
}

variable "use_latest_version" {
  description = "Use the latest ONTAP version"
  type        = bool
  default     = true
}

#------------------------------------------------------------------------------
# Network Configuration
#------------------------------------------------------------------------------

variable "vpc_id" {
  description = "VPC ID for CVO deployment"
  type        = string
}

variable "subnet_ids" {
  description = "List of subnet IDs for CVO"
  type        = list(string)
}

variable "client_subnet_id" {
  description = "Subnet ID for client access"
  type        = string
  default     = null
}

variable "iscsi_subnet_id" {
  description = "Subnet ID for iSCSI access"
  type        = string
  default     = null
}

variable "nas_subnet_ids" {
  description = "List of subnet IDs for NAS access"
  type        = list(string)
  default     = []
}

#------------------------------------------------------------------------------
# Security Configuration
#------------------------------------------------------------------------------

variable "create_security_group" {
  description = "Create security group for CVO"
  type        = bool
  default     = true
}

variable "security_group_ids" {
  description = "Existing security group IDs (if not creating)"
  type        = list(string)
  default     = []
}

variable "allowed_cidr_blocks" {
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
  description = "CIDR blocks for SnapMirror replication"
  type        = list(string)
  default     = []
}

#------------------------------------------------------------------------------
# IAM Configuration
#------------------------------------------------------------------------------

variable "create_iam_role" {
  description = "Create IAM role for CVO"
  type        = bool
  default     = true
}

variable "iam_role_arn" {
  description = "Existing IAM role ARN (if not creating)"
  type        = string
  default     = null
}

#------------------------------------------------------------------------------
# Storage Configuration
#------------------------------------------------------------------------------

variable "ebs_volume_type" {
  description = "EBS volume type: gp3, gp2, io1, io2, st1, sc1"
  type        = string
  default     = "gp3"

  validation {
    condition     = contains(["gp3", "gp2", "io1", "io2", "st1", "sc1"], var.ebs_volume_type)
    error_message = "EBS volume type must be gp3, gp2, io1, io2, st1, or sc1."
  }
}

variable "ebs_volume_size_gb" {
  description = "EBS volume size in GB"
  type        = number
  default     = 500
}

variable "disk_count" {
  description = "Number of disks per aggregate"
  type        = number
  default     = 1
}

variable "aggregate_name" {
  description = "Name of the ONTAP aggregate"
  type        = string
  default     = "aggr1"
}

#------------------------------------------------------------------------------
# Data Tiering Configuration
#------------------------------------------------------------------------------

variable "capacity_tier" {
  description = "Capacity tier for cold data: S3, none"
  type        = string
  default     = "S3"

  validation {
    condition     = contains(["S3", "none"], var.capacity_tier)
    error_message = "Capacity tier must be S3 or none."
  }
}

variable "capacity_tier_level" {
  description = "Capacity tier level: normal, backup"
  type        = string
  default     = "normal"
}

variable "create_tiering_bucket" {
  description = "Create S3 bucket for data tiering"
  type        = bool
  default     = true
}

variable "data_tiering_s3_bucket" {
  description = "S3 bucket name for data tiering"
  type        = string
  default     = ""
}

variable "enable_tiering_lifecycle" {
  description = "Enable lifecycle rules on tiering bucket"
  type        = bool
  default     = true
}

variable "tiering_days_to_glacier" {
  description = "Days before transitioning to Glacier"
  type        = number
  default     = 90
}

variable "tiering_noncurrent_expiration_days" {
  description = "Days before expiring noncurrent versions"
  type        = number
  default     = 365
}

#------------------------------------------------------------------------------
# HA Configuration
#------------------------------------------------------------------------------

variable "ha_node1_availability_zone" {
  description = "Availability zone for HA node 1"
  type        = string
  default     = null
}

variable "ha_node2_availability_zone" {
  description = "Availability zone for HA node 2"
  type        = string
  default     = null
}

variable "mediator_subnet_id" {
  description = "Subnet ID for HA mediator"
  type        = string
  default     = null
}

#------------------------------------------------------------------------------
# SVM Configuration
#------------------------------------------------------------------------------

variable "svms" {
  description = "List of Storage Virtual Machines to configure"
  type = list(object({
    name                       = string
    root_volume_security_style = optional(string, "unix")

    volumes = optional(list(object({
      name               = string
      size_gb            = number
      junction_path      = string
      security_style     = optional(string, "unix")
      snapshot_policy    = optional(string, "default")
      tiering_policy     = optional(string, "snapshot-only")
      export_policy_name = optional(string)
    })), [])
  }))
  default = []
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
# BlueXP Connector Configuration
#------------------------------------------------------------------------------

variable "connector_id" {
  description = "BlueXP Connector ID"
  type        = string
  default     = null
}

variable "workspace_id" {
  description = "BlueXP Workspace ID"
  type        = string
  default     = null
}

#------------------------------------------------------------------------------
# DNS Configuration
#------------------------------------------------------------------------------

variable "create_dns_records" {
  description = "Create Route53 DNS records"
  type        = bool
  default     = false
}

variable "route53_zone_id" {
  description = "Route53 hosted zone ID"
  type        = string
  default     = null
}

variable "dns_domain" {
  description = "DNS domain for records"
  type        = string
  default     = null
}

variable "management_ip_addresses" {
  description = "IP addresses for management DNS record"
  type        = list(string)
  default     = []
}

variable "data_ip_addresses" {
  description = "IP addresses for data DNS record"
  type        = list(string)
  default     = []
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
  description = "Storage utilization threshold for alarm (%)"
  type        = number
  default     = 80
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