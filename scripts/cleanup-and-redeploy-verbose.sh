#!/bin/bash

# Enhanced Cleanup and Redeploy Script with Verbose Logging
# This script will destroy all existing stacks and redeploy with comprehensive logging

set -euo pipefail

echo "========================================="
echo "EC2 Workstation Manager - Enhanced Redeploy"
echo "========================================="
echo ""
echo "This script will:"
echo "1. Destroy all existing CloudFormation stacks"
echo "2. Clean all build artifacts"
echo "3. Rebuild Lambda functions with enhanced logging"
echo "4. Deploy all infrastructure fresh"
echo "5. Initialize admin system"
echo ""
read -p "Are you sure you want to proceed? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Deployment cancelled."
    exit 0
fi

echo ""
echo "========================================="
echo "Step 1: Destroying Existing Stacks"
echo "========================================="

# Function to check if stack exists
stack_exists() {
    aws cloudformation describe-stacks --stack-name "$1" >/dev/null 2>&1
}

# Function to wait for stack deletion
wait_for_deletion() {
    local stack_name=$1
    echo "Waiting for $stack_name to be deleted..."
    
    while stack_exists "$stack_name"; do
        local status=$(aws cloudformation describe-stacks --stack-name "$stack_name" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DELETED")
        echo "  Status: $status"
        
        if [ "$status" == "DELETE_FAILED" ]; then
            echo "⚠️  Warning: Stack deletion failed. You may need to manually clean up resources."
            break
        fi
        
        if [ "$status" == "DELETED" ] || [ "$status" == "" ]; then
            break
        fi
        
        sleep 10
    done
    
    echo "✅ $stack_name deleted"
}

# Destroy stacks in reverse order of dependencies using AWS CLI directly
STACKS=(
    "WorkstationWebsite"
    "WorkstationFrontend"
    "WorkstationApi"
    "WorkstationInfrastructure"
)

for stack in "${STACKS[@]}"; do
    if stack_exists "$stack"; then
        echo "Destroying $stack..."
        aws cloudformation delete-stack --stack-name "$stack"
        wait_for_deletion "$stack"
    else
        echo "Stack $stack does not exist, skipping..."
    fi
done

echo ""
echo "========================================="
echo "Step 2: Cleaning Build Artifacts"
echo "========================================="

echo "Removing dist directory..."
rm -rf dist/

echo "Removing cdk.out directory..."
rm -rf cdk.out/

echo "Removing node_modules in lambda functions..."
find src/lambda -name "node_modules" -type d -exec rm -rf {} + 2>/dev/null || true

echo "Removing frontend build..."
rm -rf frontend/build/ frontend/.next/ frontend/out/

echo "✅ Build artifacts cleaned"

echo ""
echo "========================================="
echo "Step 3: Installing Dependencies"
echo "========================================="

echo "Installing root dependencies..."
npm install

echo "Installing frontend dependencies..."
cd frontend && npm install && cd ..

echo "✅ Dependencies installed"

echo ""
echo "========================================="
echo "Step 4: Building Lambda Functions"
echo "========================================="

echo "Building Lambda functions with enhanced logging..."
npm run build

# Verify Lambda builds
LAMBDA_FUNCTIONS=(
    "ec2-management"
    "status-monitor"
    "cost-analytics"
    "config-service"
    "credentials-service"
    "user-profile-service"
    "user-management-service"
)

echo ""
echo "Verifying Lambda builds..."
for func in "${LAMBDA_FUNCTIONS[@]}"; do
    if [ ! -d "dist/lambda/$func" ]; then
        echo "❌ Lambda build failed - dist/lambda/$func not found"
        exit 1
    fi
    echo "  ✅ $func"
done

echo "✅ All Lambda functions built successfully"

echo ""
echo "========================================="
echo "Step 5: Synthesizing CDK Stacks"
echo "========================================="

echo "Running CDK synth..."
npx cdk synth

echo "✅ CDK stacks synthesized"

echo ""
echo "========================================="
echo "Step 6: Deploying Infrastructure Stack"
echo "========================================="

echo "Deploying WorkstationInfrastructure..."
npx cdk deploy WorkstationInfrastructure --require-approval never

echo "✅ Infrastructure stack deployed"

echo ""
echo "========================================="
echo "Step 7: Deploying API Stack"
echo "========================================="

echo "Deploying WorkstationApi..."
npx cdk deploy WorkstationApi --require-approval never

echo "✅ API stack deployed"

echo ""
echo "========================================="
echo "Step 8: Deploying Frontend Stack"
echo "========================================="

echo "Deploying WorkstationFrontend..."
npx cdk deploy WorkstationFrontend --require-approval never

echo "✅ Frontend stack deployed"

echo ""
echo "========================================="
echo "Step 9: Deploying Website Stack"
echo "========================================="

echo "Deploying WorkstationWebsite..."
npx cdk deploy WorkstationWebsite --require-approval never

echo "✅ Website stack deployed"

echo ""
echo "========================================="
echo "Step 10: Initializing Admin System"
echo "========================================="

echo "Running admin system initialization..."
if [ -f "scripts/init-admin-system.js" ]; then
    node scripts/init-admin-system.js
    echo "✅ Admin system initialized"
else
    echo "⚠️  Warning: scripts/init-admin-system.js not found, skipping initialization"
    echo "You may need to create admin users manually"
fi

echo ""
echo "========================================="
echo "Step 11: Getting Stack Outputs"
echo "========================================="

echo ""
echo "Fetching deployment information..."
echo ""

# Get API endpoint
API_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name WorkstationApi \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
    --output text 2>/dev/null || echo "Not available")

