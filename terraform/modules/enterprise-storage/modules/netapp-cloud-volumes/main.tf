#------------------------------------------------------------------------------
# NetApp Cloud Volumes ONTAP Submodule
# 
# Deploys NetApp Cloud Volumes ONTAP on AWS using the NetApp BlueXP
# (Cloud Manager) provider. Supports single-node and HA deployments.
#------------------------------------------------------------------------------

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  
  common_tags = merge(var.tags, {
    Module      = "netapp-cloud-volumes"
    StorageType = "NetApp-CVO"
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
  })

  # Default instance types based on deployment mode
  default_instance_types = {
    single_node = "m5.2xlarge"
    ha          = "m5.2xlarge"
  }
}

#------------------------------------------------------------------------------
# NetApp BlueXP Connector (required for CVO deployment)
# Note: This assumes a connector already exists or uses an existing one
#------------------------------------------------------------------------------

# If connector needs to be created, it would be done via AWS EC2 instance
# with the NetApp Connector AMI. This is typically done once per account/region.

#------------------------------------------------------------------------------
# AWS Resources for NetApp CVO
#------------------------------------------------------------------------------

# IAM Role for NetApp CVO
resource "aws_iam_role" "cvo" {
  count = var.enabled && var.create_iam_role ? 1 : 0

  name = "${local.name_prefix}-netapp-cvo-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy" "cvo" {
  count = var.enabled && var.create_iam_role ? 1 : 0

  name = "${local.name_prefix}-netapp-cvo-policy"
  role = aws_iam_role.cvo[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ec2:DescribeInstances",
          "ec2:DescribeInstanceStatus",
          "ec2:RunInstances",
          "ec2:ModifyInstanceAttribute",
          "ec2:DescribeRouteTables",
          "ec2:DescribeImages",
          "ec2:CreateTags",
          "ec2:CreateVolume",
          "ec2:DescribeVolumes",
          "ec2:ModifyVolumeAttribute",
          "ec2:DeleteVolume",
          "ec2:AttachVolume",
          "ec2:DetachVolume",
          "ec2:DescribeSubnets",
          "ec2:DescribeVpcs",
          "ec2:DescribeAvailabilityZones",
          "ec2:CreateSecurityGroup",
          "ec2:DeleteSecurityGroup",
          "ec2:DescribeSecurityGroups",
          "ec2:RevokeSecurityGroupEgress",
          "ec2:AuthorizeSecurityGroupEgress",
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:RevokeSecurityGroupIngress",
          "ec2:CreateNetworkInterface",
          "ec2:DeleteNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:ModifyNetworkInterfaceAttribute",
          "ec2:DescribeNetworkInterfaceAttribute",
          "ec2:CreateSnapshot",
          "ec2:DeleteSnapshot",
          "ec2:DescribeSnapshots",
          "ec2:CreateKeyPair",
          "ec2:DescribeKeyPairs",
          "ec2:StopInstances",
          "ec2:StartInstances",
          "ec2:TerminateInstances",
          "ec2:DescribeInstanceAttribute",
          "ec2:DescribePlacementGroups",
          "ec2:CreatePlacementGroup",
          "ec2:DeletePlacementGroup"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetBucketTagging",
          "s3:GetBucketLocation",
          "s3:ListAllMyBuckets",
          "s3:ListBucket"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:PutObjectTagging"
        ]
        Resource = "arn:aws:s3:::${var.data_tiering_s3_bucket}/*"
        Condition = {
          StringEquals = {
            "aws:ResourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
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
          "cloudwatch:PutMetricData",
          "cloudwatch:GetMetricData",
          "cloudwatch:GetMetricStatistics",
          "cloudwatch:ListMetrics"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = "arn:aws:logs:*:*:log-group:/aws/netapp/*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "cvo" {
  count = var.enabled && var.create_iam_role ? 1 : 0

  name = "${local.name_prefix}-netapp-cvo-profile"
  role = aws_iam_role.cvo[0].name

  tags = local.common_tags
}

#------------------------------------------------------------------------------
# S3 Bucket for Data Tiering (Capacity Tier)
#------------------------------------------------------------------------------

resource "aws_s3_bucket" "data_tiering" {
  count = var.enabled && var.create_tiering_bucket ? 1 : 0

  bucket = var.data_tiering_s3_bucket != "" ? var.data_tiering_s3_bucket : "${local.name_prefix}-netapp-tiering"

  tags = merge(local.common_tags, {
    Name    = "${local.name_prefix}-netapp-tiering"
    Purpose = "NetApp CVO Data Tiering"
  })
}

resource "aws_s3_bucket_versioning" "data_tiering" {
  count = var.enabled && var.create_tiering_bucket ? 1 : 0

  bucket = aws_s3_bucket.data_tiering[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "data_tiering" {
  count = var.enabled && var.create_tiering_bucket ? 1 : 0

  bucket = aws_s3_bucket.data_tiering[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = var.kms_key_arn != null ? "aws:kms" : "AES256"
      kms_master_key_id = var.kms_key_arn
    }
  }
}

resource "aws_s3_bucket_public_access_block" "data_tiering" {
  count = var.enabled && var.create_tiering_bucket ? 1 : 0

  bucket = aws_s3_bucket.data_tiering[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "data_tiering" {
  count = var.enabled && var.create_tiering_bucket && var.enable_tiering_lifecycle ? 1 : 0

  bucket = aws_s3_bucket.data_tiering[0].id

  rule {
    id     = "intelligent-tiering"
    status = "Enabled"

    transition {
      days          = var.tiering_days_to_glacier
      storage_class = "GLACIER"
    }

    noncurrent_version_transition {
      noncurrent_days = 30
      storage_class   = "GLACIER"
    }

    noncurrent_version_expiration {
      noncurrent_days = var.tiering_noncurrent_expiration_days
    }
  }
}

#------------------------------------------------------------------------------
# Security Group for NetApp CVO
#------------------------------------------------------------------------------

resource "aws_security_group" "cvo" {
  count = var.enabled && var.create_security_group ? 1 : 0

  name        = "${local.name_prefix}-netapp-cvo-sg"
  description = "Security group for NetApp Cloud Volumes ONTAP"
  vpc_id      = var.vpc_id

  # Intercluster LIF (for SnapMirror, SnapVault)
  ingress {
    description = "HTTPS for cluster management"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
  }

  ingress {
    description = "SSH for CLI access"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
  }

  # NFS
  ingress {
    description = "NFS portmapper"
    from_port   = 111
    to_port     = 111
    protocol    = "tcp"
    cidr_blocks = var.client_cidr_blocks
  }

  ingress {
    description = "NFS portmapper UDP"
    from_port   = 111
    to_port     = 111
    protocol    = "udp"
    cidr_blocks = var.client_cidr_blocks
  }

  ingress {
    description = "NFS"
    from_port   = 2049
    to_port     = 2049
    protocol    = "tcp"
    cidr_blocks = var.client_cidr_blocks
  }

  ingress {
    description = "NFS UDP"
    from_port   = 2049
    to_port     = 2049
    protocol    = "udp"
    cidr_blocks = var.client_cidr_blocks
  }

  # CIFS/SMB
  ingress {
    description = "NetBIOS"
    from_port   = 137
    to_port     = 138
    protocol    = "udp"
    cidr_blocks = var.client_cidr_blocks
  }

  ingress {
    description = "NetBIOS session"
    from_port   = 139
    to_port     = 139
    protocol    = "tcp"
    cidr_blocks = var.client_cidr_blocks
  }

  ingress {
    description = "CIFS/SMB"
    from_port   = 445
    to_port     = 445
    protocol    = "tcp"
    cidr_blocks = var.client_cidr_blocks
  }

  # iSCSI
  ingress {
    description = "iSCSI"
    from_port   = 3260
    to_port     = 3260
    protocol    = "tcp"
    cidr_blocks = var.client_cidr_blocks
  }

  # SnapMirror intercluster
  ingress {
    description = "SnapMirror intercluster"
    from_port   = 11104
    to_port     = 11105
    protocol    = "tcp"
    cidr_blocks = var.replication_cidr_blocks
  }

  # Cluster peering
  ingress {
    description = "Cluster peering"
    from_port   = 10000
    to_port     = 10000
    protocol    = "tcp"
    cidr_blocks = var.replication_cidr_blocks
  }

  # HA interconnect (for HA deployments)
  dynamic "ingress" {
    for_each = var.deployment_mode == "ha" ? [1] : []
    content {
      description = "HA interconnect"
      from_port   = 0
      to_port     = 0
      protocol    = "-1"
      self        = true
    }
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-netapp-cvo-sg"
  })
}

#------------------------------------------------------------------------------
# CloudWatch Log Group for NetApp CVO
#------------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "cvo" {
  count = var.enabled ? 1 : 0

  name              = "/aws/netapp/cvo/${local.name_prefix}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn

  tags = local.common_tags
}

#------------------------------------------------------------------------------
# CloudWatch Alarms
#------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "cvo_storage" {
  count = var.enabled && var.enable_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.name_prefix}-netapp-cvo-storage"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "StorageCapacityUtilization"
  namespace           = "NetApp/CloudVolumes"
  period              = 300
  statistic           = "Average"
  threshold           = var.storage_utilization_threshold
  alarm_description   = "NetApp CVO storage utilization exceeds ${var.storage_utilization_threshold}%"
  treat_missing_data  = "notBreaching"

  dimensions = {
    WorkingEnvironmentId = local.name_prefix
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

#------------------------------------------------------------------------------
# Route53 DNS Records (optional)
#------------------------------------------------------------------------------

resource "aws_route53_record" "cvo_management" {
  count = var.enabled && var.create_dns_records && var.route53_zone_id != null ? 1 : 0

  zone_id = var.route53_zone_id
  name    = "netapp-mgmt.${var.dns_domain}"
  type    = "A"
  ttl     = 300
  records = var.management_ip_addresses

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cvo_data" {
  count = var.enabled && var.create_dns_records && var.route53_zone_id != null ? 1 : 0

  zone_id = var.route53_zone_id
  name    = "netapp-data.${var.dns_domain}"
  type    = "A"
  ttl     = 300
  records = var.data_ip_addresses

  lifecycle {
    create_before_destroy = true
  }
}

#------------------------------------------------------------------------------
# SSM Parameters for CVO Configuration Storage
#------------------------------------------------------------------------------

resource "aws_ssm_parameter" "cvo_config" {
  count = var.enabled ? 1 : 0

  name        = "/${local.name_prefix}/netapp/cvo/config"
  description = "NetApp CVO configuration"
  type        = "SecureString"
  key_id      = var.kms_key_arn

  value = jsonencode({
    name            = var.cvo_name
    deployment_mode = var.deployment_mode
    instance_type   = var.instance_type
    license_type    = var.license_type
    capacity_tier   = var.capacity_tier
    svms            = var.svms
  })

  tags = local.common_tags
}

#------------------------------------------------------------------------------
# Data Sources
#------------------------------------------------------------------------------

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}