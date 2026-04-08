#------------------------------------------------------------------------------
# Shared Module - Outputs
#------------------------------------------------------------------------------

#------------------------------------------------------------------------------
# KMS Outputs
#------------------------------------------------------------------------------

output "kms_key_id" {
  description = "ID of the KMS key"
  value       = var.create_kms_key ? aws_kms_key.storage[0].id : var.kms_key_arn
}

output "kms_key_arn" {
  description = "ARN of the KMS key"
  value       = var.create_kms_key ? aws_kms_key.storage[0].arn : var.kms_key_arn
}

output "kms_key_alias_arn" {
  description = "ARN of the KMS key alias"
  value       = var.create_kms_key ? aws_kms_alias.storage[0].arn : null
}

output "kms_key_alias_name" {
  description = "Name of the KMS key alias"
  value       = var.create_kms_key ? aws_kms_alias.storage[0].name : null
}

output "kms_replica_key_arn" {
  description = "ARN of the replica KMS key"
  value       = var.create_kms_key && var.kms_multi_region && var.replica_region != null ? aws_kms_replica_key.storage[0].arn : null
}

#------------------------------------------------------------------------------
# Security Group Outputs
#------------------------------------------------------------------------------

output "fsx_windows_security_group_id" {
  description = "ID of FSx Windows security group"
  value       = var.create_fsx_windows_sg ? aws_security_group.fsx_windows[0].id : null
}

output "fsx_lustre_security_group_id" {
  description = "ID of FSx Lustre security group"
  value       = var.create_fsx_lustre_sg ? aws_security_group.fsx_lustre[0].id : null
}

output "fsx_ontap_security_group_id" {
  description = "ID of FSx ONTAP security group"
  value       = var.create_fsx_ontap_sg ? aws_security_group.fsx_ontap[0].id : null
}

output "fsx_openzfs_security_group_id" {
  description = "ID of FSx OpenZFS security group"
  value       = var.create_fsx_openzfs_sg ? aws_security_group.fsx_openzfs[0].id : null
}

output "efs_security_group_id" {
  description = "ID of EFS security group"
  value       = var.create_efs_sg ? aws_security_group.efs[0].id : null
}

output "storage_client_security_group_id" {
  description = "ID of storage client security group"
  value       = var.create_storage_client_sg ? aws_security_group.storage_client[0].id : null
}

output "all_security_group_ids" {
  description = "Map of all created security group IDs"
  value = {
    fsx_windows    = var.create_fsx_windows_sg ? aws_security_group.fsx_windows[0].id : null
    fsx_lustre     = var.create_fsx_lustre_sg ? aws_security_group.fsx_lustre[0].id : null
    fsx_ontap      = var.create_fsx_ontap_sg ? aws_security_group.fsx_ontap[0].id : null
    fsx_openzfs    = var.create_fsx_openzfs_sg ? aws_security_group.fsx_openzfs[0].id : null
    efs            = var.create_efs_sg ? aws_security_group.efs[0].id : null
    storage_client = var.create_storage_client_sg ? aws_security_group.storage_client[0].id : null
  }
}

#------------------------------------------------------------------------------
# IAM Outputs
#------------------------------------------------------------------------------

output "storage_admin_role_arn" {
  description = "ARN of storage admin IAM role"
  value       = var.create_storage_admin_role ? aws_iam_role.storage_admin[0].arn : null
}

output "storage_admin_role_name" {
  description = "Name of storage admin IAM role"
  value       = var.create_storage_admin_role ? aws_iam_role.storage_admin[0].name : null
}

output "storage_readonly_role_arn" {
  description = "ARN of storage read-only IAM role"
  value       = var.create_storage_readonly_role ? aws_iam_role.storage_readonly[0].arn : null
}

output "storage_readonly_role_name" {
  description = "Name of storage read-only IAM role"
  value       = var.create_storage_readonly_role ? aws_iam_role.storage_readonly[0].name : null
}

output "backup_role_arn" {
  description = "ARN of backup IAM role"
  value       = var.create_backup_role ? aws_iam_role.backup[0].arn : null
}

output "backup_role_name" {
  description = "Name of backup IAM role"
  value       = var.create_backup_role ? aws_iam_role.backup[0].name : null
}

output "ec2_client_role_arn" {
  description = "ARN of EC2 storage client IAM role"
  value       = var.create_ec2_client_role ? aws_iam_role.ec2_storage_client[0].arn : null
}

output "ec2_client_role_name" {
  description = "Name of EC2 storage client IAM role"
  value       = var.create_ec2_client_role ? aws_iam_role.ec2_storage_client[0].name : null
}

