#------------------------------------------------------------------------------
# AWS Elastic File System (EFS) Submodule
# 
# Creates and configures EFS with lifecycle policies, throughput modes,
# mount targets, and access points across availability zones.
#------------------------------------------------------------------------------

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  
  common_tags = merge(var.tags, {
    Module      = "efs"
    StorageType = "EFS"
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
  })

  # Use provided subnet IDs or fall back to the variable
  mount_target_subnets = var.mount_target_subnet_ids != null ? var.mount_target_subnet_ids : var.subnet_ids
}

#------------------------------------------------------------------------------
# EFS File System
#------------------------------------------------------------------------------

resource "aws_efs_file_system" "this" {
  count = var.enabled ? 1 : 0

  # Performance configuration
  performance_mode                = var.performance_mode
  throughput_mode                 = var.throughput_mode
  provisioned_throughput_in_mibps = var.throughput_mode == "provisioned" ? var.provisioned_throughput_in_mibps : null

  # Encryption
  encrypted  = true
  kms_key_id = var.kms_key_id

  # Availability zone (for One Zone storage)
  availability_zone_name = var.availability_zone_name

  # Lifecycle policies
  dynamic "lifecycle_policy" {
    for_each = var.lifecycle_policies
    content {
      transition_to_ia                    = try(lifecycle_policy.value.transition_to_ia, null)
      transition_to_primary_storage_class = try(lifecycle_policy.value.transition_to_primary_storage_class, null)
      transition_to_archive               = try(lifecycle_policy.value.transition_to_archive, null)
    }
  }

  # Protection
  dynamic "protection" {
    for_each = var.enable_replication_overwrite_protection ? [1] : []
    content {
      replication_overwrite = "DISABLED"
    }
  }

  tags = merge(local.common_tags, {
    Name            = "${local.name_prefix}-efs"
    PerformanceMode = var.performance_mode
    ThroughputMode  = var.throughput_mode
  })

  lifecycle {
    prevent_destroy = false
  }
}

#------------------------------------------------------------------------------
# EFS Backup Policy
#------------------------------------------------------------------------------

resource "aws_efs_backup_policy" "this" {
  count = var.enabled && var.enable_backup_policy ? 1 : 0

  file_system_id = aws_efs_file_system.this[0].id

  backup_policy {
    status = "ENABLED"
  }
}

#------------------------------------------------------------------------------
# EFS Mount Targets
#------------------------------------------------------------------------------

resource "aws_efs_mount_target" "this" {
  for_each = var.enabled ? toset(local.mount_target_subnets) : toset([])

  file_system_id  = aws_efs_file_system.this[0].id
  subnet_id       = each.value
  security_groups = var.security_group_ids

  lifecycle {
    create_before_destroy = true
  }
}

#------------------------------------------------------------------------------
# EFS Access Points
#------------------------------------------------------------------------------

resource "aws_efs_access_point" "this" {
  for_each = var.enabled ? { for ap in var.access_points : ap.name => ap } : {}

  file_system_id = aws_efs_file_system.this[0].id

  # POSIX user configuration
  dynamic "posix_user" {
    for_each = each.value.posix_user != null ? [each.value.posix_user] : []
    content {
      gid            = posix_user.value.gid
      uid            = posix_user.value.uid
      secondary_gids = try(posix_user.value.secondary_gids, null)
    }
  }

  # Root directory configuration
  dynamic "root_directory" {
    for_each = each.value.root_directory != null ? [each.value.root_directory] : []
    content {
      path = root_directory.value.path

      dynamic "creation_info" {
        for_each = root_directory.value.creation_info != null ? [root_directory.value.creation_info] : []
        content {
          owner_gid   = creation_info.value.owner_gid
          owner_uid   = creation_info.value.owner_uid
          permissions = creation_info.value.permissions
        }
      }
    }
  }

  tags = merge(local.common_tags, {
    Name            = "${local.name_prefix}-ap-${each.value.name}"
    AccessPointName = each.value.name
  })
}

#------------------------------------------------------------------------------
# EFS File System Policy
#------------------------------------------------------------------------------

