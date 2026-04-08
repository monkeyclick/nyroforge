#------------------------------------------------------------------------------
# Enterprise Storage Module - Main Orchestration
#------------------------------------------------------------------------------
# This module orchestrates the deployment of enterprise storage solutions
# across AWS FSx, EFS, and third-party platforms.
#------------------------------------------------------------------------------

locals {
  # Common tags to apply to all resources
  common_tags = merge(
    var.tags,
    {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
      Module      = "enterprise-storage"
    }
  )

  # Determine which storage types are enabled
  enable_fsx_windows     = var.fsx_windows_config != null && var.fsx_windows_config.enabled
  enable_fsx_lustre      = var.fsx_lustre_config != null && var.fsx_lustre_config.enabled
  enable_fsx_ontap       = var.fsx_ontap_config != null && var.fsx_ontap_config.enabled
  enable_fsx_openzfs     = var.fsx_openzfs_config != null && var.fsx_openzfs_config.enabled
  enable_efs             = var.efs_config != null && var.efs_config.enabled
  enable_netapp_cvo      = var.netapp_cloud_volumes_config != null && var.netapp_cloud_volumes_config.enabled
  enable_pure_storage    = var.pure_storage_config != null && var.pure_storage_config.enabled
  enable_portworx        = var.portworx_config != null && var.portworx_config.enabled
  enable_minio           = var.minio_config != null && var.minio_config.enabled

  # Determine which security groups to create
  create_fsx_windows_sg = local.enable_fsx_windows
  create_fsx_lustre_sg  = local.enable_fsx_lustre
  create_fsx_ontap_sg   = local.enable_fsx_ontap
  create_fsx_openzfs_sg = local.enable_fsx_openzfs
  create_efs_sg         = local.enable_efs
}

#------------------------------------------------------------------------------
# Data Sources
#------------------------------------------------------------------------------

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

#------------------------------------------------------------------------------
# Shared Resources Module
#------------------------------------------------------------------------------

module "shared" {
  source = "./modules/shared"

  project_name = var.project_name
  environment  = var.environment
  tags         = local.common_tags
  vpc_id       = var.vpc_id

  # KMS Configuration
  create_kms_key           = var.encryption_config.create_kms_key
  kms_key_arn              = var.encryption_config.kms_key_arn
  kms_key_deletion_window  = var.encryption_config.key_deletion_window_days
  kms_key_rotation_enabled = var.encryption_config.enable_key_rotation
  kms_multi_region         = var.encryption_config.multi_region
  replica_region           = var.replication_config != null ? var.replication_config.target_region : null
  kms_key_administrators   = var.encryption_config.key_administrators
  kms_key_users            = var.encryption_config.key_users
  enable_backup_grants     = var.backup_config.enabled

  # Security Group Configuration
  create_fsx_windows_sg      = local.create_fsx_windows_sg
  create_fsx_lustre_sg       = local.create_fsx_lustre_sg
  create_fsx_ontap_sg        = local.create_fsx_ontap_sg
  create_fsx_openzfs_sg      = local.create_fsx_openzfs_sg
  create_efs_sg              = local.create_efs_sg
  create_storage_client_sg   = var.create_storage_client_sg
  allowed_cidr_blocks        = var.security_config.allowed_cidr_blocks
  allowed_security_group_ids = var.security_config.allowed_security_group_ids
  management_cidr_blocks     = var.security_config.management_cidr_blocks
  replication_cidr_blocks    = var.replication_config != null ? var.replication_config.source_cidr_blocks : []

  # IAM Configuration
  create_storage_admin_role    = var.create_iam_roles
  create_storage_readonly_role = var.create_iam_roles
  create_backup_role           = var.backup_config.enabled && var.create_iam_roles
  create_ec2_client_role       = var.create_iam_roles
  trusted_account_ids          = var.trusted_account_ids
  require_mfa                  = var.require_mfa_for_admin

