#!/bin/bash

# Test Group Package Service Integration
# This script performs comprehensive testing of the Group Package Service

set -e

REGION="us-west-2"
API_BASE="https://YOUR_API_ID.execute-api.us-west-2.amazonaws.com/api"
LAMBDA_NAME="MediaWorkstation-GroupPackageService"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Function to print test status
print_test() {
    echo -e "${BLUE}[TEST $TESTS_RUN]${NC} $1"
}

print_pass() {
    echo -e "${GREEN}✅ PASS${NC} $1"
    ((TESTS_PASSED++))
}

print_fail() {
    echo -e "${RED}❌ FAIL${NC} $1"
    ((TESTS_FAILED++))
}

print_info() {
    echo -e "${YELLOW}ℹ INFO${NC} $1"
}

# Function to run test
run_test() {
    ((TESTS_RUN++))
}

echo "========================================"
echo "Group Package Service Integration Tests"
echo "========================================"
echo ""

# Test 1: Health Check
run_test
print_test "API Health Check"
HEALTH_RESPONSE=$(curl -s -X GET "$API_BASE/health")
if echo "$HEALTH_RESPONSE" | grep -q '"status":"healthy"'; then
    print_pass "API is healthy"
    echo "$HEALTH_RESPONSE" | jq '.'
else
    print_fail "API health check failed"
    echo "$HEALTH_RESPONSE"
fi
echo ""

# Test 2: Verify DynamoDB Tables
run_test
print_test "DynamoDB Tables Status"
QUEUE_STATUS=$(aws dynamodb describe-table --table-name WorkstationPackageQueue --region $REGION --query 'Table.TableStatus' --output text 2>/dev/null || echo "ERROR")
BINDINGS_STATUS=$(aws dynamodb describe-table --table-name GroupPackageBindings --region $REGION --query 'Table.TableStatus' --output text 2>/dev/null || echo "ERROR")

if [ "$QUEUE_STATUS" = "ACTIVE" ] && [ "$BINDINGS_STATUS" = "ACTIVE" ]; then
    print_pass "Both DynamoDB tables are ACTIVE"
    echo "  - WorkstationPackageQueue: $QUEUE_STATUS"
    echo "  - GroupPackageBindings: $BINDINGS_STATUS"
else
    print_fail "DynamoDB tables not ready"
    echo "  - WorkstationPackageQueue: $QUEUE_STATUS"
    echo "  - GroupPackageBindings: $BINDINGS_STATUS"
fi
echo ""

# Test 3: Create Test Group Package Binding
run_test
print_test "Create Test Group Package Binding"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

aws dynamodb put-item \
  --table-name GroupPackageBindings \
  --item '{
    "PK": {"S": "GROUP#Developers"},
    "SK": {"S": "PACKAGE#chrome"},
    "packageId": {"S": "chrome"},
    "packageName": {"S": "Google Chrome"},
    "autoInstall": {"BOOL": true},
    "isMandatory": {"BOOL": false},
    "installOrder": {"N": "50"},
    "createdAt": {"S": "'"$TIMESTAMP"'"}
  }' \
  --region $REGION 2>&1

if [ $? -eq 0 ]; then
    print_pass "Created test group package binding (Developers -> chrome)"
else
    print_fail "Failed to create group package binding"
fi
echo ""

# Test 4: Create Another Test Binding (Mandatory Package)
run_test
print_test "Create Mandatory Package Binding"

aws dynamodb put-item \
  --table-name GroupPackageBindings \
  --item '{
    "PK": {"S": "GROUP#Developers"},
    "SK": {"S": "PACKAGE#vscode"},
    "packageId": {"S": "vscode"},
    "packageName": {"S": "Visual Studio Code"},
    "autoInstall": {"BOOL": true},
    "isMandatory": {"BOOL": true},
    "installOrder": {"N": "25"},
    "createdAt": {"S": "'"$TIMESTAMP"'"}
  }' \
  --region $REGION 2>&1

if [ $? -eq 0 ]; then
    print_pass "Created mandatory package binding (Developers -> vscode)"
else
    print_fail "Failed to create mandatory package binding"
fi
echo ""

# Test 5: Query Group Package Bindings
run_test
print_test "Query Group Package Bindings"
QUERY_RESULT=$(aws dynamodb query \
  --table-name GroupPackageBindings \
  --key-condition-expression "PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"GROUP#Developers"}}' \
  --region $REGION)

ITEM_COUNT=$(echo "$QUERY_RESULT" | jq '.Items | length')
if [ "$ITEM_COUNT" -ge 2 ]; then
    print_pass "Found $ITEM_COUNT package bindings for Developers group"
    echo "$QUERY_RESULT" | jq '.Items[] | {packageId: .packageId.S, packageName: .packageName.S, isMandatory: .isMandatory.BOOL, installOrder: .installOrder.N}'
else
    print_fail "Expected at least 2 bindings, found $ITEM_COUNT"
fi
echo ""

