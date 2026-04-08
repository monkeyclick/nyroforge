#------------------------------------------------------------------------------
# Shared Module - Variables
#------------------------------------------------------------------------------

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

variable "vpc_id" {
  description = "VPC ID for security groups"
  type        = string
}

#------------------------------------------------------------------------------
# KMS Configuration
#------------------------------------------------------------------------------

variable "create_kms_key" {
  description = "Create KMS key for storage encryption"
  type        = bool
  default     = true
}

variable "kms_key_arn" {
  description = "Existing KMS key ARN (if not creating)"
  type        = string
  default     = null
}

variable "kms_key_deletion_window" {
  description = "KMS key deletion window in days"
  type        = number
  default     = 30
}

variable "kms_key_rotation_enabled" {
  description = "Enable automatic KMS key rotation"
  type        = bool
  default     = true
}

variable "kms_multi_region" {
  description = "Create multi-region KMS key"
  type        = bool
  default     = false
}

variable "replica_region" {
  description = "Region for KMS key replica"
  type        = string
  default     = null
}

variable "kms_key_administrators" {
  description = "List of IAM ARNs that can administer the KMS key"
  type        = list(string)
  default     = []
}

variable "kms_key_users" {
  description = "List of IAM ARNs that can use the KMS key"
  type        = list(string)
  default     = []
}

variable "enable_backup_grants" {
  description = "Enable KMS grants for AWS Backup"
  type        = bool
  default     = true
}

#------------------------------------------------------------------------------
# Security Group Configuration
#------------------------------------------------------------------------------

variable "create_fsx_windows_sg" {
  description = "Create FSx Windows security group"
  type        = bool
  default     = false
}

variable "create_fsx_lustre_sg" {
  description = "Create FSx Lustre security group"
  type        = bool
  default     = false
}

variable "create_fsx_ontap_sg" {
  description = "Create FSx ONTAP security group"
  type        = bool
  default     = false
}

variable "create_fsx_openzfs_sg" {
  description = "Create FSx OpenZFS security group"
  type        = bool
  default     = false
}

variable "create_efs_sg" {
  description = "Create EFS security group"
  type        = bool
  default     = false
}

variable "create_storage_client_sg" {
  description = "Create storage client security group"
  type        = bool
  default     = true
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed for storage access"
  type        = list(string)
  default     = []
}

variable "allowed_security_group_ids" {
  description = "Security group IDs allowed for storage access"
  type        = list(string)
  default     = []
}

variable "management_cidr_blocks" {
  description = "CIDR blocks allowed for management access"
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

variable "create_storage_admin_role" {
  description = "Create storage admin IAM role"
  type        = bool
  default     = true
}

variable "create_storage_readonly_role" {
  description = "Create storage read-only IAM role"
  type        = bool
  default     = true
}

variable "create_backup_role" {
  description = "Create backup IAM role"
  type        = bool
  default     = true
}

variable "create_ec2_client_role" {
  description = "Create EC2 storage client IAM role"
  type        = bool
  default     = true
}

variable "trusted_account_ids" {
  description = "List of AWS account IDs that can assume storage roles"
  type        = list(string)
  default     = []
}

variable "require_mfa" {
  description = "Require MFA for assuming admin role"
  type        = bool
  default     = true
}

variable "s3_bucket_arns" {
  description = "List of S3 bucket ARNs for IAM policies"
  type        = list(string)
  default     = null
}

#------------------------------------------------------------------------------
# CloudWatch Configuration
#------------------------------------------------------------------------------

variable "create_dashboard" {
  description = "Create CloudWatch dashboard"
  type        = bool
  default     = true
}

variable "dashboard_name" {
  description = "CloudWatch dashboard name"
  type        = string
  default     = null
}

variable "include_fsx_metrics" {
  description = "Include FSx metrics in dashboard"
  type        = bool
  default     = true
}

variable "include_efs_metrics" {
  description = "Include EFS metrics in dashboard"
  type        = bool
  default     = true
}

variable "create_log_group" {
  description = "Create CloudWatch log group"
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 30
}

variable "create_sns_topic" {
  description = "Create SNS topic for alerts"
  type        = bool
  default     = true
}

variable "alert_email_addresses" {
  description = "Email addresses for alert notifications"
  type        = list(string)
  default     = []
}

variable "alarm_arns" {
  description = "List of alarm ARNs for composite alarm"
  type        = list(string)
  default     = []
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

variable "create_composite_alarm" {
  description = "Create composite alarm for storage health"
  type        = bool
  default     = false
}

variable "create_capacity_alarm" {
  description = "Create capacity utilization alarms"
  type        = bool
  default     = true
}

variable "capacity_warning_threshold" {
  description = "Capacity warning threshold (%)"
  type        = number
  default     = 80
}

variable "capacity_critical_threshold" {
  description = "Capacity critical threshold (%)"
  type        = number
  default     = 95
}

variable "create_event_rules" {
  description = "Create EventBridge rules for storage events"
  type        = bool
  default     = true
}