#------------------------------------------------------------------------------
# Enterprise Storage Module - Input Variables
# 
# Comprehensive configuration options for AWS FSx, EFS, and third-party
# storage solutions with validation rules and sensible defaults.
#------------------------------------------------------------------------------

#------------------------------------------------------------------------------
# General Configuration
#------------------------------------------------------------------------------

variable "environment" {
  description = "Environment name (e.g., dev, staging, production)"
  type        = string

  validation {
    condition     = contains(["dev", "development", "staging", "uat", "prod", "production"], lower(var.environment))
    error_message = "Environment must be one of: dev, development, staging, uat, prod, production."
  }
}

variable "project_name" {
  description = "Project name for resource naming and tagging"
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,28}[a-z0-9]$", var.project_name))
    error_message = "Project name must be 3-30 characters, start with a letter, end with alphanumeric, and contain only lowercase letters, numbers, and hyphens."
  }
}

variable "aws_region" {
  description = "AWS region for resource deployment"
  type        = string
  default     = "us-east-1"

  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]+$", var.aws_region))
    error_message = "AWS region must be a valid region format (e.g., us-east-1, eu-west-2)."
  }
}

variable "vpc_id" {
  description = "VPC ID for storage resources deployment"
  type        = string

  validation {
    condition     = can(regex("^vpc-[a-f0-9]{8,17}$", var.vpc_id))
    error_message = "VPC ID must be a valid format (vpc-xxxxxxxx or vpc-xxxxxxxxxxxxxxxxx)."
  }
}

variable "subnet_ids" {
  description = "List of subnet IDs for storage resource deployment"
  type        = list(string)

  validation {
    condition     = length(var.subnet_ids) >= 1
    error_message = "At least one subnet ID must be provided."
  }

  validation {
    condition     = alltrue([for s in var.subnet_ids : can(regex("^subnet-[a-f0-9]{8,17}$", s))])
    error_message = "All subnet IDs must be valid format (subnet-xxxxxxxx or subnet-xxxxxxxxxxxxxxxxx)."
  }
}

variable "tags" {
  description = "Common tags to apply to all resources"
  type        = map(string)
  default     = {}
}

variable "cost_center" {
  description = "Cost center for billing and cost allocation"
  type        = string
  default     = ""
}

variable "owner" {
  description = "Owner email or team name for resource ownership"
  type        = string
  default     = ""
}

#------------------------------------------------------------------------------
# Encryption Configuration
#------------------------------------------------------------------------------

variable "kms_key_id" {
  description = "Existing KMS key ID for encryption. If not provided, a new key will be created."
  type        = string
  default     = null
}

variable "create_kms_key" {
  description = "Whether to create a new KMS key for storage encryption"
  type        = bool
  default     = true
}

variable "kms_key_deletion_window" {
  description = "KMS key deletion window in days (7-30)"
  type        = number
  default     = 30

  validation {
    condition     = var.kms_key_deletion_window >= 7 && var.kms_key_deletion_window <= 30
    error_message = "KMS key deletion window must be between 7 and 30 days."
  }
}

variable "kms_key_rotation_enabled" {
  description = "Enable automatic KMS key rotation"
  type        = bool
  default     = true
}

variable "kms_key_administrators" {
  description = "List of IAM ARNs that can administer the KMS key"
  type        = list(string)
  default     = []
}

variable "kms_key_users" {
  description = "List of IAM ARNs that can use the KMS key"
  type        = list(string)
  default     = []
}

#------------------------------------------------------------------------------
# FSx for Windows File Server Configuration
#------------------------------------------------------------------------------

variable "enable_fsx_windows" {
  description = "Enable FSx for Windows File Server deployment"
  type        = bool
  default     = false
}

