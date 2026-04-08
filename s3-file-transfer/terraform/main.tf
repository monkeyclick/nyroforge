#------------------------------------------------------------------------------
# S3 File Transfer Infrastructure - Main Configuration
#------------------------------------------------------------------------------
# This Terraform configuration deploys the infrastructure needed for the
# S3 File Transfer application, including S3 buckets, IAM policies, CloudFront,
# and optionally Lambda functions for server-side processing.
#------------------------------------------------------------------------------

terraform {
  required_version = ">= 1.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.0.0"
    }
  }
}

#------------------------------------------------------------------------------
# Provider Configuration
#------------------------------------------------------------------------------

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = var.default_tags
  }
}

#------------------------------------------------------------------------------
# Local Variables
#------------------------------------------------------------------------------

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  
  common_tags = merge(var.default_tags, {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Application = "s3-file-transfer"
  })
}

#------------------------------------------------------------------------------
# Random Suffix for Unique Naming
#------------------------------------------------------------------------------

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

#------------------------------------------------------------------------------
# S3 Buckets
#------------------------------------------------------------------------------

# Main transfer bucket
resource "aws_s3_bucket" "transfer" {
  bucket = "${local.name_prefix}-transfer-${random_id.bucket_suffix.hex}"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-transfer"
    Type = "transfer"
  })
}

# Bucket versioning
resource "aws_s3_bucket_versioning" "transfer" {
  bucket = aws_s3_bucket.transfer.id

  versioning_configuration {
    status = var.enable_versioning ? "Enabled" : "Disabled"
  }
}

# Bucket encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "transfer" {
  bucket = aws_s3_bucket.transfer.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = var.kms_key_arn != null ? "aws:kms" : "AES256"
      kms_master_key_id = var.kms_key_arn
    }
    bucket_key_enabled = var.kms_key_arn != null
  }
}

# Block public access
resource "aws_s3_bucket_public_access_block" "transfer" {
  bucket = aws_s3_bucket.transfer.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle rules
resource "aws_s3_bucket_lifecycle_configuration" "transfer" {
  count  = var.enable_lifecycle_rules ? 1 : 0
  bucket = aws_s3_bucket.transfer.id

  rule {
    id     = "transition-to-ia"
    status = "Enabled"

    filter {
      prefix = ""
    }

    transition {
      days          = var.lifecycle_ia_transition_days
      storage_class = "STANDARD_IA"
    }

    dynamic "transition" {
      for_each = var.lifecycle_glacier_transition_days != null ? [1] : []
      content {
        days          = var.lifecycle_glacier_transition_days
        storage_class = "GLACIER"
      }
    }

    dynamic "expiration" {
      for_each = var.lifecycle_expiration_days != null ? [1] : []
      content {
        days = var.lifecycle_expiration_days
      }
    }

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_expiration_days
    }
  }

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {
      prefix = ""
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# CORS configuration for browser uploads
resource "aws_s3_bucket_cors_configuration" "transfer" {
  bucket = aws_s3_bucket.transfer.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST", "DELETE", "HEAD"]
    allowed_origins = var.cors_allowed_origins
    expose_headers  = [
      "ETag",
      "x-amz-meta-*",
      "x-amz-server-side-encryption",
      "x-amz-request-id",
      "x-amz-id-2",
      "Content-Length",
      "Content-Type"
    ]
    max_age_seconds = 3600
  }
}

# Logging bucket
resource "aws_s3_bucket" "logs" {
  count  = var.enable_access_logging ? 1 : 0
  bucket = "${local.name_prefix}-logs-${random_id.bucket_suffix.hex}"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-logs"
    Type = "logs"
  })
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  count  = var.enable_access_logging ? 1 : 0
  bucket = aws_s3_bucket.logs[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "logs" {
  count  = var.enable_access_logging ? 1 : 0
  bucket = aws_s3_bucket.logs[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_logging" "transfer" {
  count  = var.enable_access_logging ? 1 : 0
  bucket = aws_s3_bucket.transfer.id

  target_bucket = aws_s3_bucket.logs[0].id
  target_prefix = "s3-access-logs/"
}

#------------------------------------------------------------------------------
# KMS Key (Optional)
#------------------------------------------------------------------------------

resource "aws_kms_key" "transfer" {
  count                   = var.create_kms_key ? 1 : 0
  description             = "KMS key for S3 File Transfer encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-kms"
  })
}

