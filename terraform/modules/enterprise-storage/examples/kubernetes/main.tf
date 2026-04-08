#------------------------------------------------------------------------------
# Enterprise Storage Module - Kubernetes Environment Example
#------------------------------------------------------------------------------
# This example demonstrates deployment of container-native storage solutions
# using Portworx for persistent volumes and MinIO for S3-compatible object
# storage within a Kubernetes environment.
#------------------------------------------------------------------------------

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = ">= 2.20"
    }
    helm = {
      source  = "hashicorp/helm"
      version = ">= 2.10"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Environment = var.environment
      Project     = "kubernetes-storage"
      ManagedBy   = "terraform"
    }
  }
}

# Configure Kubernetes provider
provider "kubernetes" {
  host                   = var.cluster_endpoint
  cluster_ca_certificate = base64decode(var.cluster_ca_certificate)
  token                  = var.cluster_auth_token
}

# Configure Helm provider
provider "helm" {
  kubernetes {
    host                   = var.cluster_endpoint
    cluster_ca_certificate = base64decode(var.cluster_ca_certificate)
    token                  = var.cluster_auth_token
  }
}

#------------------------------------------------------------------------------
# Variables
#------------------------------------------------------------------------------

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-west-2"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs"
  type        = list(string)
}

variable "cluster_endpoint" {
  description = "Kubernetes cluster endpoint"
  type        = string
}

variable "cluster_ca_certificate" {
  description = "Kubernetes cluster CA certificate (base64 encoded)"
  type        = string
}

variable "cluster_auth_token" {
  description = "Kubernetes cluster auth token"
  type        = string
  sensitive   = true
}

variable "portworx_license_secret" {
  description = "Portworx license secret"
  type        = string
  sensitive   = true
  default     = null
}

variable "minio_root_password" {
  description = "MinIO root password"
  type        = string
  sensitive   = true
}

variable "alert_emails" {
  description = "Email addresses for alerts"
  type        = list(string)
  default     = []
}

#------------------------------------------------------------------------------
# Enterprise Storage Module - Kubernetes Configuration
#------------------------------------------------------------------------------

module "enterprise_storage" {
  source = "../../"

  project_name = "k8s-storage"
  environment  = var.environment
  vpc_id       = var.vpc_id

  tags = {
    Team        = "platform"
    CostCenter  = "infrastructure"
    Application = "kubernetes-storage"
  }

  #----------------------------------------------------------------------------
  # Encryption Configuration
  #----------------------------------------------------------------------------
  encryption_config = {
    create_kms_key             = true
    kms_key_arn                = null
    key_deletion_window_days   = 30
    enable_key_rotation        = true
    multi_region               = false
    key_administrators         = []
    key_users                  = []
  }

  #----------------------------------------------------------------------------
  # Security Configuration
  #----------------------------------------------------------------------------
  security_config = {
    allowed_cidr_blocks        = ["10.0.0.0/8"]
    allowed_security_group_ids = []
    management_cidr_blocks     = ["10.0.0.0/8"]
  }

