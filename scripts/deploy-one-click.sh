#!/bin/bash

################################################################################
# EC2 Workstation Manager - One-Click Deployment Script
# 
# This script automates the entire deployment process:
# - Checks prerequisites
# - Installs dependencies
# - Bootstraps CDK
# - Deploys infrastructure
# - Creates admin user
# - Configures system parameters
# 
# Usage: ./deploy-one-click.sh
################################################################################

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

log_section() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Prompt for input with default value
prompt_input() {
    local prompt="$1"
    local default="$2"
    local result
    
    if [ -n "$default" ]; then
        read -p "$prompt [$default]: " result
        echo "${result:-$default}"
    else
        read -p "$prompt: " result
        echo "$result"
    fi
}

# Prompt yes/no question
prompt_yes_no() {
    local prompt="$1"
    local default="${2:-y}"
    local result
    
    if [ "$default" = "y" ]; then
        read -p "$prompt [Y/n]: " result
        result="${result:-y}"
    else
        read -p "$prompt [y/N]: " result
        result="${result:-n}"
    fi
    
    [[ "$result" =~ ^[Yy] ]]
}

################################################################################
# PRE-FLIGHT CHECKS
################################################################################

log_section "Pre-Flight Checks"

# Check if running in project directory
if [ ! -f "cdk.json" ]; then
    log_error "This script must be run from the project root directory"
    log_info "Please cd to the ec2mgr4me directory and try again"
    exit 1
fi

log_info "Checking prerequisites..."

# Check Node.js
if ! command_exists node; then
    log_error "Node.js is not installed"
    log_info "Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    log_error "Node.js version must be 18 or higher (found: $(node -v))"
    exit 1
fi
log_success "Node.js $(node -v) found"

# Check npm
if ! command_exists npm; then
    log_error "npm is not installed"
    exit 1
fi
log_success "npm $(npm -v) found"

# Check AWS CLI
if ! command_exists aws; then
    log_error "AWS CLI is not installed"
    log_info "Please install AWS CLI from https://aws.amazon.com/cli/"
    exit 1
fi

AWS_VERSION=$(aws --version | cut -d' ' -f1 | cut -d'/' -f2 | cut -d'.' -f1)
if [ "$AWS_VERSION" -lt 2 ]; then
    log_warning "AWS CLI version 2 is recommended (found: $(aws --version))"
fi
log_success "AWS CLI found"

# Check AWS credentials
if ! aws sts get-caller-identity >/dev/null 2>&1; then
    log_error "AWS credentials not configured or invalid"
    log_info "Please run: aws configure"
    exit 1
fi

AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
AWS_USER=$(aws sts get-caller-identity --query Arn --output text)
log_success "AWS credentials valid"
log_info "  Account: $AWS_ACCOUNT"
log_info "  Identity: $AWS_USER"

# Check CDK
if ! command_exists cdk; then
    log_warning "AWS CDK not found, installing globally..."
    npm install -g aws-cdk
    log_success "AWS CDK installed"
else
    log_success "AWS CDK $(cdk --version) found"
fi

################################################################################
# CONFIGURATION
################################################################################

log_section "Configuration"

# Get deployment region
DEFAULT_REGION=$(aws configure get region || echo "us-west-2")
DEPLOYMENT_REGION=$(prompt_input "Enter AWS region for deployment" "$DEFAULT_REGION")

log_info "Setting environment variables..."
export CDK_DEFAULT_ACCOUNT="$AWS_ACCOUNT"
export CDK_DEFAULT_REGION="$DEPLOYMENT_REGION"

# Get admin email
log_info ""
ADMIN_EMAIL=$(prompt_input "Enter admin email address" "admin@company.com")

# Ask about domain join
log_info ""
USE_DOMAIN_JOIN=false
if prompt_yes_no "Will you use Active Directory domain join?" "n"; then
    USE_DOMAIN_JOIN=true
    DOMAIN_NAME=$(prompt_input "Enter domain name" "corp.example.com")
    DOMAIN_OU=$(prompt_input "Enter OU path" "OU=Workstations,DC=corp,DC=example,DC=com")
fi

# Confirm configuration
log_info ""
log_info "Deployment Configuration:"
log_info "  Account: $AWS_ACCOUNT"
log_info "  Region: $DEPLOYMENT_REGION"
log_info "  Admin Email: $ADMIN_EMAIL"
if [ "$USE_DOMAIN_JOIN" = true ]; then
    log_info "  Domain: $DOMAIN_NAME"
    log_info "  OU Path: $DOMAIN_OU"