resource "aws_kms_alias" "transfer" {
  count         = var.create_kms_key ? 1 : 0
  name          = "alias/${local.name_prefix}-transfer"
  target_key_id = aws_kms_key.transfer[0].key_id
}

#------------------------------------------------------------------------------
# IAM Policies
#------------------------------------------------------------------------------

# Policy for full access to the transfer bucket
data "aws_iam_policy_document" "transfer_full_access" {
  statement {
    sid = "ListBucket"
    actions = [
      "s3:ListBucket",
      "s3:GetBucketLocation",
      "s3:GetBucketVersioning"
    ]
    resources = [aws_s3_bucket.transfer.arn]
  }

  statement {
    sid = "ObjectOperations"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:GetObjectAttributes",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
      "s3:ListMultipartUploadParts",
      "s3:AbortMultipartUpload"
    ]
    resources = ["${aws_s3_bucket.transfer.arn}/*"]
  }

  dynamic "statement" {
    for_each = var.create_kms_key || var.kms_key_arn != null ? [1] : []
    content {
      sid = "KMSAccess"
      actions = [
        "kms:Decrypt",
        "kms:GenerateDataKey",
        "kms:DescribeKey"
      ]
      resources = [
        var.create_kms_key ? aws_kms_key.transfer[0].arn : var.kms_key_arn
      ]
    }
  }
}

resource "aws_iam_policy" "transfer_full_access" {
  name        = "${local.name_prefix}-transfer-full-access"
  description = "Full access to S3 File Transfer bucket"
  policy      = data.aws_iam_policy_document.transfer_full_access.json

  tags = local.common_tags
}

# Policy for read-only access
data "aws_iam_policy_document" "transfer_read_only" {
  statement {
    sid = "ListBucket"
    actions = [
      "s3:ListBucket",
      "s3:GetBucketLocation"
    ]
    resources = [aws_s3_bucket.transfer.arn]
  }

  statement {
    sid = "ReadObjects"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:GetObjectAttributes"
    ]
    resources = ["${aws_s3_bucket.transfer.arn}/*"]
  }

  dynamic "statement" {
    for_each = var.create_kms_key || var.kms_key_arn != null ? [1] : []
    content {
      sid = "KMSDecrypt"
      actions = [
        "kms:Decrypt",
        "kms:DescribeKey"
      ]
      resources = [
        var.create_kms_key ? aws_kms_key.transfer[0].arn : var.kms_key_arn
      ]
    }
  }
}

resource "aws_iam_policy" "transfer_read_only" {
  name        = "${local.name_prefix}-transfer-read-only"
  description = "Read-only access to S3 File Transfer bucket"
  policy      = data.aws_iam_policy_document.transfer_read_only.json

  tags = local.common_tags
}

# Policy for upload-only access (for restricted users)
data "aws_iam_policy_document" "transfer_upload_only" {
  statement {
    sid = "UploadObjects"
    actions = [
      "s3:PutObject",
      "s3:ListMultipartUploadParts",
      "s3:AbortMultipartUpload"
    ]
    resources = ["${aws_s3_bucket.transfer.arn}/*"]
  }

  dynamic "statement" {
    for_each = var.create_kms_key || var.kms_key_arn != null ? [1] : []
    content {
      sid = "KMSEncrypt"
      actions = [
        "kms:GenerateDataKey",
        "kms:DescribeKey"
      ]
      resources = [
        var.create_kms_key ? aws_kms_key.transfer[0].arn : var.kms_key_arn
      ]
    }
  }
}

resource "aws_iam_policy" "transfer_upload_only" {
  name        = "${local.name_prefix}-transfer-upload-only"
  description = "Upload-only access to S3 File Transfer bucket"
  policy      = data.aws_iam_policy_document.transfer_upload_only.json

  tags = local.common_tags
}

#------------------------------------------------------------------------------
# IAM User for Application (Optional)
#------------------------------------------------------------------------------

resource "aws_iam_user" "transfer" {
  count = var.create_iam_user ? 1 : 0
  name  = "${local.name_prefix}-transfer-user"
  path  = "/application/"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-transfer-user"
  })
}

resource "aws_iam_user_policy_attachment" "transfer" {
  count      = var.create_iam_user ? 1 : 0
  user       = aws_iam_user.transfer[0].name
  policy_arn = aws_iam_policy.transfer_full_access.arn
}