  #----------------------------------------------------------------------------
  # Portworx Enterprise Storage for Kubernetes
  #----------------------------------------------------------------------------
  portworx_config = {
    enabled          = true
    namespace        = "portworx"
    create_namespace = true
    version          = "3.0.0"
    cluster_name     = "px-cluster-${var.environment}"
    
    # KVDB configuration
    kvdb_endpoints = []  # Will use internal KVDB
    internal_kvdb  = true
    secret_type    = "k8s"
    
    # Storage configuration
    storage_devices           = []  # Auto-discover cloud drives
    journal_device            = null
    system_metadata_device    = null
    max_storage_nodes         = 3
    max_storage_nodes_per_zone = 1
    
    # Feature configuration
    enable_stork      = true
    enable_autopilot  = true
    enable_csi        = true
    enable_monitoring = true
    
    # Network configuration
    network_interface    = null
    data_interface       = null
    management_interface = null
    
    # License
    license_secret   = var.portworx_license_secret
    activate_license = var.portworx_license_secret != null
    
    # Cloud integration
    cloud_drive_enabled   = true
    aws_access_key_id     = null  # Use IAM roles
    aws_secret_access_key = null
    
    # Storage classes for different workload types
    storage_classes = {
      # High-performance database storage
      px-db = {
        replication_factor = 3
        io_profile         = "db"
        priority_io        = "high"
        group              = "database"
        allow_all_namespaces = true
        parameters = {
          "io_profile"    = "db"
          "priority_io"   = "high"
          "repl"          = "3"
          "secure"        = "true"
        }
        is_default = false
      }
      
      # General purpose storage
      px-storage = {
        replication_factor = 2
        io_profile         = "auto"
        priority_io        = "medium"
        group              = "general"
        allow_all_namespaces = true
        parameters = {
          "io_profile"    = "auto"
          "priority_io"   = "medium"
          "repl"          = "2"
        }
        is_default = true
      }
      
      # Shared storage (ReadWriteMany)
      px-shared = {
        replication_factor = 2
        io_profile         = "cms"
        priority_io        = "medium"
        group              = "shared"
        allow_all_namespaces = true
        parameters = {
          "io_profile"    = "cms"
          "repl"          = "2"
          "sharedv4"      = "true"
        }
        is_default = false
      }
      
      # High IOPS storage
      px-high-iops = {
        replication_factor = 2
        io_profile         = "db_remote"
        priority_io        = "high"
        group              = "performance"
        allow_all_namespaces = true
        parameters = {
          "io_profile"    = "db_remote"
          "priority_io"   = "high"
          "repl"          = "2"
          "journal"       = "true"
        }
        is_default = false
      }
    }
    
    # Backup configuration
    enable_backup        = true
    backup_location_name = "s3-backup"
    backup_s3_bucket     = null  # Created by module
    backup_s3_region     = var.aws_region
    backup_schedule      = "0 2 * * *"  # 2 AM daily
    
    # Security
    security_enabled = true
    oidc_config      = null
  }

  #----------------------------------------------------------------------------
  # MinIO S3-Compatible Object Storage
  #----------------------------------------------------------------------------
  minio_config = {
    enabled          = true
    namespace        = "minio"
    create_namespace = true
    
    # Operator configuration
    operator_version = "5.0.0"
    install_operator = true
    
    # Tenant configuration
    tenant_name      = "minio-${var.environment}"
    tenant_version   = "RELEASE.2024-01-01T00-00-00Z"
    servers          = 4
    volumes_per_server = 4
    volume_size      = "100Gi"
    storage_class    = "px-storage"  # Use Portworx storage
    
    # Resource configuration
    memory_request = "2Gi"
    memory_limit   = "4Gi"
    cpu_request    = "500m"
    cpu_limit      = "2"
    
    # Authentication
    root_user     = "admin"
    root_password = var.minio_root_password
    
    # TLS configuration
    enable_tls           = true
    auto_cert            = true
    cert_secret_name     = null
    external_cert_secret = null
    
    # Console configuration
    enable_console       = true
    console_service_type = "ClusterIP"
    
    # Ingress configuration
    enable_ingress       = true
    ingress_host         = "minio.${var.environment}.internal"
    console_ingress_host = "minio-console.${var.environment}.internal"
    ingress_class        = "nginx"
    ingress_annotations = {
      "nginx.ingress.kubernetes.io/proxy-body-size" = "0"
      "nginx.ingress.kubernetes.io/ssl-redirect"    = "true"
    }
    
    # Buckets
    buckets = {
      data = {
        name          = "data"
        object_lock   = false
        quota_hard    = "500Gi"
        quota_type    = "hard"
        versioning    = true
        retention_days = null
      }
      backups = {
        name          = "backups"
        object_lock   = true
        quota_hard    = "1Ti"
        quota_type    = "hard"
        versioning    = true
        retention_days = 90
      }
      logs = {
        name          = "logs"
        object_lock   = false
        quota_hard    = "100Gi"
        quota_type    = "hard"
        versioning    = false
        retention_days = 30
      }
      artifacts = {
        name          = "artifacts"
        object_lock   = false
        quota_hard    = "200Gi"
        quota_type    = "hard"
        versioning    = true
        retention_days = null
      }
    }
    
    # Users
    users = {
      app_user = {
        access_key = "app-user"
        secret_key = null  # Generated automatically
        policies   = ["readwrite-data"]
      }
      backup_user = {
        access_key = "backup-user"
        secret_key = null
        policies   = ["readwrite-backups"]
      }
      readonly_user = {
        access_key = "readonly-user"
        secret_key = null
        policies   = ["readonly"]
      }
    }
    
    # Policies
    policies = {
      readwrite-data = {
        name = "readwrite-data"
        statements = [
          {
            effect    = "Allow"
            actions   = ["s3:*"]
            resources = ["arn:aws:s3:::data/*"]
          }
        ]
      }
      readwrite-backups = {
        name = "readwrite-backups"
        statements = [
          {
            effect    = "Allow"
            actions   = ["s3:*"]
            resources = ["arn:aws:s3:::backups/*"]
          }
        ]
      }
      readonly = {
        name = "readonly"
        statements = [
          {
            effect    = "Allow"
            actions   = ["s3:GetObject", "s3:ListBucket"]
            resources = ["arn:aws:s3:::*"]
          }
        ]
      }
    }
    
    # Prometheus integration
    prometheus_enabled   = true
    prometheus_namespace = "monitoring"
    
    # Logging
    log_search_enabled = true
    log_db_volume_size = "10Gi"
    
    # Audit
    audit_log_enabled = true
    audit_log_target  = null
  }

