#------------------------------------------------------------------------------
# Portworx Enterprise Storage Submodule
# 
# Deploys Portworx enterprise storage for Kubernetes environments using
# Helm charts with storage classes, backup, and monitoring configuration.
#------------------------------------------------------------------------------

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  
  common_tags = merge(var.tags, {
    Module      = "portworx"
    StorageType = "Portworx"
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
  })

  # Default storage class configurations
  default_storage_classes = [
    {
      name               = "px-db"
      replication_factor = 3
      io_profile         = "db"
      priority           = "high"
      secure             = true
      sharedv4           = false
    },
    {
      name               = "px-replicated"
      replication_factor = 3
      io_profile         = "auto"
      priority           = "medium"
      secure             = true
      sharedv4           = false
    },
    {
      name               = "px-shared"
      replication_factor = 3
      io_profile         = "auto"
      priority           = "medium"
      secure             = true
      sharedv4           = true
    }
  ]

  storage_classes = length(var.storage_classes) > 0 ? var.storage_classes : local.default_storage_classes
}

#------------------------------------------------------------------------------
# Kubernetes Namespace
#------------------------------------------------------------------------------

resource "kubernetes_namespace" "portworx" {
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
# IAM Role for Portworx (EKS)
#------------------------------------------------------------------------------

data "aws_iam_policy_document" "portworx_assume_role" {
  count = var.enabled && var.create_iam_role ? 1 : 0

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"

    condition {
      test     = "StringEquals"
      variable = "${replace(var.oidc_provider_url, "https://", "")}:sub"
      values   = ["system:serviceaccount:${var.namespace}:px-account"]
    }

    condition {
      test     = "StringEquals"
      variable = "${replace(var.oidc_provider_url, "https://", "")}:aud"
      values   = ["sts.amazonaws.com"]
    }

    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }
  }
}

resource "aws_iam_role" "portworx" {
  count = var.enabled && var.create_iam_role ? 1 : 0

  name               = "${local.name_prefix}-portworx-role"
  assume_role_policy = data.aws_iam_policy_document.portworx_assume_role[0].json

  tags = local.common_tags
}

resource "aws_iam_role_policy" "portworx" {
  count = var.enabled && var.create_iam_role ? 1 : 0

  name = "${local.name_prefix}-portworx-policy"
  role = aws_iam_role.portworx[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ec2:AttachVolume",
          "ec2:ModifyVolume",
          "ec2:DetachVolume",
          "ec2:CreateTags",
          "ec2:CreateVolume",
          "ec2:DeleteTags",
          "ec2:DeleteVolume",
          "ec2:DescribeTags",
          "ec2:DescribeVolumeAttribute",
          "ec2:DescribeVolumesModifications",
          "ec2:DescribeVolumeStatus",
          "ec2:DescribeVolumes",
          "ec2:DescribeInstances",
          "autoscaling:DescribeAutoScalingGroups"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey"
        ]
        Resource = var.kms_key_arn != null ? var.kms_key_arn : "*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = var.backup_s3_bucket != null ? [
          "arn:aws:s3:::${var.backup_s3_bucket}",
          "arn:aws:s3:::${var.backup_s3_bucket}/*"
        ] : ["*"]
      }
    ]
  })
}

#------------------------------------------------------------------------------
# S3 Bucket for Portworx Backup
#------------------------------------------------------------------------------

resource "aws_s3_bucket" "backup" {
  count = var.enabled && var.enable_backup && var.create_backup_bucket ? 1 : 0

  bucket = var.backup_s3_bucket != null ? var.backup_s3_bucket : "${local.name_prefix}-portworx-backup"

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-portworx-backup"
    Purpose = "Portworx Backup"
  })
}

resource "aws_s3_bucket_versioning" "backup" {
  count = var.enabled && var.enable_backup && var.create_backup_bucket ? 1 : 0

  bucket = aws_s3_bucket.backup[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backup" {
  count = var.enabled && var.enable_backup && var.create_backup_bucket ? 1 : 0

  bucket = aws_s3_bucket.backup[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = var.kms_key_arn != null ? "aws:kms" : "AES256"
      kms_master_key_id = var.kms_key_arn
    }
  }
}

