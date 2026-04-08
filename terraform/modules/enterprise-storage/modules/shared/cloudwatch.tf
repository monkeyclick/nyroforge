#------------------------------------------------------------------------------
# Shared CloudWatch Module
# 
# Creates CloudWatch dashboards, alarms, and log groups for storage monitoring.
#------------------------------------------------------------------------------

locals {
  cloudwatch_tags = merge(var.tags, {
    Module    = "shared-cloudwatch"
    Purpose   = "Storage Monitoring"
    ManagedBy = "terraform"
  })
}

#------------------------------------------------------------------------------
# CloudWatch Dashboard for Storage Overview
#------------------------------------------------------------------------------

resource "aws_cloudwatch_dashboard" "storage_overview" {
  count = var.create_dashboard ? 1 : 0

  dashboard_name = var.dashboard_name != null ? var.dashboard_name : "${var.project_name}-${var.environment}-storage-overview"

  dashboard_body = jsonencode({
    widgets = concat(
      # Header widget
      [
        {
          type   = "text"
          x      = 0
          y      = 0
          width  = 24
          height = 1
          properties = {
            markdown = "# Enterprise Storage Dashboard - ${var.project_name} (${var.environment})"
          }
        }
      ],
      # FSx Metrics
      var.include_fsx_metrics ? [
        {
          type   = "metric"
          x      = 0
          y      = 1
          width  = 8
          height = 6
          properties = {
            title  = "FSx Storage Capacity"
            region = data.aws_region.current.name
            metrics = [
              ["AWS/FSx", "StorageCapacity", { "stat" : "Average", "period" : 300 }]
            ]
            view = "timeSeries"
          }
        },
        {
          type   = "metric"
          x      = 8
          y      = 1
          width  = 8
          height = 6
          properties = {
            title  = "FSx Free Storage Capacity"
            region = data.aws_region.current.name
            metrics = [
              ["AWS/FSx", "FreeStorageCapacity", { "stat" : "Average", "period" : 300 }]
            ]
            view = "timeSeries"
          }
        },
        {
          type   = "metric"
          x      = 16
          y      = 1
          width  = 8
          height = 6
          properties = {
            title  = "FSx Network Throughput"
            region = data.aws_region.current.name
            metrics = [
              ["AWS/FSx", "DataReadBytes", { "stat" : "Sum", "period" : 300, "label" : "Read" }],
              [".", "DataWriteBytes", { "stat" : "Sum", "period" : 300, "label" : "Write" }]
            ]
            view = "timeSeries"
          }
        }
      ] : [],
      # EFS Metrics
      var.include_efs_metrics ? [
        {
          type   = "metric"
          x      = 0
          y      = 7
          width  = 8
          height = 6
          properties = {
            title  = "EFS Client Connections"
            region = data.aws_region.current.name
            metrics = [
              ["AWS/EFS", "ClientConnections", { "stat" : "Sum", "period" : 300 }]
            ]
            view = "timeSeries"
          }
        },
        {
          type   = "metric"
          x      = 8
          y      = 7
          width  = 8
          height = 6
          properties = {
            title  = "EFS IO Operations"
            region = data.aws_region.current.name
            metrics = [
              ["AWS/EFS", "DataReadIOBytes", { "stat" : "Sum", "period" : 300, "label" : "Read" }],
              [".", "DataWriteIOBytes", { "stat" : "Sum", "period" : 300, "label" : "Write" }]
            ]
            view = "timeSeries"
          }
        },
        {
          type   = "metric"
          x      = 16
          y      = 7
          width  = 8
          height = 6
          properties = {
            title  = "EFS Burst Credit Balance"
            region = data.aws_region.current.name
            metrics = [
              ["AWS/EFS", "BurstCreditBalance", { "stat" : "Average", "period" : 300 }]
            ]
            view = "timeSeries"
          }
        }
      ] : [],
      # Alarm Status Widget
      [
        {
          type   = "alarm"
          x      = 0
          y      = 13
          width  = 24
          height = 4
          properties = {
            title  = "Storage Alarm Status"
            alarms = var.alarm_arns
          }
        }
      ]
    )
  })
}

