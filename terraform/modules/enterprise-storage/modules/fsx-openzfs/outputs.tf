#------------------------------------------------------------------------------
# FSx for OpenZFS Submodule - Outputs
#------------------------------------------------------------------------------

output "file_system_id" {
  description = "FSx OpenZFS file system ID"
  value       = try(aws_fsx_openzfs_file_system.this[0].id, null)
}

output "file_system_arn" {
  description = "FSx OpenZFS file system ARN"
  value       = try(aws_fsx_openzfs_file_system.this[0].arn, null)
}

output "dns_name" {
  description = "DNS name for the file system"
  value       = try(aws_fsx_openzfs_file_system.this[0].dns_name, null)
}

output "root_volume_id" {
  description = "Root volume ID"
  value       = try(aws_fsx_openzfs_file_system.this[0].root_volume_id, null)
}

output "network_interface_ids" {
  description = "Network interface IDs for the file system"
  value       = try(aws_fsx_openzfs_file_system.this[0].network_interface_ids, [])
}

output "vpc_id" {
  description = "VPC ID where the file system is deployed"
  value       = try(aws_fsx_openzfs_file_system.this[0].vpc_id, null)
}

output "owner_id" {
  description = "AWS account ID that owns the file system"
  value       = try(aws_fsx_openzfs_file_system.this[0].owner_id, null)
}

output "storage_capacity_gb" {
  description = "Storage capacity in GB"
  value       = try(aws_fsx_openzfs_file_system.this[0].storage_capacity, null)
}

output "throughput_capacity_mbs" {
  description = "Throughput capacity in MB/s"
  value       = try(aws_fsx_openzfs_file_system.this[0].throughput_capacity, null)
}

output "deployment_type" {
  description = "Deployment type of the file system"
  value       = try(aws_fsx_openzfs_file_system.this[0].deployment_type, null)
}

output "kms_key_id" {
  description = "KMS key ID used for encryption"
  value       = try(aws_fsx_openzfs_file_system.this[0].kms_key_id, null)
}

#------------------------------------------------------------------------------
# Volume Outputs
#------------------------------------------------------------------------------

output "volumes" {
  description = "Map of volume details"
  value = {
    for name, vol in aws_fsx_openzfs_volume.this : name => {
      id                        = vol.id
      arn                       = vol.arn
      name                      = vol.name
      parent_volume_id          = vol.parent_volume_id
      data_compression_type     = vol.data_compression_type
      record_size_kib           = vol.record_size_kib
      storage_capacity_quota_gib = vol.storage_capacity_quota_gib
      storage_capacity_reservation_gib = vol.storage_capacity_reservation_gib
    }
  }
}

output "volume_ids" {
  description = "Map of volume names to IDs"
  value       = { for name, vol in aws_fsx_openzfs_volume.this : name => vol.id }
}

#------------------------------------------------------------------------------
# Snapshot Outputs
#------------------------------------------------------------------------------

output "snapshots" {
  description = "Map of snapshot details"
  value = {
    for name, snap in aws_fsx_openzfs_snapshot.this : name => {
      id         = snap.id
      arn        = snap.arn
      name       = snap.name
      volume_id  = snap.volume_id
    }
  }
}

output "snapshot_ids" {
  description = "Map of snapshot names to IDs"
  value       = { for name, snap in aws_fsx_openzfs_snapshot.this : name => snap.id }
}

#------------------------------------------------------------------------------
# CloudWatch Alarm Outputs
#------------------------------------------------------------------------------

output "cloudwatch_alarm_arns" {
  description = "List of CloudWatch alarm ARNs"
  value = compact(concat(
    [
      try(aws_cloudwatch_metric_alarm.storage_capacity[0].arn, ""),
      try(aws_cloudwatch_metric_alarm.throughput[0].arn, ""),
      try(aws_cloudwatch_metric_alarm.disk_iops[0].arn, "")
    ],
    [for alarm in aws_cloudwatch_metric_alarm.volume_storage : alarm.arn]
  ))
}

#------------------------------------------------------------------------------
# Connection Information
#------------------------------------------------------------------------------

output "mount_command" {
  description = "NFS mount command for the root volume"
  value       = try("sudo mount -t nfs -o nfsvers=4.1 ${aws_fsx_openzfs_file_system.this[0].dns_name}:/fsx /mnt/fsx", null)
}

output "fstab_entry" {
  description = "fstab entry for persistent mounting"
  value       = try("${aws_fsx_openzfs_file_system.this[0].dns_name}:/fsx /mnt/fsx nfs4 nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2,_netdev 0 0", null)
}

# Mount commands for each volume
output "volume_mount_commands" {
  description = "NFS mount commands for each volume"
  value = {
    for name, vol in aws_fsx_openzfs_volume.this : name =>
      "sudo mount -t nfs -o nfsvers=4.1 ${aws_fsx_openzfs_file_system.this[0].dns_name}:/fsx/${name} /mnt/${name}"
  }
}

# ZFS dataset paths
output "zfs_dataset_paths" {
  description = "ZFS dataset paths for each volume"
  value = {
    for name, vol in aws_fsx_openzfs_volume.this : name => "/fsx/${name}"
  }
}