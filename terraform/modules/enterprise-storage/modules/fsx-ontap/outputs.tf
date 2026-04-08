#------------------------------------------------------------------------------
# FSx for NetApp ONTAP Submodule - Outputs
#------------------------------------------------------------------------------

output "file_system_id" {
  description = "FSx ONTAP file system ID"
  value       = try(aws_fsx_ontap_file_system.this[0].id, null)
}

output "file_system_arn" {
  description = "FSx ONTAP file system ARN"
  value       = try(aws_fsx_ontap_file_system.this[0].arn, null)
}

output "dns_name" {
  description = "DNS name for the file system management endpoint"
  value       = try(aws_fsx_ontap_file_system.this[0].dns_name, null)
}

output "endpoints" {
  description = "File system management and data endpoints"
  value       = try(aws_fsx_ontap_file_system.this[0].endpoints, null)
}

output "network_interface_ids" {
  description = "Network interface IDs for the file system"
  value       = try(aws_fsx_ontap_file_system.this[0].network_interface_ids, [])
}

output "vpc_id" {
  description = "VPC ID where the file system is deployed"
  value       = try(aws_fsx_ontap_file_system.this[0].vpc_id, null)
}

output "owner_id" {
  description = "AWS account ID that owns the file system"
  value       = try(aws_fsx_ontap_file_system.this[0].owner_id, null)
}

output "storage_capacity_gb" {
  description = "Storage capacity in GB"
  value       = try(aws_fsx_ontap_file_system.this[0].storage_capacity, null)
}

output "throughput_capacity_mbs" {
  description = "Throughput capacity in MB/s"
  value       = try(aws_fsx_ontap_file_system.this[0].throughput_capacity, null)
}

output "deployment_type" {
  description = "Deployment type of the file system"
  value       = try(aws_fsx_ontap_file_system.this[0].deployment_type, null)
}

output "ha_pairs" {
  description = "Number of HA pairs"
  value       = try(aws_fsx_ontap_file_system.this[0].ha_pairs, null)
}

output "kms_key_id" {
  description = "KMS key ID used for encryption"
  value       = try(aws_fsx_ontap_file_system.this[0].kms_key_id, null)
}

#------------------------------------------------------------------------------
# Storage Virtual Machine Outputs
#------------------------------------------------------------------------------

output "storage_virtual_machines" {
  description = "Map of Storage Virtual Machine details"
  value = {
    for name, svm in aws_fsx_ontap_storage_virtual_machine.this : name => {
      id                   = svm.id
      arn                  = svm.arn
      name                 = svm.name
      uuid                 = svm.uuid
      subtype              = svm.subtype
      endpoints            = svm.endpoints
      root_volume_security_style = svm.root_volume_security_style
    }
  }
}

output "svm_ids" {
  description = "Map of SVM names to IDs"
  value       = { for name, svm in aws_fsx_ontap_storage_virtual_machine.this : name => svm.id }
}

output "svm_endpoints" {
  description = "Map of SVM names to their endpoints"
  value       = { for name, svm in aws_fsx_ontap_storage_virtual_machine.this : name => svm.endpoints }
}

#------------------------------------------------------------------------------
# Volume Outputs
#------------------------------------------------------------------------------

output "volumes" {
  description = "Map of volume details"
  value = {
    for key, vol in aws_fsx_ontap_volume.this : key => {
      id                = vol.id
      arn               = vol.arn
      name              = vol.name
      uuid              = vol.uuid
      junction_path     = vol.junction_path
      size_in_megabytes = vol.size_in_megabytes
      security_style    = vol.security_style
      volume_type       = vol.ontap_volume_type
    }
  }
}

output "volume_ids" {
  description = "Map of volume keys to IDs"
  value       = { for key, vol in aws_fsx_ontap_volume.this : key => vol.id }
}

#------------------------------------------------------------------------------
# CloudWatch Alarm Outputs
#------------------------------------------------------------------------------

output "cloudwatch_alarm_arns" {
  description = "List of CloudWatch alarm ARNs"
  value = compact(concat(
    [
      try(aws_cloudwatch_metric_alarm.storage_capacity[0].arn, ""),
      try(aws_cloudwatch_metric_alarm.ssd_storage_capacity[0].arn, ""),
      try(aws_cloudwatch_metric_alarm.throughput[0].arn, ""),
      try(aws_cloudwatch_metric_alarm.disk_iops[0].arn, "")
    ],
    [for alarm in aws_cloudwatch_metric_alarm.svm_storage : alarm.arn]
  ))
}

#------------------------------------------------------------------------------
# Connection Information
#------------------------------------------------------------------------------

output "management_endpoint" {
  description = "ONTAP management endpoint"
  value       = try(aws_fsx_ontap_file_system.this[0].endpoints[0].management[0].dns_name, null)
}

output "intercluster_endpoint" {
  description = "ONTAP intercluster endpoint for SnapMirror"
  value       = try(aws_fsx_ontap_file_system.this[0].endpoints[0].intercluster[0].dns_name, null)
}

# NFS mount commands for each volume
output "nfs_mount_commands" {
  description = "NFS mount commands for each volume"
  value = {
    for key, vol in aws_fsx_ontap_volume.this : key => {
      for name, svm in aws_fsx_ontap_storage_virtual_machine.this : name =>
        "sudo mount -t nfs ${try(svm.endpoints[0].nfs[0].dns_name, "NFS_DNS")}:${vol.junction_path} /mnt/${vol.name}"
      if startswith(key, "${name}-")
    }
  }
}

# SMB mount information
output "smb_endpoints" {
  description = "SMB endpoints for each SVM with AD configured"
  value = {
    for name, svm in aws_fsx_ontap_storage_virtual_machine.this : name => {
      smb_dns = try(svm.endpoints[0].smb[0].dns_name, null)
      smb_ip  = try(svm.endpoints[0].smb[0].ip_addresses, [])
    }
  }
}

# iSCSI endpoint information
output "iscsi_endpoints" {
  description = "iSCSI endpoints for each SVM"
  value = {
    for name, svm in aws_fsx_ontap_storage_virtual_machine.this : name => {
      iscsi_dns = try(svm.endpoints[0].iscsi[0].dns_name, null)
      iscsi_ip  = try(svm.endpoints[0].iscsi[0].ip_addresses, [])
    }
  }
}