#------------------------------------------------------------------------------
# CloudWatch Log Group for Storage Logs
#------------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "storage" {
  count = var.create_log_group ? 1 : 0

  name              = "/aws/storage/${var.project_name}-${var.environment}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn

  tags = merge(local.cloudwatch_tags, {
    Name = "${var.project_name}-${var.environment}-storage-logs"
  })
}

#------------------------------------------------------------------------------
# SNS Topic for Storage Alerts
#------------------------------------------------------------------------------

resource "aws_sns_topic" "storage_alerts" {
  count = var.create_sns_topic ? 1 : 0

  name              = "${var.project_name}-${var.environment}-storage-alerts"
  kms_master_key_id = var.kms_key_arn

  tags = merge(local.cloudwatch_tags, {
    Name = "${var.project_name}-${var.environment}-storage-alerts"
  })
}

resource "aws_sns_topic_policy" "storage_alerts" {
  count = var.create_sns_topic ? 1 : 0

  arn = aws_sns_topic.storage_alerts[0].arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudWatchAlarms"
        Effect = "Allow"
        Principal = {
          Service = "cloudwatch.amazonaws.com"
        }
        Action   = "sns:Publish"
        Resource = aws_sns_topic.storage_alerts[0].arn
        Condition = {
          ArnLike = {
            "aws:SourceArn" = "arn:aws:cloudwatch:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:alarm:*"
          }
        }
      },
      {
        Sid    = "AllowAWSEvents"
        Effect = "Allow"
        Principal = {
          Service = "events.amazonaws.com"
        }
        Action   = "sns:Publish"
        Resource = aws_sns_topic.storage_alerts[0].arn
      }
    ]
  })
}

resource "aws_sns_topic_subscription" "email" {
  for_each = var.create_sns_topic ? toset(var.alert_email_addresses) : toset([])

  topic_arn = aws_sns_topic.storage_alerts[0].arn
  protocol  = "email"
  endpoint  = each.value
}

#------------------------------------------------------------------------------
# CloudWatch Composite Alarm for Storage Health
#------------------------------------------------------------------------------

resource "aws_cloudwatch_composite_alarm" "storage_health" {
  count = var.create_composite_alarm && length(var.alarm_arns) > 0 ? 1 : 0

  alarm_name        = "${var.project_name}-${var.environment}-storage-health"
  alarm_description = "Composite alarm for overall storage health"

  alarm_rule = join(" OR ", [
    for arn in var.alarm_arns : "ALARM(${element(split(":", arn), length(split(":", arn)) - 1)})"
  ])

  alarm_actions = var.create_sns_topic ? [aws_sns_topic.storage_alerts[0].arn] : var.alarm_actions
  ok_actions    = var.create_sns_topic ? [aws_sns_topic.storage_alerts[0].arn] : var.ok_actions

  tags = local.cloudwatch_tags
}

#------------------------------------------------------------------------------
# CloudWatch Metric Alarms
#------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "storage_capacity_warning" {
  count = var.create_capacity_alarm ? 1 : 0

  alarm_name          = "${var.project_name}-${var.environment}-storage-capacity-warning"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = var.capacity_warning_threshold
  alarm_description   = "Storage capacity utilization exceeds ${var.capacity_warning_threshold}%"
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "capacity_utilization"
    expression  = "(used/total)*100"
    label       = "Capacity Utilization"
    return_data = true
  }

  metric_query {
    id = "used"
    metric {
      metric_name = "StorageUsed"
      namespace   = "EnterpriseStorage"
      period      = 300
      stat        = "Average"
      dimensions = {
        Environment = var.environment
      }
    }
  }

  metric_query {
    id = "total"
    metric {
      metric_name = "StorageTotal"
      namespace   = "EnterpriseStorage"
      period      = 300
      stat        = "Average"
      dimensions = {
        Environment = var.environment
      }
    }
  }

  alarm_actions = var.create_sns_topic ? [aws_sns_topic.storage_alerts[0].arn] : var.alarm_actions
  ok_actions    = var.create_sns_topic ? [aws_sns_topic.storage_alerts[0].arn] : var.ok_actions

  tags = local.cloudwatch_tags
}