variable "fsx_windows_config" {
  description = "Configuration for FSx for Windows File Server"
  type = object({
    # Basic configuration
    storage_capacity_gb     = number
    throughput_capacity_mbs = number
    deployment_type         = string
    storage_type           = string

    # Active Directory configuration
    active_directory_id              = optional(string)
    self_managed_active_directory    = optional(object({
      dns_ips                                = list(string)
      domain_name                            = string
      username                               = string
      password                               = string
      file_system_administrators_group       = optional(string, "Domain Admins")
      organizational_unit_distinguished_name = optional(string)
    }))

    # Performance configuration
    automatic_backup_retention_days = optional(number, 7)
    daily_automatic_backup_start_time = optional(string, "02:00")
    weekly_maintenance_start_time   = optional(string, "sat:03:00")
    copy_tags_to_backups           = optional(bool, true)

    # Storage configuration
    preferred_subnet_id = optional(string)
    aliases            = optional(list(string), [])

    # Audit logging
    audit_log_destination = optional(string)

    # Disk IOPS configuration (for SSD storage)
    disk_iops_configuration = optional(object({
      mode = string
      iops = optional(number)
    }))
  })

  default = {
    storage_capacity_gb     = 300
    throughput_capacity_mbs = 64
    deployment_type         = "SINGLE_AZ_2"
    storage_type           = "SSD"
  }

  validation {
    condition     = var.fsx_windows_config.storage_capacity_gb >= 32 && var.fsx_windows_config.storage_capacity_gb <= 65536
    error_message = "FSx Windows storage capacity must be between 32 GB and 65,536 GB."
  }

  validation {
    condition     = contains([8, 16, 32, 64, 128, 256, 512, 1024, 2048], var.fsx_windows_config.throughput_capacity_mbs)
    error_message = "FSx Windows throughput capacity must be one of: 8, 16, 32, 64, 128, 256, 512, 1024, 2048 MB/s."
  }

  validation {
    condition     = contains(["SINGLE_AZ_1", "SINGLE_AZ_2", "MULTI_AZ_1"], var.fsx_windows_config.deployment_type)
    error_message = "FSx Windows deployment type must be one of: SINGLE_AZ_1, SINGLE_AZ_2, MULTI_AZ_1."
  }

  validation {
    condition     = contains(["SSD", "HDD"], var.fsx_windows_config.storage_type)
    error_message = "FSx Windows storage type must be SSD or HDD."
  }
}

#------------------------------------------------------------------------------
# FSx for Lustre Configuration
#------------------------------------------------------------------------------

variable "enable_fsx_lustre" {
  description = "Enable FSx for Lustre deployment"
  type        = bool
  default     = false
}

variable "fsx_lustre_config" {
  description = "Configuration for FSx for Lustre"
  type = object({
    # Basic configuration
    storage_capacity_gb = number
    deployment_type     = string
    storage_type       = optional(string, "SSD")

    # Performance configuration
    per_unit_storage_throughput = optional(number)
    drive_cache_type           = optional(string)

    # Data repository configuration for S3 integration
    import_path               = optional(string)
    export_path              = optional(string)
    imported_file_chunk_size = optional(number, 1024)
    auto_import_policy       = optional(string)

    # Data repository associations (multiple S3 paths)
    data_repository_associations = optional(list(object({
      file_system_path         = string
      data_repository_path     = string
      batch_import_meta_data_on_create = optional(bool, false)
      imported_file_chunk_size = optional(number, 1024)
      s3_auto_export_policy    = optional(object({
        events = list(string)
      }))
      s3_auto_import_policy    = optional(object({
        events = list(string)
      }))
    })), [])

    # Backup configuration
    automatic_backup_retention_days = optional(number, 0)
    daily_automatic_backup_start_time = optional(string)
    copy_tags_to_backups           = optional(bool, true)

    # Maintenance
    weekly_maintenance_start_time = optional(string, "sat:03:00")

    # File system configuration
    data_compression_type = optional(string, "NONE")

    # Logging
    log_configuration = optional(object({
      destination = string
      level       = string
    }))

    # Root squash configuration
    root_squash_configuration = optional(object({
      root_squash     = string
      no_squash_nids = optional(list(string), [])
    }))
  })

  default = {
    storage_capacity_gb = 1200
    deployment_type     = "PERSISTENT_2"
    storage_type       = "SSD"
  }

  validation {
    condition = (
      var.fsx_lustre_config.deployment_type == "SCRATCH_1" ? var.fsx_lustre_config.storage_capacity_gb >= 1200 && var.fsx_lustre_config.storage_capacity_gb % 3600 == 0 || var.fsx_lustre_config.storage_capacity_gb == 1200 :
      var.fsx_lustre_config.deployment_type == "SCRATCH_2" ? var.fsx_lustre_config.storage_capacity_gb >= 1200 && var.fsx_lustre_config.storage_capacity_gb % 2400 == 0 || var.fsx_lustre_config.storage_capacity_gb == 1200 :
      var.fsx_lustre_config.storage_capacity_gb >= 1200
    )
    error_message = "FSx Lustre storage capacity must be at least 1200 GB with specific increment requirements based on deployment type."
  }

  validation {
    condition     = contains(["SCRATCH_1", "SCRATCH_2", "PERSISTENT_1", "PERSISTENT_2"], var.fsx_lustre_config.deployment_type)
    error_message = "FSx Lustre deployment type must be one of: SCRATCH_1, SCRATCH_2, PERSISTENT_1, PERSISTENT_2."
  }

  validation {
    condition     = var.fsx_lustre_config.data_compression_type == null || contains(["NONE", "LZ4"], var.fsx_lustre_config.data_compression_type)
    error_message = "FSx Lustre data compression type must be NONE or LZ4."
  }
}

