#------------------------------------------------------------------------------
# Shared KMS Module
# 
# Creates and manages KMS keys for storage encryption across all storage types.
#------------------------------------------------------------------------------

locals {
  kms_tags = merge(var.tags, {
    Module    = "shared-kms"
    Purpose   = "Storage Encryption"
    ManagedBy = "terraform"
  })
}

#------------------------------------------------------------------------------
# KMS Key for Storage Encryption
#------------------------------------------------------------------------------

resource "aws_kms_key" "storage" {
  count = var.create_kms_key ? 1 : 0

  description              = "KMS key for enterprise storage encryption - ${var.project_name}-${var.environment}"
  deletion_window_in_days  = var.kms_key_deletion_window
  enable_key_rotation      = var.kms_key_rotation_enabled
  is_enabled              = true
  multi_region            = var.kms_multi_region

  policy = jsonencode({
    Version = "2012-10-17"
    Id      = "storage-key-policy"
    Statement = concat(
      # Root account access
      [
        {
          Sid    = "EnableRootPermissions"
          Effect = "Allow"
          Principal = {
            AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
          }
          Action   = "kms:*"
          Resource = "*"
        }
      ],
      # Key administrators
      length(var.kms_key_administrators) > 0 ? [
        {
          Sid    = "AllowKeyAdministration"
          Effect = "Allow"
          Principal = {
            AWS = var.kms_key_administrators
          }
          Action = [
            "kms:Create*",
            "kms:Describe*",
            "kms:Enable*",
            "kms:List*",
            "kms:Put*",
            "kms:Update*",
            "kms:Revoke*",
            "kms:Disable*",
            "kms:Get*",
            "kms:Delete*",
            "kms:TagResource",
            "kms:UntagResource",
            "kms:ScheduleKeyDeletion",
            "kms:CancelKeyDeletion"
          ]
          Resource = "*"
        }
      ] : [],
      # Key users
      length(var.kms_key_users) > 0 ? [
        {
          Sid    = "AllowKeyUsage"
          Effect = "Allow"
          Principal = {
            AWS = var.kms_key_users
          }
          Action = [
            "kms:Encrypt",
            "kms:Decrypt",
            "kms:ReEncrypt*",
            "kms:GenerateDataKey*",
            "kms:DescribeKey"
          ]
          Resource = "*"
        }
      ] : [],
      # AWS services
      [
        {
          Sid    = "AllowAWSServices"
          Effect = "Allow"
          Principal = {
            Service = [
              "fsx.amazonaws.com",
              "elasticfilesystem.amazonaws.com",
              "s3.amazonaws.com",
              "ec2.amazonaws.com",
              "logs.amazonaws.com",
              "backup.amazonaws.com"
            ]
          }
          Action = [
            "kms:Encrypt",
            "kms:Decrypt",
            "kms:ReEncrypt*",
            "kms:GenerateDataKey*",
            "kms:DescribeKey",
            "kms:CreateGrant"
          ]
          Resource = "*"
          Condition = {
            StringEquals = {
              "kms:CallerAccount" = data.aws_caller_identity.current.account_id
            }
          }
        }
      ],
      # Grant access for AWS Backup
      var.enable_backup_grants ? [
        {
          Sid    = "AllowBackupService"
          Effect = "Allow"
          Principal = {
            Service = "backup.amazonaws.com"
          }
          Action = [
            "kms:CreateGrant",
            "kms:ListGrants",
            "kms:RevokeGrant"
          ]
          Resource = "*"
          Condition = {
            Bool = {
              "kms:GrantIsForAWSResource" = "true"
            }
          }
        }
      ] : []
    )
  })

  tags = merge(local.kms_tags, {
    Name = "${var.project_name}-${var.environment}-storage-key"
  })
}

resource "aws_kms_alias" "storage" {
  count = var.create_kms_key ? 1 : 0

  name          = "alias/${var.project_name}-${var.environment}-storage"
  target_key_id = aws_kms_key.storage[0].key_id
}

#------------------------------------------------------------------------------
# Cross-Region Replica Key (for disaster recovery)
#------------------------------------------------------------------------------

resource "aws_kms_replica_key" "storage" {
  count = var.create_kms_key && var.kms_multi_region && var.replica_region != null ? 1 : 0

  provider = aws.replica

  description             = "Replica KMS key for enterprise storage encryption - ${var.project_name}-${var.environment}"
  primary_key_arn         = aws_kms_key.storage[0].arn
  deletion_window_in_days = var.kms_key_deletion_window

  tags = merge(local.kms_tags, {
    Name        = "${var.project_name}-${var.environment}-storage-key-replica"
    ReplicaOf   = aws_kms_key.storage[0].key_id
    PrimaryRegion = data.aws_region.current.name
  })
}

resource "aws_kms_alias" "storage_replica" {
  count = var.create_kms_key && var.kms_multi_region && var.replica_region != null ? 1 : 0

  provider = aws.replica

  name          = "alias/${var.project_name}-${var.environment}-storage"
  target_key_id = aws_kms_replica_key.storage[0].key_id
}

#------------------------------------------------------------------------------
# Data Sources
#------------------------------------------------------------------------------

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}