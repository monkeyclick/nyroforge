#------------------------------------------------------------------------------
# S3 File Transfer Infrastructure - Outputs
#------------------------------------------------------------------------------

#------------------------------------------------------------------------------
# S3 Bucket Outputs
#------------------------------------------------------------------------------

output "transfer_bucket_id" {
  description = "ID of the transfer S3 bucket"
  value       = aws_s3_bucket.transfer.id
}

output "transfer_bucket_arn" {
  description = "ARN of the transfer S3 bucket"
  value       = aws_s3_bucket.transfer.arn
}

output "transfer_bucket_domain_name" {
  description = "Domain name of the transfer S3 bucket"
  value       = aws_s3_bucket.transfer.bucket_domain_name
}

output "transfer_bucket_regional_domain_name" {
  description = "Regional domain name of the transfer S3 bucket"
  value       = aws_s3_bucket.transfer.bucket_regional_domain_name
}

output "logs_bucket_id" {
  description = "ID of the logs S3 bucket"
  value       = var.enable_access_logging ? aws_s3_bucket.logs[0].id : null
}

output "logs_bucket_arn" {
  description = "ARN of the logs S3 bucket"
  value       = var.enable_access_logging ? aws_s3_bucket.logs[0].arn : null
}

#------------------------------------------------------------------------------
# KMS Outputs
#------------------------------------------------------------------------------

output "kms_key_id" {
  description = "ID of the KMS key"
  value       = var.create_kms_key ? aws_kms_key.transfer[0].key_id : null
}

output "kms_key_arn" {
  description = "ARN of the KMS key"
  value       = var.create_kms_key ? aws_kms_key.transfer[0].arn : var.kms_key_arn
}

output "kms_alias_arn" {
  description = "ARN of the KMS alias"
  value       = var.create_kms_key ? aws_kms_alias.transfer[0].arn : null
}

#------------------------------------------------------------------------------
# IAM Outputs
#------------------------------------------------------------------------------

output "full_access_policy_arn" {
  description = "ARN of the full access IAM policy"
  value       = aws_iam_policy.transfer_full_access.arn
}

output "read_only_policy_arn" {
  description = "ARN of the read-only IAM policy"
  value       = aws_iam_policy.transfer_read_only.arn
}

output "upload_only_policy_arn" {
  description = "ARN of the upload-only IAM policy"
  value       = aws_iam_policy.transfer_upload_only.arn
}

output "iam_user_name" {
  description = "Name of the IAM user"
  value       = var.create_iam_user ? aws_iam_user.transfer[0].name : null
}

output "iam_user_arn" {
  description = "ARN of the IAM user"
  value       = var.create_iam_user ? aws_iam_user.transfer[0].arn : null
}

output "iam_access_key_id" {
  description = "Access key ID for the IAM user"
  value       = var.create_iam_user ? aws_iam_access_key.transfer[0].id : null
  sensitive   = true
}

output "iam_secret_access_key" {
  description = "Secret access key for the IAM user"
  value       = var.create_iam_user ? aws_iam_access_key.transfer[0].secret : null
  sensitive   = true
}

#------------------------------------------------------------------------------
# CloudFront Outputs
#------------------------------------------------------------------------------

output "cloudfront_distribution_id" {
  description = "ID of the CloudFront distribution"
  value       = var.enable_cloudfront ? aws_cloudfront_distribution.transfer[0].id : null
}

output "cloudfront_distribution_arn" {
  description = "ARN of the CloudFront distribution"
  value       = var.enable_cloudfront ? aws_cloudfront_distribution.transfer[0].arn : null
}

output "cloudfront_domain_name" {
  description = "Domain name of the CloudFront distribution"
  value       = var.enable_cloudfront ? aws_cloudfront_distribution.transfer[0].domain_name : null
}

output "cloudfront_hosted_zone_id" {
  description = "Hosted zone ID of the CloudFront distribution"
  value       = var.enable_cloudfront ? aws_cloudfront_distribution.transfer[0].hosted_zone_id : null
}

#------------------------------------------------------------------------------
# Configuration Outputs
#------------------------------------------------------------------------------

output "aws_region" {
  description = "AWS region where resources are deployed"
  value       = var.aws_region
}

output "environment" {
  description = "Deployment environment"
  value       = var.environment
}

output "cors_configuration" {
  description = "CORS allowed origins"
  value       = var.cors_allowed_origins
}

#------------------------------------------------------------------------------
# Application Configuration Output
#------------------------------------------------------------------------------

output "app_config" {
  description = "Configuration object for the application"
  value = {
    region       = var.aws_region
    bucket       = aws_s3_bucket.transfer.id
    bucket_arn   = aws_s3_bucket.transfer.arn
    kms_key_arn  = var.create_kms_key ? aws_kms_key.transfer[0].arn : var.kms_key_arn
    cdn_enabled  = var.enable_cloudfront
    cdn_domain   = var.enable_cloudfront ? aws_cloudfront_distribution.transfer[0].domain_name : null
  }
}