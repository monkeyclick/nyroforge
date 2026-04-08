#------------------------------------------------------------------------------
# Enterprise Storage Module - Outputs
#------------------------------------------------------------------------------
# This file aggregates outputs from all submodules for integration
# with other infrastructure components.
#------------------------------------------------------------------------------

#------------------------------------------------------------------------------
# Shared Resources Outputs
#------------------------------------------------------------------------------

output "kms_key_id" {
  description = "ID of the KMS key used for storage encryption"
  value       = module.shared.kms_key_id
}

output "kms_key_arn" {
  description = "ARN of the KMS key used for storage encryption"
  value       = module.shared.kms_key_arn
}

output "kms_key_alias" {
  description = "Alias of the KMS key"
  value       = module.shared.kms_key_alias_name
}

#------------------------------------------------------------------------------
# Security Group Outputs
#------------------------------------------------------------------------------

output "security_groups" {
  description = "Map of all created security group IDs"
  value       = module.shared.all_security_group_ids
}

output "storage_client_security_group_id" {
  description = "Security group ID for storage clients (attach to EC2 instances)"
  value       = module.shared.storage_client_security_group_id
}

#------------------------------------------------------------------------------
# IAM Role Outputs
#------------------------------------------------------------------------------

output "iam_roles" {
  description = "Map of all created IAM role ARNs"
  value       = module.shared.all_iam_role_arns
}

output "storage_admin_role_arn" {
  description = "ARN of storage admin IAM role"
  value       = module.shared.storage_admin_role_arn
}

output "storage_readonly_role_arn" {
  description = "ARN of storage read-only IAM role"
  value       = module.shared.storage_readonly_role_arn
}

output "backup_role_arn" {
  description = "ARN of backup IAM role"
  value       = module.shared.backup_role_arn
}

output "ec2_client_instance_profile_arn" {
  description = "ARN of EC2 storage client instance profile"
  value       = module.shared.ec2_client_instance_profile_arn
}

output "ec2_client_instance_profile_name" {
  description = "Name of EC2 storage client instance profile"
  value       = module.shared.ec2_client_instance_profile_name
}

#------------------------------------------------------------------------------
# CloudWatch Outputs
#------------------------------------------------------------------------------

output "cloudwatch_dashboard_name" {
  description = "Name of CloudWatch dashboard"
  value       = module.shared.cloudwatch_dashboard_name
}

output "cloudwatch_log_group_name" {
  description = "Name of CloudWatch log group"
  value       = module.shared.cloudwatch_log_group_name
}

output "sns_topic_arn" {
  description = "ARN of SNS topic for storage alerts"
  value       = module.shared.sns_topic_arn
}

#------------------------------------------------------------------------------
# FSx for Windows File Server Outputs
#------------------------------------------------------------------------------

output "fsx_windows" {
  description = "FSx for Windows File Server outputs"
  value = local.enable_fsx_windows ? {
    file_system_id    = module.fsx_windows[0].file_system_id
    file_system_arn   = module.fsx_windows[0].file_system_arn
    dns_name          = module.fsx_windows[0].dns_name
    preferred_file_server_ip = try(module.fsx_windows[0].preferred_file_server_ip, null)
    remote_administration_endpoint = try(module.fsx_windows[0].remote_administration_endpoint, null)
    network_interface_ids = try(module.fsx_windows[0].network_interface_ids, [])
    
    # Mount information
    mount_command_windows = "net use Z: \\\\${module.fsx_windows[0].dns_name}\\share"
  } : null
}

output "fsx_windows_file_system_id" {
  description = "FSx Windows file system ID"
  value       = local.enable_fsx_windows ? module.fsx_windows[0].file_system_id : null
}

output "fsx_windows_dns_name" {
  description = "FSx Windows DNS name for mounting"
  value       = local.enable_fsx_windows ? module.fsx_windows[0].dns_name : null
}

#------------------------------------------------------------------------------
# FSx for Lustre Outputs
#------------------------------------------------------------------------------