# Test 6: Create Test Workstation Queue Items
run_test
print_test "Create Test Workstation Queue Items"
TTL=$(($(date +%s) + 2592000)) # 30 days from now

# Create pending package
aws dynamodb put-item \
  --table-name WorkstationPackageQueue \
  --item '{
    "PK": {"S": "WORKSTATION#test-ws-123"},
    "SK": {"S": "PACKAGE#chrome"},
    "workstationId": {"S": "test-ws-123"},
    "packageId": {"S": "chrome"},
    "packageName": {"S": "Google Chrome"},
    "downloadUrl": {"S": "https://dl.google.com/chrome/install/ChromeSetup.exe"},
    "installCommand": {"S": "msiexec.exe"},
    "installArgs": {"S": "/i ChromeSetup.exe /quiet /norestart"},
    "status": {"S": "pending"},
    "installOrder": {"N": "50"},
    "required": {"BOOL": false},
    "retryCount": {"N": "0"},
    "maxRetries": {"N": "3"},
    "createdAt": {"S": "'"$TIMESTAMP"'"},
    "ttl": {"N": "'"$TTL"'"}
  }' \
  --region $REGION 2>&1

# Create completed package
aws dynamodb put-item \
  --table-name WorkstationPackageQueue \
  --item '{
    "PK": {"S": "WORKSTATION#test-ws-123"},
    "SK": {"S": "PACKAGE#vscode"},
    "workstationId": {"S": "test-ws-123"},
    "packageId": {"S": "vscode"},
    "packageName": {"S": "Visual Studio Code"},
    "downloadUrl": {"S": "https://code.visualstudio.com/sha/download?build=stable&os=win32-x64"},
    "installCommand": {"S": "msiexec.exe"},
    "installArgs": {"S": "/i VSCodeSetup.exe /quiet /norestart"},
    "status": {"S": "completed"},
    "installOrder": {"N": "25"},
    "required": {"BOOL": true},
    "retryCount": {"N": "0"},
    "maxRetries": {"N": "3"},
    "createdAt": {"S": "'"$TIMESTAMP"'"},
    "completedAt": {"S": "'"$TIMESTAMP"'"},
    "ttl": {"N": "'"$TTL"'"}
  }' \
  --region $REGION 2>&1

# Create failed package
aws dynamodb put-item \
  --table-name WorkstationPackageQueue \
  --item '{
    "PK": {"S": "WORKSTATION#test-ws-123"},
    "SK": {"S": "PACKAGE#firefox"},
    "workstationId": {"S": "test-ws-123"},
    "packageId": {"S": "firefox"},
    "packageName": {"S": "Mozilla Firefox"},
    "downloadUrl": {"S": "https://download.mozilla.org/?product=firefox-latest"},
    "installCommand": {"S": "msiexec.exe"},
    "installArgs": {"S": "/i FirefoxSetup.exe /quiet /norestart"},
    "status": {"S": "failed"},
    "installOrder": {"N": "40"},
    "required": {"BOOL": false},
    "retryCount": {"N": "1"},
    "maxRetries": {"N": "3"},
    "errorMessage": {"S": "Download timeout"},
    "createdAt": {"S": "'"$TIMESTAMP"'"},
    "lastAttemptAt": {"S": "'"$TIMESTAMP"'"},
    "ttl": {"N": "'"$TTL"'"}
  }' \
  --region $REGION 2>&1

if [ $? -eq 0 ]; then
    print_pass "Created 3 test queue items (pending, completed, failed)"
else
    print_fail "Failed to create queue items"
fi
echo ""

# Test 7: Query Package Installation Status
run_test
print_test "Query Package Installation Status"
STATUS_QUERY=$(aws dynamodb query \
  --table-name WorkstationPackageQueue \
  --key-condition-expression "PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"WORKSTATION#test-ws-123"}}' \
  --region $REGION)

QUEUE_COUNT=$(echo "$STATUS_QUERY" | jq '.Items | length')
if [ "$QUEUE_COUNT" -ge 3 ]; then
    print_pass "Found $QUEUE_COUNT packages in queue for test-ws-123"
    echo "$STATUS_QUERY" | jq '.Items[] | {packageId: .packageId.S, status: .status.S, required: .required.BOOL}'
else
    print_fail "Expected 3 queue items, found $QUEUE_COUNT"
fi
echo ""