output "ec2_client_instance_profile_arn" {
  description = "ARN of EC2 storage client instance profile"
  value       = var.create_ec2_client_role ? aws_iam_instance_profile.ec2_storage_client[0].arn : null
}

output "ec2_client_instance_profile_name" {
  description = "Name of EC2 storage client instance profile"
  value       = var.create_ec2_client_role ? aws_iam_instance_profile.ec2_storage_client[0].name : null
}

output "all_iam_role_arns" {
  description = "Map of all created IAM role ARNs"
  value = {
    storage_admin    = var.create_storage_admin_role ? aws_iam_role.storage_admin[0].arn : null
    storage_readonly = var.create_storage_readonly_role ? aws_iam_role.storage_readonly[0].arn : null
    backup           = var.create_backup_role ? aws_iam_role.backup[0].arn : null
    ec2_client       = var.create_ec2_client_role ? aws_iam_role.ec2_storage_client[0].arn : null
  }
}

#------------------------------------------------------------------------------
# CloudWatch Outputs
#------------------------------------------------------------------------------

output "cloudwatch_dashboard_arn" {
  description = "ARN of CloudWatch dashboard"
  value       = var.create_dashboard ? aws_cloudwatch_dashboard.storage[0].dashboard_arn : null
}

output "cloudwatch_dashboard_name" {
  description = "Name of CloudWatch dashboard"
  value       = var.create_dashboard ? aws_cloudwatch_dashboard.storage[0].dashboard_name : null
}

output "cloudwatch_log_group_arn" {
  description = "ARN of CloudWatch log group"
  value       = var.create_log_group ? aws_cloudwatch_log_group.storage[0].arn : null
}

output "cloudwatch_log_group_name" {
  description = "Name of CloudWatch log group"
  value       = var.create_log_group ? aws_cloudwatch_log_group.storage[0].name : null
}

output "sns_topic_arn" {
  description = "ARN of SNS topic for alerts"
  value       = var.create_sns_topic ? aws_sns_topic.storage_alerts[0].arn : null
}

output "sns_topic_name" {
  description = "Name of SNS topic for alerts"
  value       = var.create_sns_topic ? aws_sns_topic.storage_alerts[0].name : null
}

output "composite_alarm_arn" {
  description = "ARN of composite storage health alarm"
  value       = var.create_composite_alarm && length(var.alarm_arns) > 0 ? aws_cloudwatch_composite_alarm.storage_health[0].arn : null
}

output "capacity_warning_alarm_arn" {
  description = "ARN of capacity warning alarm"
  value       = var.create_capacity_alarm ? aws_cloudwatch_metric_alarm.storage_capacity_warning[0].arn : null
}

output "capacity_critical_alarm_arn" {
  description = "ARN of capacity critical alarm"
  value       = var.create_capacity_alarm ? aws_cloudwatch_metric_alarm.storage_capacity_critical[0].arn : null
}

output "fsx_event_rule_arn" {
  description = "ARN of FSx event rule"
  value       = var.create_event_rules ? aws_cloudwatch_event_rule.fsx_events[0].arn : null
}

output "efs_event_rule_arn" {
  description = "ARN of EFS event rule"
  value       = var.create_event_rules ? aws_cloudwatch_event_rule.efs_events[0].arn : null
}

output "backup_event_rule_arn" {
  description = "ARN of backup event rule"
  value       = var.create_event_rules ? aws_cloudwatch_event_rule.backup_events[0].arn : null
}

#------------------------------------------------------------------------------
# Summary Outputs
#------------------------------------------------------------------------------

output "module_summary" {
  description = "Summary of all created resources"
  value = {
    kms = {
      key_created = var.create_kms_key
      key_arn     = var.create_kms_key ? aws_kms_key.storage[0].arn : var.kms_key_arn
      multi_region = var.kms_multi_region
    }
    security_groups = {
      fsx_windows_created    = var.create_fsx_windows_sg
      fsx_lustre_created     = var.create_fsx_lustre_sg
      fsx_ontap_created      = var.create_fsx_ontap_sg
      fsx_openzfs_created    = var.create_fsx_openzfs_sg
      efs_created            = var.create_efs_sg
      storage_client_created = var.create_storage_client_sg
    }
    iam = {
      admin_role_created    = var.create_storage_admin_role
      readonly_role_created = var.create_storage_readonly_role
      backup_role_created   = var.create_backup_role
      ec2_client_created    = var.create_ec2_client_role
    }
    cloudwatch = {
      dashboard_created   = var.create_dashboard
      log_group_created   = var.create_log_group
      sns_topic_created   = var.create_sns_topic
      event_rules_created = var.create_event_rules
    }
  }
}