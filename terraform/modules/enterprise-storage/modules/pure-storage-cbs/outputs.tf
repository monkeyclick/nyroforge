#------------------------------------------------------------------------------
# Pure Storage Cloud Block Store Submodule - Outputs
#------------------------------------------------------------------------------

output "iam_role_arn" {
  description = "IAM role ARN for CBS"
  value       = try(aws_iam_role.cbs[0].arn, null)
}

output "iam_instance_profile_arn" {
  description = "IAM instance profile ARN for CBS"
  value       = try(aws_iam_instance_profile.cbs[0].arn, null)
}

#------------------------------------------------------------------------------
# Security Group Outputs
#------------------------------------------------------------------------------

output "management_security_group_id" {
  description = "Management security group ID"
  value       = try(aws_security_group.management[0].id, null)
}

output "iscsi_security_group_id" {
  description = "iSCSI security group ID"
  value       = try(aws_security_group.iscsi[0].id, null)
}

output "nvme_security_group_id" {
  description = "NVMe-oF security group ID"
  value       = try(aws_security_group.nvme[0].id, null)
}

output "replication_security_group_id" {
  description = "Replication security group ID"
  value       = try(aws_security_group.replication[0].id, null)
}

#------------------------------------------------------------------------------
# Network Interface Outputs
#------------------------------------------------------------------------------

output "management_eni_id" {
  description = "Management network interface ID"
  value       = try(aws_network_interface.management[0].id, null)
}

output "management_eni_private_ip" {
  description = "Management network interface private IP"
  value       = try(aws_network_interface.management[0].private_ip, null)
}

output "iscsi_eni_id" {
  description = "iSCSI network interface ID"
  value       = try(aws_network_interface.iscsi[0].id, null)
}

output "iscsi_eni_private_ip" {
  description = "iSCSI network interface private IP"
  value       = try(aws_network_interface.iscsi[0].private_ip, null)
}

output "replication_eni_id" {
  description = "Replication network interface ID"
  value       = try(aws_network_interface.replication[0].id, null)
}

output "replication_eni_private_ip" {
  description = "Replication network interface private IP"
  value       = try(aws_network_interface.replication[0].private_ip, null)
}

#------------------------------------------------------------------------------
# CloudWatch Outputs
#------------------------------------------------------------------------------

output "log_group_name" {
  description = "CloudWatch log group name"
  value       = try(aws_cloudwatch_log_group.cbs[0].name, null)
}

output "log_group_arn" {
  description = "CloudWatch log group ARN"
  value       = try(aws_cloudwatch_log_group.cbs[0].arn, null)
}

output "cloudwatch_alarm_arns" {
  description = "List of CloudWatch alarm ARNs"
  value = compact([
    try(aws_cloudwatch_metric_alarm.capacity[0].arn, ""),
    try(aws_cloudwatch_metric_alarm.latency[0].arn, ""),
    try(aws_cloudwatch_metric_alarm.iops[0].arn, "")
  ])
}

#------------------------------------------------------------------------------
# SSM Parameter Outputs
#------------------------------------------------------------------------------

output "config_parameter_name" {
  description = "SSM parameter name for CBS configuration"
  value       = try(aws_ssm_parameter.cbs_config[0].name, null)
}

output "config_parameter_arn" {
  description = "SSM parameter ARN for CBS configuration"
  value       = try(aws_ssm_parameter.cbs_config[0].arn, null)
}

#------------------------------------------------------------------------------
# Configuration Outputs
#------------------------------------------------------------------------------

output "array_name" {
  description = "Name of the CBS array"
  value       = var.array_name
}

output "deployment_type" {
  description = "Deployment type"
  value       = var.deployment_type
}

output "capacity_tb" {
  description = "Capacity in TB"
  value       = var.capacity_tb
}

output "iscsi_enabled" {
  description = "Whether iSCSI is enabled"
  value       = var.iscsi_enabled
}

output "nvme_enabled" {
  description = "Whether NVMe-oF is enabled"
  value       = var.nvme_enabled
}

#------------------------------------------------------------------------------
# Connection Information
#------------------------------------------------------------------------------

output "iscsi_connect_instructions" {
  description = "iSCSI connection instructions"
  value = var.iscsi_enabled ? <<-EOT
    # Connect to Pure Storage CBS via iSCSI
    # Replace <iscsi_ip> with the actual iSCSI IP address
    
    # Install iSCSI initiator (if not installed):
    # Amazon Linux/RHEL: sudo yum install -y iscsi-initiator-utils
    # Ubuntu/Debian: sudo apt-get install -y open-iscsi
    
    # Start iSCSI service:
    sudo systemctl enable iscsid
    sudo systemctl start iscsid
    
    # Discover targets:
    sudo iscsiadm -m discovery -t sendtargets -p ${try(aws_network_interface.iscsi[0].private_ip, "<iscsi_ip>")}:3260
    
    # Login to target:
    sudo iscsiadm -m node -T <target_iqn> -p ${try(aws_network_interface.iscsi[0].private_ip, "<iscsi_ip>")}:3260 --login
    
    # List connected sessions:
    sudo iscsiadm -m session
    
    # Find new block devices:
    lsblk
  EOT
  : null
}

output "management_url" {
  description = "Pure Storage CBS management URL"
  value       = try("https://${aws_network_interface.management[0].private_ip}", null)
}