output "fsx_lustre" {
  description = "FSx for Lustre outputs"
  value = local.enable_fsx_lustre ? {
    file_system_id  = module.fsx_lustre[0].file_system_id
    file_system_arn = module.fsx_lustre[0].file_system_arn
    dns_name        = module.fsx_lustre[0].dns_name
    mount_name      = module.fsx_lustre[0].mount_name
    network_interface_ids = try(module.fsx_lustre[0].network_interface_ids, [])
    
    # S3 integration
    data_repository_association_ids = try(module.fsx_lustre[0].data_repository_association_ids, [])
    
    # Mount information
    mount_command_linux = "sudo mount -t lustre ${module.fsx_lustre[0].dns_name}@tcp:/${module.fsx_lustre[0].mount_name} /mnt/fsx"
  } : null
}

output "fsx_lustre_file_system_id" {
  description = "FSx Lustre file system ID"
  value       = local.enable_fsx_lustre ? module.fsx_lustre[0].file_system_id : null
}

output "fsx_lustre_dns_name" {
  description = "FSx Lustre DNS name for mounting"
  value       = local.enable_fsx_lustre ? module.fsx_lustre[0].dns_name : null
}

output "fsx_lustre_mount_name" {
  description = "FSx Lustre mount name"
  value       = local.enable_fsx_lustre ? module.fsx_lustre[0].mount_name : null
}

#------------------------------------------------------------------------------
# FSx for NetApp ONTAP Outputs
#------------------------------------------------------------------------------

output "fsx_ontap" {
  description = "FSx for NetApp ONTAP outputs"
  value = local.enable_fsx_ontap ? {
    file_system_id  = module.fsx_ontap[0].file_system_id
    file_system_arn = module.fsx_ontap[0].file_system_arn
    dns_name        = try(module.fsx_ontap[0].dns_name, null)
    
    # Management endpoints
    management_endpoints = try(module.fsx_ontap[0].management_endpoints, {})
    
    # SVMs
    storage_virtual_machines = try(module.fsx_ontap[0].storage_virtual_machines, {})
    svm_endpoints            = try(module.fsx_ontap[0].svm_endpoints, {})
    
    # Volumes
    volumes = try(module.fsx_ontap[0].volumes, {})
    
    # Network
    inter_cluster_endpoints = try(module.fsx_ontap[0].inter_cluster_endpoints, [])
    
    # Mount examples
    nfs_mount_example = "sudo mount -t nfs <svm-dns>:/vol_name /mnt/ontap"
    smb_mount_example = "net use Z: \\\\<svm-dns>\\share"
  } : null
}

output "fsx_ontap_file_system_id" {
  description = "FSx ONTAP file system ID"
  value       = local.enable_fsx_ontap ? module.fsx_ontap[0].file_system_id : null
}

output "fsx_ontap_svm_ids" {
  description = "Map of FSx ONTAP SVM names to IDs"
  value       = local.enable_fsx_ontap ? try(module.fsx_ontap[0].storage_virtual_machines, {}) : {}
}

#------------------------------------------------------------------------------
# FSx for OpenZFS Outputs
#------------------------------------------------------------------------------

output "fsx_openzfs" {
  description = "FSx for OpenZFS outputs"
  value = local.enable_fsx_openzfs ? {
    file_system_id  = module.fsx_openzfs[0].file_system_id
    file_system_arn = module.fsx_openzfs[0].file_system_arn
    dns_name        = module.fsx_openzfs[0].dns_name
    root_volume_id  = module.fsx_openzfs[0].root_volume_id
    
    # Additional volumes
    volumes = try(module.fsx_openzfs[0].volumes, {})
    
    # Network
    network_interface_ids = try(module.fsx_openzfs[0].network_interface_ids, [])
    
    # Mount information
    mount_command_linux = "sudo mount -t nfs ${module.fsx_openzfs[0].dns_name}:/fsx /mnt/openzfs"
  } : null
}

output "fsx_openzfs_file_system_id" {
  description = "FSx OpenZFS file system ID"
  value       = local.enable_fsx_openzfs ? module.fsx_openzfs[0].file_system_id : null
}

output "fsx_openzfs_dns_name" {
  description = "FSx OpenZFS DNS name for mounting"
  value       = local.enable_fsx_openzfs ? module.fsx_openzfs[0].dns_name : null
}

#------------------------------------------------------------------------------
# Amazon EFS Outputs
#------------------------------------------------------------------------------