# Get User Pool ID
USER_POOL_ID=$(aws cloudformation describe-stacks \
    --stack-name WorkstationInfrastructure \
    --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
    --output text 2>/dev/null || echo "Not available")

# Get User Pool Client ID
USER_POOL_CLIENT_ID=$(aws cloudformation describe-stacks \
    --stack-name WorkstationInfrastructure \
    --query 'Stacks[0].Outputs[?OutputKey==`UserPoolClientId`].OutputValue' \
    --output text 2>/dev/null || echo "Not available")

# Get CloudFront URL
CLOUDFRONT_URL=$(aws cloudformation describe-stacks \
    --stack-name WorkstationWebsite \
    --query 'Stacks[0].Outputs[?OutputKey==`WebsiteURL`].OutputValue' \
    --output text 2>/dev/null || echo "Not available")

echo "========================================="
echo "Deployment Complete!"
echo "========================================="
echo ""
echo "📋 Deployment Information:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "API Endpoint:        $API_ENDPOINT"
echo "User Pool ID:        $USER_POOL_ID"
echo "User Pool Client ID: $USER_POOL_CLIENT_ID"
echo "Website URL:         $CLOUDFRONT_URL"
echo ""
echo "🔐 Default Admin Credentials:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Email:    ${ADMIN_EMAIL:-admin@workstation.local}"
echo "Password: ${ADMIN_PASSWORD:-<set via ADMIN_PASSWORD env var>}"
echo ""
echo "⚠️  IMPORTANT: Change the admin password immediately after first login!"
echo ""
echo "📝 Next Steps:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. Access the application at: $CLOUDFRONT_URL"
echo "2. Login with the admin credentials above"
echo "3. Change the admin password immediately"
echo "4. Create additional users and assign roles"
echo ""
echo "🔍 Troubleshooting:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Check Lambda logs:"
echo "  aws logs tail /aws/lambda/MediaWorkstation-EC2Management --follow"
echo ""
echo "Check API Gateway logs:"
echo "  aws logs tail /aws/apigateway/WorkstationApi --follow"
echo ""
echo "List all workstations:"
echo "  aws dynamodb scan --table-name WorkstationInfrastructure-WorkstationsTable*"
echo ""
echo "Check all CloudFormation stacks:"
echo "  aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE"
echo ""
echo "========================================="
echo "✅ Enhanced deployment complete with verbose logging enabled!"
echo "========================================="