#!/bin/bash

# Script to sync a Cognito user to DynamoDB EnhancedUsers table
# Usage: USER_POOL_ID=xxx USER_EMAIL=user@example.com ./scripts/sync-cognito-user-to-dynamodb.sh

set -euo pipefail

USER_POOL_ID="${USER_POOL_ID:?Error: USER_POOL_ID environment variable must be set}"
USER_EMAIL="${USER_EMAIL:-${1:-}}"
if [ -z "$USER_EMAIL" ]; then
  echo "Error: USER_EMAIL environment variable or first argument must be provided"
  echo "Usage: USER_EMAIL=user@example.com USER_POOL_ID=xxx $0"
  echo "   or: USER_POOL_ID=xxx $0 user@example.com"
  exit 1
fi
EMAIL="$USER_EMAIL"
TABLE_NAME="${USERS_TABLE:-EnhancedUsers}"

echo "=========================================="
echo "Syncing Cognito User to DynamoDB"
echo "=========================================="
echo "Email: $EMAIL"
echo "User Pool: $USER_POOL_ID"
echo "Table: $TABLE_NAME"
echo ""

# Get Cognito user details
echo "Fetching Cognito user..."
USER_DATA=$(aws cognito-idp list-users \
  --user-pool-id "$USER_POOL_ID" \
  --filter "email = \"$EMAIL\"" \
  --output json)

if [ "$(echo "$USER_DATA" | jq -r '.Users | length')" -eq "0" ]; then
  echo "❌ Error: User not found in Cognito User Pool"
  exit 1
fi

# Extract user details
COGNITO_USER_ID=$(echo "$USER_DATA" | jq -r '.Users[0].Username')
USER_STATUS=$(echo "$USER_DATA" | jq -r '.Users[0].UserStatus')
GIVEN_NAME=$(echo "$USER_DATA" | jq -r '.Users[0].Attributes[] | select(.Name=="given_name") | .Value // "User"')
FAMILY_NAME=$(echo "$USER_DATA" | jq -r '.Users[0].Attributes[] | select(.Name=="family_name") | .Value // ""')
FULL_NAME="$GIVEN_NAME $FAMILY_NAME"

echo "✓ Found Cognito user:"
echo "  User ID: $COGNITO_USER_ID"
echo "  Name: $FULL_NAME"
echo "  Status: $USER_STATUS"
echo ""

# Check if user already exists in DynamoDB
echo "Checking DynamoDB..."
EXISTING=$(aws dynamodb get-item \
  --table-name "$TABLE_NAME" \
  --key "{\"id\": {\"S\": \"$COGNITO_USER_ID\"}}" \
  --output json 2>/dev/null || echo "{}")

if [ "$(echo "$EXISTING" | jq -r '.Item')" != "null" ]; then
  echo "⚠️  User already exists in DynamoDB"
  echo "   Updating existing record..."
  
  aws dynamodb update-item \
    --table-name "$TABLE_NAME" \
    --key "{\"id\": {\"S\": \"$COGNITO_USER_ID\"}}" \
    --update-expression "SET #name = :name, #email = :email, #status = :status, updatedAt = :updated" \
    --expression-attribute-names '{"#name": "name", "#email": "email", "#status": "status"}' \
    --expression-attribute-values "{
      \":name\": {\"S\": \"$FULL_NAME\"},
      \":email\": {\"S\": \"$EMAIL\"},
      \":status\": {\"S\": \"active\"},
      \":updated\": {\"S\": \"$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")\"}
    }"
  
  echo "✓ User updated in DynamoDB"
else
  echo "Creating new user in DynamoDB..."
  
  aws dynamodb put-item \
    --table-name "$TABLE_NAME" \
    --item "{
      \"id\": {\"S\": \"$COGNITO_USER_ID\"},
      \"email\": {\"S\": \"$EMAIL\"},
      \"name\": {\"S\": \"$FULL_NAME\"},
      \"status\": {\"S\": \"active\"},
      \"roleIds\": {\"L\": [{\"S\": \"user\"}]},
      \"groupIds\": {\"L\": []},
      \"directPermissions\": {\"L\": []},
      \"createdAt\": {\"S\": \"$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")\"},
      \"updatedAt\": {\"S\": \"$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")\"}
    }"
  
  echo "✓ User created in DynamoDB"
fi

echo ""
echo "=========================================="
echo "✓ Sync Complete!"
echo "=========================================="
echo ""
echo "User $EMAIL can now log in to the application."
echo ""