fi

log_info ""
if ! prompt_yes_no "Proceed with deployment?" "y"; then
    log_warning "Deployment cancelled"
    exit 0
fi

################################################################################
# INSTALL DEPENDENCIES
################################################################################

log_section "Installing Dependencies"

log_info "Installing root dependencies..."
npm install --silent

log_info "Installing Lambda function dependencies..."
if [ -d "src/lambda/cognito-admin-service" ]; then
    cd src/lambda/cognito-admin-service
    npm install --silent
    cd ../../..
    log_success "Cognito admin service dependencies installed"
fi

log_info "Installing frontend dependencies..."
if [ -d "frontend" ]; then
    cd frontend
    npm install --silent
    cd ..
    log_success "Frontend dependencies installed"
fi

log_success "All dependencies installed"

################################################################################
# CDK BOOTSTRAP
################################################################################

log_section "CDK Bootstrap"

# Check if already bootstrapped
BOOTSTRAP_STACK="CDKToolkit"
if aws cloudformation describe-stacks --stack-name "$BOOTSTRAP_STACK" --region "$DEPLOYMENT_REGION" >/dev/null 2>&1; then
    log_info "CDK already bootstrapped in $DEPLOYMENT_REGION"
else
    log_info "Bootstrapping CDK in $DEPLOYMENT_REGION..."
    cdk bootstrap "aws://$AWS_ACCOUNT/$DEPLOYMENT_REGION"
    log_success "CDK bootstrap complete"
fi

################################################################################
# DEPLOY INFRASTRUCTURE
################################################################################

log_section "Deploying Infrastructure"

log_info "This will take approximately 15-25 minutes..."
log_info ""

# Deploy all stacks
log_info "Deploying CDK stacks..."
cdk deploy --all \
    --require-approval never \
    --outputs-file cdk-outputs.json \
    --progress events

log_success "Infrastructure deployed successfully"

# Verify outputs file exists
if [ ! -f "cdk-outputs.json" ]; then
    log_error "Deployment outputs file not found"
    exit 1
fi

################################################################################
# POST-DEPLOYMENT CONFIGURATION
################################################################################

log_section "Post-Deployment Configuration"

# Extract outputs
log_info "Extracting deployment outputs..."
USER_POOL_ID=$(cat cdk-outputs.json | grep -o '"UserPoolId"[^,]*' | cut -d'"' -f4 | head -1)
API_ENDPOINT=$(cat cdk-outputs.json | grep -o '"ApiEndpoint"[^,]*' | cut -d'"' -f4 | head -1)
WEBSITE_URL=$(cat cdk-outputs.json | grep -o '"WebsiteUrl"[^,]*' | cut -d'"' -f4 | head -1)

if [ -z "$USER_POOL_ID" ] || [ -z "$API_ENDPOINT" ] || [ -z "$WEBSITE_URL" ]; then
    log_error "Failed to extract deployment outputs"
    log_info "Please check cdk-outputs.json manually"
    exit 1
fi

log_success "Outputs extracted"
log_info "  User Pool ID: $USER_POOL_ID"
log_info "  API Endpoint: $API_ENDPOINT"
log_info "  Website URL: $WEBSITE_URL"

# Create admin user
log_info ""
log_info "Creating admin user..."
TEMP_PASSWORD="${ADMIN_PASSWORD:-$(openssl rand -base64 16 | tr -d '+/=' | head -c 16)!A1}"

aws cognito-idp admin-create-user \
    --user-pool-id "$USER_POOL_ID" \
    --username "$ADMIN_EMAIL" \
    --user-attributes \
        Name=email,Value="$ADMIN_EMAIL" \
        Name=email_verified,Value=true \
    --temporary-password "$TEMP_PASSWORD" \
    --message-action SUPPRESS \
    --region "$DEPLOYMENT_REGION" >/dev/null 2>&1

aws cognito-idp admin-add-user-to-group \
    --user-pool-id "$USER_POOL_ID" \
    --username "$ADMIN_EMAIL" \
    --group-name workstation-admin \
    --region "$DEPLOYMENT_REGION" >/dev/null 2>&1

log_success "Admin user created"

# Configure system parameters
log_info ""
log_info "Configuring system parameters..."

