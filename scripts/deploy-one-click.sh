#!/bin/bash

################################################################################
# NyroForge — One-Click Deployment
#
# Deploys the whole system end to end:
#   Phase 1  prerequisites, dependencies, Lambda bundles, CDK bootstrap,
#            backend stacks (everything except the website)
#   Phase 2  admin user, package catalog, frontend build wired to the real
#            stack outputs, website stack
#
# The two phases exist because the web UI compiles the API Gateway and Cognito
# IDs into its JavaScript bundle at *build* time. Those IDs only exist after the
# backend stacks are created, so the UI cannot be built until Phase 1 finishes.
#
# Every step is idempotent: re-running after a failure picks up where it left
# off instead of erroring on resources that already exist.
#
# Usage: ./scripts/deploy-one-click.sh
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

################################################################################
# FAILURE REPORTING
#
# Under `set -e` a failing command aborts the script instantly. Without this
# trap the deploy could exit silently — the previous version of this script
# redirected the output of every post-deployment AWS call to /dev/null, so a
# rejected Cognito call ended a 20-minute deployment with no message at all.
################################################################################

CURRENT_STEP="startup"

on_error() {
    local exit_code=$?
    local line_no="${1:-unknown}"

    echo ""
    log_error "Deployment failed while: ${CURRENT_STEP}"
    log_error "  script line ${line_no}, exit code ${exit_code}"
    echo ""
    log_info "Nothing was rolled back. This script is safe to re-run — completed"
    log_info "steps are skipped, so it will resume from the failure."
    echo ""
    log_info "Common causes:"
    log_info "  • Insufficient IAM permissions — see DEPLOYMENT_GUIDE.md §1"
    log_info "  • Resource name already taken by another deployment in this"
    log_info "    account+region (see NYROFORGE_RESOURCE_PREFIX in the guide)"
    log_info "  • A CloudFormation stack stuck in ROLLBACK_COMPLETE — delete it"
    log_info "    and re-run: aws cloudformation delete-stack --stack-name <name>"
    echo ""
    log_info "Troubleshooting: DEPLOYMENT_GUIDE.md §6"
    exit "$exit_code"
}

trap 'on_error $LINENO' ERR