#------------------------------------------------------------------------------
# FSx for NetApp ONTAP Configuration
#------------------------------------------------------------------------------

variable "enable_fsx_ontap" {
  description = "Enable FSx for NetApp ONTAP deployment"
  type        = bool
  default     = false
}

variable "fsx_ontap_config" {
  description = "Configuration for FSx for NetApp ONTAP"
  type = object({
    # File system configuration
    storage_capacity_gb       = number
    throughput_capacity_mbs   = number
    deployment_type          = string
    ha_pairs                 = optional(number, 1)
    preferred_subnet_id      = optional(string)
    endpoint_ip_address_range = optional(string)

    # Disk configuration
    disk_iops_configuration = optional(object({
      mode = string
      iops = optional(number)
    }))

    # Backup configuration
    automatic_backup_retention_days   = optional(number, 7)
    daily_automatic_backup_start_time = optional(string, "02:00")
    weekly_maintenance_start_time     = optional(string, "sat:03:00")

    # Route table IDs for Multi-AZ
    route_table_ids = optional(list(string), [])

    # Storage Virtual Machines (SVMs)
    storage_virtual_machines = optional(list(object({
      name                       = string
      root_volume_security_style = optional(string, "UNIX")

      # Active Directory configuration for SMB
      active_directory_configuration = optional(object({
        netbios_name = string
        self_managed_active_directory_configuration = optional(object({
          dns_ips                                = list(string)
          domain_name                            = string
          username                               = string
          password                               = string
          file_system_administrators_group       = optional(string, "Domain Admins")
          organizational_unit_distinguished_name = optional(string)
        }))
      }))

      # Volumes for this SVM
      volumes = optional(list(object({
        name                       = string
        junction_path             = string
        size_in_megabytes         = number
        storage_efficiency_enabled = optional(bool, true)
        security_style            = optional(string, "UNIX")
        tiering_policy = optional(object({
          name           = string
          cooling_period = optional(number)
        }))
        ontap_volume_type = optional(string, "RW")
        snapshot_policy   = optional(string)
        copy_tags_to_backups = optional(bool, true)

        # NFS export configuration
        nfs_exports = optional(list(object({
          client_configurations = list(object({
            clients = string
            options = list(string)
          }))
        })), [])
      })), [])
    })), [])
  })

  default = {
    storage_capacity_gb     = 1024
    throughput_capacity_mbs = 128
    deployment_type         = "MULTI_AZ_1"
  }

  validation {
    condition     = var.fsx_ontap_config.storage_capacity_gb >= 1024 && var.fsx_ontap_config.storage_capacity_gb <= 196608
    error_message = "FSx ONTAP storage capacity must be between 1,024 GB and 196,608 GB."
  }

  validation {
    condition     = contains([128, 256, 512, 1024, 2048, 4096], var.fsx_ontap_config.throughput_capacity_mbs)
    error_message = "FSx ONTAP throughput capacity must be one of: 128, 256, 512, 1024, 2048, 4096 MB/s."
  }

  validation {
    condition     = contains(["SINGLE_AZ_1", "SINGLE_AZ_2", "MULTI_AZ_1", "MULTI_AZ_2"], var.fsx_ontap_config.deployment_type)
    error_message = "FSx ONTAP deployment type must be one of: SINGLE_AZ_1, SINGLE_AZ_2, MULTI_AZ_1, MULTI_AZ_2."
  }
}

#------------------------------------------------------------------------------
# FSx for OpenZFS Configuration
#------------------------------------------------------------------------------