aws ssm put-parameter \
    --name "/workstation/config/defaultRegion" \
    --value "$DEPLOYMENT_REGION" \
    --type "String" \
    --overwrite \
    --region "$DEPLOYMENT_REGION" >/dev/null 2>&1

aws ssm put-parameter \
    --name "/workstation/config/allowedInstanceTypes" \
    --value '["g4dn.xlarge","g5.xlarge","g6.xlarge","c7i.xlarge"]' \
    --type "String" \
    --overwrite \
    --region "$DEPLOYMENT_REGION" >/dev/null 2>&1

aws ssm put-parameter \
    --name "/workstation/config/defaultAutoTerminateHours" \
    --value "8" \
    --type "String" \
    --overwrite \
    --region "$DEPLOYMENT_REGION" >/dev/null 2>&1

log_success "System parameters configured"

# Configure domain join if requested
if [ "$USE_DOMAIN_JOIN" = true ]; then
    log_info ""
    log_info "Configuring domain join settings..."
    
    aws ssm put-parameter \
        --name "/workstation/domain/name" \
        --value "$DOMAIN_NAME" \
        --type "String" \
        --overwrite \
        --region "$DEPLOYMENT_REGION" >/dev/null 2>&1
    
    aws ssm put-parameter \
        --name "/workstation/domain/ou-path" \
        --value "$DOMAIN_OU" \
        --type "String" \
        --overwrite \
        --region "$DEPLOYMENT_REGION" >/dev/null 2>&1
    
    log_success "Domain join configured"
    log_warning "Remember to configure domain join credentials in Secrets Manager"
fi

################################################################################
# SAVE DEPLOYMENT INFO
################################################################################

# Write deployment info to stdout only (don't persist credentials to file)
echo ""
echo "=========================================="
echo "  DEPLOYMENT INFORMATION"
echo "  Save this information now!"
echo "=========================================="
echo "Website URL: $WEBSITE_URL"
echo "API Endpoint: $API_ENDPOINT"
echo "User Pool ID: $USER_POOL_ID"
echo "Admin Email: $ADMIN_EMAIL"
echo "Admin Password: $TEMP_PASSWORD"
echo "⚠️  This information will not be shown again."
echo "=========================================="

# Write non-sensitive deployment info to file (no credentials)
cat > deployment-info.txt << EOF
EC2 Workstation Manager Deployment Information
Generated: $(date)

AWS Configuration:
- Account ID: $AWS_ACCOUNT
- Region: $DEPLOYMENT_REGION

Access Information:
- Website URL: $WEBSITE_URL
- API Endpoint: $API_ENDPOINT
- User Pool ID: $USER_POOL_ID

IMPORTANT:
1. Admin credentials were displayed in the terminal output only
2. The temporary password must be changed on first login
3. Access the website at: $WEBSITE_URL
EOF

# Restrict file permissions and add to .gitignore
chmod 600 deployment-info.txt
grep -qxF 'deployment-info.txt' .gitignore 2>/dev/null || echo "deployment-info.txt" >> .gitignore

log_success "Non-sensitive deployment info saved to deployment-info.txt (credentials excluded)"

################################################################################
# COMPLETION
################################################################################

log_section "Deployment Complete!"

echo ""
log_success "EC2 Workstation Manager has been successfully deployed!"
echo ""
log_info "Access your deployment:"
log_info "  🌐 Website: $WEBSITE_URL"
echo ""
log_info "Admin login:"
log_info "  📧 Email: $ADMIN_EMAIL"
log_info "  🔑 Password: $TEMP_PASSWORD"
log_info "  ⚠️  You will be prompted to change this password on first login"
echo ""
log_info "Next steps:"
log_info "  1. Open the website URL in your browser"
log_info "  2. Login with your admin credentials"
log_info "  3. Change your temporary password"
log_info "  4. Configure MFA (recommended)"
log_info "  5. Launch a test workstation"
echo ""
log_info "Important files:"
log_info "  📄 deployment-info.txt - Contains non-sensitive deployment details"
log_info "  📄 cdk-outputs.json - Raw CDK outputs"
echo ""
log_warning "Admin credentials were shown above. Save them now - they will not be shown again!"
echo ""
log_info "For detailed documentation, see:"
log_info "  📖 DEPLOYMENT_GUIDE.md"
log_info "  📖 QUICK_START_CHECKLIST.md"
log_info "  📖 IAM_POLICIES.md"
echo ""
log_info "Need help? Check the troubleshooting section in DEPLOYMENT_GUIDE.md"
echo ""