# Marks the operation in progress so the trap can name it.
step() {
    CURRENT_STEP="$1"
    log_info "$1"
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

# Stack names honour STACK_PREFIX, matching bin/app.ts, so a prefixed second
# deployment targets its own stacks instead of the unprefixed originals.
STACK_PREFIX="${STACK_PREFIX:-}"
stack() {
    echo "${STACK_PREFIX}$1"
}

# Read one output value from a deployed CloudFormation stack.
# Deliberately queries CloudFormation rather than parsing cdk-outputs.json: the
# outputs file only contains stacks touched by the most recent deploy, so a
# resumed run would come up empty.
stack_output() {
    local stack="$1"
    local key="$2"
    aws cloudformation describe-stacks \
        --stack-name "$stack" \
        --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue" \
        --output text \
        --region "$DEPLOYMENT_REGION" 2>/dev/null || echo ""
}

################################################################################
# PRE-FLIGHT CHECKS
################################################################################

log_section "Pre-Flight Checks"

# Check if running in project directory
if [ ! -f "cdk.json" ]; then
    log_error "This script must be run from the project root directory"
    log_info "Please cd to the nyroforge directory and try again:"
    log_info "  cd /path/to/nyroforge && ./scripts/deploy-one-click.sh"
    exit 1
fi

step "Checking prerequisites..."

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

# Tolerate unexpected `aws --version` formats: a non-numeric result used to be
# fed straight to `-lt`, which aborted pre-flight with "integer expression
# expected" instead of a usable message.
AWS_VERSION=$(aws --version 2>&1 | sed -n 's|^aws-cli/\([0-9]\{1,\}\).*|\1|p')
if [ -z "$AWS_VERSION" ]; then
    log_warning "Could not determine AWS CLI version (found: $(aws --version 2>&1))"
    log_warning "AWS CLI v2 is recommended; continuing"
elif [ "$AWS_VERSION" -lt 2 ]; then
    log_warning "AWS CLI version 2 is recommended (found: $(aws --version 2>&1))"
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
    step "Installing AWS CDK globally"
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
DEFAULT_REGION=$(aws configure get region 2>/dev/null || echo "us-west-2")
DEPLOYMENT_REGION=$(prompt_input "Enter AWS region for deployment" "${DEFAULT_REGION:-us-west-2}")

step "Setting environment variables"
export CDK_DEFAULT_ACCOUNT="$AWS_ACCOUNT"
export CDK_DEFAULT_REGION="$DEPLOYMENT_REGION"
# Consumed by the seed scripts and the AWS SDK inside them.
export AWS_REGION="$DEPLOYMENT_REGION"
export AWS_DEFAULT_REGION="$DEPLOYMENT_REGION"

# Get admin details. given_name and family_name are REQUIRED attributes on the
# user pool (see lib/workstation-infrastructure-stack.ts standardAttributes), so
# Cognito rejects AdminCreateUser without them — this script used to send only
# the email and fail every single time.
echo ""
ADMIN_EMAIL=$(prompt_input "Enter admin email address" "admin@company.com")
ADMIN_FIRST_NAME=$(prompt_input "Enter admin first name" "System")
ADMIN_LAST_NAME=$(prompt_input "Enter admin last name" "Administrator")

# Confirm configuration
echo ""
log_info "Deployment Configuration:"
log_info "  Account: $AWS_ACCOUNT"
log_info "  Region: $DEPLOYMENT_REGION"
log_info "  Admin: $ADMIN_FIRST_NAME $ADMIN_LAST_NAME <$ADMIN_EMAIL>"
if [ -n "${NYROFORGE_RESOURCE_PREFIX:-}" ]; then
    log_info "  Resource prefix: $NYROFORGE_RESOURCE_PREFIX"
fi
echo ""
log_info "Active Directory domain join is configured per workstation at launch"
log_info "time in the web UI, not here. See DEPLOYMENT_GUIDE.md §4.3."

echo ""
if ! prompt_yes_no "Proceed with deployment?" "y"; then
    log_warning "Deployment cancelled"
    exit 0
fi

################################################################################
# PHASE 1 — INSTALL DEPENDENCIES
################################################################################

log_section "Phase 1 of 2 — Backend"

step "Installing root dependencies"
npm install --silent

step "Installing Lambda function dependencies"
if [ -d "src/lambda/cognito-admin-service" ]; then
    (cd src/lambda/cognito-admin-service && npm install --silent)
    log_success "Cognito admin service dependencies installed"
fi

step "Installing frontend dependencies"
if [ -d "frontend" ]; then
    (cd frontend && npm install --silent)
    log_success "Frontend dependencies installed"
fi

log_success "All dependencies installed"

################################################################################
# BUILD LAMBDA BUNDLES
#
# Every Lambda loads its code from dist/lambda/<service> (see
# lib/service-lambda.ts). dist/ is gitignored and `npm install` does not build
# it, so skipping this step made `cdk deploy` abort during synthesis with
# "Cannot find asset .../dist/lambda/ec2-management" on every fresh clone.
################################################################################

step "Building Lambda bundles"
npm run build:lambdas

if [ ! -d "dist/lambda" ] || [ -z "$(ls -A dist/lambda 2>/dev/null)" ]; then
    log_error "Lambda build produced no output in dist/lambda"
    exit 1
fi
log_success "Lambda bundles built ($(ls dist/lambda | wc -l | tr -d ' ') functions)"

################################################################################
# CDK BOOTSTRAP
################################################################################

log_section "CDK Bootstrap"

# Modern CDK requires bootstrap stack version 6+. Checking only that CDKToolkit
# exists let stale bootstraps through, which then failed during asset publishing
# with an opaque error.
REQUIRED_BOOTSTRAP_VERSION=6
BOOTSTRAP_VERSION=$(aws cloudformation describe-stacks \
    --stack-name CDKToolkit \
    --query "Stacks[0].Outputs[?OutputKey=='BootstrapVersion'].OutputValue" \
    --output text \
    --region "$DEPLOYMENT_REGION" 2>/dev/null || echo "")

if [ -z "$BOOTSTRAP_VERSION" ] || [ "$BOOTSTRAP_VERSION" = "None" ]; then
    step "Bootstrapping CDK in $DEPLOYMENT_REGION"
    cdk bootstrap "aws://$AWS_ACCOUNT/$DEPLOYMENT_REGION"
    log_success "CDK bootstrap complete"
elif [ "$BOOTSTRAP_VERSION" -lt "$REQUIRED_BOOTSTRAP_VERSION" ]; then
    log_warning "CDK bootstrap is version $BOOTSTRAP_VERSION (need $REQUIRED_BOOTSTRAP_VERSION+)"
    step "Upgrading CDK bootstrap in $DEPLOYMENT_REGION"
    cdk bootstrap "aws://$AWS_ACCOUNT/$DEPLOYMENT_REGION"
    log_success "CDK bootstrap upgraded"
else
    log_info "CDK already bootstrapped in $DEPLOYMENT_REGION (version $BOOTSTRAP_VERSION)"
fi

################################################################################
# DEPLOY BACKEND STACKS
#
# The website stack is deliberately left for Phase 2 — its content is the
# compiled UI, which needs the outputs produced here.
################################################################################

log_section "Deploying Backend Stacks"

log_info "This will take approximately 15-25 minutes..."
echo ""

step "Deploying CDK stacks (infrastructure, storage, API, admin API, frontend config)"
cdk deploy \
    "$(stack WorkstationInfrastructure)" \
    "$(stack WorkstationStorage)" \
    "$(stack WorkstationApi)" \
    "$(stack WorkstationAdminApi)" \
    "$(stack WorkstationFrontend)" \
    --require-approval never \
    --outputs-file cdk-outputs.json \
    --progress events

log_success "Backend stacks deployed"

################################################################################
# PHASE 2 — POST-DEPLOYMENT CONFIGURATION
################################################################################

log_section "Phase 2 of 2 — Configuration and Web UI"

step "Reading stack outputs"
USER_POOL_ID=$(stack_output "$(stack WorkstationInfrastructure)" UserPoolId)
USER_POOL_CLIENT_ID=$(stack_output "$(stack WorkstationInfrastructure)" UserPoolClientId)
API_ENDPOINT=$(stack_output "$(stack WorkstationApi)" ApiEndpoint)
ADMIN_API_ENDPOINT=$(stack_output "$(stack WorkstationAdminApi)" AdminApiUrl)
BOOTSTRAP_PACKAGES_TABLE=$(stack_output "$(stack WorkstationInfrastructure)" BootstrapPackagesTableName)

MISSING_OUTPUTS=()
[ -z "$USER_POOL_ID" ]        && MISSING_OUTPUTS+=("$(stack WorkstationInfrastructure)/UserPoolId")
[ -z "$USER_POOL_CLIENT_ID" ] && MISSING_OUTPUTS+=("$(stack WorkstationInfrastructure)/UserPoolClientId")
[ -z "$API_ENDPOINT" ]        && MISSING_OUTPUTS+=("$(stack WorkstationApi)/ApiEndpoint")
[ -z "$ADMIN_API_ENDPOINT" ]  && MISSING_OUTPUTS+=("$(stack WorkstationAdminApi)/AdminApiUrl")

if [ ${#MISSING_OUTPUTS[@]} -gt 0 ]; then
    log_error "Could not read required stack outputs:"
    for out in "${MISSING_OUTPUTS[@]}"; do
        log_error "  • $out"
    done
    log_info "Check the stacks in the CloudFormation console for that region."
    exit 1
fi

log_success "Stack outputs read"
log_info "  User Pool ID: $USER_POOL_ID"
log_info "  API Endpoint: $API_ENDPOINT"
log_info "  Admin API Endpoint: $ADMIN_API_ENDPOINT"

################################################################################
# CREATE ADMIN USER
################################################################################

echo ""
step "Creating admin user"

# Password policy is minLength 12 with upper, lower, digit and symbol required.
# `tr -d` leaves the trailing newline from openssl in place, so trim it before
# taking a substring — a short base64 run could otherwise embed a newline in
# the password.
generate_password() {
    local raw
    raw=$(openssl rand -base64 24 | tr -d '+/=\n')
    # Guarantees one of each required class regardless of the random run.
    printf '%s!A1a' "${raw:0:16}"
}

TEMP_PASSWORD="${ADMIN_PASSWORD:-$(generate_password)}"
ADMIN_USER_EXISTED=false

if aws cognito-idp admin-get-user \
        --user-pool-id "$USER_POOL_ID" \
        --username "$ADMIN_EMAIL" \
        --region "$DEPLOYMENT_REGION" >/dev/null 2>&1; then
    ADMIN_USER_EXISTED=true
    log_warning "User $ADMIN_EMAIL already exists — leaving their password unchanged"
else
    # Errors are intentionally NOT suppressed: the failure text is the only
    # useful diagnostic when Cognito rejects an attribute or password.
    aws cognito-idp admin-create-user \
        --user-pool-id "$USER_POOL_ID" \
        --username "$ADMIN_EMAIL" \
        --user-attributes \
            Name=email,Value="$ADMIN_EMAIL" \
            Name=email_verified,Value=true \
            Name=given_name,Value="$ADMIN_FIRST_NAME" \
            Name=family_name,Value="$ADMIN_LAST_NAME" \
        --temporary-password "$TEMP_PASSWORD" \
        --message-action SUPPRESS \
        --region "$DEPLOYMENT_REGION" >/dev/null
    log_success "Admin user created"
fi

step "Adding admin user to the workstation-admin group"
# Idempotent server-side — repeat calls on an existing membership succeed.
aws cognito-idp admin-add-user-to-group \
    --user-pool-id "$USER_POOL_ID" \
    --username "$ADMIN_EMAIL" \
    --group-name workstation-admin \
    --region "$DEPLOYMENT_REGION"
log_success "Admin user is in the workstation-admin group"

################################################################################
# SEED THE PACKAGE CATALOG
#
# Without this the bootstrap package table is empty, so launched workstations
# get no GPU driver and no DCV remote-access server. The instance boots and then
# appears broken to the user — the most common "deployment failure" report.
################################################################################

echo ""
step "Seeding the bootstrap package catalog"

if [ -z "$BOOTSTRAP_PACKAGES_TABLE" ]; then
    log_warning "BootstrapPackagesTableName output not found; falling back to the default table name"
    BOOTSTRAP_PACKAGES_TABLE="WorkstationBootstrapPackages"
fi
export BOOTSTRAP_PACKAGES_TABLE

node scripts/seed-bootstrap-packages.js
node scripts/seed-dcv-package.js
log_success "Package catalog seeded (drivers, DCV, common applications)"

################################################################################
# VERIFY SYSTEM PARAMETERS
#
# The CDK infrastructure stack owns these values, so writing them here would
# just fight with CloudFormation on the next deploy. Verify instead, and only
# repair what is genuinely missing.
################################################################################

echo ""
step "Verifying system parameters"

REQUIRED_PARAMS=(
    "/workstation/config/defaultInstanceType"
    "/workstation/config/allowedInstanceTypes"
    "/workstation/config/defaultAutoTerminateHours"
    "/workstation/config/windowsVersions"
    "/workstation/config/instanceProfileArn"
    "/workstation/config/instanceRoleArn"
)

MISSING_PARAMS=()
for param in "${REQUIRED_PARAMS[@]}"; do
    if ! aws ssm get-parameter --name "$param" --region "$DEPLOYMENT_REGION" >/dev/null 2>&1; then
        MISSING_PARAMS+=("$param")
    fi
done

if [ ${#MISSING_PARAMS[@]} -eq 0 ]; then
    log_success "All ${#REQUIRED_PARAMS[@]} system parameters present"
else
    log_warning "Missing system parameters (the infrastructure stack should own these):"
    for param in "${MISSING_PARAMS[@]}"; do
        log_warning "  • $param"
    done
    log_info "Workstation launches may fail. Re-deploy WorkstationInfrastructure,"
    log_info "or set them manually — see DEPLOYMENT_GUIDE.md §4.2."
fi

################################################################################
# BUILD AND DEPLOY THE WEB UI
#
# Next.js inlines NEXT_PUBLIC_* values at build time, so this must happen after
# the API and Cognito outputs are known. Building before Phase 1 (as the old
# single-pass script effectively did) produced a bundle with an empty API
# endpoint and user pool — the site loaded but no request or login worked.
################################################################################

echo ""
step "Writing frontend/.env.local from the deployed stack outputs"

cat > frontend/.env.local << EOF
# Auto-generated by scripts/deploy-one-click.sh — do not edit by hand.
# Re-run ./scripts/deploy-frontend.sh to regenerate.
NEXT_PUBLIC_AWS_REGION=$DEPLOYMENT_REGION
NEXT_PUBLIC_API_ENDPOINT=$API_ENDPOINT
NEXT_PUBLIC_ADMIN_API_ENDPOINT=$ADMIN_API_ENDPOINT
NEXT_PUBLIC_USER_POOL_ID=$USER_POOL_ID
NEXT_PUBLIC_USER_POOL_CLIENT_ID=$USER_POOL_CLIENT_ID
NEXT_PUBLIC_LOCAL_ADMIN_MODE=false
EOF
log_success "Frontend environment configured"

step "Building the web UI"
(cd frontend && rm -rf .next out && npm run build)

if [ ! -d "frontend/out" ] || [ -z "$(ls -A frontend/out 2>/dev/null)" ]; then
    log_error "Frontend build produced no output in frontend/out"
    exit 1
fi
log_success "Web UI built"

step "Deploying the website stack"
cdk deploy "$(stack WorkstationWebsite)" \
    --require-approval never \
    --outputs-file cdk-outputs-website.json \
    --progress events

WEBSITE_URL=$(stack_output "$(stack WorkstationWebsite)" WebsiteUrl)
if [ -z "$WEBSITE_URL" ]; then
    log_error "$(stack WorkstationWebsite) deployed but no WebsiteUrl output was found"
    exit 1
fi
log_success "Website deployed"

################################################################################
# SAVE DEPLOYMENT INFO
################################################################################

echo ""
echo "=========================================="
echo "  DEPLOYMENT INFORMATION"
if [ "$ADMIN_USER_EXISTED" = false ]; then
    echo "  Save this information now!"
fi
echo "=========================================="
echo "Website URL: $WEBSITE_URL"
echo "API Endpoint: $API_ENDPOINT"
echo "User Pool ID: $USER_POOL_ID"
echo "Admin Email: $ADMIN_EMAIL"
if [ "$ADMIN_USER_EXISTED" = true ]; then
    echo "Admin Password: (unchanged — this user already existed)"
else
    echo "Admin Password: $TEMP_PASSWORD"
    echo "⚠️  This password will not be shown again."
fi
echo "=========================================="

# Non-sensitive deployment info only — credentials stay in the terminal.
cat > deployment-info.txt << EOF
NyroForge Deployment Information
Generated: $(date)

AWS Configuration:
- Account ID: $AWS_ACCOUNT
- Region: $DEPLOYMENT_REGION

Access Information:
- Website URL: $WEBSITE_URL
- API Endpoint: $API_ENDPOINT
- Admin API Endpoint: $ADMIN_API_ENDPOINT
- User Pool ID: $USER_POOL_ID
- User Pool Client ID: $USER_POOL_CLIENT_ID

IMPORTANT:
1. Admin credentials were displayed in the terminal output only
2. The temporary password must be changed on first login
3. Access the website at: $WEBSITE_URL
EOF

chmod 600 deployment-info.txt
log_success "Non-sensitive deployment info saved to deployment-info.txt (credentials excluded)"

################################################################################
# COMPLETION
################################################################################

CURRENT_STEP="finishing up"

log_section "Deployment Complete!"

echo ""
log_success "NyroForge has been successfully deployed!"
echo ""
log_info "Access your deployment:"
log_info "  🌐 Website: $WEBSITE_URL"
echo ""
log_info "Admin login:"
log_info "  📧 Email: $ADMIN_EMAIL"
if [ "$ADMIN_USER_EXISTED" = true ]; then
    log_info "  🔑 Password: unchanged (existing user)"
else
    log_info "  🔑 Password: $TEMP_PASSWORD"
    log_info "  ⚠️  You will be prompted to change this password on first login"
fi
echo ""
log_info "Next steps:"
log_info "  1. Open the website URL in your browser"
log_info "  2. Login with your admin credentials"
log_info "  3. Change your temporary password"
log_info "  4. Configure MFA (recommended)"
log_info "  5. Launch a test workstation"
echo ""
log_info "Important files:"
log_info "  📄 deployment-info.txt - Non-sensitive deployment details"
log_info "  📄 cdk-outputs.json - Raw CDK outputs (backend stacks)"
log_info "  📄 frontend/.env.local - UI configuration used for the build"
echo ""
if [ "$ADMIN_USER_EXISTED" = false ]; then
    log_warning "Admin credentials were shown above. Save them now - they will not be shown again!"
    echo ""
fi
log_info "CloudFront can take a few minutes to serve the new build worldwide."
echo ""
log_info "To rebuild and redeploy just the web UI later:"
log_info "  ./scripts/deploy-frontend.sh"
echo ""
log_info "For detailed documentation, see:"
log_info "  📖 DEPLOYMENT_GUIDE.md"
log_info "  📖 ARCHITECTURE.md"
echo ""
log_info "Need help? Check the troubleshooting section in DEPLOYMENT_GUIDE.md"
echo ""