variable "enable_fsx_openzfs" {
  description = "Enable FSx for OpenZFS deployment"
  type        = bool
  default     = false
}

variable "fsx_openzfs_config" {
  description = "Configuration for FSx for OpenZFS"
  type = object({
    # File system configuration
    storage_capacity_gb     = number
    throughput_capacity_mbs = number
    deployment_type         = string
    preferred_subnet_id     = optional(string)

    # Disk configuration
    disk_iops_configuration = optional(object({
      mode = string
      iops = optional(number)
    }))

    # Root volume configuration
    root_volume_configuration = optional(object({
      data_compression_type   = optional(string, "ZSTD")
      read_only              = optional(bool, false)
      record_size_kib        = optional(number, 128)
      copy_tags_to_snapshots = optional(bool, true)

      nfs_exports = optional(object({
        client_configurations = list(object({
          clients = string
          options = list(string)
        }))
      }))

      user_and_group_quotas = optional(list(object({
        id                         = number
        storage_capacity_quota_gib = number
        type                       = string
      })), [])
    }))

    # Backup configuration
    automatic_backup_retention_days   = optional(number, 7)
    daily_automatic_backup_start_time = optional(string, "02:00")
    weekly_maintenance_start_time     = optional(string, "sat:03:00")
    copy_tags_to_backups             = optional(bool, true)
    copy_tags_to_volumes             = optional(bool, true)

    # Route table IDs for Multi-AZ
    route_table_ids = optional(list(string), [])

    # Additional volumes
    volumes = optional(list(object({
      name                    = string
      parent_volume_id        = optional(string)
      data_compression_type   = optional(string, "ZSTD")
      read_only              = optional(bool, false)
      record_size_kib        = optional(number, 128)
      storage_capacity_quota_gib = optional(number)
      storage_capacity_reservation_gib = optional(number)
      copy_tags_to_snapshots = optional(bool, true)

      nfs_exports = optional(object({
        client_configurations = list(object({
          clients = string
          options = list(string)
        }))
      }))

      user_and_group_quotas = optional(list(object({
        id                         = number
        storage_capacity_quota_gib = number
        type                       = string
      })), [])

      origin_snapshot = optional(object({
        snapshot_arn    = string
        copy_strategy   = string
      }))
    })), [])
  })

  default = {
    storage_capacity_gb     = 64
    throughput_capacity_mbs = 64
    deployment_type         = "SINGLE_AZ_1"
  }

  validation {
    condition     = var.fsx_openzfs_config.storage_capacity_gb >= 64 && var.fsx_openzfs_config.storage_capacity_gb <= 524288
    error_message = "FSx OpenZFS storage capacity must be between 64 GB and 524,288 GB."
  }

  validation {
    condition     = contains([64, 128, 256, 512, 1024, 2048, 3072, 4096], var.fsx_openzfs_config.throughput_capacity_mbs)
    error_message = "FSx OpenZFS throughput capacity must be one of: 64, 128, 256, 512, 1024, 2048, 3072, 4096 MB/s."
  }

  validation {
    condition     = contains(["SINGLE_AZ_1", "SINGLE_AZ_2", "MULTI_AZ_1"], var.fsx_openzfs_config.deployment_type)
    error_message = "FSx OpenZFS deployment type must be one of: SINGLE_AZ_1, SINGLE_AZ_2, MULTI_AZ_1."
  }
}

#------------------------------------------------------------------------------
# AWS EFS Configuration
#------------------------------------------------------------------------------

variable "enable_efs" {
  description = "Enable AWS EFS deployment"
  type        = bool
  default     = false
}

