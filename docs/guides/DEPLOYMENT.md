# Deployment Guide - Media Workstation Automation System

This guide provides step-by-step instructions for deploying the Media Workstation Automation System to AWS.

## 📋 Pre-Deployment Checklist

### AWS Prerequisites

- [ ] AWS CLI installed and configured
- [ ] AWS account with sufficient permissions:
  - EC2 (launch instances, manage VPCs, security groups)
  - Lambda (create/manage functions)
  - API Gateway (create/manage APIs)
  - DynamoDB (create/manage tables)
  - Cognito (create/manage user pools)
  - IAM (create roles and policies)
  - Cost Explorer (read access)
  - Secrets Manager (create/manage secrets)
  - Systems Manager (parameter store, session manager)
  - CloudWatch (logs, metrics, dashboards)
  - KMS (key management)
  - Amplify (app deployment)

### Development Prerequisites

- [ ] Node.js 18+ installed
- [ ] npm or yarn package manager
- [ ] AWS CDK CLI: `npm install -g aws-cdk`
- [ ] TypeScript: `npm install -g typescript`
- [ ] Git repository access (for Amplify deployment)

### Environment Setup

```bash
# Verify AWS CLI configuration
aws sts get-caller-identity

# Set environment variables
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION="us-west-2"  # or your preferred region
export ENVIRONMENT="prod"  # or "dev"/"staging"
```

## 🚀 Step-by-Step Deployment

### Step 1: Project Setup

```bash
# Clone the repository
git clone <your-repository-url>
cd media-workstation-automation

# Install dependencies
npm install

# Verify TypeScript compilation
npm run build
```

### Step 2: CDK Bootstrap

```bash
# Bootstrap CDK (first time in account/region)
cdk bootstrap

# Verify bootstrap
aws cloudformation describe-stacks --stack-name CDKToolkit
```

### Step 3: GitHub Integration (for Amplify)

```bash
# Create GitHub Personal Access Token with repo permissions
# Store in AWS Secrets Manager
aws secretsmanager create-secret \
  --name "github-token" \
  --description "GitHub token for Amplify deployment" \
  --secret-string "ghp_your_github_personal_access_token_here"
```

### Step 4: Deploy Infrastructure Stack

```bash
# Deploy core infrastructure first
cdk deploy WorkstationInfrastructure \
  --require-approval never \
  --outputs-file infrastructure-outputs.json

# Verify deployment
aws cloudformation describe-stacks \
  --stack-name WorkstationInfrastructure
```

### Step 5: Deploy API Stack

```bash
# Deploy API services
cdk deploy WorkstationApi \
  --require-approval never \
  --outputs-file api-outputs.json

# Test API health endpoint
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name WorkstationApi \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text)

curl "${API_ENDPOINT}health"
```

### Step 6: Deploy Frontend Stack

```bash
# Update frontend stack with your GitHub details
# Edit lib/workstation-frontend-stack.ts to set:
# - GitHub owner/repository
# - Branch configuration

# Deploy frontend
cdk deploy WorkstationFrontend \
  --require-approval never \
  --outputs-file frontend-outputs.json
```

### Step 7: Initial Configuration

```bash
# Get deployment outputs
USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name WorkstationInfrastructure \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
  --output text)

CLIENT_ID=$(aws cloudformation describe-stacks \
  --stack-name WorkstationInfrastructure \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolClientId`].OutputValue' \
  --output text)

echo "User Pool ID: $USER_POOL_ID"
echo "Client ID: $CLIENT_ID"
```

### Step 8: Create Admin User

```bash
# Create the first admin user
aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "admin@yourcompany.com" \
  --user-attributes Name=email,Value=admin@yourcompany.com \
  --temporary-password "TempPassword123!" \
  --message-action SUPPRESS

# Add to admin group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$USER_POOL_ID" \
  --username "admin@yourcompany.com" \
  --group-name "workstation-admin"

