#------------------------------------------------------------------------------
# FSx for NetApp ONTAP Submodule
# 
# Creates and configures FSx for NetApp ONTAP with multi-protocol support
# (NFS, SMB, iSCSI), storage virtual machines, volumes, and tiering policies.
#------------------------------------------------------------------------------

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  
  common_tags = merge(var.tags, {
    Module      = "fsx-ontap"
    StorageType = "FSx-ONTAP"
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
  })
}

#------------------------------------------------------------------------------
# FSx for NetApp ONTAP File System
#------------------------------------------------------------------------------

resource "aws_fsx_ontap_file_system" "this" {
  count = var.enabled ? 1 : 0

  storage_capacity    = var.storage_capacity_gb
  throughput_capacity = var.throughput_capacity_mbs
  deployment_type     = var.deployment_type
  
  # Network configuration
  subnet_ids          = var.deployment_type == "MULTI_AZ_1" || var.deployment_type == "MULTI_AZ_2" ? var.subnet_ids : [var.subnet_ids[0]]
  preferred_subnet_id = var.deployment_type == "MULTI_AZ_1" || var.deployment_type == "MULTI_AZ_2" ? (var.preferred_subnet_id != null ? var.preferred_subnet_id : var.subnet_ids[0]) : null
  
  security_group_ids = var.security_group_ids
  kms_key_id        = var.kms_key_id

  # HA configuration
  ha_pairs                    = var.ha_pairs
  throughput_capacity_per_ha_pair = var.throughput_capacity_per_ha_pair
  
  # Endpoint IP address range for Multi-AZ
  endpoint_ip_address_range = var.deployment_type == "MULTI_AZ_1" || var.deployment_type == "MULTI_AZ_2" ? var.endpoint_ip_address_range : null

  # Route table IDs for Multi-AZ failover
  route_table_ids = var.deployment_type == "MULTI_AZ_1" || var.deployment_type == "MULTI_AZ_2" ? var.route_table_ids : null

  # Disk IOPS configuration
  dynamic "disk_iops_configuration" {
    for_each = var.disk_iops_configuration != null ? [var.disk_iops_configuration] : []
    content {
      mode = disk_iops_configuration.value.mode
      iops = disk_iops_configuration.value.mode == "USER_PROVISIONED" ? disk_iops_configuration.value.iops : null
    }
  }

  # Backup configuration
  automatic_backup_retention_days   = var.automatic_backup_retention_days
  daily_automatic_backup_start_time = var.automatic_backup_retention_days > 0 ? var.daily_automatic_backup_start_time : null

  # Maintenance window
  weekly_maintenance_start_time = var.weekly_maintenance_start_time

  # ONTAP configuration
  fsx_admin_password = var.fsx_admin_password

  tags = merge(local.common_tags, {
    Name           = "${local.name_prefix}-fsx-ontap"
    DeploymentType = var.deployment_type
    HAPairs        = tostring(var.ha_pairs)
  })

  lifecycle {
    prevent_destroy = false
    ignore_changes = [
      fsx_admin_password
    ]
  }
}

#------------------------------------------------------------------------------
# Storage Virtual Machines (SVMs)
#------------------------------------------------------------------------------

resource "aws_fsx_ontap_storage_virtual_machine" "this" {
  for_each = var.enabled ? { for idx, svm in var.storage_virtual_machines : svm.name => svm } : {}

  file_system_id             = aws_fsx_ontap_file_system.this[0].id
  name                       = each.value.name
  root_volume_security_style = try(each.value.root_volume_security_style, "UNIX")
  svm_admin_password         = try(each.value.svm_admin_password, null)

  # Active Directory configuration for SMB
  dynamic "active_directory_configuration" {
    for_each = each.value.active_directory_configuration != null ? [each.value.active_directory_configuration] : []
    content {
      netbios_name = active_directory_configuration.value.netbios_name

      dynamic "self_managed_active_directory_configuration" {
        for_each = active_directory_configuration.value.self_managed_active_directory_configuration != null ? [active_directory_configuration.value.self_managed_active_directory_configuration] : []
        content {
          dns_ips                                = self_managed_active_directory_configuration.value.dns_ips
          domain_name                            = self_managed_active_directory_configuration.value.domain_name
          username                               = self_managed_active_directory_configuration.value.username
          password                               = self_managed_active_directory_configuration.value.password
          file_system_administrators_group       = try(self_managed_active_directory_configuration.value.file_system_administrators_group, "Domain Admins")
          organizational_unit_distinguished_name = try(self_managed_active_directory_configuration.value.organizational_unit_distinguished_name, null)
        }
      }
    }
  }

  tags = merge(local.common_tags, {
    Name         = "${local.name_prefix}-svm-${each.value.name}"
    SVMName      = each.value.name
    SecurityStyle = try(each.value.root_volume_security_style, "UNIX")
  })
}

#------------------------------------------------------------------------------
# ONTAP Volumes
#------------------------------------------------------------------------------