  # CloudWatch Configuration
  create_dashboard        = var.monitoring_config.create_dashboard
  dashboard_name          = var.monitoring_config.dashboard_name
  include_fsx_metrics     = local.enable_fsx_windows || local.enable_fsx_lustre || local.enable_fsx_ontap || local.enable_fsx_openzfs
  include_efs_metrics     = local.enable_efs
  create_log_group        = var.monitoring_config.create_log_group
  log_retention_days      = var.monitoring_config.log_retention_days
  create_sns_topic        = var.monitoring_config.create_sns_topic
  alert_email_addresses   = var.monitoring_config.alert_email_addresses
  create_event_rules      = var.monitoring_config.create_event_rules
  create_capacity_alarm   = var.monitoring_config.capacity_alarm_enabled
  capacity_warning_threshold  = var.monitoring_config.capacity_warning_threshold
  capacity_critical_threshold = var.monitoring_config.capacity_critical_threshold
}

#------------------------------------------------------------------------------
# FSx for Windows File Server
#------------------------------------------------------------------------------

module "fsx_windows" {
  source = "./modules/fsx-windows"
  count  = local.enable_fsx_windows ? 1 : 0

  project_name = var.project_name
  environment  = var.environment
  tags         = local.common_tags

  # Network Configuration
  subnet_ids         = var.fsx_windows_config.subnet_ids
  security_group_ids = concat(
    [module.shared.fsx_windows_security_group_id],
    var.fsx_windows_config.additional_security_group_ids
  )

  # Storage Configuration
  storage_capacity    = var.fsx_windows_config.storage_capacity_gb
  storage_type        = var.fsx_windows_config.storage_type
  throughput_capacity = var.fsx_windows_config.throughput_capacity

  # Active Directory Configuration
  active_directory_id               = var.fsx_windows_config.active_directory_id
  self_managed_ad_dns_ips           = var.fsx_windows_config.self_managed_ad_config != null ? var.fsx_windows_config.self_managed_ad_config.dns_ips : null
  self_managed_ad_domain_name       = var.fsx_windows_config.self_managed_ad_config != null ? var.fsx_windows_config.self_managed_ad_config.domain_name : null
  self_managed_ad_username          = var.fsx_windows_config.self_managed_ad_config != null ? var.fsx_windows_config.self_managed_ad_config.username : null
  self_managed_ad_password          = var.fsx_windows_config.self_managed_ad_config != null ? var.fsx_windows_config.self_managed_ad_config.password : null
  self_managed_ad_organizational_unit = var.fsx_windows_config.self_managed_ad_config != null ? var.fsx_windows_config.self_managed_ad_config.organizational_unit_distinguished_name : null
  self_managed_ad_file_system_administrators_group = var.fsx_windows_config.self_managed_ad_config != null ? var.fsx_windows_config.self_managed_ad_config.file_system_administrators_group : null

  # Backup Configuration
  automatic_backup_retention_days = var.fsx_windows_config.automatic_backup_retention_days
  daily_automatic_backup_start_time = var.fsx_windows_config.daily_automatic_backup_start_time
  copy_tags_to_backups           = var.fsx_windows_config.copy_tags_to_backups
  skip_final_backup              = var.fsx_windows_config.skip_final_backup

  # Encryption
  kms_key_id = module.shared.kms_key_id

  # Additional Options
  deployment_type                     = var.fsx_windows_config.deployment_type
  preferred_subnet_id                 = var.fsx_windows_config.preferred_subnet_id
  weekly_maintenance_start_time       = var.fsx_windows_config.weekly_maintenance_start_time
  aliases                             = var.fsx_windows_config.aliases
  audit_log_destination               = var.fsx_windows_config.audit_log_destination
}

#------------------------------------------------------------------------------
# FSx for Lustre
#------------------------------------------------------------------------------

module "fsx_lustre" {
  source = "./modules/fsx-lustre"
  count  = local.enable_fsx_lustre ? 1 : 0

  project_name = var.project_name
  environment  = var.environment
  tags         = local.common_tags

  # Network Configuration
  subnet_ids         = var.fsx_lustre_config.subnet_ids
  security_group_ids = concat(
    [module.shared.fsx_lustre_security_group_id],
    var.fsx_lustre_config.additional_security_group_ids
  )

  # Storage Configuration
  storage_capacity    = var.fsx_lustre_config.storage_capacity_gb
  storage_type        = var.fsx_lustre_config.storage_type
  deployment_type     = var.fsx_lustre_config.deployment_type
  per_unit_storage_throughput = var.fsx_lustre_config.per_unit_storage_throughput