# Test 8: Test Unauthorized API Access
run_test
print_test "Test Unauthorized API Access"
UNAUTH_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/user/group-packages")
HTTP_CODE=$(echo "$UNAUTH_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$UNAUTH_RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "401" ]; then
    print_pass "Unauthorized access correctly rejected (401)"
    echo "Response: $RESPONSE_BODY"
else
    print_fail "Expected 401, got $HTTP_CODE"
    echo "Response: $RESPONSE_BODY"
fi
echo ""

# Test 9: Test Lambda Function Directly
run_test
print_test "Invoke Lambda Function Directly (getUserGroupPackages)"

# Create test event
cat > /tmp/test-event.json <<EOF
{
  "httpMethod": "GET",
  "path": "/user/group-packages",
  "headers": {
    "Content-Type": "application/json"
  },
  "requestContext": {
    "authorizer": {
      "claims": {
        "email": "test@example.com",
        "sub": "test-user-123",
        "cognito:groups": ["Developers"]
      }
    }
  }
}
EOF

LAMBDA_RESPONSE=$(aws lambda invoke \
  --function-name $LAMBDA_NAME \
  --payload file:///tmp/test-event.json \
  --region $REGION \
  /tmp/lambda-response.json 2>&1)

if [ $? -eq 0 ]; then
    LAMBDA_STATUS=$(cat /tmp/lambda-response.json | jq -r '.statusCode')
    if [ "$LAMBDA_STATUS" = "200" ]; then
        print_pass "Lambda invocation successful (200)"
        cat /tmp/lambda-response.json | jq '.body | fromjson'
    else
        print_fail "Lambda returned status $LAMBDA_STATUS"
        cat /tmp/lambda-response.json | jq '.'
    fi
else
    print_fail "Lambda invocation failed"
    echo "$LAMBDA_RESPONSE"
fi
echo ""

# Test 10: Test getPackageInstallationStatus
run_test
print_test "Test getPackageInstallationStatus Lambda"

cat > /tmp/test-status-event.json <<EOF
{
  "httpMethod": "GET",
  "path": "/workstations/test-ws-123/packages/status",
  "pathParameters": {
    "workstationId": "test-ws-123"
  },
  "headers": {
    "Content-Type": "application/json"
  },
  "requestContext": {
    "authorizer": {
      "claims": {
        "email": "test@example.com",
        "sub": "test-user-123"
      }
    }
  }
}
EOF

aws lambda invoke \
  --function-name $LAMBDA_NAME \
  --payload file:///tmp/test-status-event.json \
  --region $REGION \
  /tmp/status-response.json 2>&1

if [ $? -eq 0 ]; then
    STATUS_CODE=$(cat /tmp/status-response.json | jq -r '.statusCode')
    if [ "$STATUS_CODE" = "200" ]; then
        print_pass "getPackageInstallationStatus successful"
        cat /tmp/status-response.json | jq '.body | fromjson'
    else
        print_fail "Status check returned $STATUS_CODE"
        cat /tmp/status-response.json | jq '.'
    fi
else
    print_fail "Status check invocation failed"
fi
echo ""

# Test 11: Check Lambda Logs
run_test
print_test "Check Lambda CloudWatch Logs"
LOG_STREAM=$(aws logs describe-log-streams \
  --log-group-name /aws/lambda/$LAMBDA_NAME \
  --order-by LastEventTime \
  --descending \
  --max-items 1 \
  --region $REGION \
  --query 'logStreams[0].logStreamName' \
  --output text)

if [ "$LOG_STREAM" != "None" ] && [ -n "$LOG_STREAM" ]; then
    print_pass "Found recent log stream: $LOG_STREAM"
    print_info "Recent log events:"
    aws logs get-log-events \
      --log-group-name /aws/lambda/$LAMBDA_NAME \
      --log-stream-name "$LOG_STREAM" \
      --limit 10 \
      --region $REGION \
      --query 'events[*].message' \
      --output text | tail -10
else
    print_fail "No log streams found"
fi
echo ""

# Test 12: Check Lambda Metrics
run_test
print_test "Check Lambda Invocation Metrics"
START_TIME=$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S)
END_TIME=$(date -u +%Y-%m-%dT%H:%M:%S)

INVOCATIONS=$(aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=$LAMBDA_NAME \
  --start-time "$START_TIME" \
  --end-time "$END_TIME" \
  --period 300 \
  --statistics Sum \
  --region $REGION \
  --query 'Datapoints[*].Sum' \
  --output text | awk '{s+=$1} END {print s}')

ERRORS=$(aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=$LAMBDA_NAME \
  --start-time "$START_TIME" \
  --end-time "$END_TIME" \
  --period 300 \
  --statistics Sum \
  --region $REGION \
  --query 'Datapoints[*].Sum' \
  --output text | awk '{s+=$1} END {print s}')

if [ -n "$INVOCATIONS" ]; then
    print_pass "Lambda metrics available"
    echo "  - Invocations (last hour): ${INVOCATIONS:-0}"
    echo "  - Errors (last hour): ${ERRORS:-0}"
else
    print_fail "No metrics data available yet"
fi
echo ""

# Cleanup
rm -f /tmp/test-event.json /tmp/lambda-response.json /tmp/test-status-event.json /tmp/status-response.json

# Summary
echo "========================================"
echo "Test Summary"
echo "========================================"
echo "Total Tests Run: $TESTS_RUN"
echo -e "Tests Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests Failed: ${RED}$TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ ALL TESTS PASSED${NC}"
    exit 0
else
    echo -e "${RED}❌ SOME TESTS FAILED${NC}"
    exit 1
fi