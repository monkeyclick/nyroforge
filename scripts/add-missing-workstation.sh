#!/bin/bash

# Script to manually add a missing workstation record to DynamoDB
# Usage: ./scripts/add-missing-workstation.sh <instance-id> <user-id> [workstation-id]

set -euo pipefail

INSTANCE_ID="${1:?Error: Instance ID required as first argument}"
USER_ID="${2:?Error: User ID required as second argument}"
WORKSTATION_ID="${3:-ws-$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "manual-$(date +%s)")}"
TABLE_NAME="${WORKSTATION_TABLE:-WorkstationManagement}"
REGION="${AWS_REGION:-us-west-2}"

echo "Adding missing workstation record to DynamoDB..."
echo "Instance ID: $INSTANCE_ID"
echo "Workstation ID: $WORKSTATION_ID"
echo "Table: $TABLE_NAME"
echo ""

# Get instance details from EC2
echo "Fetching instance details from EC2..."
INSTANCE_INFO=$(aws ec2 describe-instances \
  --instance-ids "$INSTANCE_ID" \
  --region "$REGION" \
  --query 'Reservations[0].Instances[0]' \
  --output json)

if [ $? -ne 0 ]; then
  echo "Error: Failed to fetch instance details"
  exit 1
fi

INSTANCE_TYPE=$(echo "$INSTANCE_INFO" | jq -r '.InstanceType')
AMI_ID=$(echo "$INSTANCE_INFO" | jq -r '.ImageId')
SUBNET_ID=$(echo "$INSTANCE_INFO" | jq -r '.SubnetId')
VPC_ID=$(echo "$INSTANCE_INFO" | jq -r '.VpcId')
AZ=$(echo "$INSTANCE_INFO" | jq -r '.Placement.AvailabilityZone')
SECURITY_GROUP=$(echo "$INSTANCE_INFO" | jq -r '.SecurityGroups[0].GroupId')
PUBLIC_IP=$(echo "$INSTANCE_INFO" | jq -r '.PublicIpAddress // ""')
PRIVATE_IP=$(echo "$INSTANCE_INFO" | jq -r '.PrivateIpAddress // ""')
STATE=$(echo "$INSTANCE_INFO" | jq -r '.State.Name')
LAUNCH_TIME=$(echo "$INSTANCE_INFO" | jq -r '.LaunchTime')

echo "Instance Type: $INSTANCE_TYPE"
echo "State: $STATE"
echo "Public IP: $PUBLIC_IP"
echo ""

# Get current timestamp
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

# Create DynamoDB item
echo "Creating DynamoDB record..."

aws dynamodb put-item \
  --table-name "$TABLE_NAME" \
  --region "$REGION" \
  --item "{
    \"PK\": {\"S\": \"WORKSTATION#$WORKSTATION_ID\"},
    \"SK\": {\"S\": \"METADATA\"},
    \"instanceId\": {\"S\": \"$INSTANCE_ID\"},
    \"userId\": {\"S\": \"$USER_ID\"},
    \"userRole\": {\"S\": \"user\"},
    \"region\": {\"S\": \"$REGION\"},
    \"availabilityZone\": {\"S\": \"$AZ\"},
    \"instanceType\": {\"S\": \"$INSTANCE_TYPE\"},
    \"osVersion\": {\"S\": \"windows-server-2025\"},
    \"amiId\": {\"S\": \"$AMI_ID\"},
    \"vpcId\": {\"S\": \"$VPC_ID\"},
    \"subnetId\": {\"S\": \"$SUBNET_ID\"},
    \"securityGroupId\": {\"S\": \"$SECURITY_GROUP\"},
    \"publicIp\": {\"S\": \"$PUBLIC_IP\"},
    \"privateIp\": {\"S\": \"$PRIVATE_IP\"},
    \"authMethod\": {\"S\": \"local\"},
    \"localAdminUser\": {\"S\": \"Administrator\"},
    \"status\": {\"S\": \"$STATE\"},
    \"launchTime\": {\"S\": \"$LAUNCH_TIME\"},
    \"lastStatusCheck\": {\"S\": \"$TIMESTAMP\"},
    \"estimatedHourlyCost\": {\"N\": \"1.0\"},
    \"estimatedMonthlyCost\": {\"N\": \"720.0\"},
    \"actualCostToDate\": {\"N\": \"0\"},
    \"tags\": {\"M\": {}},
    \"createdAt\": {\"S\": \"$TIMESTAMP\"},
    \"updatedAt\": {\"S\": \"$TIMESTAMP\"}
  }"

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Success! Workstation record created in DynamoDB"
  echo ""
  echo "The workstation should now appear in your dashboard."
  echo "You may need to refresh the page."
else
  echo ""
  echo "❌ Error: Failed to create DynamoDB record"
  exit 1
fi