#------------------------------------------------------------------------------
# FSx for Windows File Server Submodule - Outputs
#------------------------------------------------------------------------------

output "file_system_id" {
  description = "FSx Windows file system ID"
  value       = try(aws_fsx_windows_file_system.this[0].id, null)
}

output "file_system_arn" {
  description = "FSx Windows file system ARN"
  value       = try(aws_fsx_windows_file_system.this[0].arn, null)
}

output "dns_name" {
  description = "DNS name for the file system"
  value       = try(aws_fsx_windows_file_system.this[0].dns_name, null)
}

output "preferred_file_server_ip" {
  description = "IP address of the primary file server"
  value       = try(aws_fsx_windows_file_system.this[0].preferred_file_server_ip, null)
}

output "remote_administration_endpoint" {
  description = "Remote administration endpoint for the file system"
  value       = try(aws_fsx_windows_file_system.this[0].remote_administration_endpoint, null)
}

output "network_interface_ids" {
  description = "Network interface IDs for the file system"
  value       = try(aws_fsx_windows_file_system.this[0].network_interface_ids, [])
}

output "vpc_id" {
  description = "VPC ID where the file system is deployed"
  value       = try(aws_fsx_windows_file_system.this[0].vpc_id, null)
}

output "owner_id" {
  description = "AWS account ID that owns the file system"
  value       = try(aws_fsx_windows_file_system.this[0].owner_id, null)
}

output "storage_capacity_gb" {
  description = "Storage capacity in GB"
  value       = try(aws_fsx_windows_file_system.this[0].storage_capacity, null)
}

output "throughput_capacity_mbs" {
  description = "Throughput capacity in MB/s"
  value       = try(aws_fsx_windows_file_system.this[0].throughput_capacity, null)
}

output "deployment_type" {
  description = "Deployment type of the file system"
  value       = try(aws_fsx_windows_file_system.this[0].deployment_type, null)
}

output "storage_type" {
  description = "Storage type of the file system"
  value       = try(aws_fsx_windows_file_system.this[0].storage_type, null)
}

output "kms_key_id" {
  description = "KMS key ID used for encryption"
  value       = try(aws_fsx_windows_file_system.this[0].kms_key_id, null)
}

output "audit_log_group_arn" {
  description = "CloudWatch log group ARN for audit logs"
  value       = try(aws_cloudwatch_log_group.audit_logs[0].arn, null)
}

output "audit_log_group_name" {
  description = "CloudWatch log group name for audit logs"
  value       = try(aws_cloudwatch_log_group.audit_logs[0].name, null)
}

output "sns_topic_arn" {
  description = "SNS topic ARN for alerts"
  value       = try(aws_sns_topic.alerts[0].arn, null)
}

output "data_repository_association_ids" {
  description = "List of data repository association IDs"
  value       = [for dra in aws_fsx_data_repository_association.this : dra.id]
}

output "cloudwatch_alarm_arns" {
  description = "List of CloudWatch alarm ARNs"
  value = compact([
    try(aws_cloudwatch_metric_alarm.storage_capacity[0].arn, ""),
    try(aws_cloudwatch_metric_alarm.throughput[0].arn, ""),
    try(aws_cloudwatch_metric_alarm.network_throughput[0].arn, "")
  ])
}

# Connection information for clients
output "smb_connection_string" {
  description = "SMB connection string for mounting the file system"
  value       = try("\\\\${aws_fsx_windows_file_system.this[0].dns_name}\\share", null)
}

output "powershell_mount_command" {
  description = "PowerShell command to mount the file system"
  value       = try("New-PSDrive -Name Z -PSProvider FileSystem -Root \\\\${aws_fsx_windows_file_system.this[0].dns_name}\\share -Persist", null)
}