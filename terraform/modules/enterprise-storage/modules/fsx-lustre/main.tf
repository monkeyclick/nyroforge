#------------------------------------------------------------------------------
# FSx for Lustre Submodule
# 
# Creates and configures FSx for Lustre with deployment types (scratch, persistent),
# data repository associations for S3 integration, and performance optimization.
#------------------------------------------------------------------------------

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  
  common_tags = merge(var.tags, {
    Module      = "fsx-lustre"
    StorageType = "FSx-Lustre"
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
  })

  # Determine per-unit storage throughput based on deployment type
  default_per_unit_throughput = {
    "PERSISTENT_1" = 200
    "PERSISTENT_2" = 125
  }
}

#------------------------------------------------------------------------------
# FSx for Lustre File System
#------------------------------------------------------------------------------

resource "aws_fsx_lustre_file_system" "this" {
  count = var.enabled ? 1 : 0

  storage_capacity = var.storage_capacity_gb
  subnet_ids       = [var.subnet_id]
  deployment_type  = var.deployment_type
  storage_type     = var.storage_type

  security_group_ids = var.security_group_ids
  kms_key_id        = var.kms_key_id

  # Performance configuration for persistent deployments
  per_unit_storage_throughput = contains(["PERSISTENT_1", "PERSISTENT_2"], var.deployment_type) ? (
    var.per_unit_storage_throughput != null ? var.per_unit_storage_throughput : local.default_per_unit_throughput[var.deployment_type]
  ) : null

  # Drive cache for HDD storage
  drive_cache_type = var.storage_type == "HDD" && contains(["PERSISTENT_1"], var.deployment_type) ? var.drive_cache_type : null

  # S3 data repository configuration (legacy - for SCRATCH_1 and SCRATCH_2)
  import_path               = contains(["SCRATCH_1", "SCRATCH_2"], var.deployment_type) ? var.import_path : null
  export_path               = contains(["SCRATCH_1", "SCRATCH_2"], var.deployment_type) ? var.export_path : null
  imported_file_chunk_size  = var.import_path != null ? var.imported_file_chunk_size : null
  auto_import_policy        = var.import_path != null && contains(["SCRATCH_1", "SCRATCH_2", "PERSISTENT_1"], var.deployment_type) ? var.auto_import_policy : null

  # Backup configuration (for persistent deployments)
  automatic_backup_retention_days   = contains(["PERSISTENT_1", "PERSISTENT_2"], var.deployment_type) ? var.automatic_backup_retention_days : null
  daily_automatic_backup_start_time = var.automatic_backup_retention_days > 0 ? var.daily_automatic_backup_start_time : null
  copy_tags_to_backups             = var.copy_tags_to_backups

  # Maintenance window
  weekly_maintenance_start_time = var.weekly_maintenance_start_time

  # Data compression
  data_compression_type = var.data_compression_type

  # File system type option
  file_system_type_version = var.file_system_type_version

  # Logging configuration
  dynamic "log_configuration" {
    for_each = var.log_configuration != null ? [var.log_configuration] : []
    content {
      destination = log_configuration.value.destination
      level       = log_configuration.value.level
    }
  }

  # Root squash configuration
  dynamic "root_squash_configuration" {
    for_each = var.root_squash_configuration != null ? [var.root_squash_configuration] : []
    content {
      root_squash     = root_squash_configuration.value.root_squash
      no_squash_nids  = try(root_squash_configuration.value.no_squash_nids, [])
    }
  }

  # Metadata configuration for PERSISTENT_2
  dynamic "metadata_configuration" {
    for_each = var.deployment_type == "PERSISTENT_2" && var.metadata_configuration != null ? [var.metadata_configuration] : []
    content {
      iops = metadata_configuration.value.iops
      mode = metadata_configuration.value.mode
    }
  }

  tags = merge(local.common_tags, {
    Name           = "${local.name_prefix}-fsx-lustre"
    DeploymentType = var.deployment_type
    StorageType    = var.storage_type
  })

  lifecycle {
    prevent_destroy = false
  }
}