variable "efs_config" {
  description = "Configuration for AWS Elastic File System"
  type = object({
    # Performance configuration
    performance_mode                = optional(string, "generalPurpose")
    throughput_mode                = optional(string, "bursting")
    provisioned_throughput_in_mibps = optional(number)

    # Availability and durability
    availability_zone_name = optional(string)

    # Lifecycle management
    lifecycle_policies = optional(list(object({
      transition_to_ia                    = optional(string)
      transition_to_primary_storage_class = optional(string)
      transition_to_archive               = optional(string)
    })), [])

    # Backup
    enable_backup_policy = optional(bool, true)

    # Mount targets configuration
    mount_target_subnet_ids = optional(list(string))

    # Access points
    access_points = optional(list(object({
      name = string
      posix_user = optional(object({
        gid            = number
        uid            = number
        secondary_gids = optional(list(number))
      }))
      root_directory = optional(object({
        path = string
        creation_info = optional(object({
          owner_gid   = number
          owner_uid   = number
          permissions = string
        }))
      }))
    })), [])

    # Replication configuration
    replication_configuration = optional(object({
      destination = object({
        region                 = optional(string)
        availability_zone_name = optional(string)
        kms_key_id            = optional(string)
        file_system_id        = optional(string)
      })
    }))

    # File system policy
    enable_file_system_policy = optional(bool, false)
    file_system_policy_bypass_policy_lockout_safety_check = optional(bool, false)
  })

  default = {
    performance_mode = "generalPurpose"
    throughput_mode = "bursting"
  }

  validation {
    condition     = contains(["generalPurpose", "maxIO"], var.efs_config.performance_mode)
    error_message = "EFS performance mode must be generalPurpose or maxIO."
  }

  validation {
    condition     = contains(["bursting", "provisioned", "elastic"], var.efs_config.throughput_mode)
    error_message = "EFS throughput mode must be bursting, provisioned, or elastic."
  }

  validation {
    condition = (
      var.efs_config.throughput_mode != "provisioned" ||
      (var.efs_config.provisioned_throughput_in_mibps != null && 
       var.efs_config.provisioned_throughput_in_mibps >= 1 && 
       var.efs_config.provisioned_throughput_in_mibps <= 3414)
    )
    error_message = "When throughput mode is provisioned, provisioned_throughput_in_mibps must be between 1 and 3414."
  }
}

#------------------------------------------------------------------------------
# Third-Party Storage: NetApp Cloud Volumes ONTAP Configuration
#------------------------------------------------------------------------------

variable "enable_netapp_cloud_volumes" {
  description = "Enable NetApp Cloud Volumes ONTAP deployment"
  type        = bool
  default     = false
}

variable "netapp_cloud_volumes_config" {
  description = "Configuration for NetApp Cloud Volumes ONTAP"
  type = object({
    # Deployment configuration
    name                    = string
    instance_type          = string
    license_type           = string
    deployment_mode        = string
    capacity_tier         = optional(string, "S3")
    capacity_tier_level   = optional(string, "normal")
    
    # Network configuration
    client_subnet_id       = optional(string)
    iscsi_subnet_id       = optional(string)
    nas_subnet_ids        = optional(list(string))
    
    # Storage configuration
    aggregate_name        = optional(string, "aggr1")
    ebs_volume_type      = optional(string, "gp3")
    ebs_volume_size_gb   = optional(number, 500)
    disk_count           = optional(number, 1)
    
    # High Availability configuration (for HA deployments)
    ha_node1_availability_zone = optional(string)
    ha_node2_availability_zone = optional(string)
    mediator_subnet_id        = optional(string)
    
    # ONTAP configuration
    ontap_version         = optional(string)
    use_latest_version   = optional(bool, true)
    
    # Storage Virtual Machines
    svms = optional(list(object({
      name                    = string
      root_volume_security_style = optional(string, "unix")
      
      volumes = optional(list(object({
        name                = string
        size_gb             = number
        junction_path       = string
        security_style      = optional(string, "unix")
        snapshot_policy     = optional(string, "default")
        tiering_policy      = optional(string, "snapshot-only")
        export_policy_name  = optional(string)
      })), [])
    })), [])
    
    # Cloud Manager/BlueXP connector
    connector_id          = optional(string)
    workspace_id          = optional(string)
  })

  default = {
    name            = "cvo"
    instance_type   = "m5.2xlarge"
    license_type    = "capacity-paygo"
    deployment_mode = "single_node"
  }

  validation {
    condition     = contains(["single_node", "ha"], var.netapp_cloud_volumes_config.deployment_mode)
    error_message = "NetApp Cloud Volumes deployment mode must be single_node or ha."
  }

  validation {
    condition = contains([
      "explore-paygo", "standard-paygo", "premium-paygo", "capacity-paygo",
      "explore-byol", "standard-byol", "premium-byol", "capacity-byol",
      "ha-explore-paygo", "ha-standard-paygo", "ha-premium-paygo", "ha-capacity-paygo",
      "ha-explore-byol", "ha-standard-byol", "ha-premium-byol", "ha-capacity-byol"
    ], var.netapp_cloud_volumes_config.license_type)
    error_message = "Invalid NetApp Cloud Volumes license type."
  }
}