resource "aws_efs_file_system_policy" "this" {
  count = var.enabled && var.enable_file_system_policy ? 1 : 0

  file_system_id                     = aws_efs_file_system.this[0].id
  bypass_policy_lockout_safety_check = var.file_system_policy_bypass_policy_lockout_safety_check

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      # Enforce encryption in transit
      var.enforce_encryption_in_transit ? [
        {
          Sid       = "EnforceEncryptionInTransit"
          Effect    = "Deny"
          Principal = "*"
          Action    = "*"
          Resource  = aws_efs_file_system.this[0].arn
          Condition = {
            Bool = {
              "aws:SecureTransport" = "false"
            }
          }
        }
      ] : [],
      # Restrict root access
      var.restrict_root_access ? [
        {
          Sid       = "RestrictRootAccess"
          Effect    = "Deny"
          Principal = "*"
          Action    = "elasticfilesystem:ClientRootAccess"
          Resource  = aws_efs_file_system.this[0].arn
          Condition = {
            Bool = {
              "elasticfilesystem:AccessedViaMountTarget" = "true"
            }
          }
        }
      ] : [],
      # Allow access from specific principals
      length(var.allowed_principals) > 0 ? [
        {
          Sid       = "AllowSpecificPrincipals"
          Effect    = "Allow"
          Principal = {
            AWS = var.allowed_principals
          }
          Action = [
            "elasticfilesystem:ClientMount",
            "elasticfilesystem:ClientWrite",
            "elasticfilesystem:ClientRootAccess"
          ]
          Resource = aws_efs_file_system.this[0].arn
        }
      ] : []
    )
  })
}

#------------------------------------------------------------------------------
# EFS Replication Configuration
#------------------------------------------------------------------------------

resource "aws_efs_replication_configuration" "this" {
  count = var.enabled && var.replication_configuration != null ? 1 : 0

  source_file_system_id = aws_efs_file_system.this[0].id

  destination {
    region                 = try(var.replication_configuration.destination.region, null)
    availability_zone_name = try(var.replication_configuration.destination.availability_zone_name, null)
    kms_key_id            = try(var.replication_configuration.destination.kms_key_id, null)
    file_system_id        = try(var.replication_configuration.destination.file_system_id, null)
  }
}

#------------------------------------------------------------------------------
# CloudWatch Alarms for EFS
#------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "burst_credit_balance" {
  count = var.enabled && var.enable_cloudwatch_alarms && var.throughput_mode == "bursting" ? 1 : 0

  alarm_name          = "${local.name_prefix}-efs-burst-credit-balance"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "BurstCreditBalance"
  namespace           = "AWS/EFS"
  period              = 300
  statistic           = "Average"
  threshold           = var.burst_credit_balance_threshold
  alarm_description   = "EFS burst credit balance is below ${var.burst_credit_balance_threshold}"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FileSystemId = aws_efs_file_system.this[0].id
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "percent_io_limit" {
  count = var.enabled && var.enable_cloudwatch_alarms && var.performance_mode == "generalPurpose" ? 1 : 0

  alarm_name          = "${local.name_prefix}-efs-io-limit"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "PercentIOLimit"
  namespace           = "AWS/EFS"
  period              = 300
  statistic           = "Average"
  threshold           = var.percent_io_limit_threshold
  alarm_description   = "EFS I/O limit utilization exceeds ${var.percent_io_limit_threshold}%"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FileSystemId = aws_efs_file_system.this[0].id
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "throughput" {
  count = var.enabled && var.enable_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.name_prefix}-efs-throughput"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "TotalIOBytes"
  namespace           = "AWS/EFS"
  period              = 300
  statistic           = "Sum"
  threshold           = var.throughput_threshold_bytes
  alarm_description   = "EFS throughput exceeds threshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FileSystemId = aws_efs_file_system.this[0].id
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "client_connections" {
  count = var.enabled && var.enable_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.name_prefix}-efs-client-connections"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ClientConnections"
  namespace           = "AWS/EFS"
  period              = 300
  statistic           = "Sum"
  threshold           = var.client_connections_threshold
  alarm_description   = "EFS client connections exceed ${var.client_connections_threshold}"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FileSystemId = aws_efs_file_system.this[0].id
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

#------------------------------------------------------------------------------
# Data Sources
#------------------------------------------------------------------------------

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}