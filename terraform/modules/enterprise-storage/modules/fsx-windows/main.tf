#------------------------------------------------------------------------------
# FSx for Windows File Server Submodule
# 
# Creates and configures FSx for Windows File Server with Active Directory
# integration, storage capacity, throughput settings, and backup policies.
#------------------------------------------------------------------------------

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  
  common_tags = merge(var.tags, {
    Module      = "fsx-windows"
    StorageType = "FSx-Windows"
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
  })
}

#------------------------------------------------------------------------------
# FSx for Windows File System
#------------------------------------------------------------------------------

resource "aws_fsx_windows_file_system" "this" {
  count = var.enabled ? 1 : 0

  storage_capacity    = var.storage_capacity_gb
  throughput_capacity = var.throughput_capacity_mbs
  deployment_type     = var.deployment_type
  storage_type        = var.storage_type
  
  subnet_ids = var.deployment_type == "MULTI_AZ_1" ? var.subnet_ids : [var.preferred_subnet_id != null ? var.preferred_subnet_id : var.subnet_ids[0]]
  preferred_subnet_id = var.deployment_type == "MULTI_AZ_1" ? (var.preferred_subnet_id != null ? var.preferred_subnet_id : var.subnet_ids[0]) : null
  
  security_group_ids = var.security_group_ids
  kms_key_id        = var.kms_key_id

  # Active Directory Configuration
  dynamic "self_managed_active_directory" {
    for_each = var.self_managed_active_directory != null ? [var.self_managed_active_directory] : []
    content {
      dns_ips                                = self_managed_active_directory.value.dns_ips
      domain_name                            = self_managed_active_directory.value.domain_name
      username                               = self_managed_active_directory.value.username
      password                               = self_managed_active_directory.value.password
      file_system_administrators_group       = try(self_managed_active_directory.value.file_system_administrators_group, "Domain Admins")
      organizational_unit_distinguished_name = try(self_managed_active_directory.value.organizational_unit_distinguished_name, null)
    }
  }

  # Use AWS Managed Active Directory if provided
  active_directory_id = var.active_directory_id

  # Backup Configuration
  automatic_backup_retention_days   = var.automatic_backup_retention_days
  daily_automatic_backup_start_time = var.daily_automatic_backup_start_time
  copy_tags_to_backups             = var.copy_tags_to_backups
  skip_final_backup                = var.skip_final_backup

  # Maintenance Window
  weekly_maintenance_start_time = var.weekly_maintenance_start_time

  # DNS Aliases
  aliases = var.aliases

  # Audit Logging
  dynamic "audit_log_configuration" {
    for_each = var.audit_log_destination != null ? [1] : []
    content {
      audit_log_destination             = var.audit_log_destination
      file_access_audit_log_level       = var.file_access_audit_log_level
      file_share_access_audit_log_level = var.file_share_access_audit_log_level
    }
  }

  # Disk IOPS Configuration (for SSD storage with specific IOPS needs)
  dynamic "disk_iops_configuration" {
    for_each = var.disk_iops_configuration != null ? [var.disk_iops_configuration] : []
    content {
      mode = disk_iops_configuration.value.mode
      iops = disk_iops_configuration.value.mode == "USER_PROVISIONED" ? disk_iops_configuration.value.iops : null
    }
  }

  tags = merge(local.common_tags, {
    Name           = "${local.name_prefix}-fsx-windows"
    DeploymentType = var.deployment_type
    StorageType    = var.storage_type
  })

  lifecycle {
    prevent_destroy = false
    
    precondition {
      condition     = var.active_directory_id != null || var.self_managed_active_directory != null
      error_message = "Either active_directory_id or self_managed_active_directory must be provided."
    }
  }
}

#------------------------------------------------------------------------------
# FSx Data Repository Association (if S3 integration needed)
#------------------------------------------------------------------------------

