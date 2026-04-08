#------------------------------------------------------------------------------
# Pure Storage Cloud Block Store Submodule
# 
# Deploys Pure Storage Cloud Block Store on AWS for enterprise block storage
# with iSCSI and NVMe-oF support, protection groups, and replication.
#------------------------------------------------------------------------------

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  
  common_tags = merge(var.tags, {
    Module      = "pure-storage-cbs"
    StorageType = "Pure-CBS"
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
  })
}

#------------------------------------------------------------------------------
# AWS Resources for Pure Storage CBS
#------------------------------------------------------------------------------

# IAM Role for Pure Storage CBS
resource "aws_iam_role" "cbs" {
  count = var.enabled && var.create_iam_role ? 1 : 0

  name = "${local.name_prefix}-pure-cbs-role"

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

resource "aws_iam_role_policy" "cbs" {
  count = var.enabled && var.create_iam_role ? 1 : 0

  name = "${local.name_prefix}-pure-cbs-policy"
  role = aws_iam_role.cbs[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ec2:DescribeInstances",
          "ec2:DescribeVolumes",
          "ec2:AttachVolume",
          "ec2:DetachVolume",
          "ec2:CreateVolume",
          "ec2:DeleteVolume",
          "ec2:ModifyVolume",
          "ec2:DescribeSnapshots",
          "ec2:CreateSnapshot",
          "ec2:DeleteSnapshot",
          "ec2:CopySnapshot",
          "ec2:DescribeNetworkInterfaces",
          "ec2:CreateNetworkInterface",
          "ec2:DeleteNetworkInterface",
          "ec2:ModifyNetworkInterfaceAttribute",
          "ec2:DescribeSubnets",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeVpcs",
          "ec2:CreateTags"
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
          "kms:DescribeKey",
          "kms:CreateGrant"
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
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:log-group:/aws/purestorage/*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "cbs" {
  count = var.enabled && var.create_iam_role ? 1 : 0

  name = "${local.name_prefix}-pure-cbs-profile"
  role = aws_iam_role.cbs[0].name

  tags = local.common_tags
}

#------------------------------------------------------------------------------
# Security Group for Pure Storage CBS
#------------------------------------------------------------------------------

resource "aws_security_group" "management" {
  count = var.enabled && var.create_security_groups ? 1 : 0

  name        = "${local.name_prefix}-pure-cbs-mgmt-sg"
  description = "Security group for Pure Storage CBS management"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTPS management"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.management_cidr_blocks
  }

  ingress {
    description = "SSH access"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.management_cidr_blocks
  }

  ingress {
    description = "Pure1 Cloud Connector"
    from_port   = 8443
    to_port     = 8443
    protocol    = "tcp"
    cidr_blocks = var.management_cidr_blocks
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-pure-cbs-mgmt-sg"
  })
}

resource "aws_security_group" "iscsi" {
  count = var.enabled && var.create_security_groups && var.iscsi_enabled ? 1 : 0

  name        = "${local.name_prefix}-pure-cbs-iscsi-sg"
  description = "Security group for Pure Storage CBS iSCSI"
  vpc_id      = var.vpc_id

  ingress {
    description = "iSCSI"
    from_port   = 3260
    to_port     = 3260
    protocol    = "tcp"
    cidr_blocks = var.client_cidr_blocks
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-pure-cbs-iscsi-sg"
  })
}

resource "aws_security_group" "nvme" {
  count = var.enabled && var.create_security_groups && var.nvme_enabled ? 1 : 0

  name        = "${local.name_prefix}-pure-cbs-nvme-sg"
  description = "Security group for Pure Storage CBS NVMe-oF"
  vpc_id      = var.vpc_id

  ingress {
    description = "NVMe-oF/TCP"
    from_port   = 4420
    to_port     = 4420
    protocol    = "tcp"
    cidr_blocks = var.client_cidr_blocks
  }

  ingress {
    description = "NVMe-oF discovery"
    from_port   = 8009
    to_port     = 8009
    protocol    = "tcp"
    cidr_blocks = var.client_cidr_blocks
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-pure-cbs-nvme-sg"
  })
}

resource "aws_security_group" "replication" {
  count = var.enabled && var.create_security_groups && var.enable_replication ? 1 : 0

  name        = "${local.name_prefix}-pure-cbs-repl-sg"
  description = "Security group for Pure Storage CBS replication"
  vpc_id      = var.vpc_id

  ingress {
    description = "Replication"
    from_port   = 8117
    to_port     = 8117
    protocol    = "tcp"
    cidr_blocks = var.replication_cidr_blocks
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-pure-cbs-repl-sg"
  })
}

#------------------------------------------------------------------------------
# Network Interfaces for CBS
#------------------------------------------------------------------------------

resource "aws_network_interface" "management" {
  count = var.enabled ? 1 : 0

  subnet_id       = var.management_subnet_id
  security_groups = var.create_security_groups ? [aws_security_group.management[0].id] : var.management_security_group_ids

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-pure-cbs-mgmt-eni"
  })
}

resource "aws_network_interface" "iscsi" {
  count = var.enabled && var.iscsi_enabled ? 1 : 0

  subnet_id       = var.iscsi_subnet_id
  security_groups = var.create_security_groups ? [aws_security_group.iscsi[0].id] : var.iscsi_security_group_ids

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-pure-cbs-iscsi-eni"
  })
}

resource "aws_network_interface" "replication" {
  count = var.enabled && var.enable_replication && var.replication_subnet_id != null ? 1 : 0

  subnet_id       = var.replication_subnet_id
  security_groups = var.create_security_groups ? [aws_security_group.replication[0].id] : var.replication_security_group_ids

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-pure-cbs-repl-eni"
  })
}

#------------------------------------------------------------------------------
# CloudWatch Log Group
#------------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "cbs" {
  count = var.enabled ? 1 : 0

  name              = "/aws/purestorage/cbs/${local.name_prefix}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn

  tags = local.common_tags
}

#------------------------------------------------------------------------------
# CloudWatch Alarms
#------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "capacity" {
  count = var.enabled && var.enable_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.name_prefix}-pure-cbs-capacity"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CapacityUtilization"
  namespace           = "PureStorage/CBS"
  period              = 300
  statistic           = "Average"
  threshold           = var.capacity_utilization_threshold
  alarm_description   = "Pure Storage CBS capacity utilization exceeds ${var.capacity_utilization_threshold}%"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ArrayName = var.array_name
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "latency" {
  count = var.enabled && var.enable_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.name_prefix}-pure-cbs-latency"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "AverageLatency"
  namespace           = "PureStorage/CBS"
  period              = 300
  statistic           = "Average"
  threshold           = var.latency_threshold_ms
  alarm_description   = "Pure Storage CBS latency exceeds ${var.latency_threshold_ms}ms"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ArrayName = var.array_name
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "iops" {
  count = var.enabled && var.enable_cloudwatch_alarms ? 1 : 0

  alarm_name          = "${local.name_prefix}-pure-cbs-iops"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "TotalIOPS"
  namespace           = "PureStorage/CBS"
  period              = 300
  statistic           = "Average"
  threshold           = var.iops_threshold
  alarm_description   = "Pure Storage CBS IOPS exceeds ${var.iops_threshold}"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ArrayName = var.array_name
  }

  alarm_actions = var.alarm_actions
  ok_actions    = var.ok_actions

  tags = local.common_tags
}

#------------------------------------------------------------------------------
# SSM Parameters for CBS Configuration
#------------------------------------------------------------------------------

resource "aws_ssm_parameter" "cbs_config" {
  count = var.enabled ? 1 : 0

  name        = "/${local.name_prefix}/purestorage/cbs/config"
  description = "Pure Storage CBS configuration"
  type        = "SecureString"
  key_id      = var.kms_key_arn

  value = jsonencode({
    array_name       = var.array_name
    deployment_type  = var.deployment_type
    capacity_tb      = var.capacity_tb
    iscsi_enabled    = var.iscsi_enabled
    nvme_enabled     = var.nvme_enabled
    host_groups      = var.host_groups
    volumes          = var.volumes
    protection_groups = var.protection_groups
  })

  tags = local.common_tags
}

#------------------------------------------------------------------------------
# Data Sources
#------------------------------------------------------------------------------

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}