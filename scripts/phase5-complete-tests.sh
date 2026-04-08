#!/bin/bash

# Phase 5 Complete Integration Testing Suite
# Executes all remaining tests to complete Phase 5

set -e

REGION="us-west-2"
API_BASE="https://YOUR_API_ID.execute-api.us-west-2.amazonaws.com/api"
LAMBDA_NAME="MediaWorkstation-GroupPackageService"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

print_test() {
    ((TESTS_RUN++))
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

echo "=========================================="
echo "Phase 5 Complete Integration Testing"
echo "=========================================="
echo ""

# Test 11: Admin POST - Add package to group (valid package)
print_test "Admin POST: Add 7zip to Developers group"
RESPONSE=$(aws lambda invoke \
  --function-name $LAMBDA_NAME \
  --cli-binary-format raw-in-base64-out \
  --payload '{"httpMethod":"POST","path":"/admin/groups/Developers/packages","pathParameters":{"groupId":"Developers"},"body":"{\"packageId\":\"pkg-7zip\",\"autoInstall\":true,\"isMandatory\":false,\"installOrder\":40}","headers":{"Content-Type":"application/json"},"requestContext":{"authorizer":{"claims":{"email":"admin@example.com","sub":"admin-123","cognito:groups":["workstation-admin"]}}}}' \
  --region $REGION \
  /tmp/test11.json 2>&1)

STATUS=$(cat /tmp/test11.json | jq -r '.statusCode')
if [ "$STATUS" = "201" ] || [ "$STATUS" = "200" ]; then
    print_pass "Package added successfully (Status: $STATUS)"
    cat /tmp/test11.json | jq '.body | fromjson'
else
    print_fail "Expected 200/201, got $STATUS"
    cat /tmp/test11.json | jq '.'
fi
echo ""

# Test 12: Admin PUT - Update package settings
print_test "Admin PUT: Update 7zip to mandatory"
RESPONSE=$(aws lambda invoke \
  --function-name $LAMBDA_NAME \
  --cli-binary-format raw-in-base64-out \
  --payload '{"httpMethod":"PUT","path":"/admin/groups/Developers/packages/pkg-7zip","pathParameters":{"groupId":"Developers","packageId":"pkg-7zip"},"body":"{\"isMandatory\":true,\"installOrder\":25}","headers":{"Content-Type":"application/json"},"requestContext":{"authorizer":{"claims":{"email":"admin@example.com","sub":"admin-123"}}}}' \
  --region $REGION \
  /tmp/test12.json 2>&1)

STATUS=$(cat /tmp/test12.json | jq -r '.statusCode')
if [ "$STATUS" = "200" ]; then
    print_pass "Package updated successfully"
    MANDATORY=$(cat /tmp/test12.json | jq -r '.body | fromjson | .binding.isMandatory')
    if [ "$MANDATORY" = "true" ]; then
        echo "  ✓ isMandatory correctly set to true"
    fi
else
    print_fail "Expected 200, got $STATUS"
fi
echo ""

# Test 13: Admin DELETE - Remove package from group
print_test "Admin DELETE: Remove 7zip from Developers group"
RESPONSE=$(aws lambda invoke \
  --function-name $LAMBDA_NAME \
  --cli-binary-format raw-in-base64-out \
  --payload '{"httpMethod":"DELETE","path":"/admin/groups/Developers/packages/pkg-7zip","pathParameters":{"groupId":"Developers","packageId":"pkg-7zip"},"headers":{"Content-Type":"application/json"},"requestContext":{"authorizer":{"claims":{"email":"admin@example.com","sub":"admin-123"}}}}' \
  --region $REGION \
  /tmp/test13.json 2>&1)

STATUS=$(cat /tmp/test13.json | jq -r '.statusCode')
if [ "$STATUS" = "200" ]; then
    print_pass "Package removed successfully"
    SUCCESS=$(cat /tmp/test13.json | jq -r '.body | fromjson | .success')
    if [ "$SUCCESS" = "true" ]; then
        echo "  ✓ Success flag confirmed"
    fi
else
    print_fail "Expected 200, got $STATUS"
fi
echo ""

# Test 14: Error - Invalid package ID
print_test "Error Handling: Invalid package ID"
RESPONSE=$(aws lambda invoke \
  --function-name $LAMBDA_NAME \
  --cli-binary-format raw-in-base64-out \
  --payload '{"httpMethod":"POST","path":"/admin/groups/Developers/packages","pathParameters":{"groupId":"Developers"},"body":"{\"packageId\":\"nonexistent-package-xyz\",\"autoInstall\":true}","headers":{"Content-Type":"application/json"},"requestContext":{"authorizer":{"claims":{"email":"admin@example.com","sub":"admin-123"}}}}' \
  --region $REGION \
  /tmp/test14.json 2>&1)

STATUS=$(cat /tmp/test14.json | jq -r '.statusCode')
if [ "$STATUS" = "404" ]; then
    print_pass "Invalid package correctly rejected with 404"
else
    print_fail "Expected 404, got $STATUS"
fi
echo ""

# Test 15: Error - Missing required parameter
print_test "Error Handling: Missing packageId parameter"
RESPONSE=$(aws lambda invoke \
  --function-name $LAMBDA_NAME \
  --cli-binary-format raw-in-base64-out \
  --payload '{"httpMethod":"POST","path":"/admin/groups/Developers/packages","pathParameters":{"groupId":"Developers"},"body":"{\"autoInstall\":true}","headers":{"Content-Type":"application/json"},"requestContext":{"authorizer":{"claims":{"email":"admin@example.com","sub":"admin-123"}}}}' \
  --region $REGION \
  /tmp/test15.json 2>&1)

STATUS=$(cat /tmp/test15.json | jq -r '.statusCode')
if [ "$STATUS" = "400" ]; then
    print_pass "Missing parameter correctly rejected with 400"
else
    print_fail "Expected 400, got $STATUS"
fi
echo ""

# Test 16: Admin POST - Add packages to workstation queue
print_test "Admin POST: Add packages to workstation queue"
RESPONSE=$(aws lambda invoke \
  --function-name $LAMBDA_NAME \
  --cli-binary-format raw-in-base64-out \
  --payload '{"httpMethod":"POST","path":"/admin/workstations/test-ws-456/packages","pathParameters":{"workstationId":"test-ws-456"},"body":"{\"packageIds\":[\"pkg-7zip\",\"pkg-obs-studio\"]}","headers":{"Content-Type":"application/json"},"requestContext":{"authorizer":{"claims":{"email":"admin@example.com","sub":"admin-123"}}}}' \
  --region $REGION \
  /tmp/test16.json 2>&1)

STATUS=$(cat /tmp/test16.json | jq -r '.statusCode')
if [ "$STATUS" = "201" ] || [ "$STATUS" = "200" ]; then
    print_pass "Packages added to workstation queue"
    ADDED=$(cat /tmp/test16.json | jq -r '.body | fromjson | .added')
    echo "  ✓ Added $ADDED packages"
else
    print_fail "Expected 200/201, got $STATUS"
fi
echo ""

# Test 17: Retry failed package
print_test "Retry Package Installation: Mark as failed then retry"

# First create a failed package
TTL=$(($(date +%s) + 2592000))
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
aws dynamodb put-item \
  --table-name WorkstationPackageQueue \
  --item "{\"PK\":{\"S\":\"WORKSTATION#test-ws-789\"},\"SK\":{\"S\":\"PACKAGE#failed-pkg\"},\"workstationId\":{\"S\":\"test-ws-789\"},\"packageId\":{\"S\":\"failed-pkg\"},\"packageName\":{\"S\":\"Failed Package\"},\"status\":{\"S\":\"failed\"},\"errorMessage\":{\"S\":\"Download timeout\"},\"installOrder\":{\"N\":\"50\"},\"required\":{\"BOOL\":false},\"retryCount\":{\"N\":\"1\"},\"maxRetries\":{\"N\":\"3\"},\"createdAt\":{\"S\":\"$TIMESTAMP\"},\"ttl\":{\"N\":\"$TTL\"}}" \
  --region $REGION > /dev/null 2>&1

# Now retry it
RESPONSE=$(aws lambda invoke \
  --function-name $LAMBDA_NAME \
  --cli-binary-format raw-in-base64-out \
  --payload '{"httpMethod":"POST","path":"/workstations/test-ws-789/packages/failed-pkg/retry","pathParameters":{"workstationId":"test-ws-789","packageId":"failed-pkg"},"headers":{"Content-Type":"application/json"},"requestContext":{"authorizer":{"claims":{"email":"user@example.com","sub":"user-123"}}}}' \
  --region $REGION \
  /tmp/test17.json 2>&1)

STATUS=$(cat /tmp/test17.json | jq -r '.statusCode')
if [ "$STATUS" = "200" ]; then
    print_pass "Package retry successful"
    NEW_STATUS=$(cat /tmp/test17.json | jq -r '.body | fromjson | .package.status')
    if [ "$NEW_STATUS" = "pending" ]; then
        echo "  ✓ Status changed to pending"
    fi
else
    print_fail "Expected 200, got $STATUS"
fi
echo ""

# Test 18: Query multiple packages
print_test "Query Multiple Packages: Check workstation with 2+ packages"
STATUS_RESPONSE=$(aws lambda invoke \
  --function-name $LAMBDA_NAME \
  --cli-binary-format raw-in-base64-out \
  --payload '{"httpMethod":"GET","path":"/workstations/test-ws-456/packages/status","pathParameters":{"workstationId":"test-ws-456"},"requestContext":{"authorizer":{"claims":{"email":"user@example.com","sub":"user-123"}}}}' \
  --region $REGION \
  /tmp/test18.json 2>&1)

STATUS=$(cat /tmp/test18.json | jq -r '.statusCode')
TOTAL=$(cat /tmp/test18.json | jq -r '.body | fromjson | .summary.total')
if [ "$STATUS" = "200" ] && [ "$TOTAL" -ge 2 ]; then
    print_pass "Multiple packages retrieved (Total: $TOTAL)"
else
    print_fail "Expected 2+ packages, got $TOTAL"
fi
echo ""

# Test 19: Performance - Response time check
print_test "Performance: API response time measurement"
START=$(date +%s%N)
curl -s "$API_BASE/health" > /dev/null
END=$(date +%s%N)
DURATION=$(( (END - START) / 1000000 ))

if [ $DURATION -lt 1000 ]; then
    print_pass "Response time: ${DURATION}ms (< 1000ms target)"
else
    print_fail "Response time: ${DURATION}ms (>= 1000ms target)"
fi
echo ""

# Test 20: Lambda metrics check
print_test "Lambda Metrics: Check invocations and errors"
START_TIME=$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S)
END_TIME=$(date -u +%Y-%m-%dT%H:%M:%S)

INVOCATIONS=$(aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=$LAMBDA_NAME \
  --start-time "$START_TIME" \
  --end-time "$END_TIME" \
  --period 3600 \
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
  --period 3600 \
  --statistics Sum \
  --region $REGION \
  --query 'Datapoints[*].Sum' \
  --output text | awk '{s+=$1} END {print s}')

INVOCATIONS=${INVOCATIONS:-0}
ERRORS=${ERRORS:-0}

if [ "$INVOCATIONS" -gt 0 ]; then
    print_pass "Lambda invoked $INVOCATIONS times with $ERRORS errors"
    echo "  ✓ Error rate: $(awk "BEGIN {printf \"%.2f\", ($ERRORS/$INVOCATIONS)*100}")%"
else
    print_fail "No Lambda invocations recorded"
fi
echo ""

# Summary
echo "=========================================="
echo "Phase 5 Complete - Test Summary"
echo "=========================================="
echo "Total Tests Run: $TESTS_RUN"
echo -e "Tests Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests Failed: ${RED}$TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ ALL TESTS PASSED - PHASE 5 COMPLETE${NC}"
    exit 0
else
    echo -e "${RED}❌ SOME TESTS FAILED${NC}"
    exit 1
fi