resource "aws_s3_bucket_public_access_block" "backup" {
  count = var.enabled && var.enable_backup && var.create_backup_bucket ? 1 : 0

  bucket = aws_s3_bucket.backup[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "backup" {
  count = var.enabled && var.enable_backup && var.create_backup_bucket ? 1 : 0

  bucket = aws_s3_bucket.backup[0].id

  rule {
    id     = "backup-lifecycle"
    status = "Enabled"

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 90
      storage_class = "GLACIER"
    }

    expiration {
      days = var.backup_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

#------------------------------------------------------------------------------
# Helm Release - Portworx Operator
#------------------------------------------------------------------------------

resource "helm_release" "portworx_operator" {
  count = var.enabled ? 1 : 0

  name       = "portworx"
  repository = "https://raw.githubusercontent.com/portworx/helm/master/charts"
  chart      = "portworx"
  version    = var.portworx_version
  namespace  = var.namespace

  create_namespace = !var.create_namespace
  wait             = true
  timeout          = 900

  # Basic configuration
  set {
    name  = "clusterName"
    value = var.cluster_name
  }

  set {
    name  = "imageVersion"
    value = var.portworx_version
  }

  # Storage configuration
  set {
    name  = "storage.drives"
    value = var.storage_drives
  }

  set {
    name  = "storage.useAllDevices"
    value = var.use_all_devices
  }

  set {
    name  = "storage.journalDevice"
    value = var.journal_device != null ? var.journal_device : ""
  }

  # Cloud storage configuration
  dynamic "set" {
    for_each = var.cloud_storage_type != null ? [1] : []
    content {
      name  = "cloudStorage.type"
      value = var.cloud_storage_type
    }
  }

  dynamic "set" {
    for_each = var.cloud_storage_type != null ? [1] : []
    content {
      name  = "cloudStorage.size"
      value = var.storage_device_size_gb
    }
  }

  dynamic "set" {
    for_each = var.cloud_storage_type != null ? [1] : []
    content {
      name  = "cloudStorage.maxStorageNodesPerZone"
      value = var.max_storage_nodes_per_zone
    }
  }

  # Network configuration
  dynamic "set" {
    for_each = var.data_interface != null ? [1] : []
    content {
      name  = "network.dataInterface"
      value = var.data_interface
    }
  }

  dynamic "set" {
    for_each = var.management_interface != null ? [1] : []
    content {
      name  = "network.managementInterface"
      value = var.management_interface
    }
  }

  # Security configuration
  set {
    name  = "security.enabled"
    value = var.enable_security
  }

  # Stork (storage orchestration)
  set {
    name  = "stork.enabled"
    value = var.enable_stork
  }

  # Lighthouse (UI)
  set {
    name  = "lighthouse.enabled"
    value = var.enable_lighthouse
  }

  # Autopilot
  set {
    name  = "autopilot.enabled"
    value = var.enable_autopilot
  }

  # CSI
  set {
    name  = "csi.enabled"
    value = var.enable_csi
  }

  # Monitoring
  set {
    name  = "monitoring.prometheus.enabled"
    value = var.enable_prometheus
  }

  # AWS-specific configuration
  dynamic "set" {
    for_each = var.create_iam_role ? [1] : []
    content {
      name  = "aws.eksServiceAccount"
      value = "px-account"
    }
  }

  # License
  dynamic "set" {
    for_each = var.license_key != null ? [1] : []
    content {
      name  = "activateLicense"
      value = var.license_key
    }
  }

  depends_on = [
    kubernetes_namespace.portworx,
    aws_iam_role.portworx
  ]
}

#------------------------------------------------------------------------------
# Kubernetes Storage Classes
#------------------------------------------------------------------------------

resource "kubernetes_storage_class" "portworx" {
  for_each = var.enabled ? { for sc in local.storage_classes : sc.name => sc } : {}

  metadata {
    name = each.value.name

    labels = {
      "app.kubernetes.io/managed-by" = "terraform"
    }

    annotations = {
      "storageclass.kubernetes.io/is-default-class" = each.value.name == var.default_storage_class ? "true" : "false"
    }
  }

  storage_provisioner    = "pxd.portworx.com"
  reclaim_policy         = "Delete"
  volume_binding_mode    = "Immediate"
  allow_volume_expansion = try(each.value.allow_volume_expansion, true)

  parameters = {
    repl          = tostring(try(each.value.replication_factor, 3))
    io_profile    = try(each.value.io_profile, "auto")
    priority_io   = try(each.value.priority, "high")
    secure        = tostring(try(each.value.secure, true))
    journal       = tostring(try(each.value.journal, false))
    sharedv4      = tostring(try(each.value.sharedv4, false))
    fs            = try(each.value.fs_type, "ext4")
  }

  depends_on = [helm_release.portworx_operator]
}

#------------------------------------------------------------------------------
# Portworx Backup Location (if backup enabled)
#------------------------------------------------------------------------------

resource "kubernetes_manifest" "backup_location" {
  count = var.enabled && var.enable_backup ? 1 : 0

  manifest = {
    apiVersion = "stork.libopenstorage.org/v1alpha1"
    kind       = "BackupLocation"
    metadata = {
      name      = "${local.name_prefix}-s3"
      namespace = var.namespace
    }
    spec = {
      location = {
        type = "s3"
        path = var.create_backup_bucket ? aws_s3_bucket.backup[0].id : var.backup_s3_bucket
        s3Config = {
          region   = var.backup_s3_region != null ? var.backup_s3_region : data.aws_region.current.name
          endpoint = "s3.${var.backup_s3_region != null ? var.backup_s3_region : data.aws_region.current.name}.amazonaws.com"
        }
      }
    }
  }

  depends_on = [helm_release.portworx_operator]
}

#------------------------------------------------------------------------------
# CloudWatch Dashboard
#------------------------------------------------------------------------------

resource "aws_cloudwatch_dashboard" "portworx" {
  count = var.enabled && var.enable_cloudwatch_dashboard ? 1 : 0

  dashboard_name = "${local.name_prefix}-portworx"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "Portworx Storage Capacity"
          region = data.aws_region.current.name
          metrics = [
            ["Portworx", "storage_capacity_total", "ClusterName", var.cluster_name],
            [".", "storage_capacity_used", ".", "."]
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
          title  = "Portworx IOPS"
          region = data.aws_region.current.name
          metrics = [
            ["Portworx", "read_iops", "ClusterName", var.cluster_name],
            [".", "write_iops", ".", "."]
          ]
          period = 300
          stat   = "Average"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "Portworx Throughput"
          region = data.aws_region.current.name
          metrics = [
            ["Portworx", "read_throughput", "ClusterName", var.cluster_name],
            [".", "write_throughput", ".", "."]
          ]
          period = 300
          stat   = "Average"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "Portworx Latency"
          region = data.aws_region.current.name
          metrics = [
            ["Portworx", "read_latency", "ClusterName", var.cluster_name],
            [".", "write_latency", ".", "."]
          ]
          period = 300
          stat   = "Average"
        }
      }
    ]
  })
}

#------------------------------------------------------------------------------
# Data Sources
#------------------------------------------------------------------------------

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}