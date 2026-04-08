#------------------------------------------------------------------------------
# NetApp Cloud Volumes ONTAP Submodule - Outputs
#------------------------------------------------------------------------------

output "iam_role_arn" {
  description = "IAM role ARN for CVO"
  value       = try(aws_iam_role.cvo[0].arn, null)
}

output "iam_instance_profile_arn" {
  description = "IAM instance profile ARN for CVO"
  value       = try(aws_iam_instance_profile.cvo[0].arn, null)
}

output "security_group_id" {
  description = "Security group ID for CVO"
  value       = try(aws_security_group.cvo[0].id, null)
}

output "security_group_arn" {
  description = "Security group ARN for CVO"
  value       = try(aws_security_group.cvo[0].arn, null)
}

#------------------------------------------------------------------------------
# S3 Tiering Bucket Outputs
#------------------------------------------------------------------------------

output "tiering_bucket_id" {
  description = "S3 bucket ID for data tiering"
  value       = try(aws_s3_bucket.data_tiering[0].id, null)
}

output "tiering_bucket_arn" {
  description = "S3 bucket ARN for data tiering"
  value       = try(aws_s3_bucket.data_tiering[0].arn, null)
}

output "tiering_bucket_domain_name" {
  description = "S3 bucket domain name for data tiering"
  value       = try(aws_s3_bucket.data_tiering[0].bucket_domain_name, null)
}

#------------------------------------------------------------------------------
# CloudWatch Outputs
#------------------------------------------------------------------------------

output "log_group_name" {
  description = "CloudWatch log group name"
  value       = try(aws_cloudwatch_log_group.cvo[0].name, null)
}

output "log_group_arn" {
  description = "CloudWatch log group ARN"
  value       = try(aws_cloudwatch_log_group.cvo[0].arn, null)
}

output "cloudwatch_alarm_arns" {
  description = "List of CloudWatch alarm ARNs"
  value = compact([
    try(aws_cloudwatch_metric_alarm.cvo_storage[0].arn, "")
  ])
}

#------------------------------------------------------------------------------
# DNS Outputs
#------------------------------------------------------------------------------

output "management_dns_name" {
  description = "DNS name for CVO management"
  value       = try(aws_route53_record.cvo_management[0].fqdn, null)
}

output "data_dns_name" {
  description = "DNS name for CVO data access"
  value       = try(aws_route53_record.cvo_data[0].fqdn, null)
}

#------------------------------------------------------------------------------
# SSM Parameter Outputs
#------------------------------------------------------------------------------

output "config_parameter_name" {
  description = "SSM parameter name for CVO configuration"
  value       = try(aws_ssm_parameter.cvo_config[0].name, null)
}

output "config_parameter_arn" {
  description = "SSM parameter ARN for CVO configuration"
  value       = try(aws_ssm_parameter.cvo_config[0].arn, null)
}

#------------------------------------------------------------------------------
# Configuration Outputs
#------------------------------------------------------------------------------

output "cvo_name" {
  description = "Name of the CVO deployment"
  value       = var.cvo_name
}

output "deployment_mode" {
  description = "Deployment mode (single_node or ha)"
  value       = var.deployment_mode
}

output "instance_type" {
  description = "EC2 instance type"
  value       = var.instance_type
}

output "license_type" {
  description = "License type"
  value       = var.license_type
}

output "capacity_tier" {
  description = "Capacity tier configuration"
  value       = var.capacity_tier
}

#------------------------------------------------------------------------------
# Connection Information
#------------------------------------------------------------------------------

output "nfs_mount_instructions" {
  description = "NFS mount instructions"
  value = <<-EOT
    # Mount NFS volume from NetApp CVO
    # Replace <data_lif_ip> with the actual data LIF IP address
    # Replace <junction_path> with the volume junction path
    
    sudo mount -t nfs -o nfsvers=4.1 <data_lif_ip>:<junction_path> /mnt/netapp
    
    # For persistent mount, add to /etc/fstab:
    # <data_lif_ip>:<junction_path> /mnt/netapp nfs4 defaults,_netdev 0 0
  EOT
}

output "smb_mount_instructions" {
  description = "SMB/CIFS mount instructions"
  value = <<-EOT
    # Mount SMB share from NetApp CVO
    # Replace <data_lif_ip> with the actual data LIF IP address
    # Replace <share_name> with the SMB share name
    
    # Linux:
    sudo mount -t cifs //<data_lif_ip>/<share_name> /mnt/netapp -o username=<user>,domain=<domain>
    
    # Windows:
    net use Z: \\<data_lif_ip>\<share_name> /user:<domain>\<user>
  EOT
}

output "iscsi_connect_instructions" {
  description = "iSCSI connection instructions"
  value = <<-EOT
    # Connect to iSCSI target on NetApp CVO
    # Replace <iscsi_lif_ip> with the actual iSCSI LIF IP address
    
    # Discover targets:
    sudo iscsiadm -m discovery -t sendtargets -p <iscsi_lif_ip>
    
    # Login to target:
    sudo iscsiadm -m node -T <target_iqn> -p <iscsi_lif_ip> --login
    
    # List connected sessions:
    sudo iscsiadm -m session
  EOT
}