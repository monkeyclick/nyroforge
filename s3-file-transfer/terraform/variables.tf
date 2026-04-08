#------------------------------------------------------------------------------
# S3 File Transfer Infrastructure - Input Variables
#------------------------------------------------------------------------------

#------------------------------------------------------------------------------
# General Configuration
#------------------------------------------------------------------------------

variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "s3-transfer"

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.project_name))
    error_message = "Project name must contain only lowercase letters, numbers, and hyphens."
  }
}

variable "environment" {
  description = "Environment name (e.g., dev, staging, prod)"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod", "test"], var.environment)
    error_message = "Environment must be one of: dev, staging, prod, test."
  }
}

variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1"
}

variable "default_tags" {
  description = "Default tags to apply to all resources"
  type        = map(string)
  default     = {}
}

#------------------------------------------------------------------------------
# S3 Bucket Configuration
#------------------------------------------------------------------------------

variable "enable_versioning" {
  description = "Enable versioning on the transfer bucket"
  type        = bool
  default     = true
}

variable "kms_key_arn" {
  description = "ARN of existing KMS key for encryption (null for AES256)"
  type        = string
  default     = null
}

variable "create_kms_key" {
  description = "Create a new KMS key for encryption"
  type        = bool
  default     = false
}

variable "enable_access_logging" {
  description = "Enable S3 access logging"
  type        = bool
  default     = true
}

variable "cors_allowed_origins" {
  description = "List of allowed origins for CORS"
  type        = list(string)
  default     = ["*"]
}

#------------------------------------------------------------------------------
# Lifecycle Configuration
#------------------------------------------------------------------------------

variable "enable_lifecycle_rules" {
  description = "Enable S3 lifecycle rules"
  type        = bool
  default     = true
}

variable "lifecycle_ia_transition_days" {
  description = "Days before transitioning to Infrequent Access"
  type        = number
  default     = 90

  validation {
    condition     = var.lifecycle_ia_transition_days >= 30
    error_message = "IA transition must be at least 30 days."
  }
}

variable "lifecycle_glacier_transition_days" {
  description = "Days before transitioning to Glacier (null to disable)"
  type        = number
  default     = null
}

variable "lifecycle_expiration_days" {
  description = "Days before object expiration (null to disable)"
  type        = number
  default     = null
}

variable "noncurrent_version_expiration_days" {
  description = "Days before noncurrent versions expire"
  type        = number
  default     = 90
}

#------------------------------------------------------------------------------
# IAM Configuration
#------------------------------------------------------------------------------

variable "create_iam_user" {
  description = "Create an IAM user for application access"
  type        = bool
  default     = false
}

#------------------------------------------------------------------------------
# CloudFront Configuration
#------------------------------------------------------------------------------

variable "enable_cloudfront" {
  description = "Enable CloudFront distribution"
  type        = bool
  default     = false
}

variable "cloudfront_price_class" {
  description = "CloudFront price class"
  type        = string
  default     = "PriceClass_100"

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.cloudfront_price_class)
    error_message = "Invalid CloudFront price class."
  }
}

variable "cloudfront_certificate_arn" {
  description = "ACM certificate ARN for CloudFront (null for default)"
  type        = string
  default     = null
}

variable "cloudfront_geo_restriction_locations" {
  description = "List of country codes for geo restriction whitelist"
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

variable "alarm_sns_topic_arn" {
  description = "SNS topic ARN for alarm notifications"
  type        = string
  default     = null
}

variable "bucket_size_alarm_threshold_gb" {
  description = "Bucket size threshold in GB for alarm"
  type        = number
  default     = 100
}

variable "error_rate_alarm_threshold" {
  description = "4xx error count threshold for alarm"
  type        = number
  default     = 100
}

#------------------------------------------------------------------------------
# Event Notifications
#------------------------------------------------------------------------------

variable "enable_event_notifications" {
  description = "Enable S3 event notifications"
  type        = bool
  default     = false
}

variable "notification_lambda_arn" {
  description = "Lambda function ARN for event notifications"
  type        = string
  default     = null
}

variable "notification_sns_topic_arn" {
  description = "SNS topic ARN for event notifications"
  type        = string
  default     = null
}

variable "notification_sqs_queue_arn" {
  description = "SQS queue ARN for event notifications"
  type        = string
  default     = null
}