  # S3 Data Repository Configuration
  import_path                         = var.fsx_lustre_config.s3_import_path
  export_path                         = var.fsx_lustre_config.s3_export_path
  imported_file_chunk_size            = var.fsx_lustre_config.imported_file_chunk_size
  auto_import_policy                  = var.fsx_lustre_config.auto_import_policy
  data_repository_associations        = var.fsx_lustre_config.data_repository_associations

  # Backup Configuration
  automatic_backup_retention_days     = var.fsx_lustre_config.automatic_backup_retention_days
  daily_automatic_backup_start_time   = var.fsx_lustre_config.daily_automatic_backup_start_time
  copy_tags_to_backups                = var.fsx_lustre_config.copy_tags_to_backups

  # Encryption
  kms_key_id = module.shared.kms_key_id

  # Performance Configuration
  drive_cache_type              = var.fsx_lustre_config.drive_cache_type
  data_compression_type         = var.fsx_lustre_config.data_compression_type
  weekly_maintenance_start_time = var.fsx_lustre_config.weekly_maintenance_start_time
  file_system_type_version      = var.fsx_lustre_config.file_system_type_version

  # Logging
  log_destination               = var.fsx_lustre_config.log_destination
  log_level                     = var.fsx_lustre_config.log_level
}

#------------------------------------------------------------------------------
# FSx for NetApp ONTAP
#------------------------------------------------------------------------------

module "fsx_ontap" {
  source = "./modules/fsx-ontap"
  count  = local.enable_fsx_ontap ? 1 : 0

  project_name = var.project_name
  environment  = var.environment
  tags         = local.common_tags

  # Network Configuration
  subnet_ids                = var.fsx_ontap_config.subnet_ids
  preferred_subnet_id       = var.fsx_ontap_config.preferred_subnet_id
  security_group_ids        = concat(
    [module.shared.fsx_ontap_security_group_id],
    var.fsx_ontap_config.additional_security_group_ids
  )
  route_table_ids           = var.fsx_ontap_config.route_table_ids
  endpoint_ip_address_range = var.fsx_ontap_config.endpoint_ip_address_range

  # Storage Configuration
  storage_capacity          = var.fsx_ontap_config.storage_capacity_gb
  storage_type              = var.fsx_ontap_config.storage_type
  throughput_capacity       = var.fsx_ontap_config.throughput_capacity
  deployment_type           = var.fsx_ontap_config.deployment_type
  ha_pairs                  = var.fsx_ontap_config.ha_pairs

  # Disk IOPS Configuration
  disk_iops_configuration_mode = var.fsx_ontap_config.disk_iops_mode
  disk_iops_configuration_iops = var.fsx_ontap_config.disk_iops

  # Backup Configuration
  automatic_backup_retention_days   = var.fsx_ontap_config.automatic_backup_retention_days
  daily_automatic_backup_start_time = var.fsx_ontap_config.daily_automatic_backup_start_time

  # Encryption
  kms_key_id = module.shared.kms_key_id

  # Maintenance
  weekly_maintenance_start_time = var.fsx_ontap_config.weekly_maintenance_start_time

  # SVMs and Volumes
  storage_virtual_machines = var.fsx_ontap_config.storage_virtual_machines
  volumes                  = var.fsx_ontap_config.volumes
}

#------------------------------------------------------------------------------
# FSx for OpenZFS
#------------------------------------------------------------------------------

module "fsx_openzfs" {
  source = "./modules/fsx-openzfs"
  count  = local.enable_fsx_openzfs ? 1 : 0

  project_name = var.project_name
  environment  = var.environment
  tags         = local.common_tags

  # Network Configuration
  subnet_ids         = var.fsx_openzfs_config.subnet_ids
  security_group_ids = concat(
    [module.shared.fsx_openzfs_security_group_id],
    var.fsx_openzfs_config.additional_security_group_ids
  )

  # Storage Configuration
  storage_capacity          = var.fsx_openzfs_config.storage_capacity_gb
  storage_type              = var.fsx_openzfs_config.storage_type
  throughput_capacity       = var.fsx_openzfs_config.throughput_capacity
  deployment_type           = var.fsx_openzfs_config.deployment_type