resource "aws_iam_access_key" "transfer" {
  count = var.create_iam_user ? 1 : 0
  user  = aws_iam_user.transfer[0].name
}

#------------------------------------------------------------------------------
# CloudFront Distribution (Optional)
#------------------------------------------------------------------------------

resource "aws_cloudfront_origin_access_control" "transfer" {
  count                             = var.enable_cloudfront ? 1 : 0
  name                              = "${local.name_prefix}-oac"
  description                       = "OAC for S3 File Transfer"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "transfer" {
  count = var.enable_cloudfront ? 1 : 0

  enabled             = true
  is_ipv6_enabled     = true
  comment             = "S3 File Transfer CDN"
  default_root_object = "index.html"
  price_class         = var.cloudfront_price_class

  origin {
    domain_name              = aws_s3_bucket.transfer.bucket_regional_domain_name
    origin_id                = "S3-${aws_s3_bucket.transfer.id}"
    origin_access_control_id = aws_cloudfront_origin_access_control.transfer[0].id
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods   = ["GET", "HEAD", "OPTIONS"]
    target_origin_id = "S3-${aws_s3_bucket.transfer.id}"

    forwarded_values {
      query_string = true
      headers      = ["Origin", "Access-Control-Request-Headers", "Access-Control-Request-Method"]

      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = length(var.cloudfront_geo_restriction_locations) > 0 ? "whitelist" : "none"
      locations        = var.cloudfront_geo_restriction_locations
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.cloudfront_certificate_arn == null
    acm_certificate_arn            = var.cloudfront_certificate_arn
    ssl_support_method             = var.cloudfront_certificate_arn != null ? "sni-only" : null
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-cdn"
  })
}

# Bucket policy for CloudFront access
resource "aws_s3_bucket_policy" "transfer_cloudfront" {
  count  = var.enable_cloudfront ? 1 : 0
  bucket = aws_s3_bucket.transfer.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontServicePrincipal"
        Effect    = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.transfer.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.transfer[0].arn
          }
        }
      }
    ]
  })
}

#------------------------------------------------------------------------------
# CloudWatch Alarms
#------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "bucket_size" {
  count               = var.enable_cloudwatch_alarms ? 1 : 0
  alarm_name          = "${local.name_prefix}-bucket-size"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "BucketSizeBytes"
  namespace           = "AWS/S3"
  period              = 86400
  statistic           = "Average"
  threshold           = var.bucket_size_alarm_threshold_gb * 1073741824
  alarm_description   = "S3 bucket size exceeds ${var.bucket_size_alarm_threshold_gb}GB"

  dimensions = {
    BucketName  = aws_s3_bucket.transfer.id
    StorageType = "StandardStorage"
  }

  alarm_actions = var.alarm_sns_topic_arn != null ? [var.alarm_sns_topic_arn] : []

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "request_errors" {
  count               = var.enable_cloudwatch_alarms ? 1 : 0
  alarm_name          = "${local.name_prefix}-4xx-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "4xxErrors"
  namespace           = "AWS/S3"
  period              = 300
  statistic           = "Sum"
  threshold           = var.error_rate_alarm_threshold
  alarm_description   = "S3 4xx error rate is high"

  dimensions = {
    BucketName = aws_s3_bucket.transfer.id
    FilterId   = "AllRequests"
  }

  alarm_actions = var.alarm_sns_topic_arn != null ? [var.alarm_sns_topic_arn] : []

  tags = local.common_tags
}

#------------------------------------------------------------------------------
# S3 Event Notifications (Optional)
#------------------------------------------------------------------------------

resource "aws_s3_bucket_notification" "transfer" {
  count  = var.enable_event_notifications ? 1 : 0
  bucket = aws_s3_bucket.transfer.id

  dynamic "lambda_function" {
    for_each = var.notification_lambda_arn != null ? [1] : []
    content {
      lambda_function_arn = var.notification_lambda_arn
      events              = ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
    }
  }

  dynamic "sns_topic" {
    for_each = var.notification_sns_topic_arn != null ? [1] : []
    content {
      topic_arn = var.notification_sns_topic_arn
      events    = ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
    }
  }

  dynamic "sqs_queue" {
    for_each = var.notification_sqs_queue_arn != null ? [1] : []
    content {
      queue_arn = var.notification_sqs_queue_arn
      events    = ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
    }
  }
}