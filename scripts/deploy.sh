#!/bin/bash

# AWS CDK Deployment Script for EC2 Workstation Manager with Admin System
# This script deploys the complete infrastructure and initializes the admin system

set -euo pipefail

echo "🚀 Starting AWS CDK Deployment for EC2 Workstation Manager"
echo "============================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
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

# Check prerequisites
print_status "Checking prerequisites..."

# Check if AWS CLI is installed and configured
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is not installed. Please install and configure it first."
    exit 1
fi

# Check if CDK is installed
if ! command -v cdk &> /dev/null; then
    print_error "AWS CDK is not installed. Please install it with: npm install -g aws-cdk"
    exit 1
fi

# Check if Node.js and npm are available
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js first."
    exit 1
fi

if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install npm first."
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

print_status "Deploying to AWS Account: $AWS_ACCOUNT"
print_status "AWS Region: $AWS_REGION"

# Install dependencies
print_status "Installing dependencies..."
npm install

# Build Lambda functions
print_status "Building Lambda functions..."
npm run build

# Bootstrap CDK (if not already done)
print_status "Bootstrapping CDK environment..."
cdk bootstrap aws://$AWS_ACCOUNT/$AWS_REGION || {
    print_warning "CDK bootstrap failed or already done. Continuing..."
}

# Deploy stacks in order
print_status "Deploying infrastructure stack..."
cdk deploy WorkstationInfrastructure --require-approval never || {
    print_error "Infrastructure deployment failed"
    exit 1
}
print_success "Infrastructure stack deployed"

print_status "Deploying API stack..."
cdk deploy WorkstationApi --require-approval never || {
    print_error "API deployment failed"
    exit 1
}
print_success "API stack deployed"

print_status "Deploying frontend stack..."
cdk deploy WorkstationFrontend --require-approval never || {
    print_error "Frontend deployment failed"
    exit 1
}
print_success "Frontend stack deployed"

print_status "Deploying website stack..."
cdk deploy WorkstationWebsite --require-approval never || {
    print_warning "Website deployment failed or not needed. Continuing..."
}

# Get stack outputs
print_status "Retrieving deployment outputs..."

# Get User Pool ID from CDK outputs
USER_POOL_ID=$(aws cloudformation describe-stacks \
    --stack-name WorkstationInfrastructure \
    --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
    --output text 2>/dev/null || echo "")

if [ -z "$USER_POOL_ID" ]; then
    print_error "Could not retrieve User Pool ID from stack outputs"
    exit 1
fi

API_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name WorkstationApi \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
    --output text 2>/dev/null || echo "")

print_success "Retrieved stack outputs"
echo "  User Pool ID: $USER_POOL_ID"
echo "  API Endpoint: $API_ENDPOINT"

# Initialize admin system
print_status "Initializing admin system..."

# Set environment variables for initialization
export USER_POOL_ID="$USER_POOL_ID"
export AWS_REGION="$AWS_REGION"

# Set admin credentials (prompt if not set)
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

# Run initialization script
node scripts/init-admin-system.js || {
    print_error "Admin system initialization failed"
    exit 1
}

print_success "Admin system initialized"

# Deploy frontend (optional)
read -p "Do you want to deploy the frontend now? (y/N): " DEPLOY_FRONTEND
if [[ $DEPLOY_FRONTEND =~ ^[Yy]$ ]]; then
    print_status "Building frontend..."
    cd frontend
    npm install
    npm run build
    
    print_status "Frontend built successfully"
    print_warning "Frontend build completed. You can now:"
    echo "  1. Deploy to AWS Amplify"
    echo "  2. Upload to S3 static website hosting"
    echo "  3. Deploy to your preferred hosting platform"
    echo ""
    echo "Build files are located in: frontend/build/"
    cd ..
else
    print_status "Skipping frontend deployment"
fi

# Display deployment summary
echo ""
echo "============================================================"
print_success "🎉 Deployment Complete!"
echo "============================================================"
echo ""
echo "📋 Deployment Summary:"
echo "  ✅ Infrastructure deployed"
echo "  ✅ API deployed"
echo "  ✅ Admin system initialized" 
echo "  ✅ Default admin user created"
echo ""
echo "🔐 Admin Login Credentials:"
echo "  Email: $ADMIN_EMAIL"
echo "  Password: $ADMIN_PASSWORD"
echo ""
echo "🌐 API Endpoint: $API_ENDPOINT"
echo "🆔 User Pool ID: $USER_POOL_ID"
echo ""
echo "📝 Next Steps:"
echo "  1. Deploy the frontend application"
echo "  2. Login with admin credentials"
echo "  3. Change the default password"
echo "  4. Create additional users and assign roles"
echo ""
echo "📖 For detailed instructions, see: ADMIN_SYSTEM_SETUP.md"
echo ""
print_warning "⚠️  IMPORTANT: Change the admin password immediately after first login!"