  # Disk IOPS Configuration
  disk_iops_configuration_mode = var.fsx_openzfs_config.disk_iops_mode
  disk_iops_configuration_iops = var.fsx_openzfs_config.disk_iops

  # Root Volume Configuration
  root_volume_data_compression_type = var.fsx_openzfs_config.data_compression_type
  root_volume_read_only             = var.fsx_openzfs_config.root_volume_read_only
  root_volume_record_size_kib       = var.fsx_openzfs_config.root_volume_record_size_kib
  root_volume_nfs_exports           = var.fsx_openzfs_config.root_volume_nfs_exports
  root_volume_user_and_group_quotas = var.fsx_openzfs_config.root_volume_user_and_group_quotas

  # Backup Configuration
  automatic_backup_retention_days   = var.fsx_openzfs_config.automatic_backup_retention_days
  daily_automatic_backup_start_time = var.fsx_openzfs_config.daily_automatic_backup_start_time
  copy_tags_to_backups              = var.fsx_openzfs_config.copy_tags_to_backups
  copy_tags_to_volumes              = var.fsx_openzfs_config.copy_tags_to_volumes
  skip_final_backup                 = var.fsx_openzfs_config.skip_final_backup

  # Encryption
  kms_key_id = module.shared.kms_key_id

  # Maintenance
  weekly_maintenance_start_time = var.fsx_openzfs_config.weekly_maintenance_start_time

  # Additional Volumes
  volumes = var.fsx_openzfs_config.volumes
}

#------------------------------------------------------------------------------
# Amazon EFS
#------------------------------------------------------------------------------

module "efs" {
  source = "./modules/efs"
  count  = local.enable_efs ? 1 : 0

  project_name = var.project_name
  environment  = var.environment
  tags         = local.common_tags

  # Performance Configuration
  performance_mode                = var.efs_config.performance_mode
  throughput_mode                 = var.efs_config.throughput_mode
  provisioned_throughput_in_mibps = var.efs_config.provisioned_throughput_in_mibps

  # Encryption
  encrypted  = true
  kms_key_id = module.shared.kms_key_id

  # Lifecycle Configuration
  lifecycle_policies = var.efs_config.lifecycle_policies

  # Mount Targets
  subnet_ids         = var.efs_config.subnet_ids
  security_group_ids = concat(
    [module.shared.efs_security_group_id],
    var.efs_config.additional_security_group_ids
  )

  # Access Points
  access_points = var.efs_config.access_points

  # File System Policy
  enable_policy           = var.efs_config.enable_policy
  bypass_policy_lockout   = var.efs_config.bypass_policy_lockout
  policy_statements       = var.efs_config.policy_statements

  # Backup
  enable_backup = var.efs_config.enable_backup

  # Replication
  enable_replication      = var.efs_config.enable_replication
  replication_region      = var.efs_config.replication_region
  replication_kms_key_id  = var.efs_config.replication_kms_key_id
}

#------------------------------------------------------------------------------
# NetApp Cloud Volumes ONTAP
#------------------------------------------------------------------------------

module "netapp_cloud_volumes" {
  source = "./modules/netapp-cloud-volumes"
  count  = local.enable_netapp_cvo ? 1 : 0

  project_name = var.project_name
  environment  = var.environment
  tags         = local.common_tags

  # Network Configuration
  vpc_id                    = var.vpc_id
  subnet_id                 = var.netapp_cloud_volumes_config.subnet_id
  additional_subnet_id      = var.netapp_cloud_volumes_config.additional_subnet_id
  mediator_subnet_id        = var.netapp_cloud_volumes_config.mediator_subnet_id
  route_table_ids           = var.netapp_cloud_volumes_config.route_table_ids
  mediator_route_table_ids  = var.netapp_cloud_volumes_config.mediator_route_table_ids

  # Instance Configuration
  instance_type             = var.netapp_cloud_volumes_config.instance_type
  license_type              = var.netapp_cloud_volumes_config.license_type
  deployment_type           = var.netapp_cloud_volumes_config.deployment_type
  use_dedicated_instance    = var.netapp_cloud_volumes_config.use_dedicated_instance

