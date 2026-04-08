#------------------------------------------------------------------------------
# MinIO S3-Compatible Object Storage Submodule - Variables
#------------------------------------------------------------------------------

variable "enabled" {
  description = "Whether to create MinIO resources"
  type        = bool
  default     = true
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "tags" {
  description = "Common tags to apply to resources"
  type        = map(string)
  default     = {}
}

#------------------------------------------------------------------------------
# Deployment Configuration
#------------------------------------------------------------------------------

variable "deployment_name" {
  description = "Name for the MinIO deployment"
  type        = string
  default     = "minio"
}

variable "namespace" {
  description = "Kubernetes namespace for MinIO"
  type        = string
  default     = "minio"
}

variable "create_namespace" {
  description = "Create the Kubernetes namespace"
  type        = bool
  default     = true
}

variable "helm_chart_version" {
  description = "MinIO Helm chart version"
  type        = string
  default     = null
}

variable "minio_version" {
  description = "MinIO server version"
  type        = string
  default     = "RELEASE.2024-01-01T00-00-00Z"
}

variable "deployment_mode" {
  description = "Deployment mode: standalone or distributed"
  type        = string
  default     = "distributed"

  validation {
    condition     = contains(["standalone", "distributed"], var.deployment_mode)
    error_message = "Deployment mode must be standalone or distributed."
  }
}

#------------------------------------------------------------------------------
# Cluster Configuration (Distributed Mode)
#------------------------------------------------------------------------------

variable "replicas" {
  description = "Number of MinIO replicas (for distributed mode, minimum 4)"
  type        = number
  default     = 4

  validation {
    condition     = var.replicas >= 1 && var.replicas <= 32
    error_message = "Replicas must be between 1 and 32."
  }
}

variable "drives_per_node" {
  description = "Number of drives per node"
  type        = number
  default     = 4

  validation {
    condition     = var.drives_per_node >= 1 && var.drives_per_node <= 16
    error_message = "Drives per node must be between 1 and 16."
  }
}

#------------------------------------------------------------------------------
# Storage Configuration
#------------------------------------------------------------------------------

variable "storage_class" {
  description = "Kubernetes storage class for persistence"
  type        = string
  default     = "gp3"
}

variable "storage_size_gb" {
  description = "Storage size per drive in GB"
  type        = number
  default     = 100

  validation {
    condition     = var.storage_size_gb >= 10 && var.storage_size_gb <= 16000
    error_message = "Storage size must be between 10 GB and 16,000 GB."
  }
}

#------------------------------------------------------------------------------
# Resource Configuration
#------------------------------------------------------------------------------

variable "cpu_requests" {
  description = "CPU requests"
  type        = string
  default     = "2"
}

variable "cpu_limits" {
  description = "CPU limits"
  type        = string
  default     = "4"
}

variable "memory_requests" {
  description = "Memory requests"
  type        = string
  default     = "4Gi"
}

variable "memory_limits" {
  description = "Memory limits"
  type        = string
  default     = "8Gi"
}

#------------------------------------------------------------------------------
# Security Configuration
#------------------------------------------------------------------------------

variable "root_user" {
  description = "Root user name (access key)"
  type        = string
  default     = "minioadmin"
}

variable "root_password" {
  description = "Root password (secret key) - generated if not provided"
  type        = string
  sensitive   = true
  default     = null
}

variable "enable_tls" {
  description = "Enable TLS encryption"
  type        = bool
  default     = true
}

variable "certificate_secret" {
  description = "Existing Kubernetes secret containing TLS certificate"
  type        = string
  default     = null
}

#------------------------------------------------------------------------------
# Bucket Configuration
#------------------------------------------------------------------------------

variable "buckets" {
  description = "List of buckets to create"
  type = list(object({
    name           = string
    policy         = optional(string, "none")
    versioning     = optional(bool, false)
    object_locking = optional(bool, false)
    retention_days = optional(number)
    quota_gb       = optional(number)
  }))
  default = []

  validation {
    condition     = alltrue([for b in var.buckets : b.policy == null || contains(["none", "download", "upload", "public"], b.policy)])
    error_message = "Bucket policy must be none, download, upload, or public."
  }
}

#------------------------------------------------------------------------------
# IAM Configuration
#------------------------------------------------------------------------------

variable "policies" {
  description = "List of IAM policies to create"
  type = list(object({
    name = string
    statements = list(object({
      effect    = string
      actions   = list(string)
      resources = list(string)
    }))
  }))
  default = []
}

variable "users" {
  description = "List of users to create"
  type = list(object({
    access_key = string
    secret_key = string
    policies   = list(string)
  }))
  default   = []
  sensitive = true
}

#------------------------------------------------------------------------------
# Replication Configuration
#------------------------------------------------------------------------------

variable "enable_replication" {
  description = "Enable bucket replication"
  type        = bool
  default     = false
}

variable "replication_target" {
  description = "Replication target configuration"
  type = object({
    endpoint   = string
    access_key = string
    secret_key = string
    bucket     = string
    region     = optional(string, "us-east-1")
  })
  default   = null
  sensitive = true
}

#------------------------------------------------------------------------------
# Console Configuration
#------------------------------------------------------------------------------

variable "enable_console" {
  description = "Enable MinIO Console"
  type        = bool
  default     = true
}

variable "console_port" {
  description = "Console service port"
  type        = number
  default     = 9001
}

#------------------------------------------------------------------------------
# Network Configuration
#------------------------------------------------------------------------------

variable "service_type" {
  description = "Kubernetes service type"
  type        = string
  default     = "ClusterIP"

  validation {
    condition     = contains(["ClusterIP", "NodePort", "LoadBalancer"], var.service_type)
    error_message = "Service type must be ClusterIP, NodePort, or LoadBalancer."
  }
}

variable "ingress_enabled" {
  description = "Enable ingress"
  type        = bool
  default     = false
}

variable "ingress_host" {
  description = "Ingress hostname"
  type        = string
  default     = null
}

#------------------------------------------------------------------------------
# Monitoring Configuration
#------------------------------------------------------------------------------

variable "enable_prometheus" {
  description = "Enable Prometheus metrics"
  type        = bool
  default     = true
}

variable "enable_cloudwatch_dashboard" {
  description = "Enable CloudWatch dashboard"
  type        = bool
  default     = true
}

#------------------------------------------------------------------------------
# Encryption Configuration
#------------------------------------------------------------------------------

variable "kms_key_arn" {
  description = "KMS key ARN for encryption"
  type        = string
  default     = null
}

#------------------------------------------------------------------------------
# Environment Variables
#------------------------------------------------------------------------------

variable "environment_variables" {
  description = "Additional environment variables for MinIO"
  type        = map(string)
  default     = {}
}