resource "aws_cloudwatch_metric_alarm" "storage_capacity_critical" {
  count = var.create_capacity_alarm ? 1 : 0

  alarm_name          = "${var.project_name}-${var.environment}-storage-capacity-critical"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = var.capacity_critical_threshold
  alarm_description   = "CRITICAL: Storage capacity utilization exceeds ${var.capacity_critical_threshold}%"
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "capacity_utilization"
    expression  = "(used/total)*100"
    label       = "Capacity Utilization"
    return_data = true
  }

  metric_query {
    id = "used"
    metric {
      metric_name = "StorageUsed"
      namespace   = "EnterpriseStorage"
      period      = 300
      stat        = "Average"
      dimensions = {
        Environment = var.environment
      }
    }
  }

  metric_query {
    id = "total"
    metric {
      metric_name = "StorageTotal"
      namespace   = "EnterpriseStorage"
      period      = 300
      stat        = "Average"
      dimensions = {
        Environment = var.environment
      }
    }
  }

  alarm_actions = var.create_sns_topic ? [aws_sns_topic.storage_alerts[0].arn] : var.alarm_actions
  ok_actions    = var.create_sns_topic ? [aws_sns_topic.storage_alerts[0].arn] : var.ok_actions

  tags = local.cloudwatch_tags
}

#------------------------------------------------------------------------------
# EventBridge Rules for Storage Events
#------------------------------------------------------------------------------

resource "aws_cloudwatch_event_rule" "fsx_events" {
  count = var.create_event_rules ? 1 : 0

  name        = "${var.project_name}-${var.environment}-fsx-events"
  description = "Capture FSx file system events"

  event_pattern = jsonencode({
    source      = ["aws.fsx"]
    detail-type = ["FSx File System State Change"]
  })

  tags = local.cloudwatch_tags
}

resource "aws_cloudwatch_event_target" "fsx_events" {
  count = var.create_event_rules && var.create_sns_topic ? 1 : 0

  rule      = aws_cloudwatch_event_rule.fsx_events[0].name
  target_id = "SendToSNS"
  arn       = aws_sns_topic.storage_alerts[0].arn

  input_transformer {
    input_paths = {
      fileSystemId = "$.detail.fileSystemId"
      state        = "$.detail.state"
      time         = "$.time"
    }
    input_template = "\"FSx File System <fileSystemId> changed state to <state> at <time>\""
  }
}

resource "aws_cloudwatch_event_rule" "backup_events" {
  count = var.create_event_rules ? 1 : 0

  name        = "${var.project_name}-${var.environment}-backup-events"
  description = "Capture AWS Backup events"

  event_pattern = jsonencode({
    source      = ["aws.backup"]
    detail-type = ["Backup Job State Change", "Restore Job State Change"]
    detail = {
      state = ["FAILED", "EXPIRED", "COMPLETED"]
    }
  })

  tags = local.cloudwatch_tags
}

resource "aws_cloudwatch_event_target" "backup_events" {
  count = var.create_event_rules && var.create_sns_topic ? 1 : 0

  rule      = aws_cloudwatch_event_rule.backup_events[0].name
  target_id = "SendToSNS"
  arn       = aws_sns_topic.storage_alerts[0].arn
}

#------------------------------------------------------------------------------
# Data Sources
#------------------------------------------------------------------------------

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}