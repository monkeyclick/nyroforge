#------------------------------------------------------------------------------
# FSx for OpenZFS Submodule
# 
# Creates and configures FSx for OpenZFS with data compression, snapshots,
# and volume configurations.
#------------------------------------------------------------------------------

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  
  common_tags = merge(var.tags, {
    Module      = "fsx-openzfs"
    StorageType = "FSx-OpenZFS"
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
  })
}

#------------------------------------------------------------------------------
# FSx for OpenZFS File System
#------------------------------------------------------------------------------

resource "aws_fsx_openzfs_file_system" "this" {
  count = var.enabled ? 1 : 0

  storage_capacity    = var.storage_capacity_gb
  throughput_capacity = var.throughput_capacity_mbs
  deployment_type     = var.deployment_type
  storage_type        = var.storage_type
  
  # Network configuration
  subnet_ids          = var.deployment_type == "MULTI_AZ_1" ? var.subnet_ids : [var.subnet_ids[0]]
  preferred_subnet_id = var.deployment_type == "MULTI_AZ_1" ? (var.preferred_subnet_id != null ? var.preferred_subnet_id : var.subnet_ids[0]) : null
  
  security_group_ids = var.security_group_ids
  kms_key_id        = var.kms_key_id

  # Route table IDs for Multi-AZ
  route_table_ids = var.deployment_type == "MULTI_AZ_1" ? var.route_table_ids : null

  # Endpoint IP address range for Multi-AZ
  endpoint_ip_address_range = var.deployment_type == "MULTI_AZ_1" ? var.endpoint_ip_address_range : null

  # Disk IOPS configuration
  dynamic "disk_iops_configuration" {
    for_each = var.disk_iops_configuration != null ? [var.disk_iops_configuration] : []
    content {
      mode = disk_iops_configuration.value.mode
      iops = disk_iops_configuration.value.mode == "USER_PROVISIONED" ? disk_iops_configuration.value.iops : null
    }
  }

  # Root volume configuration
  dynamic "root_volume_configuration" {
    for_each = var.root_volume_configuration != null ? [var.root_volume_configuration] : []
    content {
      data_compression_type   = try(root_volume_configuration.value.data_compression_type, "ZSTD")
      read_only               = try(root_volume_configuration.value.read_only, false)
      record_size_kib         = try(root_volume_configuration.value.record_size_kib, 128)
      copy_tags_to_snapshots  = try(root_volume_configuration.value.copy_tags_to_snapshots, true)

      dynamic "nfs_exports" {
        for_each = root_volume_configuration.value.nfs_exports != null ? [root_volume_configuration.value.nfs_exports] : []
        content {
          dynamic "client_configurations" {
            for_each = nfs_exports.value.client_configurations
            content {
              clients = client_configurations.value.clients
              options = client_configurations.value.options
            }
          }
        }
      }

      dynamic "user_and_group_quotas" {
        for_each = try(root_volume_configuration.value.user_and_group_quotas, [])
        content {
          id                         = user_and_group_quotas.value.id
          storage_capacity_quota_gib = user_and_group_quotas.value.storage_capacity_quota_gib
          type                       = user_and_group_quotas.value.type
        }
      }
    }
  }

  # Backup configuration
  automatic_backup_retention_days   = var.automatic_backup_retention_days
  daily_automatic_backup_start_time = var.automatic_backup_retention_days > 0 ? var.daily_automatic_backup_start_time : null
  copy_tags_to_backups             = var.copy_tags_to_backups
  copy_tags_to_volumes             = var.copy_tags_to_volumes
  skip_final_backup                = var.skip_final_backup

  # Maintenance window
  weekly_maintenance_start_time = var.weekly_maintenance_start_time

  tags = merge(local.common_tags, {
    Name           = "${local.name_prefix}-fsx-openzfs"
    DeploymentType = var.deployment_type
    StorageType    = var.storage_type
  })

  lifecycle {
    prevent_destroy = false
  }
}

#------------------------------------------------------------------------------
# OpenZFS Volumes
#------------------------------------------------------------------------------