# Set permanent password (admin will be prompted to change on first login)
aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username "admin@yourcompany.com" \
  --password "AdminPassword123!" \
  --permanent
```

### Step 9: Verification Tests

```bash
# Test API endpoints (replace with actual JWT token)
export JWT_TOKEN="your_jwt_token_here"
export API_ENDPOINT="your_api_endpoint_here"

# Test regions endpoint
curl -X GET "${API_ENDPOINT}regions" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json"

# Test instance types endpoint
curl -X GET "${API_ENDPOINT}instance-types" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json"

# Test health endpoint (no auth required)
curl -X GET "${API_ENDPOINT}health"
```

## 🔧 Post-Deployment Configuration

### Domain Configuration (Optional)

If using domain-joined workstations:

```bash
# Set domain parameters
aws ssm put-parameter \
  --name "/workstation/domain/name" \
  --value "corp.yourcompany.com" \
  --type "String" \
  --description "Active Directory domain name"

aws ssm put-parameter \
  --name "/workstation/domain/ou-path" \
  --value "OU=Workstations,DC=corp,DC=yourcompany,DC=com" \
  --type "String" \
  --description "Organizational Unit path for workstations"

# Store domain join credentials
aws secretsmanager create-secret \
  --name "workstation/domain-join" \
  --description "Domain join service account credentials" \
  --secret-string '{
    "username": "svc-domainjoin@corp.yourcompany.com",
    "password": "SecureDomainPassword123!"
  }'
```

### Cost Budgets and Alerts

```bash
# Create monthly cost budget
aws budgets create-budget \
  --account-id "$CDK_DEFAULT_ACCOUNT" \
  --budget '{
    "BudgetName": "MediaWorkstationBudget",
    "BudgetLimit": {
      "Amount": "5000.00",
      "Unit": "USD"
    },
    "TimeUnit": "MONTHLY",
    "BudgetType": "COST",
    "CostFilters": {
      "TagKey": ["Project"],
      "TagValue": ["MediaWorkstationAutomation"]
    }
  }' \
  --notifications-with-subscribers '[
    {
      "Notification": {
        "NotificationType": "ACTUAL",
        "ComparisonOperator": "GREATER_THAN",
        "Threshold": 80.0
      },
      "Subscribers": [
        {
          "SubscriptionType": "EMAIL",
          "Address": "admin@yourcompany.com"
        }
      ]
    }
  ]'
```

### CloudWatch Dashboards

```bash
# Create custom dashboard (optional)
aws cloudwatch put-dashboard \
  --dashboard-name "MediaWorkstations" \
  --dashboard-body '{
    "widgets": [
      {
        "type": "metric",
        "properties": {
          "metrics": [
            ["AWS/EC2", "CPUUtilization"],
            ["AWS/EC2", "NetworkIn"],
            ["AWS/EC2", "NetworkOut"]
          ],
          "period": 300,
          "stat": "Average",
          "region": "'$CDK_DEFAULT_REGION'",
          "title": "EC2 Performance"
        }
      }
    ]
  }'