#------------------------------------------------------------------------------
# Data Repository Associations (for PERSISTENT deployments)
#------------------------------------------------------------------------------

resource "aws_fsx_data_repository_association" "this" {
  for_each = var.enabled && var.data_repository_associations != null && contains(["PERSISTENT_1", "PERSISTENT_2"], var.deployment_type) ? { for idx, dra in var.data_repository_associations : idx => dra } : {}

  file_system_id       = aws_fsx_lustre_file_system.this[0].id
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
# CloudWatch Alarms for FSx Lustre
#------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "storage_capacity" {
  count = var.enabled && var.enable_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.name_prefix}-fsx-lustre-storage-utilization"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "FreeDataStorageCapacity"
  namespace           = "AWS/FSx"
  period              = 300
  statistic           = "Average"
  threshold           = var.storage_capacity_gb * 1024 * 1024 * 1024 * (1 - var.storage_utilization_threshold / 100)
  alarm_description   = "FSx Lustre file system storage utilization exceeds ${var.storage_utilization_threshold}%"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FileSystemId = aws_fsx_lustre_file_system.this[0].id
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "metadata_operations" {
  count = var.enabled && var.enable_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.name_prefix}-fsx-lustre-metadata-ops"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "MetadataOperations"
  namespace           = "AWS/FSx"
  period              = 300
  statistic           = "Sum"
  threshold           = var.metadata_operations_threshold
  alarm_description   = "FSx Lustre metadata operations exceed threshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FileSystemId = aws_fsx_lustre_file_system.this[0].id
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "data_read_bytes" {
  count = var.enabled && var.enable_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.name_prefix}-fsx-lustre-data-read"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "DataReadBytes"
  namespace           = "AWS/FSx"
  period              = 300
  statistic           = "Sum"
  threshold           = var.data_throughput_threshold_bytes
  alarm_description   = "FSx Lustre data read throughput exceeds threshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FileSystemId = aws_fsx_lustre_file_system.this[0].id
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "data_write_bytes" {
  count = var.enabled && var.enable_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.name_prefix}-fsx-lustre-data-write"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "DataWriteBytes"
  namespace           = "AWS/FSx"
  period              = 300
  statistic           = "Sum"
  threshold           = var.data_throughput_threshold_bytes
  alarm_description   = "FSx Lustre data write throughput exceeds threshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FileSystemId = aws_fsx_lustre_file_system.this[0].id
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

#------------------------------------------------------------------------------
# CloudWatch Log Group for Lustre Logging
#------------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "lustre_logs" {
  count = var.enabled && var.create_log_group ? 1 : 0

  name              = "/aws/fsx/lustre/${local.name_prefix}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_id

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-fsx-lustre-logs"
  })
}

#------------------------------------------------------------------------------
# S3 Bucket Policy for Data Repository Access (if S3 integration enabled)
#------------------------------------------------------------------------------

data "aws_s3_bucket" "data_repository" {
  count  = var.enabled && var.s3_bucket_name != null ? 1 : 0
  bucket = var.s3_bucket_name
}

resource "aws_s3_bucket_policy" "fsx_access" {
  count  = var.enabled && var.s3_bucket_name != null && var.create_s3_bucket_policy ? 1 : 0
  bucket = data.aws_s3_bucket.data_repository[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "FSxLustreAccess"
        Effect = "Allow"
        Principal = {
          Service = "fsx.amazonaws.com"
        }
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
          "s3:GetBucketLocation"
        ]
        Resource = [
          data.aws_s3_bucket.data_repository[0].arn,
          "${data.aws_s3_bucket.data_repository[0].arn}/*"
        ]
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
          ArnLike = {
            "aws:SourceArn" = aws_fsx_lustre_file_system.this[0].arn
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