#------------------------------------------------------------------------------
# Third-Party Storage: Pure Storage Cloud Block Store Configuration
#------------------------------------------------------------------------------

variable "enable_pure_storage_cbs" {
  description = "Enable Pure Storage Cloud Block Store deployment"
  type        = bool
  default     = false
}

variable "pure_storage_cbs_config" {
  description = "Configuration for Pure Storage Cloud Block Store"
  type = object({
    # Deployment configuration
    array_name            = string
    deployment_type       = string
    capacity_tb          = number
    
    # Network configuration
    management_subnet_id  = string
    iscsi_subnet_id      = string
    replication_subnet_id = optional(string)
    
    # Performance configuration
    performance_class     = optional(string, "standard")
    
    # High availability
    availability_zone     = optional(string)
    
    # Pure1 integration
    pure1_api_token      = optional(string)
    
    # Protocol configuration
    iscsi_enabled        = optional(bool, true)
    nvme_enabled         = optional(bool, false)
    
    # Host groups
    host_groups = optional(list(object({
      name  = string
      hosts = list(object({
        name = string
        iqn  = optional(string)
        nqn  = optional(string)
      }))
    })), [])
    
    # Volumes
    volumes = optional(list(object({
      name          = string
      size_gb       = number
      host_group    = optional(string)
      protection_group = optional(string)
    })), [])
    
    # Protection groups for snapshots/replication
    protection_groups = optional(list(object({
      name = string
      source_volumes = list(string)
      replication_schedule = optional(object({
        frequency_seconds   = number
        blackout_start_time = optional(string)
        blackout_end_time   = optional(string)
      }))
      snapshot_schedule = optional(object({
        frequency_seconds = number
        retain_count     = number
      }))
    })), [])
  })

  default = {
    array_name      = "cbs"
    deployment_type = "standard"
    capacity_tb     = 50
    management_subnet_id = ""
    iscsi_subnet_id     = ""
  }

  validation {
    condition     = contains(["standard", "premium"], var.pure_storage_cbs_config.deployment_type)
    error_message = "Pure Storage CBS deployment type must be standard or premium."
  }

  validation {
    condition     = var.pure_storage_cbs_config.capacity_tb >= 50 && var.pure_storage_cbs_config.capacity_tb <= 4000
    error_message = "Pure Storage CBS capacity must be between 50 TB and 4000 TB."
  }
}

#------------------------------------------------------------------------------
# Third-Party Storage: Portworx Enterprise Configuration
#------------------------------------------------------------------------------

variable "enable_portworx" {
  description = "Enable Portworx enterprise storage for Kubernetes"
  type        = bool
  default     = false
}

variable "portworx_config" {
  description = "Configuration for Portworx enterprise storage"
  type = object({
    # Deployment configuration
    cluster_name          = string
    namespace            = optional(string, "portworx")
    version              = optional(string, "3.0")
    
    # License configuration
    license_type         = string
    license_key          = optional(string)
    
    # Storage configuration
    storage_type         = optional(string, "cloud")
    cloud_storage_type   = optional(string, "gp3")
    storage_device_size_gb = optional(number, 150)
    max_storage_nodes    = optional(number, 3)
    
    # Kubernetes cluster configuration
    kubernetes_version   = optional(string)
    enable_stork        = optional(bool, true)
    enable_lighthouse   = optional(bool, true)
    enable_autopilot    = optional(bool, false)
    
    # Security configuration
    enable_security     = optional(bool, true)
    enable_csi          = optional(bool, true)
    
    # Network configuration
    data_interface      = optional(string)
    management_interface = optional(string)
    
    # Storage classes
    storage_classes = optional(list(object({
      name                    = string
      replication_factor     = optional(number, 3)
      io_profile            = optional(string, "auto")
      priority              = optional(string, "high")
      secure                = optional(bool, true)
      journal               = optional(bool, false)
      sharedv4              = optional(bool, false)
      fs_type               = optional(string, "ext4")
      allow_volume_expansion = optional(bool, true)
    })), [])
    
    # Backup configuration
    enable_backup        = optional(bool, true)
    backup_location_type = optional(string, "s3")
    backup_s3_bucket    = optional(string)
    backup_s3_region    = optional(string)
    
    # Monitoring
    enable_prometheus    = optional(bool, true)
    enable_grafana      = optional(bool, true)
  })

  default = {
    cluster_name = "portworx"
    license_type = "px-enterprise"
  }

  validation {
    condition     = contains(["px-essentials", "px-enterprise", "px-enterprise-dr"], var.portworx_config.license_type)
    error_message = "Portworx license type must be px-essentials, px-enterprise, or px-enterprise-dr."
  }

  validation {
    condition     = var.portworx_config.storage_device_size_gb >= 50 && var.portworx_config.storage_device_size_gb <= 16000
    error_message = "Portworx storage device size must be between 50 GB and 16,000 GB."
  }
}