output "efs" {
  description = "Amazon EFS outputs"
  value = local.enable_efs ? {
    file_system_id  = module.efs[0].file_system_id
    file_system_arn = module.efs[0].file_system_arn
    dns_name        = module.efs[0].dns_name
    
    # Mount targets
    mount_target_ids         = try(module.efs[0].mount_target_ids, [])
    mount_target_dns_names   = try(module.efs[0].mount_target_dns_names, [])
    mount_target_ip_addresses = try(module.efs[0].mount_target_ip_addresses, [])
    
    # Access points
    access_point_ids  = try(module.efs[0].access_point_ids, {})
    access_point_arns = try(module.efs[0].access_point_arns, {})
    
    # Replication
    replication_destination_file_system_id = try(module.efs[0].replication_destination_file_system_id, null)
    
    # Mount information
    mount_command_linux     = "sudo mount -t efs ${module.efs[0].file_system_id}:/ /mnt/efs"
    mount_command_with_tls  = "sudo mount -t efs -o tls ${module.efs[0].file_system_id}:/ /mnt/efs"
    mount_via_dns           = "sudo mount -t nfs4 -o nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2 ${module.efs[0].dns_name}:/ /mnt/efs"
  } : null
}

output "efs_file_system_id" {
  description = "EFS file system ID"
  value       = local.enable_efs ? module.efs[0].file_system_id : null
}

output "efs_dns_name" {
  description = "EFS DNS name for mounting"
  value       = local.enable_efs ? module.efs[0].dns_name : null
}

output "efs_access_point_ids" {
  description = "Map of EFS access point names to IDs"
  value       = local.enable_efs ? try(module.efs[0].access_point_ids, {}) : {}
}

#------------------------------------------------------------------------------
# NetApp Cloud Volumes ONTAP Outputs
#------------------------------------------------------------------------------

output "netapp_cloud_volumes" {
  description = "NetApp Cloud Volumes ONTAP outputs"
  value = local.enable_netapp_cvo ? {
    working_environment_id   = try(module.netapp_cloud_volumes[0].working_environment_id, null)
    working_environment_name = try(module.netapp_cloud_volumes[0].working_environment_name, null)
    svm_name                 = try(module.netapp_cloud_volumes[0].svm_name, null)
    
    # Network
    cluster_management_ip    = try(module.netapp_cloud_volumes[0].cluster_management_ip, null)
    iscsi_data_ip            = try(module.netapp_cloud_volumes[0].iscsi_data_ip, null)
    nfs_data_ip              = try(module.netapp_cloud_volumes[0].nfs_data_ip, null)
    cifs_data_ip             = try(module.netapp_cloud_volumes[0].cifs_data_ip, null)
    
    # Security groups
    security_group_id        = try(module.netapp_cloud_volumes[0].security_group_id, null)
    
    # IAM
    iam_role_arn             = try(module.netapp_cloud_volumes[0].iam_role_arn, null)
    
    # S3 tiering bucket
    tiering_bucket_name      = try(module.netapp_cloud_volumes[0].tiering_bucket_name, null)
  } : null
}

#------------------------------------------------------------------------------
# Pure Storage Cloud Block Store Outputs
#------------------------------------------------------------------------------

output "pure_storage" {
  description = "Pure Storage Cloud Block Store outputs"
  value = local.enable_pure_storage ? {
    array_id            = try(module.pure_storage[0].array_id, null)
    array_name          = try(module.pure_storage[0].array_name, null)
    management_endpoint = try(module.pure_storage[0].management_endpoint, null)
    
    # Network
    iscsi_endpoints     = try(module.pure_storage[0].iscsi_endpoints, [])
    nvme_endpoints      = try(module.pure_storage[0].nvme_endpoints, [])
    
    # Security
    security_group_id   = try(module.pure_storage[0].security_group_id, null)
    
    # IAM
    iam_role_arn        = try(module.pure_storage[0].iam_role_arn, null)
    
    # Volumes
    volumes             = try(module.pure_storage[0].volumes, {})
    
    # Host groups
    host_groups         = try(module.pure_storage[0].host_groups, {})
  } : null
}

#------------------------------------------------------------------------------
# Portworx Outputs
#------------------------------------------------------------------------------