  # Storage Configuration
  capacity_tier             = var.netapp_cloud_volumes_config.capacity_tier
  tiering_policy            = var.netapp_cloud_volumes_config.tiering_policy
  ebs_volume_type           = var.netapp_cloud_volumes_config.ebs_volume_type
  ebs_volume_size_gb        = var.netapp_cloud_volumes_config.ebs_volume_size_gb
  capacity_package_name     = var.netapp_cloud_volumes_config.capacity_package_name
  provided_license          = var.netapp_cloud_volumes_config.provided_license

  # Write Speed and Features
  writing_speed_state       = var.netapp_cloud_volumes_config.writing_speed_state
  is_ha                     = var.netapp_cloud_volumes_config.is_ha
  failover_mode             = var.netapp_cloud_volumes_config.failover_mode
  node1_floating_ip         = var.netapp_cloud_volumes_config.node1_floating_ip
  node2_floating_ip         = var.netapp_cloud_volumes_config.node2_floating_ip
  data_floating_ip1         = var.netapp_cloud_volumes_config.data_floating_ip1
  data_floating_ip2         = var.netapp_cloud_volumes_config.data_floating_ip2
  svm_floating_ip           = var.netapp_cloud_volumes_config.svm_floating_ip

  # SVM Admin Credentials
  svm_password              = var.netapp_cloud_volumes_config.svm_password

  # Encryption
  kms_key_id                = module.shared.kms_key_id
  encrypt_volumes           = true

  # Security
  allowed_cidr_blocks       = var.security_config.allowed_cidr_blocks
  allowed_security_group_ids = var.security_config.allowed_security_group_ids

  # Cloud Manager Configuration
  cloud_manager_connector_id = var.netapp_cloud_volumes_config.cloud_manager_connector_id
  refresh_token              = var.netapp_cloud_volumes_config.refresh_token
  client_id                  = var.netapp_cloud_volumes_config.client_id
}

#------------------------------------------------------------------------------
# Pure Storage Cloud Block Store
#------------------------------------------------------------------------------

module "pure_storage" {
  source = "./modules/pure-storage-cbs"
  count  = local.enable_pure_storage ? 1 : 0

  project_name = var.project_name
  environment  = var.environment
  tags         = local.common_tags

  # Network Configuration
  vpc_id                        = var.vpc_id
  subnet_ids                    = var.pure_storage_config.subnet_ids
  system_subnet_id              = var.pure_storage_config.system_subnet_id
  iscsi_subnet_id               = var.pure_storage_config.iscsi_subnet_id
  replication_subnet_id         = var.pure_storage_config.replication_subnet_id
  management_subnet_id          = var.pure_storage_config.management_subnet_id

  # Array Configuration
  array_name                    = var.pure_storage_config.array_name
  purity_version                = var.pure_storage_config.purity_version
  license_key                   = var.pure_storage_config.license_key

  # Deployment Configuration
  deployment_type               = var.pure_storage_config.deployment_type
  az_count                      = var.pure_storage_config.az_count
  instance_type                 = var.pure_storage_config.instance_type

  # Storage Configuration
  capacity_gb                   = var.pure_storage_config.capacity_gb
  protocol                      = var.pure_storage_config.protocol
  nvme_tcp_enabled              = var.pure_storage_config.nvme_tcp_enabled
  iscsi_enabled                 = var.pure_storage_config.iscsi_enabled

  # Security
  allowed_cidr_blocks           = var.security_config.allowed_cidr_blocks
  allowed_security_group_ids    = var.security_config.allowed_security_group_ids
  management_cidr_blocks        = var.security_config.management_cidr_blocks

  # Encryption
  kms_key_id                    = module.shared.kms_key_id

  # Pure1 Configuration
  pure1_api_token               = var.pure_storage_config.pure1_api_token
  pure1_organization_id         = var.pure_storage_config.pure1_organization_id

  # Volumes and Host Groups
  volumes                       = var.pure_storage_config.volumes
  host_groups                   = var.pure_storage_config.host_groups
  protection_groups             = var.pure_storage_config.protection_groups

  # Replication
  replication_config            = var.pure_storage_config.replication_config
}