resource "aws_fsx_ontap_volume" "this" {
  for_each = var.enabled ? {
    for item in flatten([
      for svm in var.storage_virtual_machines : [
        for vol in try(svm.volumes, []) : {
          key        = "${svm.name}-${vol.name}"
          svm_name   = svm.name
          volume     = vol
        }
      ]
    ]) : item.key => item
  } : {}

  name                       = each.value.volume.name
  junction_path              = each.value.volume.junction_path
  size_in_megabytes          = each.value.volume.size_in_megabytes
  storage_virtual_machine_id = aws_fsx_ontap_storage_virtual_machine.this[each.value.svm_name].id
  
  storage_efficiency_enabled = try(each.value.volume.storage_efficiency_enabled, true)
  security_style            = try(each.value.volume.security_style, "UNIX")
  ontap_volume_type         = try(each.value.volume.ontap_volume_type, "RW")
  copy_tags_to_backups      = try(each.value.volume.copy_tags_to_backups, true)
  skip_final_backup         = try(each.value.volume.skip_final_backup, false)
  
  # Snapshot policy
  snapshot_policy = try(each.value.volume.snapshot_policy, "default")

  # Tiering policy
  dynamic "tiering_policy" {
    for_each = each.value.volume.tiering_policy != null ? [each.value.volume.tiering_policy] : []
    content {
      name           = tiering_policy.value.name
      cooling_period = try(tiering_policy.value.cooling_period, null)
    }
  }

  # Snaplock configuration (for compliance)
  dynamic "snaplock_configuration" {
    for_each = try(each.value.volume.snaplock_configuration, null) != null ? [each.value.volume.snaplock_configuration] : []
    content {
      snaplock_type = snaplock_configuration.value.snaplock_type
      
      dynamic "autocommit_period" {
        for_each = snaplock_configuration.value.autocommit_period != null ? [snaplock_configuration.value.autocommit_period] : []
        content {
          type  = autocommit_period.value.type
          value = autocommit_period.value.value
        }
      }
      
      dynamic "retention_period" {
        for_each = snaplock_configuration.value.retention_period != null ? [snaplock_configuration.value.retention_period] : []
        content {
          dynamic "default_retention" {
            for_each = retention_period.value.default_retention != null ? [retention_period.value.default_retention] : []
            content {
              type  = default_retention.value.type
              value = default_retention.value.value
            }
          }
          dynamic "maximum_retention" {
            for_each = retention_period.value.maximum_retention != null ? [retention_period.value.maximum_retention] : []
            content {
              type  = maximum_retention.value.type
              value = maximum_retention.value.value
            }
          }
          dynamic "minimum_retention" {
            for_each = retention_period.value.minimum_retention != null ? [retention_period.value.minimum_retention] : []
            content {
              type  = minimum_retention.value.type
              value = minimum_retention.value.value
            }
          }
        }
      }
    }
  }

  tags = merge(local.common_tags, {
    Name         = "${local.name_prefix}-vol-${each.value.volume.name}"
    VolumeName   = each.value.volume.name
    SVMName      = each.value.svm_name
    JunctionPath = each.value.volume.junction_path
  })

  depends_on = [aws_fsx_ontap_storage_virtual_machine.this]
}

#------------------------------------------------------------------------------
# CloudWatch Alarms for FSx ONTAP
#------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "storage_capacity" {
  count = var.enabled && var.enable_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.name_prefix}-fsx-ontap-storage-utilization"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "StorageCapacityUtilization"
  namespace           = "AWS/FSx"
  period              = 300
  statistic           = "Average"
  threshold           = var.storage_utilization_threshold
  alarm_description   = "FSx ONTAP storage utilization exceeds ${var.storage_utilization_threshold}%"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FileSystemId = aws_fsx_ontap_file_system.this[0].id
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "ssd_storage_capacity" {
  count = var.enabled && var.enable_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.name_prefix}-fsx-ontap-ssd-utilization"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "SSDStorageCapacityUtilization"
  namespace           = "AWS/FSx"
  period              = 300
  statistic           = "Average"
  threshold           = var.ssd_utilization_threshold
  alarm_description   = "FSx ONTAP SSD storage utilization exceeds ${var.ssd_utilization_threshold}%"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FileSystemId = aws_fsx_ontap_file_system.this[0].id
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "throughput" {
  count = var.enabled && var.enable_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.name_prefix}-fsx-ontap-throughput"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "NetworkThroughputUtilization"
  namespace           = "AWS/FSx"
  period              = 300
  statistic           = "Average"
  threshold           = var.throughput_utilization_threshold
  alarm_description   = "FSx ONTAP network throughput utilization exceeds ${var.throughput_utilization_threshold}%"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FileSystemId = aws_fsx_ontap_file_system.this[0].id
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "disk_iops" {
  count = var.enabled && var.enable_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.name_prefix}-fsx-ontap-disk-iops"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "DiskIOPSUtilization"
  namespace           = "AWS/FSx"
  period              = 300
  statistic           = "Average"
  threshold           = var.iops_utilization_threshold
  alarm_description   = "FSx ONTAP disk IOPS utilization exceeds ${var.iops_utilization_threshold}%"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FileSystemId = aws_fsx_ontap_file_system.this[0].id
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

# SVM-level alarms
resource "aws_cloudwatch_metric_alarm" "svm_storage" {
  for_each = var.enabled && var.enable_cloudwatch_alarms ? { for idx, svm in var.storage_virtual_machines : svm.name => svm } : {}

  alarm_name          = "${local.name_prefix}-fsx-ontap-svm-${each.key}-storage"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "StorageCapacityUtilization"
  namespace           = "AWS/FSx"
  period              = 300
  statistic           = "Average"
  threshold           = var.storage_utilization_threshold
  alarm_description   = "FSx ONTAP SVM ${each.key} storage utilization exceeds ${var.storage_utilization_threshold}%"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FileSystemId           = aws_fsx_ontap_file_system.this[0].id
    StorageVirtualMachineId = aws_fsx_ontap_storage_virtual_machine.this[each.key].id
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