output "portworx" {
  description = "Portworx enterprise storage outputs"
  value = local.enable_portworx ? {
    cluster_id          = try(module.portworx[0].cluster_id, null)
    cluster_uuid        = try(module.portworx[0].cluster_uuid, null)
    namespace           = try(module.portworx[0].namespace, null)
    
    # Storage classes
    storage_class_names = try(module.portworx[0].storage_class_names, [])
    
    # Backup
    backup_location_name = try(module.portworx[0].backup_location_name, null)
    
    # IAM
    iam_role_arn        = try(module.portworx[0].iam_role_arn, null)
    
    # S3 bucket
    cloud_drive_bucket  = try(module.portworx[0].cloud_drive_bucket, null)
    
    # Usage examples
    pvc_example = <<-EOT
      apiVersion: v1
      kind: PersistentVolumeClaim
      metadata:
        name: my-pvc
      spec:
        storageClassName: px-db
        accessModes:
          - ReadWriteOnce
        resources:
          requests:
            storage: 10Gi
    EOT
  } : null
}

output "portworx_storage_classes" {
  description = "List of Portworx storage class names"
  value       = local.enable_portworx ? try(module.portworx[0].storage_class_names, []) : []
}

#------------------------------------------------------------------------------
# MinIO Outputs
#------------------------------------------------------------------------------

output "minio" {
  description = "MinIO S3-compatible storage outputs"
  value = local.enable_minio ? {
    tenant_name         = try(module.minio[0].tenant_name, null)
    namespace           = try(module.minio[0].namespace, null)
    
    # Endpoints
    api_endpoint        = try(module.minio[0].api_endpoint, null)
    console_endpoint    = try(module.minio[0].console_endpoint, null)
    
    # TLS
    tls_enabled         = try(module.minio[0].tls_enabled, false)
    
    # Buckets
    bucket_names        = try(module.minio[0].bucket_names, [])
    
    # Service accounts
    service_account_names = try(module.minio[0].service_account_names, [])
    
    # Usage examples
    aws_cli_example = <<-EOT
      # Configure AWS CLI for MinIO
      aws configure set aws_access_key_id <access_key>
      aws configure set aws_secret_access_key <secret_key>
      
      # Use with --endpoint-url
      aws --endpoint-url ${try(module.minio[0].api_endpoint, "http://minio:9000")} s3 ls
    EOT
    
    mc_config_example = <<-EOT
      # Configure MinIO Client
      mc alias set myminio ${try(module.minio[0].api_endpoint, "http://minio:9000")} <access_key> <secret_key>
      mc ls myminio
    EOT
  } : null
}

output "minio_api_endpoint" {
  description = "MinIO API endpoint URL"
  value       = local.enable_minio ? try(module.minio[0].api_endpoint, null) : null
}

output "minio_console_endpoint" {
  description = "MinIO Console endpoint URL"
  value       = local.enable_minio ? try(module.minio[0].console_endpoint, null) : null
}

#------------------------------------------------------------------------------
# AWS Backup Outputs
#------------------------------------------------------------------------------

output "backup_vault_arn" {
  description = "ARN of AWS Backup vault"
  value       = var.backup_config.enabled && var.backup_config.create_vault ? aws_backup_vault.storage[0].arn : null
}

output "backup_vault_name" {
  description = "Name of AWS Backup vault"
  value       = var.backup_config.enabled && var.backup_config.create_vault ? aws_backup_vault.storage[0].name : null
}

output "backup_plan_id" {
  description = "ID of AWS Backup plan"
  value       = var.backup_config.enabled ? aws_backup_plan.storage[0].id : null
}

output "backup_plan_arn" {
  description = "ARN of AWS Backup plan"
  value       = var.backup_config.enabled ? aws_backup_plan.storage[0].arn : null
}

#------------------------------------------------------------------------------
# Summary Output
#------------------------------------------------------------------------------