#------------------------------------------------------------------------------
# Third-Party Storage: MinIO S3-Compatible Configuration
#------------------------------------------------------------------------------

variable "enable_minio" {
  description = "Enable MinIO S3-compatible object storage deployment"
  type        = bool
  default     = false
}

variable "minio_config" {
  description = "Configuration for MinIO S3-compatible object storage"
  type = object({
    # Deployment configuration
    deployment_name      = string
    deployment_mode     = string
    namespace           = optional(string, "minio")
    version             = optional(string, "RELEASE.2024-01-01T00-00-00Z")
    
    # Cluster configuration
    replicas            = optional(number, 4)
    drives_per_node     = optional(number, 4)
    storage_class       = optional(string, "gp3")
    storage_size_gb     = optional(number, 100)
    
    # Resource configuration
    cpu_requests        = optional(string, "2")
    cpu_limits          = optional(string, "4")
    memory_requests     = optional(string, "4Gi")
    memory_limits       = optional(string, "8Gi")
    
    # Security configuration
    root_user           = optional(string, "minioadmin")
    root_password       = optional(string)
    enable_tls          = optional(bool, true)
    certificate_secret  = optional(string)
    
    # Bucket configuration
    buckets = optional(list(object({
      name           = string
      policy         = optional(string, "none")
      versioning     = optional(bool, false)
      object_locking = optional(bool, false)
      quota_gb       = optional(number)
    })), [])
    
    # IAM configuration
    policies = optional(list(object({
      name       = string
      statements = list(object({
        effect    = string
        actions   = list(string)
        resources = list(string)
      }))
    })), [])
    
    users = optional(list(object({
      access_key = string
      secret_key = string
      policies   = list(string)
    })), [])
    
    # Replication configuration
    enable_replication  = optional(bool, false)
    replication_target  = optional(object({
      endpoint    = string
      access_key  = string
      secret_key  = string
      bucket      = string
      region      = optional(string, "us-east-1")
    }))
    
    # Monitoring configuration
    enable_prometheus   = optional(bool, true)
    enable_console      = optional(bool, true)
    console_port       = optional(number, 9001)
    
    # Network configuration
    service_type       = optional(string, "ClusterIP")
    ingress_enabled    = optional(bool, false)
    ingress_host       = optional(string)
  })

  default = {
    deployment_name = "minio"
    deployment_mode = "distributed"
  }

  validation {
    condition     = contains(["standalone", "distributed"], var.minio_config.deployment_mode)
    error_message = "MinIO deployment mode must be standalone or distributed."
  }

  validation {
    condition     = var.minio_config.deployment_mode == "standalone" || (var.minio_config.replicas >= 4 && var.minio_config.replicas <= 32)
    error_message = "MinIO distributed mode requires between 4 and 32 replicas."
  }
}

#------------------------------------------------------------------------------
# Security Group Configuration
#------------------------------------------------------------------------------

variable "create_security_groups" {
  description = "Whether to create security groups for storage resources"
  type        = bool
  default     = true
}

variable "allowed_cidr_blocks" {
  description = "List of CIDR blocks allowed to access storage resources"
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for cidr in var.allowed_cidr_blocks : can(cidrhost(cidr, 0))])
    error_message = "All CIDR blocks must be valid IPv4 CIDR notation."
  }
}

variable "allowed_security_group_ids" {
  description = "List of security group IDs allowed to access storage resources"
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for sg in var.allowed_security_group_ids : can(regex("^sg-[a-f0-9]{8,17}$", sg))])
    error_message = "All security group IDs must be valid format (sg-xxxxxxxx or sg-xxxxxxxxxxxxxxxxx)."
  }
}

