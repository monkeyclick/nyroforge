#!/bin/bash

# Complete Stack Cleanup and Fresh Deployment Script
# This script will delete all existing stacks and redeploy everything fresh

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

echo "🧹 Starting Complete Stack Cleanup and Fresh Deployment"
echo "======================================================="

# Check prerequisites
print_status "Checking prerequisites..."

if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is not installed. Please install and configure it first."
    exit 1
fi

if ! command -v cdk &> /dev/null; then
    print_error "AWS CDK is not installed. Please install it with: npm install -g aws-cdk"
    exit 1
fi

if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js first."
    exit 1
fi

print_success "Prerequisites check passed"

# Get AWS account and region info
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")
AWS_REGION=$(aws configure get region 2>/dev/null || echo "us-east-1")

if [ -z "$AWS_ACCOUNT" ]; then
    print_error "Unable to determine AWS account. Please configure AWS CLI with 'aws configure'"
    exit 1
fi

print_status "Working with AWS Account: $AWS_ACCOUNT"
print_status "AWS Region: $AWS_REGION"

# Confirm destruction
print_warning "⚠️  This will PERMANENTLY DELETE all existing CloudFormation stacks:"
echo "  - WorkstationWebsite"
echo "  - WorkstationFrontend" 
echo "  - WorkstationApi"
echo "  - WorkstationInfrastructure"
echo ""
print_warning "🗃️  This will also DELETE all data including:"
echo "  - All DynamoDB tables and their data"
echo "  - All user accounts and roles"
echo "  - All workstation records"
echo "  - All audit logs"
echo ""
read -p "Are you absolutely sure you want to continue? (type 'yes' to confirm): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    print_status "Operation cancelled by user"
    exit 0
fi

# Step 1: Destroy existing stacks
print_status "🧹 Destroying existing stacks..."

# Destroy stacks in reverse order (dependencies)
STACKS_TO_DESTROY=(
    "WorkstationWebsite"
    "WorkstationFrontend" 
    "WorkstationApi"
    "WorkstationInfrastructure"
)

for stack in "${STACKS_TO_DESTROY[@]}"; do
    print_status "Checking if stack $stack exists..."
    
    if aws cloudformation describe-stacks --stack-name "$stack" >/dev/null 2>&1; then
        print_status "Destroying stack: $stack"
        cdk destroy "$stack" --force || {
            print_warning "Failed to destroy $stack or stack doesn't exist. Continuing..."
        }
        print_success "Stack $stack destroyed"
    else
        print_status "Stack $stack doesn't exist, skipping"
    fi
done

# Wait a moment for AWS to fully clean up
print_status "Waiting for AWS cleanup to complete..."
sleep 10

# Step 2: Clean local build artifacts
print_status "🧹 Cleaning local build artifacts..."
rm -rf cdk.out/
rm -rf dist/
rm -rf node_modules/
rm -rf frontend/node_modules/
rm -rf frontend/build/

# Step 3: Fresh installation and deployment
print_status "🚀 Starting fresh installation and deployment..."

# Install root dependencies
print_status "Installing root dependencies..."
npm install

# Build Lambda functions
print_status "Building Lambda functions..."
npm run build

# Bootstrap CDK (if needed)
print_status "Bootstrapping CDK environment..."
cdk bootstrap aws://$AWS_ACCOUNT/$AWS_REGION || {
    print_warning "CDK bootstrap failed or already done. Continuing..."
}

# Deploy stacks in correct order
print_status "🏗️  Deploying infrastructure stack (this may take 10-15 minutes)..."
cdk deploy WorkstationInfrastructure --require-approval never || {
    print_error "Infrastructure deployment failed"
    exit 1
}
print_success "Infrastructure stack deployed"

print_status "🏗️  Deploying API stack..."
cdk deploy WorkstationApi --require-approval never || {
    print_error "API deployment failed"
    exit 1
}
print_success "API stack deployed"

print_status "🏗️  Deploying frontend stack..."
cdk deploy WorkstationFrontend --require-approval never || {
    print_error "Frontend deployment failed"
    exit 1
}
print_success "Frontend stack deployed"

print_status "🏗️  Deploying website stack..."
cdk deploy WorkstationWebsite --require-approval never || {
    print_warning "Website deployment failed or not needed. Continuing..."
}

# Get deployment outputs
print_status "📋 Retrieving deployment information..."

USER_POOL_ID=$(aws cloudformation describe-stacks \
    --stack-name WorkstationInfrastructure \
    --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
    --output text 2>/dev/null || echo "")

API_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name WorkstationApi \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
    --output text 2>/dev/null || echo "")

if [ -z "$USER_POOL_ID" ]; then
    print_error "Could not retrieve User Pool ID from stack outputs"
    exit 1
fi

print_success "Retrieved deployment information"
echo "  User Pool ID: $USER_POOL_ID"
echo "  API Endpoint: $API_ENDPOINT"

# Initialize admin system
print_status "🔑 Initializing admin system..."

export USER_POOL_ID="$USER_POOL_ID"
export AWS_REGION="$AWS_REGION"

# Get admin credentials
if [ -z "$ADMIN_EMAIL" ]; then
    read -p "Enter admin email address [admin@company.com]: " ADMIN_EMAIL
    ADMIN_EMAIL=${ADMIN_EMAIL:-admin@company.com}
fi

if [ -z "$ADMIN_NAME" ]; then
    read -p "Enter admin full name [System Administrator]: " ADMIN_NAME
    ADMIN_NAME=${ADMIN_NAME:-"System Administrator"}
fi

if [ -z "$ADMIN_PASSWORD" ]; then
    echo "Enter admin password (leave blank for auto-generated):"
    read -s ADMIN_PASSWORD
    if [ -z "$ADMIN_PASSWORD" ]; then
        ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(openssl rand -base64 16 | tr -d '+/=' | head -c 16)!A1}"
        echo "Admin password: $ADMIN_PASSWORD"
        echo "⚠️  Save this password - it will not be shown again."
    fi
fi

export ADMIN_EMAIL="$ADMIN_EMAIL"
export ADMIN_NAME="$ADMIN_NAME" 
export ADMIN_PASSWORD="$ADMIN_PASSWORD"

# Run initialization
node scripts/init-admin-system.js || {
    print_error "Admin system initialization failed"
    exit 1
}

print_success "Admin system initialized successfully"

# Build frontend
print_status "🎨 Building frontend application..."
cd frontend
npm install
npm run build
cd ..

print_success "Frontend built successfully"

# Final summary
echo ""
echo "============================================================="
print_success "🎉 Fresh Deployment Complete!"
echo "============================================================="
echo ""
echo "✅ All old stacks destroyed"
echo "✅ Fresh infrastructure deployed"
echo "✅ Admin system initialized"
echo "✅ Frontend application built"
echo ""
echo "🔐 Admin Login Credentials:"
echo "  Email: $ADMIN_EMAIL"
echo "  Password: $ADMIN_PASSWORD"
echo ""
echo "🌐 API Endpoint: $API_ENDPOINT"
echo "🆔 User Pool ID: $USER_POOL_ID"
echo ""
echo "📁 Frontend Build Location: frontend/build/"
echo ""
echo "📝 Next Steps:"
echo "  1. Deploy the frontend (frontend/build/) to your hosting platform"
echo "  2. Login with the admin credentials above"
echo "  3. Change the default password"
echo "  4. Start creating users and managing workstations"
echo ""
print_warning "⚠️  IMPORTANT: Change the admin password immediately after first login!"
echo ""
print_success "🚀 Your EC2 Workstation Manager with Admin System is ready!"