output "storage_summary" {
  description = "Summary of all deployed storage solutions"
  value = {
    project_name = var.project_name
    environment  = var.environment
    
    enabled_storage_types = {
      fsx_windows     = local.enable_fsx_windows
      fsx_lustre      = local.enable_fsx_lustre
      fsx_ontap       = local.enable_fsx_ontap
      fsx_openzfs     = local.enable_fsx_openzfs
      efs             = local.enable_efs
      netapp_cvo      = local.enable_netapp_cvo
      pure_storage    = local.enable_pure_storage
      portworx        = local.enable_portworx
      minio           = local.enable_minio
    }
    
    aws_storage = {
      fsx_windows_id  = local.enable_fsx_windows ? module.fsx_windows[0].file_system_id : null
      fsx_lustre_id   = local.enable_fsx_lustre ? module.fsx_lustre[0].file_system_id : null
      fsx_ontap_id    = local.enable_fsx_ontap ? module.fsx_ontap[0].file_system_id : null
      fsx_openzfs_id  = local.enable_fsx_openzfs ? module.fsx_openzfs[0].file_system_id : null
      efs_id          = local.enable_efs ? module.efs[0].file_system_id : null
    }
    
    third_party_storage = {
      netapp_cvo_enabled   = local.enable_netapp_cvo
      pure_storage_enabled = local.enable_pure_storage
      portworx_enabled     = local.enable_portworx
      minio_enabled        = local.enable_minio
    }
    
    security = {
      kms_key_id                   = module.shared.kms_key_id
      storage_client_sg_id         = module.shared.storage_client_security_group_id
      backup_role_arn              = module.shared.backup_role_arn
      ec2_client_instance_profile  = module.shared.ec2_client_instance_profile_name
    }
    
    monitoring = {
      cloudwatch_dashboard = module.shared.cloudwatch_dashboard_name
      cloudwatch_log_group = module.shared.cloudwatch_log_group_name
      sns_alert_topic      = module.shared.sns_topic_arn
    }
    
    backup = {
      enabled    = var.backup_config.enabled
      vault_name = var.backup_config.enabled && var.backup_config.create_vault ? aws_backup_vault.storage[0].name : null
      plan_id    = var.backup_config.enabled ? aws_backup_plan.storage[0].id : null
    }
  }
}

#------------------------------------------------------------------------------
# Connection Information Output
#------------------------------------------------------------------------------

output "connection_info" {
  description = "Connection information for all storage systems"
  sensitive   = false
  value = {
    fsx_windows = local.enable_fsx_windows ? {
      type      = "SMB"
      dns_name  = module.fsx_windows[0].dns_name
      mount_cmd = "net use Z: \\\\${module.fsx_windows[0].dns_name}\\share"
    } : null
    
    fsx_lustre = local.enable_fsx_lustre ? {
      type       = "Lustre"
      dns_name   = module.fsx_lustre[0].dns_name
      mount_name = module.fsx_lustre[0].mount_name
      mount_cmd  = "sudo mount -t lustre ${module.fsx_lustre[0].dns_name}@tcp:/${module.fsx_lustre[0].mount_name} /mnt/fsx"
    } : null
    
    fsx_ontap = local.enable_fsx_ontap ? {
      type              = "Multi-protocol (NFS/SMB/iSCSI)"
      file_system_id    = module.fsx_ontap[0].file_system_id
      nfs_mount_example = "sudo mount -t nfs <svm-dns>:/vol_name /mnt/ontap"
      smb_mount_example = "net use Z: \\\\<svm-dns>\\share"
    } : null
    
    fsx_openzfs = local.enable_fsx_openzfs ? {
      type      = "NFS (OpenZFS)"
      dns_name  = module.fsx_openzfs[0].dns_name
      mount_cmd = "sudo mount -t nfs ${module.fsx_openzfs[0].dns_name}:/fsx /mnt/openzfs"
    } : null
    
    efs = local.enable_efs ? {
      type              = "NFS (EFS)"
      file_system_id    = module.efs[0].file_system_id
      dns_name          = module.efs[0].dns_name
      mount_cmd_efs     = "sudo mount -t efs ${module.efs[0].file_system_id}:/ /mnt/efs"
      mount_cmd_nfs_tls = "sudo mount -t efs -o tls ${module.efs[0].file_system_id}:/ /mnt/efs"
    } : null
    
    minio = local.enable_minio ? {
      type             = "S3-compatible"
      api_endpoint     = try(module.minio[0].api_endpoint, null)
      console_endpoint = try(module.minio[0].console_endpoint, null)
    } : null
  }
}