#------------------------------------------------------------------------------
# Backup and Snapshot Configuration
#------------------------------------------------------------------------------

variable "backup_config" {
  description = "Backup configuration for storage resources"
  type = object({
    enabled                 = bool
    retention_days         = number
    daily_backup_time      = string
    enable_cross_region    = bool
    cross_region_destination = optional(string)
    enable_vault_lock      = optional(bool, false)
    
    # AWS Backup vault configuration
    create_backup_vault    = optional(bool, true)
    backup_vault_name      = optional(string)
    
    # Backup schedule
    schedule_expression    = optional(string, "cron(0 2 * * ? *)")
    
    # Lifecycle rules
    cold_storage_after_days = optional(number, 90)
    delete_after_days       = optional(number, 365)
  })

  default = {
    enabled                 = true
    retention_days         = 30
    daily_backup_time      = "02:00"
    enable_cross_region    = false
  }

  validation {
    condition     = var.backup_config.retention_days >= 1 && var.backup_config.retention_days <= 35
    error_message = "Backup retention days must be between 1 and 35 for FSx automatic backups."
  }

  validation {
    condition     = can(regex("^([01][0-9]|2[0-3]):[0-5][0-9]$", var.backup_config.daily_backup_time))
    error_message = "Daily backup time must be in HH:MM format."
  }
}

#------------------------------------------------------------------------------
# Monitoring and Alerting Configuration
#------------------------------------------------------------------------------

variable "monitoring_config" {
  description = "CloudWatch monitoring and alerting configuration"
  type = object({
    enabled                    = bool
    create_dashboard          = bool
    dashboard_name            = optional(string)
    
    # Alarm configuration
    enable_alarms             = bool
    alarm_actions             = optional(list(string), [])
    ok_actions                = optional(list(string), [])
    insufficient_data_actions = optional(list(string), [])
    
    # Storage utilization alarms
    storage_utilization_threshold = optional(number, 80)
    storage_critical_threshold    = optional(number, 95)
    
    # Performance alarms
    iops_threshold               = optional(number, 90)
    throughput_threshold_percent = optional(number, 80)
    latency_threshold_ms         = optional(number, 20)
    
    # Log retention
    log_retention_days           = optional(number, 30)
    
    # Custom metrics
    enable_custom_metrics        = optional(bool, false)
    custom_metrics_namespace     = optional(string, "EnterpriseStorage")
  })

  default = {
    enabled           = true
    create_dashboard  = true
    enable_alarms     = true
  }

  validation {
    condition     = var.monitoring_config.storage_utilization_threshold >= 50 && var.monitoring_config.storage_utilization_threshold <= 99
    error_message = "Storage utilization threshold must be between 50 and 99 percent."
  }
}

#------------------------------------------------------------------------------
# IAM Configuration
#------------------------------------------------------------------------------

variable "iam_config" {
  description = "IAM configuration for storage access control"
  type = object({
    create_roles              = bool
    create_policies           = bool
    
    # Role configuration
    admin_role_name          = optional(string)
    readonly_role_name       = optional(string)
    
    # Policy configuration
    enable_resource_policies = optional(bool, true)
    
    # Cross-account access
    trusted_account_ids      = optional(list(string), [])
    
    # Service-linked roles
    create_service_linked_roles = optional(bool, true)
  })

  default = {
    create_roles    = true
    create_policies = true
  }
}

#------------------------------------------------------------------------------
# Cross-Region Replication Configuration
#------------------------------------------------------------------------------

variable "replication_config" {
  description = "Cross-region replication configuration for disaster recovery"
  type = object({
    enabled              = bool
    destination_region   = optional(string)
    destination_kms_key  = optional(string)
    
    # Replication schedules
    replication_interval_minutes = optional(number, 60)
    
    # Failover configuration
    enable_auto_failover = optional(bool, false)
    failover_threshold_minutes = optional(number, 30)
    
    # RPO/RTO targets
    target_rpo_minutes   = optional(number, 60)
    target_rto_minutes   = optional(number, 120)
  })

  default = {
    enabled = false
  }

  validation {
    condition = (
      !var.replication_config.enabled ||
      (var.replication_config.destination_region != null && 
       can(regex("^[a-z]{2}-[a-z]+-[0-9]+$", var.replication_config.destination_region)))
    )
    error_message = "When replication is enabled, destination region must be specified in valid format."
  }
}