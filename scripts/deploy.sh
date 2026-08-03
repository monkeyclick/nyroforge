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
AWS_REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null || echo "us-west-2")}"

if [ -z "$AWS_ACCOUNT" ]; then
    print_error "Unable to determine AWS account. Please configure AWS CLI with 'aws configure'"
    exit 1
fi

# bin/app.ts reads CDK_DEFAULT_ACCOUNT/CDK_DEFAULT_REGION. Without these the app
# synthesises against the hardcoded us-west-2 fallback with no account, so a
# deploy from any other region silently targeted the wrong environment.
export CDK_DEFAULT_ACCOUNT="$AWS_ACCOUNT"
export CDK_DEFAULT_REGION="$AWS_REGION"
export AWS_DEFAULT_REGION="$AWS_REGION"

print_status "Deploying to AWS Account: $AWS_ACCOUNT"
print_status "AWS Region: $AWS_REGION"

# Install dependencies
print_status "Installing dependencies..."
npm install

# Build Lambda bundles. Every Lambda's code asset is dist/lambda/<service>
# (lib/service-lambda.ts) and dist/ is gitignored, so skipping this makes
# `cdk deploy` fail during synthesis with "Cannot find asset".
print_status "Building Lambda functions..."
npm run build

if [ ! -d "dist/lambda" ] || [ -z "$(ls -A dist/lambda 2>/dev/null)" ]; then
    print_error "Lambda build produced no output in dist/lambda"
    exit 1
fi

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

print_status "Deploying storage stack..."
cdk deploy WorkstationStorage --require-approval never || {
    print_error "Storage deployment failed"
    exit 1
}
print_success "Storage stack deployed"

print_status "Deploying API stack..."
cdk deploy WorkstationApi --require-approval never || {
    print_error "API deployment failed"
    exit 1
}
print_success "API stack deployed"

print_status "Deploying admin API stack..."
cdk deploy WorkstationAdminApi --require-approval never || {
    print_error "Admin API deployment failed"
    exit 1
}
print_success "Admin API stack deployed"

print_status "Deploying frontend stack..."
cdk deploy WorkstationFrontend --require-approval never || {
    print_error "Frontend deployment failed"
    exit 1
}
print_success "Frontend stack deployed"

# The website stack is deployed later, by deploy-frontend.sh: its content is the
# compiled UI, and the UI needs the API and Cognito IDs below baked in at build
# time. Deploying it here would publish a bundle built without them.

# Get stack outputs
print_status "Retrieving deployment outputs..."

# Get User Pool ID from CDK outputs
USER_POOL_ID=$(aws cloudformation describe-stacks \
    --stack-name WorkstationInfrastructure \
    --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
    --output text --region "$AWS_REGION" 2>/dev/null || echo "")

if [ -z "$USER_POOL_ID" ]; then
    print_error "Could not retrieve User Pool ID from stack outputs"
    exit 1
fi

API_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name WorkstationApi \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
    --output text --region "$AWS_REGION" 2>/dev/null || echo "")

print_success "Retrieved stack outputs"
echo "  User Pool ID: $USER_POOL_ID"
echo "  API Endpoint: $API_ENDPOINT"

# Initialize admin system
print_status "Initializing admin system..."

# Set environment variables for initialization
export USER_POOL_ID="$USER_POOL_ID"
export AWS_REGION="$AWS_REGION"

# Set admin credentials (prompt if not set).
# `${VAR:-}` is required under `set -u`: a bare "$ADMIN_EMAIL" aborted the script
# with "unbound variable" here — after the full 20-minute deploy had succeeded.
if [ -z "${ADMIN_EMAIL:-}" ]; then
    read -p "Enter admin email address [admin@company.com]: " ADMIN_EMAIL
    ADMIN_EMAIL=${ADMIN_EMAIL:-admin@company.com}
fi