#------------------------------------------------------------------------------
# Portworx Enterprise Storage
#------------------------------------------------------------------------------

module "portworx" {
  source = "./modules/portworx"
  count  = local.enable_portworx ? 1 : 0

  project_name = var.project_name
  environment  = var.environment
  tags         = local.common_tags

  # Kubernetes Configuration
  namespace              = var.portworx_config.namespace
  create_namespace       = var.portworx_config.create_namespace

  # Portworx Installation
  portworx_version       = var.portworx_config.version
  cluster_name           = var.portworx_config.cluster_name
  kvdb_endpoints         = var.portworx_config.kvdb_endpoints
  internal_kvdb          = var.portworx_config.internal_kvdb
  secret_type            = var.portworx_config.secret_type

  # Storage Configuration
  storage_devices        = var.portworx_config.storage_devices
  journal_device         = var.portworx_config.journal_device
  system_metadata_device = var.portworx_config.system_metadata_device
  max_storage_nodes      = var.portworx_config.max_storage_nodes
  max_storage_nodes_per_zone = var.portworx_config.max_storage_nodes_per_zone

  # Feature Configuration
  enable_stork           = var.portworx_config.enable_stork
  enable_autopilot       = var.portworx_config.enable_autopilot
  enable_csi             = var.portworx_config.enable_csi
  enable_monitoring      = var.portworx_config.enable_monitoring

  # Network Configuration
  network_interface      = var.portworx_config.network_interface
  data_interface         = var.portworx_config.data_interface
  management_interface   = var.portworx_config.management_interface

  # License
  license_secret         = var.portworx_config.license_secret
  activate_license       = var.portworx_config.activate_license

  # Cloud Integration
  cloud_drive_enabled    = var.portworx_config.cloud_drive_enabled
  cloud_provider         = "aws"
  aws_access_key_id      = var.portworx_config.aws_access_key_id
  aws_secret_access_key  = var.portworx_config.aws_secret_access_key
  aws_region             = data.aws_region.current.name

  # Storage Classes
  storage_classes        = var.portworx_config.storage_classes

  # Backup Configuration
  enable_backup          = var.portworx_config.enable_backup
  backup_location_name   = var.portworx_config.backup_location_name
  backup_s3_bucket       = var.portworx_config.backup_s3_bucket
  backup_s3_region       = var.portworx_config.backup_s3_region
  backup_schedule        = var.portworx_config.backup_schedule

  # Security
  security_enabled       = var.portworx_config.security_enabled
  oidc_config            = var.portworx_config.oidc_config
}

#------------------------------------------------------------------------------
# MinIO S3-Compatible Object Storage
#------------------------------------------------------------------------------

module "minio" {
  source = "./modules/minio"
  count  = local.enable_minio ? 1 : 0

  project_name = var.project_name
  environment  = var.environment
  tags         = local.common_tags

  # Kubernetes Configuration
  namespace              = var.minio_config.namespace
  create_namespace       = var.minio_config.create_namespace

  # MinIO Operator
  operator_version       = var.minio_config.operator_version
  install_operator       = var.minio_config.install_operator

  # Tenant Configuration
  tenant_name            = var.minio_config.tenant_name
  tenant_version         = var.minio_config.tenant_version
  servers                = var.minio_config.servers
  volumes_per_server     = var.minio_config.volumes_per_server
  volume_size            = var.minio_config.volume_size
  storage_class          = var.minio_config.storage_class

  # Resource Configuration
  memory_request         = var.minio_config.memory_request
  memory_limit           = var.minio_config.memory_limit
  cpu_request            = var.minio_config.cpu_request
  cpu_limit              = var.minio_config.cpu_limit

  # Authentication
  root_user              = var.minio_config.root_user
  root_password          = var.minio_config.root_password

  # TLS Configuration
  enable_tls             = var.minio_config.enable_tls
  auto_cert              = var.minio_config.auto_cert
  cert_secret_name       = var.minio_config.cert_secret_name
  external_cert_secret   = var.minio_config.external_cert_secret

  # Console Configuration
  enable_console         = var.minio_config.enable_console
  console_service_type   = var.minio_config.console_service_type

