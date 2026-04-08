#------------------------------------------------------------------------------
# FSx for Lustre Submodule - Outputs
#------------------------------------------------------------------------------

output "file_system_id" {
  description = "FSx Lustre file system ID"
  value       = try(aws_fsx_lustre_file_system.this[0].id, null)
}

output "file_system_arn" {
  description = "FSx Lustre file system ARN"
  value       = try(aws_fsx_lustre_file_system.this[0].arn, null)
}

output "dns_name" {
  description = "DNS name for the file system"
  value       = try(aws_fsx_lustre_file_system.this[0].dns_name, null)
}

output "mount_name" {
  description = "Mount name for the file system"
  value       = try(aws_fsx_lustre_file_system.this[0].mount_name, null)
}

output "network_interface_ids" {
  description = "Network interface IDs for the file system"
  value       = try(aws_fsx_lustre_file_system.this[0].network_interface_ids, [])
}

output "vpc_id" {
  description = "VPC ID where the file system is deployed"
  value       = try(aws_fsx_lustre_file_system.this[0].vpc_id, null)
}

output "owner_id" {
  description = "AWS account ID that owns the file system"
  value       = try(aws_fsx_lustre_file_system.this[0].owner_id, null)
}

output "storage_capacity_gb" {
  description = "Storage capacity in GB"
  value       = try(aws_fsx_lustre_file_system.this[0].storage_capacity, null)
}

output "deployment_type" {
  description = "Deployment type of the file system"
  value       = try(aws_fsx_lustre_file_system.this[0].deployment_type, null)
}

output "storage_type" {
  description = "Storage type of the file system"
  value       = try(aws_fsx_lustre_file_system.this[0].storage_type, null)
}

output "per_unit_storage_throughput" {
  description = "Per unit storage throughput in MB/s/TiB"
  value       = try(aws_fsx_lustre_file_system.this[0].per_unit_storage_throughput, null)
}

output "data_compression_type" {
  description = "Data compression type"
  value       = try(aws_fsx_lustre_file_system.this[0].data_compression_type, null)
}

output "kms_key_id" {
  description = "KMS key ID used for encryption"
  value       = try(aws_fsx_lustre_file_system.this[0].kms_key_id, null)
}

output "log_group_arn" {
  description = "CloudWatch log group ARN for Lustre logs"
  value       = try(aws_cloudwatch_log_group.lustre_logs[0].arn, null)
}

output "log_group_name" {
  description = "CloudWatch log group name for Lustre logs"
  value       = try(aws_cloudwatch_log_group.lustre_logs[0].name, null)
}

output "data_repository_association_ids" {
  description = "List of data repository association IDs"
  value       = [for dra in aws_fsx_data_repository_association.this : dra.id]
}

output "cloudwatch_alarm_arns" {
  description = "List of CloudWatch alarm ARNs"
  value = compact([
    try(aws_cloudwatch_metric_alarm.storage_capacity[0].arn, ""),
    try(aws_cloudwatch_metric_alarm.metadata_operations[0].arn, ""),
    try(aws_cloudwatch_metric_alarm.data_read_bytes[0].arn, ""),
    try(aws_cloudwatch_metric_alarm.data_write_bytes[0].arn, "")
  ])
}

# Mount information for clients
output "mount_command" {
  description = "Linux mount command for the file system"
  value = try(
    "sudo mount -t lustre -o relatime,flock ${aws_fsx_lustre_file_system.this[0].dns_name}@tcp:/${aws_fsx_lustre_file_system.this[0].mount_name} /mnt/fsx",
    null
  )
}

output "fstab_entry" {
  description = "fstab entry for persistent mounting"
  value = try(
    "${aws_fsx_lustre_file_system.this[0].dns_name}@tcp:/${aws_fsx_lustre_file_system.this[0].mount_name} /mnt/fsx lustre defaults,relatime,flock,_netdev 0 0",
    null
  )
}

# Performance information
output "estimated_throughput_mbps" {
  description = "Estimated throughput based on storage and per-unit throughput"
  value = try(
    var.deployment_type == "SCRATCH_1" ? var.storage_capacity_gb / 1000 * 200 :
    var.deployment_type == "SCRATCH_2" ? var.storage_capacity_gb / 1000 * 200 :
    var.storage_capacity_gb / 1000 * (var.per_unit_storage_throughput != null ? var.per_unit_storage_throughput : 125),
    null
  )
}