resource "aws_fsx_data_repository_association" "this" {
  for_each = var.enabled && var.data_repository_associations != null ? { for idx, dra in var.data_repository_associations : idx => dra } : {}

  file_system_id       = aws_fsx_windows_file_system.this[0].id
  file_system_path     = each.value.file_system_path
  data_repository_path = each.value.data_repository_path
  
  batch_import_meta_data_on_create = try(each.value.batch_import_meta_data_on_create, false)
  imported_file_chunk_size         = try(each.value.imported_file_chunk_size, 1024)

  dynamic "s3" {
    for_each = each.value.s3_auto_export_policy != null || each.value.s3_auto_import_policy != null ? [1] : []
    content {
      dynamic "auto_export_policy" {
        for_each = each.value.s3_auto_export_policy != null ? [each.value.s3_auto_export_policy] : []
        content {
          events = auto_export_policy.value.events
        }
      }
      dynamic "auto_import_policy" {
        for_each = each.value.s3_auto_import_policy != null ? [each.value.s3_auto_import_policy] : []
        content {
          events = auto_import_policy.value.events
        }
      }
    }
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-dra-${each.key}"
  })
}

#------------------------------------------------------------------------------
# CloudWatch Alarms for FSx Windows
#------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "storage_capacity" {
  count = var.enabled && var.enable_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.name_prefix}-fsx-windows-storage-utilization"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "FreeStorageCapacity"
  namespace           = "AWS/FSx"
  period              = 300
  statistic           = "Average"
  threshold           = var.storage_capacity_gb * 1024 * 1024 * 1024 * (1 - var.storage_utilization_threshold / 100)
  alarm_description   = "FSx Windows file system storage utilization exceeds ${var.storage_utilization_threshold}%"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FileSystemId = aws_fsx_windows_file_system.this[0].id
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "throughput" {
  count = var.enabled && var.enable_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.name_prefix}-fsx-windows-throughput"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "DataReadBytes"
  namespace           = "AWS/FSx"
  period              = 300
  statistic           = "Sum"
  threshold           = var.throughput_capacity_mbs * 1024 * 1024 * 300 * (var.throughput_utilization_threshold / 100)
  alarm_description   = "FSx Windows throughput exceeds ${var.throughput_utilization_threshold}% of provisioned capacity"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FileSystemId = aws_fsx_windows_file_system.this[0].id
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "network_throughput" {
  count = var.enabled && var.enable_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.name_prefix}-fsx-windows-network-throughput"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "NetworkThroughputUtilization"
  namespace           = "AWS/FSx"
  period              = 300
  statistic           = "Average"
  threshold           = var.throughput_utilization_threshold
  alarm_description   = "FSx Windows network throughput utilization exceeds ${var.throughput_utilization_threshold}%"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FileSystemId = aws_fsx_windows_file_system.this[0].id
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

#------------------------------------------------------------------------------
# CloudWatch Log Group for Audit Logging
#------------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "audit_logs" {
  count = var.enabled && var.create_audit_log_group ? 1 : 0

  name              = "/aws/fsx/windows/${local.name_prefix}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_id

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-fsx-windows-audit-logs"
  })
}

#------------------------------------------------------------------------------
# SNS Topic for Alerts (if not provided)
#------------------------------------------------------------------------------

resource "aws_sns_topic" "alerts" {
  count = var.enabled && var.enable_cloudwatch_alarms && var.create_sns_topic ? 1 : 0

  name              = "${local.name_prefix}-fsx-windows-alerts"
  kms_master_key_id = var.kms_key_id

  tags = local.common_tags
}

resource "aws_sns_topic_policy" "alerts" {
  count = var.enabled && var.enable_cloudwatch_alarms && var.create_sns_topic ? 1 : 0

  arn = aws_sns_topic.alerts[0].arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudWatchAlarms"
        Effect = "Allow"
        Principal = {
          Service = "cloudwatch.amazonaws.com"
        }
        Action   = "sns:Publish"
        Resource = aws_sns_topic.alerts[0].arn
        Condition = {
          ArnLike = {
            "aws:SourceArn" = "arn:aws:cloudwatch:${var.aws_region}:${data.aws_caller_identity.current.account_id}:alarm:*"
          }
        }
      }
    ]
  })
}

#------------------------------------------------------------------------------
# Data Sources
#------------------------------------------------------------------------------

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}