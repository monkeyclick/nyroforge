#------------------------------------------------------------------------------
# Shared IAM Module
# 
# Creates IAM roles and policies for storage access control.
#------------------------------------------------------------------------------

locals {
  iam_tags = merge(var.tags, {
    Module    = "shared-iam"
    Purpose   = "Storage IAM"
    ManagedBy = "terraform"
  })
}

#------------------------------------------------------------------------------
# Storage Admin Role
#------------------------------------------------------------------------------

resource "aws_iam_role" "storage_admin" {
  count = var.create_storage_admin_role ? 1 : 0

  name = "${var.project_name}-${var.environment}-storage-admin"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          AWS = length(var.trusted_account_ids) > 0 ? [
            for account_id in var.trusted_account_ids : "arn:aws:iam::${account_id}:root"
          ] : ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
        }
        Condition = var.require_mfa ? {
          Bool = {
            "aws:MultiFactorAuthPresent" = "true"
          }
        } : null
      }
    ]
  })

  tags = merge(local.iam_tags, {
    Name = "${var.project_name}-${var.environment}-storage-admin"
    Role = "Admin"
  })
}

resource "aws_iam_role_policy" "storage_admin" {
  count = var.create_storage_admin_role ? 1 : 0

  name = "${var.project_name}-${var.environment}-storage-admin-policy"
  role = aws_iam_role.storage_admin[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "FSxFullAccess"
        Effect = "Allow"
        Action = [
          "fsx:*"
        ]
        Resource = "*"
      },
      {
        Sid    = "EFSFullAccess"
        Effect = "Allow"
        Action = [
          "elasticfilesystem:*"
        ]
        Resource = "*"
      },
      {
        Sid    = "S3StorageAccess"
        Effect = "Allow"
        Action = [
          "s3:*"
        ]
        Resource = var.s3_bucket_arns != null ? var.s3_bucket_arns : ["*"]
      },
      {
        Sid    = "KMSAccess"
        Effect = "Allow"
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey",
          "kms:CreateGrant",
          "kms:ListGrants",
          "kms:RevokeGrant"
        ]
        Resource = var.kms_key_arn != null ? [var.kms_key_arn] : ["*"]
      },
      {
        Sid    = "EC2NetworkAccess"
        Effect = "Allow"
        Action = [
          "ec2:DescribeSubnets",
          "ec2:DescribeVpcs",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeNetworkInterfaces",
          "ec2:CreateNetworkInterface",
          "ec2:DeleteNetworkInterface",
          "ec2:ModifyNetworkInterfaceAttribute"
        ]
        Resource = "*"
      },
      {
        Sid    = "BackupAccess"
        Effect = "Allow"
        Action = [
          "backup:*"
        ]
        Resource = "*"
      },
      {
        Sid    = "CloudWatchAccess"
        Effect = "Allow"
        Action = [
          "cloudwatch:GetMetricData",
          "cloudwatch:GetMetricStatistics",
          "cloudwatch:ListMetrics",
          "cloudwatch:PutMetricData",
          "cloudwatch:PutMetricAlarm",
          "cloudwatch:DeleteAlarms",
          "cloudwatch:DescribeAlarms",
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams"
        ]
        Resource = "*"
      }
    ]
  })
}

#------------------------------------------------------------------------------
# Storage Read-Only Role
#------------------------------------------------------------------------------

resource "aws_iam_role" "storage_readonly" {
  count = var.create_storage_readonly_role ? 1 : 0

  name = "${var.project_name}-${var.environment}-storage-readonly"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          AWS = length(var.trusted_account_ids) > 0 ? [
            for account_id in var.trusted_account_ids : "arn:aws:iam::${account_id}:root"
          ] : ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
        }
      }
    ]
  })

  tags = merge(local.iam_tags, {
    Name = "${var.project_name}-${var.environment}-storage-readonly"
    Role = "ReadOnly"
  })
}

