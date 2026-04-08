#!/bin/bash

# Setup Production Monitoring for Phase 6
# Creates CloudWatch Alarms and Dashboard

set -euo pipefail

REGION="${AWS_REGION:-us-west-2}"
LAMBDA_NAME="${LAMBDA_FUNCTION_NAME:-MediaWorkstation-GroupPackageService}"
API_ID="${API_GATEWAY_ID:?Error: API_GATEWAY_ID environment variable must be set}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query 'Account' --output text)}"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "=========================================="
echo "Production Monitoring Setup"
echo "=========================================="
echo ""

# Create SNS Topic for Alerts
echo -e "${BLUE}Creating SNS Topic for Alerts...${NC}"
SNS_TOPIC_ARN=$(aws sns create-topic \
  --name MediaWorkstation-Production-Alerts \
  --region $REGION \
  --query 'TopicArn' \
  --output text 2>/dev/null || \
  aws sns list-topics --region $REGION --query "Topics[?contains(TopicArn, 'MediaWorkstation-Production-Alerts')].TopicArn" --output text)

echo "SNS Topic ARN: $SNS_TOPIC_ARN"
echo ""

# Subscribe email to SNS topic (optional - would need actual email)
# aws sns subscribe \
#   --topic-arn $SNS_TOPIC_ARN \
#   --protocol email \
#   --notification-endpoint admin@example.com \
#   --region $REGION

# Lambda Alarms
echo -e "${BLUE}Creating Lambda CloudWatch Alarms...${NC}"

# Alarm 1: High Error Rate
aws cloudwatch put-metric-alarm \
  --alarm-name "${LAMBDA_NAME}-HighErrorRate" \
  --alarm-description "Alert when Lambda error rate exceeds 1%" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 1 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=FunctionName,Value=$LAMBDA_NAME \
  --alarm-actions $SNS_TOPIC_ARN \
  --region $REGION

echo "✓ Created: ${LAMBDA_NAME}-HighErrorRate"

# Alarm 2: High Duration
aws cloudwatch put-metric-alarm \
  --alarm-name "${LAMBDA_NAME}-HighDuration" \
  --alarm-description "Alert when Lambda duration exceeds 5000ms" \
  --metric-name Duration \
  --namespace AWS/Lambda \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 5000 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=FunctionName,Value=$LAMBDA_NAME \
  --alarm-actions $SNS_TOPIC_ARN \
  --region $REGION

echo "✓ Created: ${LAMBDA_NAME}-HighDuration"

# Alarm 3: Throttled Invocations
aws cloudwatch put-metric-alarm \
  --alarm-name "${LAMBDA_NAME}-Throttles" \
  --alarm-description "Alert when Lambda invocations are throttled" \
  --metric-name Throttles \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 60 \
  --evaluation-periods 1 \
  --threshold 0 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=FunctionName,Value=$LAMBDA_NAME \
  --alarm-actions $SNS_TOPIC_ARN \
  --region $REGION

echo "✓ Created: ${LAMBDA_NAME}-Throttles"

# API Gateway Alarms
echo ""
echo -e "${BLUE}Creating API Gateway CloudWatch Alarms...${NC}"

# Alarm 4: High 5xx Error Rate
aws cloudwatch put-metric-alarm \
  --alarm-name "APIGateway-${API_ID}-High5xxErrors" \
  --alarm-description "Alert when API Gateway 5xx error rate exceeds 1%" \
  --metric-name 5XXError \
  --namespace AWS/ApiGateway \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=ApiId,Value=$API_ID \
  --alarm-actions $SNS_TOPIC_ARN \
  --region $REGION

echo "✓ Created: APIGateway-${API_ID}-High5xxErrors"

# Alarm 5: High Latency
aws cloudwatch put-metric-alarm \
  --alarm-name "APIGateway-${API_ID}-HighLatency" \
  --alarm-description "Alert when API Gateway latency exceeds 2000ms" \
  --metric-name Latency \
  --namespace AWS/ApiGateway \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 2000 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=ApiId,Value=$API_ID \
  --alarm-actions $SNS_TOPIC_ARN \
  --region $REGION

echo "✓ Created: APIGateway-${API_ID}-HighLatency"

# DynamoDB Alarms
echo ""
echo -e "${BLUE}Creating DynamoDB CloudWatch Alarms...${NC}"