  # Ingress Configuration
  enable_ingress         = var.minio_config.enable_ingress
  ingress_host           = var.minio_config.ingress_host
  console_ingress_host   = var.minio_config.console_ingress_host
  ingress_class          = var.minio_config.ingress_class
  ingress_annotations    = var.minio_config.ingress_annotations

  # Bucket Configuration
  buckets                = var.minio_config.buckets

  # User Configuration
  users                  = var.minio_config.users

  # Policy Configuration
  policies               = var.minio_config.policies

  # Prometheus Integration
  prometheus_enabled     = var.minio_config.prometheus_enabled
  prometheus_namespace   = var.minio_config.prometheus_namespace

  # Log Configuration
  log_search_enabled     = var.minio_config.log_search_enabled
  log_db_volume_size     = var.minio_config.log_db_volume_size

  # Audit Configuration
  audit_log_enabled      = var.minio_config.audit_log_enabled
  audit_log_target       = var.minio_config.audit_log_target
}

#------------------------------------------------------------------------------
# AWS Backup Integration
#------------------------------------------------------------------------------

resource "aws_backup_vault" "storage" {
  count = var.backup_config.enabled && var.backup_config.create_vault ? 1 : 0

  name        = "${var.project_name}-${var.environment}-storage-backup"
  kms_key_arn = module.shared.kms_key_arn

  tags = merge(
    local.common_tags,
    {
      Name = "${var.project_name}-${var.environment}-storage-backup"
    }
  )
}

resource "aws_backup_plan" "storage" {
  count = var.backup_config.enabled ? 1 : 0

  name = "${var.project_name}-${var.environment}-storage-backup-plan"

  dynamic "rule" {
    for_each = var.backup_config.backup_rules
    content {
      rule_name         = rule.value.name
      target_vault_name = var.backup_config.create_vault ? aws_backup_vault.storage[0].name : var.backup_config.vault_name
      schedule          = rule.value.schedule

      start_window      = rule.value.start_window_minutes
      completion_window = rule.value.completion_window_minutes

      dynamic "lifecycle" {
        for_each = rule.value.lifecycle != null ? [rule.value.lifecycle] : []
        content {
          cold_storage_after = lifecycle.value.cold_storage_after_days
          delete_after       = lifecycle.value.delete_after_days
        }
      }

      dynamic "copy_action" {
        for_each = rule.value.copy_to_vault_arn != null ? [rule.value.copy_to_vault_arn] : []
        content {
          destination_vault_arn = copy_action.value

          dynamic "lifecycle" {
            for_each = rule.value.copy_lifecycle != null ? [rule.value.copy_lifecycle] : []
            content {
              cold_storage_after = lifecycle.value.cold_storage_after_days
              delete_after       = lifecycle.value.delete_after_days
            }
          }
        }
      }

      recovery_point_tags = local.common_tags
    }
  }

  tags = local.common_tags
}

resource "aws_backup_selection" "fsx" {
  count = var.backup_config.enabled && (local.enable_fsx_windows || local.enable_fsx_lustre || local.enable_fsx_ontap || local.enable_fsx_openzfs) ? 1 : 0

  name          = "${var.project_name}-${var.environment}-fsx-backup-selection"
  plan_id       = aws_backup_plan.storage[0].id
  iam_role_arn  = module.shared.backup_role_arn

  selection_tag {
    type  = "STRINGEQUALS"
    key   = "BackupEnabled"
    value = "true"
  }

  resources = compact([
    local.enable_fsx_windows ? module.fsx_windows[0].file_system_arn : "",
    local.enable_fsx_lustre ? module.fsx_lustre[0].file_system_arn : "",
    local.enable_fsx_ontap ? module.fsx_ontap[0].file_system_arn : "",
    local.enable_fsx_openzfs ? module.fsx_openzfs[0].file_system_arn : ""
  ])
}

resource "aws_backup_selection" "efs" {
  count = var.backup_config.enabled && local.enable_efs ? 1 : 0

  name          = "${var.project_name}-${var.environment}-efs-backup-selection"
  plan_id       = aws_backup_plan.storage[0].id
  iam_role_arn  = module.shared.backup_role_arn

  resources = [
    module.efs[0].file_system_arn
  ]
}