resource "aws_fsx_openzfs_volume" "this" {
  for_each = var.enabled && var.volumes != null ? { for idx, vol in var.volumes : vol.name => vol } : {}

  name             = each.value.name
  parent_volume_id = try(each.value.parent_volume_id, aws_fsx_openzfs_file_system.this[0].root_volume_id)
  
  data_compression_type            = try(each.value.data_compression_type, "ZSTD")
  read_only                        = try(each.value.read_only, false)
  record_size_kib                  = try(each.value.record_size_kib, 128)
  storage_capacity_quota_gib       = try(each.value.storage_capacity_quota_gib, null)
  storage_capacity_reservation_gib = try(each.value.storage_capacity_reservation_gib, null)
  copy_tags_to_snapshots           = try(each.value.copy_tags_to_snapshots, true)

  # NFS exports configuration
  dynamic "nfs_exports" {
    for_each = each.value.nfs_exports != null ? [each.value.nfs_exports] : []
    content {
      dynamic "client_configurations" {
        for_each = nfs_exports.value.client_configurations
        content {
          clients = client_configurations.value.clients
          options = client_configurations.value.options
        }
      }
    }
  }

  # User and group quotas
  dynamic "user_and_group_quotas" {
    for_each = try(each.value.user_and_group_quotas, [])
    content {
      id                         = user_and_group_quotas.value.id
      storage_capacity_quota_gib = user_and_group_quotas.value.storage_capacity_quota_gib
      type                       = user_and_group_quotas.value.type
    }
  }

  # Origin snapshot (for cloning)
  dynamic "origin_snapshot" {
    for_each = each.value.origin_snapshot != null ? [each.value.origin_snapshot] : []
    content {
      snapshot_arn  = origin_snapshot.value.snapshot_arn
      copy_strategy = origin_snapshot.value.copy_strategy
    }
  }

  tags = merge(local.common_tags, {
    Name       = "${local.name_prefix}-vol-${each.value.name}"
    VolumeName = each.value.name
  })

  depends_on = [aws_fsx_openzfs_file_system.this]
}

#------------------------------------------------------------------------------
# OpenZFS Snapshots
#------------------------------------------------------------------------------

resource "aws_fsx_openzfs_snapshot" "this" {
  for_each = var.enabled && var.snapshots != null ? { for idx, snap in var.snapshots : snap.name => snap } : {}

  name      = each.value.name
  volume_id = try(each.value.volume_name, null) != null ? aws_fsx_openzfs_volume.this[each.value.volume_name].id : aws_fsx_openzfs_file_system.this[0].root_volume_id

  tags = merge(local.common_tags, {
    Name         = "${local.name_prefix}-snap-${each.value.name}"
    SnapshotName = each.value.name
    VolumeName   = try(each.value.volume_name, "root")
  })

  depends_on = [aws_fsx_openzfs_volume.this]
}

#------------------------------------------------------------------------------
# CloudWatch Alarms for FSx OpenZFS
#------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "storage_capacity" {
  count = var.enabled && var.enable_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.name_prefix}-fsx-openzfs-storage-utilization"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "StorageCapacityUtilization"
  namespace           = "AWS/FSx"
  period              = 300
  statistic           = "Average"
  threshold           = var.storage_utilization_threshold
  alarm_description   = "FSx OpenZFS storage utilization exceeds ${var.storage_utilization_threshold}%"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FileSystemId = aws_fsx_openzfs_file_system.this[0].id
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "throughput" {
  count = var.enabled && var.enable_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.name_prefix}-fsx-openzfs-throughput"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "NetworkThroughputUtilization"
  namespace           = "AWS/FSx"
  period              = 300
  statistic           = "Average"
  threshold           = var.throughput_utilization_threshold
  alarm_description   = "FSx OpenZFS network throughput utilization exceeds ${var.throughput_utilization_threshold}%"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FileSystemId = aws_fsx_openzfs_file_system.this[0].id
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "disk_iops" {
  count = var.enabled && var.enable_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.name_prefix}-fsx-openzfs-disk-iops"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "DiskIOPSUtilization"
  namespace           = "AWS/FSx"
  period              = 300
  statistic           = "Average"
  threshold           = var.iops_utilization_threshold
  alarm_description   = "FSx OpenZFS disk IOPS utilization exceeds ${var.iops_utilization_threshold}%"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FileSystemId = aws_fsx_openzfs_file_system.this[0].id
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

# Per-volume storage alarms
resource "aws_cloudwatch_metric_alarm" "volume_storage" {
  for_each = var.enabled && var.enable_cloudwatch_alarms && var.volumes != null ? { for idx, vol in var.volumes : vol.name => vol if try(vol.storage_capacity_quota_gib, null) != null } : {}

  alarm_name          = "${local.name_prefix}-fsx-openzfs-vol-${each.key}-storage"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "StorageCapacityUtilization"
  namespace           = "AWS/FSx"
  period              = 300
  statistic           = "Average"
  threshold           = var.storage_utilization_threshold
  alarm_description   = "FSx OpenZFS volume ${each.key} storage utilization exceeds ${var.storage_utilization_threshold}%"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FileSystemId = aws_fsx_openzfs_file_system.this[0].id
    VolumeId     = aws_fsx_openzfs_volume.this[each.key].id
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