for TABLE in "WorkstationPackageQueue" "GroupPackageBindings"; do
  # Alarm 6: Read Throttles
  aws cloudwatch put-metric-alarm \
    --alarm-name "DynamoDB-${TABLE}-ReadThrottles" \
    --alarm-description "Alert when DynamoDB read operations are throttled" \
    --metric-name ReadThrottleEvents \
    --namespace AWS/DynamoDB \
    --statistic Sum \
    --period 60 \
    --evaluation-periods 1 \
    --threshold 0 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=TableName,Value=$TABLE \
    --alarm-actions $SNS_TOPIC_ARN \
    --region $REGION
  
  echo "✓ Created: DynamoDB-${TABLE}-ReadThrottles"
  
  # Alarm 7: Write Throttles
  aws cloudwatch put-metric-alarm \
    --alarm-name "DynamoDB-${TABLE}-WriteThrottles" \
    --alarm-description "Alert when DynamoDB write operations are throttled" \
    --metric-name WriteThrottleEvents \
    --namespace AWS/DynamoDB \
    --statistic Sum \
    --period 60 \
    --evaluation-periods 1 \
    --threshold 0 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=TableName,Value=$TABLE \
    --alarm-actions $SNS_TOPIC_ARN \
    --region $REGION
  
  echo "✓ Created: DynamoDB-${TABLE}-WriteThrottles"
done

# Create CloudWatch Dashboard
echo ""
echo -e "${BLUE}Creating CloudWatch Dashboard...${NC}"

cat > /tmp/dashboard-body.json << EOF
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/Lambda", "Invocations", {"stat": "Sum", "label": "Total Invocations"}],
          [".", "Errors", {"stat": "Sum", "label": "Errors"}],
          [".", "Throttles", {"stat": "Sum", "label": "Throttles"}]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "$REGION",
        "title": "Lambda Invocations & Errors",
        "period": 300,
        "dimensions": {
          "FunctionName": ["$LAMBDA_NAME"]
        }
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/Lambda", "Duration", {"stat": "Average", "label": "Average"}],
          ["...", {"stat": "p50", "label": "P50"}],
          ["...", {"stat": "p95", "label": "P95"}],
          ["...", {"stat": "p99", "label": "P99"}]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "$REGION",
        "title": "Lambda Duration (ms)",
        "period": 300,
        "dimensions": {
          "FunctionName": ["$LAMBDA_NAME"]
        }
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/Lambda", "ConcurrentExecutions", {"stat": "Maximum", "label": "Concurrent Executions"}]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "$REGION",
        "title": "Lambda Concurrent Executions",
        "period": 60,
        "dimensions": {
          "FunctionName": ["$LAMBDA_NAME"]
        }
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/ApiGateway", "Count", {"stat": "Sum", "label": "Request Count"}],
          [".", "4XXError", {"stat": "Sum", "label": "4XX Errors"}],
          [".", "5XXError", {"stat": "Sum", "label": "5XX Errors"}]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "$REGION",
        "title": "API Gateway Requests & Errors",
        "period": 300,
        "dimensions": {
          "ApiId": ["$API_ID"]
        }
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/ApiGateway", "Latency", {"stat": "Average", "label": "Average"}],
          ["...", {"stat": "p50", "label": "P50"}],
          ["...", {"stat": "p95", "label": "P95"}],
          ["...", {"stat": "p99", "label": "P99"}]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "$REGION",
        "title": "API Gateway Latency (ms)",
        "period": 300,
        "dimensions": {
          "ApiId": ["$API_ID"]
        }
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/DynamoDB", "ConsumedReadCapacityUnits", {"stat": "Sum"}],
          [".", "ConsumedWriteCapacityUnits", {"stat": "Sum"}]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "$REGION",
        "title": "DynamoDB Consumed Capacity",
        "period": 300
      }
    },
    {
      "type": "log",
      "properties": {
        "query": "SOURCE '/aws/lambda/$LAMBDA_NAME'\n| fields @timestamp, @message\n| filter @message like /ERROR/\n| sort @timestamp desc\n| limit 20",
        "region": "$REGION",
        "title": "Recent Lambda Errors",
        "stacked": false
      }
    }
  ]
}
EOF

aws cloudwatch put-dashboard \
  --dashboard-name MediaWorkstation-Production \
  --dashboard-body file:///tmp/dashboard-body.json \
  --region $REGION

echo "✓ Created: MediaWorkstation-Production Dashboard"
echo ""

# Summary
echo "=========================================="
echo -e "${GREEN}Monitoring Setup Complete!${NC}"
echo "=========================================="
echo ""
echo "Created Resources:"
echo "  - SNS Topic: MediaWorkstation-Production-Alerts"
echo "  - Lambda Alarms: 3"
echo "  - API Gateway Alarms: 2"
echo "  - DynamoDB Alarms: 4 (2 per table)"
echo "  - CloudWatch Dashboard: MediaWorkstation-Production"
echo ""
echo "Dashboard URL:"
echo "https://console.aws.amazon.com/cloudwatch/home?region=$REGION#dashboards:name=MediaWorkstation-Production"
echo ""
echo "SNS Topic ARN:"
echo "$SNS_TOPIC_ARN"
echo ""
echo "To subscribe to email alerts, run:"
echo "aws sns subscribe --topic-arn $SNS_TOPIC_ARN --protocol email --notification-endpoint YOUR_EMAIL@example.com --region $REGION"
echo ""