resource "aws_iam_role_policy" "storage_readonly" {
  count = var.create_storage_readonly_role ? 1 : 0

  name = "${var.project_name}-${var.environment}-storage-readonly-policy"
  role = aws_iam_role.storage_readonly[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "FSxReadAccess"
        Effect = "Allow"
        Action = [
          "fsx:Describe*",
          "fsx:List*"
        ]
        Resource = "*"
      },
      {
        Sid    = "EFSReadAccess"
        Effect = "Allow"
        Action = [
          "elasticfilesystem:Describe*",
          "elasticfilesystem:List*"
        ]
        Resource = "*"
      },
      {
        Sid    = "S3ReadAccess"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:GetBucketLocation",
          "s3:ListBucket",
          "s3:ListBucketVersions"
        ]
        Resource = var.s3_bucket_arns != null ? concat(
          var.s3_bucket_arns,
          [for arn in var.s3_bucket_arns : "${arn}/*"]
        ) : ["*"]
      },
      {
        Sid    = "KMSReadAccess"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey"
        ]
        Resource = var.kms_key_arn != null ? [var.kms_key_arn] : ["*"]
      },
      {
        Sid    = "CloudWatchReadAccess"
        Effect = "Allow"
        Action = [
          "cloudwatch:GetMetricData",
          "cloudwatch:GetMetricStatistics",
          "cloudwatch:ListMetrics",
          "cloudwatch:DescribeAlarms",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams",
          "logs:GetLogEvents"
        ]
        Resource = "*"
      }
    ]
  })
}

#------------------------------------------------------------------------------
# Storage Backup Role
#------------------------------------------------------------------------------

resource "aws_iam_role" "storage_backup" {
  count = var.create_backup_role ? 1 : 0

  name = "${var.project_name}-${var.environment}-storage-backup"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "backup.amazonaws.com"
        }
      }
    ]
  })

  tags = merge(local.iam_tags, {
    Name = "${var.project_name}-${var.environment}-storage-backup"
    Role = "Backup"
  })
}

resource "aws_iam_role_policy_attachment" "storage_backup" {
  count = var.create_backup_role ? 1 : 0

  role       = aws_iam_role.storage_backup[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_iam_role_policy_attachment" "storage_restore" {
  count = var.create_backup_role ? 1 : 0

  role       = aws_iam_role.storage_backup[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores"
}

resource "aws_iam_role_policy" "storage_backup_kms" {
  count = var.create_backup_role && var.kms_key_arn != null ? 1 : 0

  name = "${var.project_name}-${var.environment}-storage-backup-kms"
  role = aws_iam_role.storage_backup[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "KMSBackupAccess"
        Effect = "Allow"
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey",
          "kms:CreateGrant"
        ]
        Resource = var.kms_key_arn
      }
    ]
  })
}

#------------------------------------------------------------------------------
# EC2 Instance Profile for Storage Access
#------------------------------------------------------------------------------

resource "aws_iam_role" "ec2_storage_client" {
  count = var.create_ec2_client_role ? 1 : 0

  name = "${var.project_name}-${var.environment}-ec2-storage-client"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = merge(local.iam_tags, {
    Name = "${var.project_name}-${var.environment}-ec2-storage-client"
    Role = "EC2Client"
  })
}

resource "aws_iam_role_policy" "ec2_storage_client" {
  count = var.create_ec2_client_role ? 1 : 0

  name = "${var.project_name}-${var.environment}-ec2-storage-client-policy"
  role = aws_iam_role.ec2_storage_client[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "FSxClientAccess"
        Effect = "Allow"
        Action = [
          "fsx:DescribeFileSystems",
          "fsx:DescribeDataRepositoryAssociations"
        ]
        Resource = "*"
      },
      {
        Sid    = "EFSClientAccess"
        Effect = "Allow"
        Action = [
          "elasticfilesystem:DescribeFileSystems",
          "elasticfilesystem:DescribeMountTargets",
          "elasticfilesystem:ClientMount",
          "elasticfilesystem:ClientWrite"
        ]
        Resource = "*"
      },
      {
        Sid    = "S3ClientAccess"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = var.s3_bucket_arns != null ? concat(
          var.s3_bucket_arns,
          [for arn in var.s3_bucket_arns : "${arn}/*"]
        ) : ["*"]
      },
      {
        Sid    = "SSMParameterAccess"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath"
        ]
        Resource = "arn:aws:ssm:*:${data.aws_caller_identity.current.account_id}:parameter/${var.project_name}/*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "ec2_storage_client" {
  count = var.create_ec2_client_role ? 1 : 0

  name = "${var.project_name}-${var.environment}-ec2-storage-client"
  role = aws_iam_role.ec2_storage_client[0].name

  tags = local.iam_tags
}

#------------------------------------------------------------------------------
# Data Sources
#------------------------------------------------------------------------------

data "aws_caller_identity" "current" {}