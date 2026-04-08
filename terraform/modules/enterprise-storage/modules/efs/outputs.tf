#------------------------------------------------------------------------------
# AWS EFS Submodule - Outputs
#------------------------------------------------------------------------------

output "file_system_id" {
  description = "EFS file system ID"
  value       = try(aws_efs_file_system.this[0].id, null)
}

output "file_system_arn" {
  description = "EFS file system ARN"
  value       = try(aws_efs_file_system.this[0].arn, null)
}

output "file_system_dns_name" {
  description = "DNS name for the file system"
  value       = try("${aws_efs_file_system.this[0].id}.efs.${data.aws_region.current.name}.amazonaws.com", null)
}

output "size_in_bytes" {
  description = "File system size in bytes"
  value       = try(aws_efs_file_system.this[0].size_in_bytes, null)
}

output "number_of_mount_targets" {
  description = "Number of mount targets"
  value       = try(aws_efs_file_system.this[0].number_of_mount_targets, null)
}

output "performance_mode" {
  description = "Performance mode"
  value       = try(aws_efs_file_system.this[0].performance_mode, null)
}

output "throughput_mode" {
  description = "Throughput mode"
  value       = try(aws_efs_file_system.this[0].throughput_mode, null)
}

output "provisioned_throughput_in_mibps" {
  description = "Provisioned throughput in MiB/s"
  value       = try(aws_efs_file_system.this[0].provisioned_throughput_in_mibps, null)
}

output "kms_key_id" {
  description = "KMS key ID used for encryption"
  value       = try(aws_efs_file_system.this[0].kms_key_id, null)
}

output "availability_zone_name" {
  description = "Availability zone for One Zone storage"
  value       = try(aws_efs_file_system.this[0].availability_zone_name, null)
}

output "availability_zone_id" {
  description = "Availability zone ID for One Zone storage"
  value       = try(aws_efs_file_system.this[0].availability_zone_id, null)
}

#------------------------------------------------------------------------------
# Mount Target Outputs
#------------------------------------------------------------------------------

output "mount_targets" {
  description = "Map of mount target details"
  value = {
    for subnet_id, mt in aws_efs_mount_target.this : subnet_id => {
      id                   = mt.id
      dns_name            = mt.dns_name
      file_system_arn     = mt.file_system_arn
      ip_address          = mt.ip_address
      network_interface_id = mt.network_interface_id
      availability_zone_id = mt.availability_zone_id
      availability_zone_name = mt.availability_zone_name
    }
  }
}

output "mount_target_ids" {
  description = "List of mount target IDs"
  value       = [for mt in aws_efs_mount_target.this : mt.id]
}

output "mount_target_dns_names" {
  description = "Map of subnet IDs to mount target DNS names"
  value       = { for subnet_id, mt in aws_efs_mount_target.this : subnet_id => mt.dns_name }
}

output "mount_target_ip_addresses" {
  description = "Map of subnet IDs to mount target IP addresses"
  value       = { for subnet_id, mt in aws_efs_mount_target.this : subnet_id => mt.ip_address }
}

#------------------------------------------------------------------------------
# Access Point Outputs
#------------------------------------------------------------------------------

output "access_points" {
  description = "Map of access point details"
  value = {
    for name, ap in aws_efs_access_point.this : name => {
      id             = ap.id
      arn            = ap.arn
      file_system_id = ap.file_system_id
      root_directory = ap.root_directory
      posix_user     = ap.posix_user
    }
  }
}

output "access_point_ids" {
  description = "Map of access point names to IDs"
  value       = { for name, ap in aws_efs_access_point.this : name => ap.id }
}

output "access_point_arns" {
  description = "Map of access point names to ARNs"
  value       = { for name, ap in aws_efs_access_point.this : name => ap.arn }
}

#------------------------------------------------------------------------------
# Replication Outputs
#------------------------------------------------------------------------------

output "replication_configuration_id" {
  description = "Replication configuration ID"
  value       = try(aws_efs_replication_configuration.this[0].id, null)
}

output "replication_destination" {
  description = "Replication destination details"
  value       = try(aws_efs_replication_configuration.this[0].destination, null)
}

#------------------------------------------------------------------------------
# CloudWatch Alarm Outputs
#------------------------------------------------------------------------------

output "cloudwatch_alarm_arns" {
  description = "List of CloudWatch alarm ARNs"
  value = compact([
    try(aws_cloudwatch_metric_alarm.burst_credit_balance[0].arn, ""),
    try(aws_cloudwatch_metric_alarm.percent_io_limit[0].arn, ""),
    try(aws_cloudwatch_metric_alarm.throughput[0].arn, ""),
    try(aws_cloudwatch_metric_alarm.client_connections[0].arn, "")
  ])
}

#------------------------------------------------------------------------------
# Connection Information
#------------------------------------------------------------------------------

output "mount_command" {
  description = "NFS mount command using DNS name"
  value       = try("sudo mount -t nfs4 -o nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2,noresvport ${aws_efs_file_system.this[0].id}.efs.${data.aws_region.current.name}.amazonaws.com:/ /mnt/efs", null)
}

output "mount_command_with_access_point" {
  description = "Mount commands for each access point"
  value = {
    for name, ap in aws_efs_access_point.this : name =>
      "sudo mount -t nfs4 -o nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2,noresvport,accesspoint=${ap.id} ${aws_efs_file_system.this[0].id}.efs.${data.aws_region.current.name}.amazonaws.com:/ /mnt/efs-${name}"
  }
}

output "fstab_entry" {
  description = "fstab entry for persistent mounting"
  value       = try("${aws_efs_file_system.this[0].id}.efs.${data.aws_region.current.name}.amazonaws.com:/ /mnt/efs nfs4 nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2,noresvport,_netdev 0 0", null)
}

output "fstab_entries_with_access_points" {
  description = "fstab entries for each access point"
  value = {
    for name, ap in aws_efs_access_point.this : name =>
      "${aws_efs_file_system.this[0].id}.efs.${data.aws_region.current.name}.amazonaws.com:/ /mnt/efs-${name} nfs4 nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2,noresvport,accesspoint=${ap.id},_netdev 0 0"
  }
}

# EFS Utils helper mount (for Amazon Linux)
output "efs_utils_mount_command" {
  description = "Mount command using EFS mount helper (amazon-efs-utils)"
  value       = try("sudo mount -t efs -o tls ${aws_efs_file_system.this[0].id}:/ /mnt/efs", null)
}