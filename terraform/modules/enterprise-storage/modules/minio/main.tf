#------------------------------------------------------------------------------
# MinIO S3-Compatible Object Storage Submodule
# 
# Deploys MinIO S3-compatible object storage using Helm charts with
# distributed mode, TLS, bucket policies, and replication support.
#------------------------------------------------------------------------------

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  
  common_tags = merge(var.tags, {
    Module      = "minio"
    StorageType = "MinIO"
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
  })
}

#------------------------------------------------------------------------------
# Kubernetes Namespace
#------------------------------------------------------------------------------

resource "kubernetes_namespace" "minio" {
  count = var.enabled && var.create_namespace ? 1 : 0

  metadata {
    name = var.namespace

    labels = {
      "name"                         = var.namespace
      "app.kubernetes.io/managed-by" = "terraform"
    }
  }
}

#------------------------------------------------------------------------------
# Random Password for Root User
#------------------------------------------------------------------------------

resource "random_password" "root_password" {
  count = var.enabled && var.root_password == null ? 1 : 0

  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

#------------------------------------------------------------------------------
# Kubernetes Secret for MinIO Credentials
#------------------------------------------------------------------------------

resource "kubernetes_secret" "minio_credentials" {
  count = var.enabled ? 1 : 0

  metadata {
    name      = "${var.deployment_name}-credentials"
    namespace = var.namespace
  }

  data = {
    rootUser     = var.root_user
    rootPassword = var.root_password != null ? var.root_password : random_password.root_password[0].result
  }

  type = "Opaque"

  depends_on = [kubernetes_namespace.minio]
}

#------------------------------------------------------------------------------
# TLS Certificate (if enabled)
#------------------------------------------------------------------------------

resource "tls_private_key" "minio" {
  count = var.enabled && var.enable_tls && var.certificate_secret == null ? 1 : 0

  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "tls_self_signed_cert" "minio" {
  count = var.enabled && var.enable_tls && var.certificate_secret == null ? 1 : 0

  private_key_pem = tls_private_key.minio[0].private_key_pem

  subject {
    common_name  = "${var.deployment_name}.${var.namespace}.svc.cluster.local"
    organization = var.project_name
  }

  dns_names = [
    "${var.deployment_name}",
    "${var.deployment_name}.${var.namespace}",
    "${var.deployment_name}.${var.namespace}.svc",
    "${var.deployment_name}.${var.namespace}.svc.cluster.local",
    "*.${var.deployment_name}-hl.${var.namespace}.svc.cluster.local",
    var.ingress_host != null ? var.ingress_host : "${var.deployment_name}.local"
  ]

  validity_period_hours = 8760  # 1 year

  allowed_uses = [
    "key_encipherment",
    "digital_signature",
    "server_auth",
  ]
}

resource "kubernetes_secret" "minio_tls" {
  count = var.enabled && var.enable_tls && var.certificate_secret == null ? 1 : 0

  metadata {
    name      = "${var.deployment_name}-tls"
    namespace = var.namespace
  }

  data = {
    "tls.crt" = tls_self_signed_cert.minio[0].cert_pem
    "tls.key" = tls_private_key.minio[0].private_key_pem
  }

  type = "kubernetes.io/tls"

  depends_on = [kubernetes_namespace.minio]
}

#------------------------------------------------------------------------------
# Helm Release - MinIO
#------------------------------------------------------------------------------

resource "helm_release" "minio" {
  count = var.enabled ? 1 : 0

  name       = var.deployment_name
  repository = "https://charts.min.io/"
  chart      = "minio"
  version    = var.helm_chart_version
  namespace  = var.namespace

  create_namespace = !var.create_namespace
  wait             = true
  timeout          = 600

  # Deployment mode
  set {
    name  = "mode"
    value = var.deployment_mode
  }

  # Replicas (for distributed mode)
  dynamic "set" {
    for_each = var.deployment_mode == "distributed" ? [1] : []
    content {
      name  = "replicas"
      value = var.replicas
    }
  }

  # Drives per node
  dynamic "set" {
    for_each = var.deployment_mode == "distributed" ? [1] : []
    content {
      name  = "drivesPerNode"
      value = var.drives_per_node
    }
  }

  # Root credentials
  set {
    name  = "existingSecret"
    value = kubernetes_secret.minio_credentials[0].metadata[0].name
  }

  # Persistence
  set {
    name  = "persistence.enabled"
    value = "true"
  }

  set {
    name  = "persistence.storageClass"
    value = var.storage_class
  }

  set {
    name  = "persistence.size"
    value = "${var.storage_size_gb}Gi"
  }

  # Resources
  set {
    name  = "resources.requests.cpu"
    value = var.cpu_requests
  }

  set {
    name  = "resources.limits.cpu"
    value = var.cpu_limits
  }

  set {
    name  = "resources.requests.memory"
    value = var.memory_requests
  }

  set {
    name  = "resources.limits.memory"
    value = var.memory_limits
  }

  # TLS
  set {
    name  = "tls.enabled"
    value = var.enable_tls
  }

  dynamic "set" {
    for_each = var.enable_tls ? [1] : []
    content {
      name  = "tls.certSecret"
      value = var.certificate_secret != null ? var.certificate_secret : kubernetes_secret.minio_tls[0].metadata[0].name
    }
  }

  # Console
  set {
    name  = "console.enabled"
    value = var.enable_console
  }

  dynamic "set" {
    for_each = var.enable_console ? [1] : []
    content {
      name  = "consoleService.port"
      value = var.console_port
    }
  }

  # Service type
  set {
    name  = "service.type"
    value = var.service_type
  }

  # Ingress
  set {
    name  = "ingress.enabled"
    value = var.ingress_enabled
  }

  dynamic "set" {
    for_each = var.ingress_enabled && var.ingress_host != null ? [1] : []
    content {
      name  = "ingress.hosts[0]"
      value = var.ingress_host
    }
  }

  # Prometheus metrics
  set {
    name  = "metrics.serviceMonitor.enabled"
    value = var.enable_prometheus
  }

  # Environment variables for additional configuration
  dynamic "set" {
    for_each = var.environment_variables
    content {
      name  = "environment.${set.key}"
      value = set.value
    }
  }

  depends_on = [
    kubernetes_namespace.minio,
    kubernetes_secret.minio_credentials,
    kubernetes_secret.minio_tls
  ]
}

#------------------------------------------------------------------------------
# MinIO Buckets
#------------------------------------------------------------------------------

resource "kubernetes_job" "create_buckets" {
  count = var.enabled && length(var.buckets) > 0 ? 1 : 0

  metadata {
    name      = "${var.deployment_name}-create-buckets"
    namespace = var.namespace
  }

  spec {
    template {
      metadata {
        labels = {
          app = "${var.deployment_name}-bucket-setup"
        }
      }

      spec {
        container {
          name  = "mc"
          image = "minio/mc:latest"

          command = ["/bin/sh", "-c"]
          args = [
            <<-EOT
              mc alias set minio ${var.enable_tls ? "https" : "http"}://${var.deployment_name}:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD --insecure
              %{for bucket in var.buckets}
              mc mb minio/${bucket.name} --ignore-existing --insecure
              %{if bucket.versioning}
              mc version enable minio/${bucket.name} --insecure
              %{endif}
              %{if bucket.object_locking}
              mc retention set --default governance ${bucket.retention_days != null ? bucket.retention_days : 30}d minio/${bucket.name} --insecure
              %{endif}
              %{if bucket.quota_gb != null}
              mc quota set minio/${bucket.name} --size ${bucket.quota_gb}GB --insecure
              %{endif}
              %{endfor}
              echo "Bucket setup complete"
            EOT
          ]

          env {
            name = "MINIO_ROOT_USER"
            value_from {
              secret_key_ref {
                name = kubernetes_secret.minio_credentials[0].metadata[0].name
                key  = "rootUser"
              }
            }
          }

          env {
            name = "MINIO_ROOT_PASSWORD"
            value_from {
              secret_key_ref {
                name = kubernetes_secret.minio_credentials[0].metadata[0].name
                key  = "rootPassword"
              }
            }
          }
        }

        restart_policy = "OnFailure"
      }
    }

    backoff_limit = 3
  }

  wait_for_completion = true
  timeouts {
    create = "5m"
  }

  depends_on = [helm_release.minio]
}

#------------------------------------------------------------------------------
# MinIO Users and Policies
#------------------------------------------------------------------------------

resource "kubernetes_job" "create_policies_users" {
  count = var.enabled && (length(var.policies) > 0 || length(var.users) > 0) ? 1 : 0

  metadata {
    name      = "${var.deployment_name}-create-policies-users"
    namespace = var.namespace
  }

  spec {
    template {
      metadata {
        labels = {
          app = "${var.deployment_name}-policy-setup"
        }
      }

      spec {
        container {
          name  = "mc"
          image = "minio/mc:latest"

          command = ["/bin/sh", "-c"]
          args = [
            <<-EOT
              mc alias set minio ${var.enable_tls ? "https" : "http"}://${var.deployment_name}:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD --insecure
              
              # Create policies
              %{for policy in var.policies}
              cat > /tmp/${policy.name}.json << 'POLICY'
              {
                "Version": "2012-10-17",
                "Statement": [
                  %{for idx, stmt in policy.statements}
                  {
                    "Effect": "${stmt.effect}",
                    "Action": ${jsonencode(stmt.actions)},
                    "Resource": ${jsonencode(stmt.resources)}
                  }%{if idx < length(policy.statements) - 1},%{endif}
                  %{endfor}
                ]
              }
              POLICY
              mc admin policy create minio ${policy.name} /tmp/${policy.name}.json --insecure || mc admin policy info minio ${policy.name} --insecure
              %{endfor}
              
              # Create users
              %{for user in var.users}
              mc admin user add minio ${user.access_key} ${user.secret_key} --insecure || echo "User ${user.access_key} may already exist"
              %{for policy_name in user.policies}
              mc admin policy attach minio ${policy_name} --user ${user.access_key} --insecure || echo "Policy attachment may already exist"
              %{endfor}
              %{endfor}
              
              echo "Policy and user setup complete"
            EOT
          ]

          env {
            name = "MINIO_ROOT_USER"
            value_from {
              secret_key_ref {
                name = kubernetes_secret.minio_credentials[0].metadata[0].name
                key  = "rootUser"
              }
            }
          }

          env {
            name = "MINIO_ROOT_PASSWORD"
            value_from {
              secret_key_ref {
                name = kubernetes_secret.minio_credentials[0].metadata[0].name
                key  = "rootPassword"
              }
            }
          }
        }

        restart_policy = "OnFailure"
      }
    }

    backoff_limit = 3
  }

  wait_for_completion = true
  timeouts {
    create = "5m"
  }

  depends_on = [
    helm_release.minio,
    kubernetes_job.create_buckets
  ]
}

#------------------------------------------------------------------------------
# CloudWatch Dashboard
#------------------------------------------------------------------------------

resource "aws_cloudwatch_dashboard" "minio" {
  count = var.enabled && var.enable_cloudwatch_dashboard ? 1 : 0

  dashboard_name = "${local.name_prefix}-minio"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "MinIO Storage Usage"
          region = data.aws_region.current.name
          metrics = [
            ["MinIO", "storage_total_bytes", "Deployment", var.deployment_name],
            [".", "storage_used_bytes", ".", "."]
          ]
          period = 300
          stat   = "Average"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "MinIO Request Rate"
          region = data.aws_region.current.name
          metrics = [
            ["MinIO", "s3_requests_total", "Deployment", var.deployment_name, "Type", "GET"],
            [".", ".", ".", ".", "Type", "PUT"],
            [".", ".", ".", ".", "Type", "DELETE"]
          ]
          period = 300
          stat   = "Sum"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "MinIO Network Traffic"
          region = data.aws_region.current.name
          metrics = [
            ["MinIO", "s3_rx_bytes", "Deployment", var.deployment_name],
            [".", "s3_tx_bytes", ".", "."]
          ]
          period = 300
          stat   = "Sum"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "MinIO Errors"
          region = data.aws_region.current.name
          metrics = [
            ["MinIO", "s3_errors_total", "Deployment", var.deployment_name]
          ]
          period = 300
          stat   = "Sum"
        }
      }
    ]
  })
}

#------------------------------------------------------------------------------
# SSM Parameters for MinIO Configuration
#------------------------------------------------------------------------------

resource "aws_ssm_parameter" "minio_endpoint" {
  count = var.enabled ? 1 : 0

  name        = "/${local.name_prefix}/minio/endpoint"
  description = "MinIO endpoint URL"
  type        = "String"
  value       = "${var.enable_tls ? "https" : "http"}://${var.deployment_name}.${var.namespace}.svc.cluster.local:9000"

  tags = local.common_tags
}

resource "aws_ssm_parameter" "minio_credentials" {
  count = var.enabled ? 1 : 0

  name        = "/${local.name_prefix}/minio/credentials"
  description = "MinIO root credentials"
  type        = "SecureString"
  key_id      = var.kms_key_arn

  value = jsonencode({
    access_key = var.root_user
    secret_key = var.root_password != null ? var.root_password : random_password.root_password[0].result
  })

  tags = local.common_tags
}

#------------------------------------------------------------------------------
# Data Sources
#------------------------------------------------------------------------------

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}