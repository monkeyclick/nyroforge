# EC2 Workstation Manager - Customer Deployment Guide

Complete guide for deploying the EC2 Workstation Manager in your AWS account.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Pre-Deployment Checklist](#pre-deployment-checklist)
3. [Deployment Steps](#deployment-steps)
4. [Post-Deployment Configuration](#post-deployment-configuration)
5. [Security Group Setup](#security-group-setup)
6. [Testing & Validation](#testing--validation)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### AWS Account Requirements

#### Required AWS Services
- **AWS Account** with administrative access
- **AWS CLI** v2.x installed and configured
- **Cost Explorer** enabled (Settings > Cost Explorer)
- **Service Quotas** verified for:
  - EC2 instances (G4dn, G5, G6 families)
  - VPC resources (VPCs, Subnets, Security Groups)
  - Lambda concurrent executions
  - API Gateway APIs

#### IAM Permissions Required

The deploying user/role needs the following AWS managed policies:
- `AdministratorAccess` (recommended for initial deployment)

OR these specific permissions:
- `IAMFullAccess` - Create roles and policies
- `AmazonS3FullAccess` - S3 bucket operations
- `CloudFormationFullAccess` - CDK stack deployment
- `AmazonEC2FullAccess` - EC2 and VPC operations
- `AWSLambda_FullAccess` - Lambda function management
- `AmazonAPIGatewayAdministrator` - API Gateway setup
- `AmazonCognitoPowerUser` - User pool configuration
- `AmazonDynamoDBFullAccess` - Table creation
- `CloudWatchFullAccess` - Logging and monitoring
- `SecretsManagerReadWrite` - Secrets storage

#### Cost Considerations

**One-time Setup Costs:**
- CDK bootstrap: ~$1-5
- Initial deployment: Minimal (serverless resources)

**Monthly Operating Costs (estimated):**
| Component | Cost Range |
|-----------|------------|
| Lambda Functions | $10-50 |
| DynamoDB | $5-25 |
| API Gateway | $3-15 |
| Cognito | $2-10 |
| S3 Storage | $1-5 |
| CloudFront | $5-20 |
| **Infrastructure Total** | **$26-125/month** |

**Workstation Costs (per instance, 24/7):**
| Instance Type | Monthly Cost | Use Case |
|---------------|--------------|----------|
| g4dn.xlarge | ~$379 | Entry-level GPU workstation |
| g5.xlarge | ~$724 | High-performance workstation |
| g6.xlarge | ~$513 | Balanced GPU workstation |
| c7i.xlarge | ~$146 | CPU-only workstation |

*Costs vary by region and usage patterns. Use auto-termination to reduce costs.*

### Development Tools

```bash
# Required software versions
node --version    # v18.x or higher
npm --version     # v9.x or higher
aws --version     # AWS CLI 2.x
cdk --version     # AWS CDK 2.x
```

### Installation Commands

```bash
# Install Node.js (if not installed)
# macOS
brew install node@18

# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install AWS CDK
npm install -g aws-cdk

# Verify installations
node --version
npm --version
aws --version
cdk --version
```

---

## Pre-Deployment Checklist

### 1. AWS Account Setup

- [ ] AWS account created and accessible
- [ ] AWS CLI configured with credentials
  ```bash
  aws configure
  # Enter Access Key ID, Secret Access Key, region, output format
  ```
- [ ] Verify access:
  ```bash
  aws sts get-caller-identity
  ```
- [ ] Cost Explorer enabled (24-hour activation delay)
  ```bash
  aws ce describe-cost-category-definition --cost-category-arn arn:aws:ce::123456789012:costcategory/12345678-1234-1234-1234-123456789012
  ```

### 2. Network Planning

- [ ] Choose deployment region (e.g., us-west-2, us-east-1)
- [ ] Plan VPC CIDR blocks (default: 10.0.0.0/16)
- [ ] Identify required availability zones (minimum 2)
- [ ] List allowed source IP ranges for workstation access

### 3. Domain Integration (Optional)

If using Active Directory domain join:

- [ ] AWS Managed Microsoft AD deployed
- [ ] Directory ID and DNS servers noted
- [ ] Domain join service account created
- [ ] OU path for workstations defined
- [ ] Network connectivity verified

### 4. Security Requirements

- [ ] Determine MFA requirements (recommended: enabled)
- [ ] Plan security group templates needed
- [ ] Identify compliance requirements (HIPAA, SOC2, etc.)
- [ ] Review encryption requirements

---

## Deployment Steps

### Step 1: Clone Repository

```bash
# Clone the repository
git clone <repository-url>
cd ec2mgr4me

# Verify structure
ls -la
# Should see: bin/, lib/, src/, frontend/, etc.
```

### Step 2: Install Dependencies

```bash
# Install root dependencies
npm install

# Install Lambda function dependencies
cd src/lambda/cognito-admin-service && npm install && cd ../../..

# Install frontend dependencies
cd frontend && npm install && cd ..
```

### Step 3: Configure Environment

```bash
# Set AWS account and region
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=us-west-2  # Change to your preferred region

# Verify
echo "Account: $CDK_DEFAULT_ACCOUNT"
echo "Region: $CDK_DEFAULT_REGION"
```

### Step 4: CDK Bootstrap (First Time Only)

```bash
# Bootstrap CDK in your account/region
cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION

# Expected output:
# ✅ Environment aws://123456789012/us-west-2 bootstrapped
```

### Step 5: Review CDK Stacks

```bash
# List all stacks that will be deployed
cdk list

# Expected output:
# WorkstationInfrastructureStack
# WorkstationApiStack
# WorkstationWebsiteStack
```

### Step 6: Deploy Infrastructure

```bash
# Synthesize CloudFormation template (optional - for review)
cdk synth WorkstationInfrastructureStack > infrastructure-template.yaml

# Deploy all stacks
cdk deploy --all --require-approval never

# OR deploy one stack at a time:
cdk deploy WorkstationInfrastructureStack
cdk deploy WorkstationApiStack
cdk deploy WorkstationWebsiteStack
```

**Deployment time:** 15-25 minutes

**Expected outputs:**
```
WorkstationInfrastructureStack outputs:
  VpcId: vpc-xxxxx
  UserPoolId: us-west-2_xxxxx
  UserPoolClientId: xxxxx

WorkstationApiStack outputs:
  ApiEndpoint: https://xxxxx.execute-api.us-west-2.amazonaws.com/api
  ApiId: xxxxx

WorkstationWebsiteStack outputs:
  WebsiteUrl: https://xxxxx.cloudfront.net
  DistributionId: xxxxx
  BucketName: workstation-ui-xxxxx
```

### Step 7: Save Deployment Outputs

```bash
# Save outputs to file
cdk deploy --all --outputs-file cdk-outputs.json

# View outputs
cat cdk-outputs.json
```

---

## Post-Deployment Configuration

### 1. Create Initial Admin User

```bash
# Get User Pool ID from outputs
USER_POOL_ID=$(cat cdk-outputs.json | jq -r '.WorkstationInfrastructureStack.UserPoolId')

# Create admin user
aws cognito-idp admin-create-user \
  --user-pool-id $USER_POOL_ID \
  --username admin@yourcompany.com \
  --user-attributes \
    Name=email,Value=admin@yourcompany.com \
    Name=email_verified,Value=true \
  --temporary-password "TempPass123!" \
  --message-action SUPPRESS

# Add to admin group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id $USER_POOL_ID \
  --username admin@yourcompany.com \
  --group-name workstation-admin
```

### 2. Configure System Parameters

```bash
# Set default region
aws ssm put-parameter \
  --name "/workstation/config/defaultRegion" \
  --value "us-west-2" \
  --type "String" \
  --overwrite

# Set allowed instance types
aws ssm put-parameter \
  --name "/workstation/config/allowedInstanceTypes" \
  --value '["g4dn.xlarge","g5.xlarge","g6.xlarge","c7i.xlarge"]' \
  --type "StringList" \
  --overwrite

# Set default auto-terminate hours
aws ssm put-parameter \
  --name "/workstation/config/defaultAutoTerminateHours" \
  --value "8" \
  --type "String" \
  --overwrite
```

### 3. Enable Cost Explorer (If Not Already)

```bash
# This can take up to 24 hours to activate
aws ce get-cost-and-usage \
  --time-period Start=$(date -d '7 days ago' +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity DAILY \
  --metrics BlendedCost
```

### 4. Configure Domain Join (Optional)

```bash
# Store domain join credentials
aws secretsmanager create-secret \
  --name "workstation/domain-join-credentials" \
  --description "Domain join service account" \
  --secret-string '{
    "username": "svc-domainjoin@corp.example.com",
    "password": "SecurePassword123!"
  }'

# Set domain parameters
aws ssm put-parameter \
  --name "/workstation/domain/name" \
  --value "corp.example.com" \
  --type "String"

aws ssm put-parameter \
  --name "/workstation/domain/ou-path" \
  --value "OU=Workstations,OU=Computers,DC=corp,DC=example,DC=com" \
  --type "String"

aws ssm put-parameter \
  --name "/workstation/domain/dns-servers" \
  --value '["10.0.0.10","10.0.0.11"]' \
  --type "StringList"
```

### 5. Update Frontend Configuration

```bash
# Get API endpoint
API_ENDPOINT=$(cat cdk-outputs.json | jq -r '.WorkstationApiStack.ApiEndpoint')
USER_POOL_ID=$(cat cdk-outputs.json | jq -r '.WorkstationInfrastructureStack.UserPoolId')
USER_POOL_CLIENT_ID=$(cat cdk-outputs.json | jq -r '.WorkstationInfrastructureStack.UserPoolClientId')

# Update frontend/.env.local
cat > frontend/.env.local << EOF
NEXT_PUBLIC_API_URL=$API_ENDPOINT
NEXT_PUBLIC_USER_POOL_ID=$USER_POOL_ID
NEXT_PUBLIC_USER_POOL_CLIENT_ID=$USER_POOL_CLIENT_ID
NEXT_PUBLIC_REGION=$CDK_DEFAULT_REGION
EOF
```

---

## Security Group Setup

### Pre-configured Templates

The system includes 6 security group templates:

1. **Remote Desktop (RDP)**
   - Port 3389/TCP
   - Best for: Windows workstations

2. **SSH Access**
   - Port 22/TCP
   - Best for: Linux workstations

3. **HP Anywhere (RGS)**
   - Ports 42966-42967/TCP
   - Best for: HP Remote Graphics

4. **Amazon DCV**
   - Port 8443/TCP+UDP
   - Best for: NICE DCV sessions

5. **Full Remote Access**
   - RDP (3389), SSH (22), VNC (5900), HTTPS (443)
   - Best for: Multi-protocol access

6. **Web Server**
   - HTTP (80), HTTPS (443)
   - Best for: Web-based applications

### Creating Custom Security Groups

#### Via Admin UI:
1. Login as admin
2. Navigate to **Security** tab
3. Click **+ Create Group**
4. Enter name and description
5. Add rules using quick actions or custom ports

#### Via AWS CLI:
```bash
# Create security group
VPC_ID=$(aws ec2 describe-vpcs --filters "Name=tag:Name,Values=WorkstationVPC" --query 'Vpcs[0].VpcId' --output text)

SG_ID=$(aws ec2 create-security-group \
  --group-name custom-workstation-sg \
  --description "Custom workstation security group" \
  --vpc-id $VPC_ID \
  --output text)

# Add RDP rule (example)
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 3389 \
  --cidr YOUR_IP/32 \
  --description "RDP access from office"
```

### IP Address Restrictions

**Recommended:** Restrict access to known IP ranges

```bash
# Office network
OFFICE_IP="203.0.113.0/24"

# Add to security group
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 3389 \
  --cidr $OFFICE_IP \
  --description "Office RDP access"
```

### Security Group Best Practices

1. **Least Privilege:** Only open required ports
2. **IP Restrictions:** Limit source IPs to known networks
3. **Documentation:** Add descriptions to all rules
4. **Regular Audits:** Review rules monthly
5. **Templates:** Use templates for consistency

---

## Testing & Validation

### 1. Access Frontend

```bash
# Get CloudFront URL
WEBSITE_URL=$(cat cdk-outputs.json | jq -r '.WorkstationWebsiteStack.WebsiteUrl')
echo "Website URL: $WEBSITE_URL"

# Open in browser
open $WEBSITE_URL  # macOS
xdg-open $WEBSITE_URL  # Linux
```

### 2. Login as Admin

1. Navigate to website URL
2. Click **Sign In**
3. Enter admin credentials
4. Change temporary password
5. Setup MFA (if enabled)

### 3. Launch Test Workstation

```bash
# Via UI:
1. Click "Launch Workstation"
2. Select region: us-west-2
3. Select instance: g4dn.xlarge
4. Select OS: Windows Server 2022
5. Select security template: Remote Desktop (RDP)
6. Set auto-terminate: 1 hour
7. Click "Launch"

# Via API:
API_ENDPOINT=$(cat cdk-outputs.json | jq -r '.WorkstationApiStack.ApiEndpoint')

# Get JWT token first (from browser developer tools after login)
JWT_TOKEN="your-jwt-token"

curl -X POST "$API_ENDPOINT/workstations" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "region": "us-west-2",
    "instanceType": "g4dn.xlarge",
    "osVersion": "windows-server-2022",
    "authMethod": "local",
    "autoTerminateHours": 1,
    "tags": {
      "Purpose": "Testing"
    }
  }'
```

### 4. Verify Workstation Launch

```bash
# Check workstation status
aws ec2 describe-instances \
  --filters "Name=tag:ManagedBy,Values=WorkstationManager" \
  --query 'Reservations[*].Instances[*].[InstanceId,State.Name,PublicIpAddress]' \
  --output table
```

### 5. Get Credentials

1. Wait for workstation status: **running**
2. Click "Get Credentials"
3. Note the password
4. Download RDP file

### 6. Connect to Workstation

```bash
# Windows
mstsc /v:<PUBLIC_IP>

# macOS
open rdp://<PUBLIC_IP>

# Linux
rdesktop <PUBLIC_IP>
```

### 7. Verify Features

- [ ] Login successful
- [ ] GPU drivers installed (for G instances)
- [ ] Network connectivity working
- [ ] Auto-terminate scheduled
- [ ] Costs tracking in dashboard
- [ ] Security group rules applied

---

## Troubleshooting

### Issue: CDK Deploy Fails

**Error:** "No context provider for account"

**Solution:**
```bash
# Ensure environment variables are set
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=us-west-2

# Try bootstrap again
cdk bootstrap
```

---

### Issue: Cannot Create Admin User

**Error:** "User pool does not exist"

**Solution:**
```bash
# Verify user pool exists
aws cognito-idp list-user-pools --max-results 10

# Check CDK outputs
cat cdk-outputs.json | jq -r '.WorkstationInfrastructureStack'
```

---

### Issue: Workstation Launch Fails

**Error:** "Insufficient capacity" or "Instance limit exceeded"

**Solution:**
```bash
# Check service quotas
aws service-quotas get-service-quota \
  --service-code ec2 \
  --quota-code L-DB2E81BA

# Request increase
aws service-quotas request-service-quota-increase \
  --service-code ec2 \
  --quota-code L-DB2E81BA \
  --desired-value 10
```

---

### Issue: Frontend Shows 401 Unauthorized

**Error:** API calls failing with 401

**Solution:**
```bash
# Verify Cognito configuration
USER_POOL_ID=$(cat cdk-outputs.json | jq -r '.WorkstationInfrastructureStack.UserPoolId')

aws cognito-idp describe-user-pool --user-pool-id $USER_POOL_ID

# Check API Gateway authorizer
aws apigateway get-authorizers \
  --rest-api-id $(cat cdk-outputs.json | jq -r '.WorkstationApiStack.ApiId')
```

---

### Issue: Cost Data Not Showing

**Error:** "Cost Explorer not enabled" or no cost data

**Solution:**
```bash
# Cost Explorer takes 24 hours to activate after enabling
# Verify it's enabled
aws ce describe-cost-category-definition \
  --cost-category-arn "arn:aws:ce::${CDK_DEFAULT_ACCOUNT}:costcategory/*" 2>&1

# If error, enable Cost Explorer in AWS Console:
# Billing Dashboard > Cost Explorer > Enable Cost Explorer
```

---

### Issue: Security Group Rules Not Working

**Error:** Cannot connect to workstation

**Solution:**
```bash
# Verify security group rules
aws ec2 describe-security-groups \
  --filters "Name=tag:ManagedBy,Values=WorkstationManager" \
  --query 'SecurityGroups[*].[GroupId,GroupName,IpPermissions]'

# Check your current public IP
curl -s https://api.ipify.org
echo ""

# Verify rule allows your IP
aws ec2 describe-security-groups \
  --group-ids sg-xxxxx \
  --query 'SecurityGroups[0].IpPermissions[?FromPort==`3389`]'
```

---

### Issue: Lambda Function Timeout

**Error:** "Task timed out after 30 seconds"

**Solution:**
```bash
# Increase Lambda timeout
aws lambda update-function-configuration \
  --function-name MediaWorkstation-EC2Management \
  --timeout 300

# Check CloudWatch logs
aws logs tail /aws/lambda/MediaWorkstation-EC2Management --follow
```

---

### Issue: Domain Join Fails

**Error:** Workstation not joining domain

**Solution:**
```bash
# Verify domain credentials
aws secretsmanager get-secret-value \
  --secret-id workstation/domain-join-credentials \
  --query SecretString

# Check domain parameters
aws ssm get-parameter --name "/workstation/domain/name"
aws ssm get-parameter --name "/workstation/domain/ou-path"

# Verify DNS resolution from workstation
# RDP to instance and run:
nslookup corp.example.com
```

---

### Getting Help

1. **Check CloudWatch Logs**
   ```bash
   # Lambda function logs
   aws logs tail /aws/lambda/MediaWorkstation-EC2Management --follow
   
   # API Gateway logs
   aws logs tail API-Gateway-Execution-Logs_xxxxx/api --follow
   ```

2. **Review CloudTrail Events**
   ```bash
   aws cloudtrail lookup-events \
     --lookup-attributes AttributeKey=EventName,AttributeValue=CreateSecurityGroup \
     --max-results 10
   ```

3. **Contact Support**
   - GitHub Issues: [repository-url]/issues
   - Email: support@yourcompany.com
   - AWS Support: Open support case in AWS Console

---

## Next Steps

After successful deployment:

1. **Create Additional Users**
   - Use Admin UI to add users
   - Assign to appropriate groups

2. **Configure Cost Alerts**
   - Setup budget alerts in AWS Budgets
   - Configure SNS notifications

3. **Setup Monitoring**
   - Configure CloudWatch dashboards
   - Setup CloudWatch alarms

4. **Backup Strategy**
   - Enable DynamoDB backups
   - Document recovery procedures

5. **Security Hardening**
   - Enable AWS WAF on API Gateway
   - Configure AWS GuardDuty
   - Enable AWS Security Hub

6. **Performance Tuning**
   - Monitor Lambda cold starts
   - Adjust DynamoDB capacity
   - Optimize workstation templates

---

## Maintenance

### Regular Tasks

**Daily:**
- Monitor active workstations
- Check cost dashboard
- Review failed launches

**Weekly:**
- Audit security groups
- Review user access logs
- Check for AWS service updates

**Monthly:**
- Update Lambda functions
- Review and optimize costs
- Update documentation
- Patch workstation AMIs

**Quarterly:**
- Security audit
- Disaster recovery test
- Capacity planning review
- User training updates

---

## Appendix

### A. Default Resource Names

| Resource | Name Pattern |
|----------|-------------|
| VPC | WorkstationVPC |
| User Pool | workstation-users |
| API Gateway | WorkstationAPI |
| S3 Bucket | workstation-ui-{account}-{region} |
| DynamoDB Table | Workstations |

### B. Required IAM Policies

See [IAM_POLICIES.md](IAM_POLICIES.md) for detailed policy documents.

### C. Network Diagram

```
Internet
    │
    ├─> CloudFront ──> S3 (Frontend)
    │
    └─> API Gateway
            │
            ├─> Lambda Functions
            │       │
            │       ├─> DynamoDB (Workstations)
            │       ├─> Secrets Manager (Credentials)
            │       ├─> SSM Parameters (Config)
            │       └─> EC2 API
            │
            └─> Cognito Authorizer
                    │
                    └─> User Pool
```

### D. Cost Optimization Tips

1. **Use Auto-Termination:** Always set auto-terminate hours
2. **Right-Size Instances:** Start small, scale up as needed
3. **Use Spot Instances:** For non-critical workloads (future feature)
4. **Schedule Workstations:** Use EventBridge to start/stop on schedule
5. **Monitor Unused Resources:** Regular cleanup of old security groups
6. **Reserved Instances:** For long-term, predictable workloads

---

**Document Version:** 1.0.0  
**Last Updated:** 2025-11-10  
**Tested AWS Regions:** us-west-2, us-east-1, eu-west-1