  #----------------------------------------------------------------------------
  # Disable AWS-native storage types
  #----------------------------------------------------------------------------
  efs_config         = null
  fsx_windows_config = null
  fsx_lustre_config  = null
  fsx_ontap_config   = null
  fsx_openzfs_config = null
  netapp_cloud_volumes_config = null
  pure_storage_config = null

  #----------------------------------------------------------------------------
  # IAM Configuration
  #----------------------------------------------------------------------------
  create_iam_roles       = true
  create_storage_client_sg = false  # Not needed for K8s
  trusted_account_ids    = []
  require_mfa_for_admin  = true

  #----------------------------------------------------------------------------
  # Monitoring Configuration
  #----------------------------------------------------------------------------
  monitoring_config = {
    create_dashboard          = true
    dashboard_name            = "kubernetes-storage-${var.environment}"
    create_log_group          = true
    log_retention_days        = 90
    create_sns_topic          = length(var.alert_emails) > 0
    alert_email_addresses     = var.alert_emails
    create_event_rules        = false
    capacity_alarm_enabled    = false
    capacity_warning_threshold  = 80
    capacity_critical_threshold = 95
  }

  #----------------------------------------------------------------------------
  # Backup Configuration
  #----------------------------------------------------------------------------
  backup_config = {
    enabled      = false  # Portworx handles backups
    create_vault = false
    vault_name   = null
    backup_rules = []
  }

  #----------------------------------------------------------------------------
  # Replication Configuration
  #----------------------------------------------------------------------------
  replication_config = null
}

#------------------------------------------------------------------------------
# Outputs
#------------------------------------------------------------------------------

output "portworx" {
  description = "Portworx deployment details"
  value       = module.enterprise_storage.portworx
  sensitive   = false
}

output "portworx_storage_classes" {
  description = "Portworx storage class names"
  value       = module.enterprise_storage.portworx_storage_classes
}

output "minio" {
  description = "MinIO deployment details"
  value       = module.enterprise_storage.minio
  sensitive   = false
}

output "minio_api_endpoint" {
  description = "MinIO API endpoint"
  value       = module.enterprise_storage.minio_api_endpoint
}

output "minio_console_endpoint" {
  description = "MinIO Console endpoint"
  value       = module.enterprise_storage.minio_console_endpoint
}

output "kms_key_arn" {
  description = "KMS key ARN"
  value       = module.enterprise_storage.kms_key_arn
}

output "iam_roles" {
  description = "IAM role ARNs"
  value       = module.enterprise_storage.iam_roles
}

output "storage_summary" {
  description = "Summary of deployed storage"
  value       = module.enterprise_storage.storage_summary
}