if [ -z "${ADMIN_NAME:-}" ]; then
    read -p "Enter admin full name [System Administrator]: " ADMIN_NAME
    ADMIN_NAME=${ADMIN_NAME:-"System Administrator"}
fi

if [ -z "${ADMIN_PASSWORD:-}" ]; then
    echo "Enter admin password (leave blank for auto-generated, min 12 chars with upper, lower, digit and symbol):"
    read -s ADMIN_PASSWORD
    echo ""
    if [ -z "$ADMIN_PASSWORD" ]; then
        # `tr -d` leaves openssl's trailing newline in place, so strip it before
        # taking a substring — otherwise a short base64 run could embed a
        # newline in the password. The suffix guarantees every required class.
        RANDOM_BASE=$(openssl rand -base64 24 | tr -d '+/=\n')
        ADMIN_PASSWORD="${RANDOM_BASE:0:16}!A1a"
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

# Seed the bootstrap package catalog. Without it the catalog is empty, so
# launched workstations receive no GPU driver and no DCV remote-access server —
# the instance boots but is unusable.
print_status "Seeding the bootstrap package catalog..."
BOOTSTRAP_PACKAGES_TABLE=$(aws cloudformation describe-stacks \
    --stack-name WorkstationInfrastructure \
    --query 'Stacks[0].Outputs[?OutputKey==`BootstrapPackagesTableName`].OutputValue' \
    --output text --region "$AWS_REGION" 2>/dev/null || echo "")
export BOOTSTRAP_PACKAGES_TABLE="${BOOTSTRAP_PACKAGES_TABLE:-WorkstationBootstrapPackages}"

node scripts/seed-bootstrap-packages.js || {
    print_error "Bootstrap package seeding failed"
    exit 1
}
node scripts/seed-dcv-package.js || {
    print_error "DCV package seeding failed"
    exit 1
}
print_success "Package catalog seeded"

# Build and deploy the web UI. deploy-frontend.sh reads the deployed endpoints,
# writes frontend/.env.local, builds the static export and publishes it — the
# only correct order, because Next.js inlines those values at build time. This
# step used to just run `npm run build` with no configuration and print manual
# hosting instructions pointing at frontend/build/, a directory the static export
# never produces.
read -p "Do you want to build and deploy the web UI now? (Y/n): " DEPLOY_FRONTEND
if [[ ! ${DEPLOY_FRONTEND:-y} =~ ^[Nn]$ ]]; then
    print_status "Deploying website stack..."
    cdk deploy WorkstationWebsite --require-approval never || {
        print_error "Website stack deployment failed"
        exit 1
    }

    print_status "Building and publishing the web UI..."
    ./scripts/deploy-frontend.sh || {
        print_error "Frontend deployment failed"
        exit 1
    }
    print_success "Web UI deployed"
else
    print_status "Skipping web UI deployment"
    print_warning "Run ./scripts/deploy-frontend.sh later to publish the UI"
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
echo "  ✅ Admin user created and added to the workstation-admin group"
echo "  ✅ Bootstrap package catalog seeded"
echo ""
echo "🔐 Admin Login Credentials:"
echo "  Email: $ADMIN_EMAIL"
echo "  Password: $ADMIN_PASSWORD (temporary — you must change it at first login)"
echo ""
echo "🌐 API Endpoint: $API_ENDPOINT"
echo "🆔 User Pool ID: $USER_POOL_ID"
echo ""
echo "📝 Next Steps:"
echo "  1. Open the website URL printed above"
echo "  2. Login with the admin credentials"
echo "  3. Set a permanent password when prompted"
echo "  4. Create additional users and assign Cognito groups"
echo ""
echo "📖 For detailed instructions, see: DEPLOYMENT_GUIDE.md"
echo "📖 Admin system details: docs/guides/ADMIN_SYSTEM_SETUP.md"
echo ""
print_warning "⚠️  IMPORTANT: Change the admin password immediately after first login!"