```

## 🔍 Troubleshooting Deployment Issues

### Common CDK Deployment Errors

1. **Bootstrap Issues**
   ```bash
   # Re-bootstrap if needed
   cdk bootstrap --force
   ```

2. **Permission Errors**
   ```bash
   # Verify IAM permissions
   aws iam simulate-principal-policy \
     --policy-source-arn "arn:aws:iam::$CDK_DEFAULT_ACCOUNT:user/your-username" \
     --action-names "ec2:RunInstances" "lambda:CreateFunction" \
     --resource-arns "*"
   ```

3. **Stack Dependencies**
   ```bash
   # Deploy stacks in order
   cdk deploy WorkstationInfrastructure
   cdk deploy WorkstationApi
   cdk deploy WorkstationFrontend
   ```

### Lambda Function Issues

1. **Check Function Logs**
   ```bash
   aws logs describe-log-groups \
     --log-group-name-prefix "/aws/lambda/MediaWorkstation"
   
   aws logs filter-log-events \
     --log-group-name "/aws/lambda/MediaWorkstation-EC2Management" \
     --start-time $(date -d '1 hour ago' +%s)000
   ```

2. **Test Function Directly**
   ```bash
   aws lambda invoke \
     --function-name "MediaWorkstation-StatusMonitor" \
     --payload '{"httpMethod":"GET","path":"/health"}' \
     response.json
   
   cat response.json
   ```

### VPC and Networking Issues

1. **Check VPC Endpoints**
   ```bash
   aws ec2 describe-vpc-endpoints \
     --filters "Name=vpc-id,Values=$(aws ec2 describe-vpcs --filters 'Name=tag:Name,Values=WorkstationVPC*' --query 'Vpcs[0].VpcId' --output text)"
   ```

2. **Security Group Verification**
   ```bash
   aws ec2 describe-security-groups \
     --filters "Name=group-name,Values=*Workstation*"
   ```

### Cost Explorer Access

1. **Enable Cost Explorer**
   ```bash
   # Cost Explorer must be enabled in AWS Console
   # Go to AWS Console > Cost Management > Cost Explorer
   # Click "Enable Cost Explorer"
   ```

2. **Test Cost API Access**
   ```bash
   aws ce get-cost-and-usage \
     --time-period Start=2024-01-01,End=2024-01-02 \
     --granularity DAILY \
     --metrics BlendedCost
   ```

## 🔄 Updates and Maintenance

### Updating the Application

```bash
# Pull latest changes
git pull origin main

# Install new dependencies
npm install

# Deploy updates
cdk diff  # Review changes
cdk deploy --all
```

### Monitoring Deployment Health

```bash
# Check stack status
aws cloudformation describe-stacks \
  --query 'Stacks[?StackStatus!=`CREATE_COMPLETE` && StackStatus!=`UPDATE_COMPLETE`]'

# Monitor Lambda errors
aws logs filter-log-events \
  --log-group-name "/aws/lambda/MediaWorkstation-EC2Management" \
  --filter-pattern "ERROR" \
  --start-time $(date -d '24 hours ago' +%s)000
```

### Backup and Disaster Recovery

```bash
# Enable DynamoDB point-in-time recovery (already configured in CDK)
aws dynamodb describe-table \
  --table-name WorkstationManagement \
  --query 'Table.RestoreSummary'

# Export CloudFormation templates for backup
aws cloudformation get-template \
  --stack-name WorkstationInfrastructure \
  --template-stage Original > infrastructure-backup.json
```

## 🚨 Rollback Procedures

### Emergency Rollback

```bash
# Rollback to previous version
cdk deploy --rollback

# Or delete and redeploy if needed
cdk destroy WorkstationFrontend
cdk destroy WorkstationApi
# Keep WorkstationInfrastructure unless absolutely necessary
```

### Partial Rollback

```bash
# Rollback specific stack
aws cloudformation cancel-update-stack \
  --stack-name WorkstationApi

# Wait for rollback to complete
aws cloudformation wait stack-update-complete \
  --stack-name WorkstationApi
```

## 📞 Support and Next Steps

### Production Readiness Checklist

- [ ] Domain configuration completed
- [ ] Cost budgets and alerts configured
- [ ] CloudWatch dashboards created
- [ ] Security review completed
- [ ] User training conducted
- [ ] Backup procedures tested
- [ ] Disaster recovery plan documented

### Getting Help

1. **AWS Support**: Create support cases for AWS service issues
2. **Community**: AWS re:Post, Stack Overflow with AWS tags
3. **Documentation**: AWS service documentation and CDK guides
4. **Monitoring**: CloudWatch Insights for log analysis

### Performance Optimization

After deployment, monitor and optimize:
- Lambda function execution times
- DynamoDB read/write patterns
- API Gateway response times
- EC2 instance utilization
- Cost optimization opportunities

---

**Congratulations! Your Media Workstation Automation System is now deployed and ready for use.**