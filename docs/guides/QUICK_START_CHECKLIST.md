# EC2 Workstation Manager - Quick Start Checklist

Use this checklist to ensure a smooth deployment. Print or save this for reference during deployment.

---

## Pre-Deployment Checklist

### AWS Account Setup
- [ ] AWS account created and accessible
- [ ] Billing alerts configured
- [ ] Cost Explorer enabled (requires 24 hours to activate)
- [ ] Service quotas checked for EC2 instance types needed
- [ ] AWS CLI v2 installed and configured
  ```bash
  aws --version  # Should show 2.x
  aws sts get-caller-identity  # Verify credentials work
  ```

### Development Environment
- [ ] Node.js 18+ installed
  ```bash
  node --version  # Should show v18.x or higher
  ```
- [ ] npm 9+ installed
  ```bash
  npm --version  # Should show v9.x or higher
  ```
- [ ] AWS CDK installed globally
  ```bash
  npm install -g aws-cdk
  cdk --version  # Should show 2.x
  ```
- [ ] Git installed (for cloning repository)

### Planning
- [ ] Deployment region chosen (e.g., us-west-2)
- [ ] Admin email address prepared
- [ ] Office IP addresses noted for security group restrictions
- [ ] VPC CIDR blocks planned (if custom VPC needed)
- [ ] Domain details gathered (if using domain join)
  - [ ] Domain name
  - [ ] Domain join service account credentials
  - [ ] OU path for workstations
  - [ ] DNS server IPs

---

## Deployment Steps

### Step 1: Repository Setup
- [ ] Repository cloned
  ```bash
  git clone <repository-url>
  cd ec2mgr4me
  ```
- [ ] Root dependencies installed
  ```bash
  npm install
  ```
- [ ] Lambda dependencies installed
  ```bash
  cd src/lambda/cognito-admin-service && npm install && cd ../../..
  ```
- [ ] Frontend dependencies installed
  ```bash
  cd frontend && npm install && cd ..
  ```

### Step 2: AWS Configuration
- [ ] AWS credentials configured
  ```bash
  aws configure
  # Enter: Access Key, Secret Key, Region, Output Format
  ```
- [ ] Environment variables set
  ```bash
  export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
  export CDK_DEFAULT_REGION=us-west-2  # Your region
  echo "Account: $CDK_DEFAULT_ACCOUNT"
  echo "Region: $CDK_DEFAULT_REGION"
  ```

### Step 3: CDK Bootstrap
- [ ] CDK bootstrapped (first time only)
  ```bash
  cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION
  ```
- [ ] Bootstrap successful (✅ message shown)

### Step 4: Review Deployment
- [ ] Stacks listed successfully
  ```bash
  cdk list
  ```
- [ ] CloudFormation template synthesized (optional review)
  ```bash
  cdk synth > template.yaml
  # Review template.yaml if desired
  ```

### Step 5: Deploy Infrastructure
- [ ] All stacks deployed
  ```bash
  cdk deploy --all --outputs-file cdk-outputs.json
  ```
- [ ] Deployment completed (15-25 minutes)
- [ ] No errors in deployment output
- [ ] cdk-outputs.json file created
  ```bash
  cat cdk-outputs.json  # Verify outputs exist
  ```

### Step 6: Record Deployment Outputs
- [ ] User Pool ID recorded
  ```bash
  grep UserPoolId cdk-outputs.json
  ```
- [ ] API Endpoint recorded
  ```bash
  grep ApiEndpoint cdk-outputs.json
  ```
- [ ] Website URL recorded
  ```bash
  grep WebsiteUrl cdk-outputs.json
  ```
- [ ] All outputs saved to secure location

---

## Post-Deployment Configuration

### Admin User Setup
- [ ] Admin user created
  ```bash
  USER_POOL_ID=$(cat cdk-outputs.json | jq -r '.WorkstationInfrastructureStack.UserPoolId')
  aws cognito-idp admin-create-user \
    --user-pool-id $USER_POOL_ID \
    --username admin@yourcompany.com \
    --user-attributes Name=email,Value=admin@yourcompany.com Name=email_verified,Value=true \
    --temporary-password "TempPass123!" \
    --message-action SUPPRESS
  ```
- [ ] Admin added to workstation-admin group
  ```bash
  aws cognito-idp admin-add-user-to-group \
    --user-pool-id $USER_POOL_ID \
    --username admin@yourcompany.com \
    --group-name workstation-admin
  ```

### System Configuration
- [ ] Default region configured
  ```bash
  aws ssm put-parameter \
    --name "/workstation/config/defaultRegion" \
    --value "$CDK_DEFAULT_REGION" \
    --type "String" \
    --overwrite
  ```
- [ ] Allowed instance types configured
  ```bash
  aws ssm put-parameter \
    --name "/workstation/config/allowedInstanceTypes" \
    --value '["g4dn.xlarge","g5.xlarge","g6.xlarge","c7i.xlarge"]' \
    --type "StringList" \
    --overwrite
  ```
- [ ] Default auto-terminate hours set
  ```bash
  aws ssm put-parameter \
    --name "/workstation/config/defaultAutoTerminateHours" \
    --value "8" \
    --type "String" \
    --overwrite
  ```

### Domain Configuration (Optional - Skip if not using)
- [ ] Domain join credentials stored
  ```bash
  aws secretsmanager create-secret \
    --name "workstation/domain-join-credentials" \
    --secret-string '{"username":"svc-join@corp.com","password":"SecurePass123!"}'
  ```
- [ ] Domain name configured
  ```bash
  aws ssm put-parameter \
    --name "/workstation/domain/name" \
    --value "corp.example.com" \
    --type "String"
  ```
- [ ] Domain OU path configured
  ```bash
  aws ssm put-parameter \
    --name "/workstation/domain/ou-path" \
    --value "OU=Workstations,DC=corp,DC=example,DC=com" \
    --type "String"
  ```

---

## Testing & Validation

### Access Frontend
- [ ] Website URL opened in browser
  ```bash
  WEBSITE_URL=$(cat cdk-outputs.json | jq -r '.WorkstationWebsiteStack.WebsiteUrl')
  echo $WEBSITE_URL
  # Open URL in browser
  ```
- [ ] Login page loads successfully
- [ ] No console errors in browser developer tools

### Admin Login
- [ ] Logged in with admin credentials
- [ ] Temporary password changed
- [ ] MFA configured (if enabled)
- [ ] Admin dashboard accessible

### Launch Test Workstation
- [ ] Clicked "Launch Workstation" button
- [ ] Filled in launch form:
  - [ ] Region selected
  - [ ] Instance type selected (suggest g4dn.xlarge for testing)
  - [ ] OS version selected
  - [ ] Security group template selected (suggest "Remote Desktop (RDP)")
  - [ ] Auto-terminate set to 1 hour
- [ ] Launch initiated successfully
- [ ] Workstation appears in dashboard

### Verify Workstation
- [ ] Workstation status changed to "running" (wait 5-10 minutes)
- [ ] Public IP assigned and visible
- [ ] "Get Credentials" button available

### Get Credentials
- [ ] Clicked "Get Credentials"
- [ ] Username displayed
- [ ] Password displayed
- [ ] RDP file downloaded (optional)

### Connect to Workstation
- [ ] Connected via RDP using displayed credentials
  - Windows: `mstsc /v:<PUBLIC_IP>`
  - macOS: `open rdp://<PUBLIC_IP>`
  - Linux: `rdesktop <PUBLIC_IP>`
- [ ] Login successful
- [ ] Desktop loads properly
- [ ] GPU available (for G-series instances)
  ```powershell
  # On workstation, check GPU
  nvidia-smi  # Should show GPU info
  ```

### Verify Features
- [ ] Network connectivity working
- [ ] Auto-terminate scheduled correctly
- [ ] Cost tracking visible in dashboard
- [ ] Security group rules applied correctly

### Cleanup Test
- [ ] Terminated test workstation
- [ ] Workstation removed from dashboard
- [ ] EC2 instance terminated in AWS Console

---

## Security Configuration

### Security Groups
- [ ] Default security group rules reviewed
- [ ] Custom security groups created (if needed)
- [ ] IP restrictions configured (recommended)
- [ ] Quick-access templates tested:
  - [ ] RDP template
  - [ ] SSH template (if using Linux)
  - [ ] HP Anywhere template (if needed)
  - [ ] Amazon DCV template (if needed)

### Access Control
- [ ] Admin users identified and created
- [ ] Regular users identified
- [ ] User groups configured
- [ ] Permissions tested

---

## Monitoring Setup

### CloudWatch
- [ ] CloudWatch dashboards reviewed
- [ ] Log groups verified:
  ```bash
  aws logs describe-log-groups --query 'logGroups[?contains(logGroupName, `MediaWorkstation`)].logGroupName'
  ```
- [ ] Alarms configured (optional but recommended)

### Cost Management
- [ ] Cost Explorer data available (may take 24 hours)
- [ ] Budget alerts configured (recommended)
  ```bash
  # Example: Create $500 monthly budget
  aws budgets create-budget \
    --account-id $CDK_DEFAULT_ACCOUNT \
    --budget file://budget.json \
    --notifications-with-subscribers file://notifications.json
  ```
- [ ] Cost dashboard accessible in UI

---

## Documentation

### Internal Documentation
- [ ] Deployment outputs saved to secure location
- [ ] Admin credentials documented securely
- [ ] Network configuration documented
- [ ] Runbook created for common tasks
- [ ] Support contacts documented

### User Documentation
- [ ] User guide created or distributed
- [ ] Security group templates documented
- [ ] Instance type selection guide provided
- [ ] Cost estimation guide provided

---

## Ongoing Maintenance

### Daily
- [ ] Monitor active workstations
- [ ] Check cost dashboard
- [ ] Review failed launches (if any)

### Weekly
- [ ] Audit security groups
- [ ] Review user access logs
- [ ] Check for AWS service updates

### Monthly
- [ ] Update Lambda functions (if updates available)
- [ ] Review and optimize costs
- [ ] Update documentation
- [ ] Review workstation AMIs for patches

### Quarterly
- [ ] Security audit
- [ ] Disaster recovery test
- [ ] Capacity planning review
- [ ] User training updates

---

## Troubleshooting Quick Reference

### Deployment Failed
```bash
# Check CDK errors
cdk deploy --all --verbose

# Check CloudFormation events
aws cloudformation describe-stack-events \
  --stack-name WorkstationInfrastructureStack \
  --max-items 20
```

### Cannot Login
```bash
# Verify user exists
USER_POOL_ID=$(cat cdk-outputs.json | jq -r '.WorkstationInfrastructureStack.UserPoolId')
aws cognito-idp admin-get-user \
  --user-pool-id $USER_POOL_ID \
  --username admin@yourcompany.com

# Reset password
aws cognito-idp admin-set-user-password \
  --user-pool-id $USER_POOL_ID \
  --username admin@yourcompany.com \
  --password "NewTempPass123!" \
  --permanent false
```

### Workstation Won't Launch
```bash
# Check Lambda logs
aws logs tail /aws/lambda/MediaWorkstation-EC2Management --follow

# Check service quotas
aws service-quotas get-service-quota \
  --service-code ec2 \
  --quota-code L-DB2E81BA
```

### Cannot Connect to Workstation
```bash
# Verify security group rules
aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=*workstation*" \
  --query 'SecurityGroups[*].[GroupId,GroupName,IpPermissions]'

# Check your public IP
curl https://api.ipify.org
```

### Cost Data Not Showing
- Wait 24 hours after enabling Cost Explorer
- Verify Cost Explorer is enabled in AWS Console
- Check IAM permissions for cost-analytics Lambda

---

## Support Resources

### Documentation
- [ ] [Full Deployment Guide](DEPLOYMENT_GUIDE.md) bookmarked
- [ ] [IAM Policies Reference](IAM_POLICIES.md) bookmarked
- [ ] [README](README.md) reviewed

### AWS Resources
- [ ] AWS Support case opened (if needed)
- [ ] AWS Well-Architected Review scheduled (optional)

### Community
- [ ] GitHub Issues reviewed
- [ ] Project repository starred/watched

---

## Completion Checklist

- [ ] All deployment steps completed successfully
- [ ] Test workstation launched and accessed
- [ ] Admin user can access all features
- [ ] Security groups configured properly
- [ ] Monitoring and logging working
- [ ] Documentation completed
- [ ] Team trained on system usage
- [ ] Support contacts documented
- [ ] Backup/disaster recovery plan in place

---

## Next Steps

After completing this checklist:

1. **Create Additional Users**
   - Use Admin UI to add team members
   - Assign appropriate roles

2. **Configure Cost Budgets**
   - Set monthly spending limits
   - Configure alert notifications

3. **Customize Templates**
   - Create company-specific security group templates
   - Configure workstation defaults

4. **Schedule Training**
   - Admin training session
   - End-user training session
   - Document internal procedures

5. **Production Readiness**
   - Security review
   - Performance testing
   - Disaster recovery test

---

## Emergency Contacts

Fill in your organization's contacts:

- **Primary Admin:** ___________________________
- **AWS Account Owner:** ___________________________
- **Security Team:** ___________________________
- **Support Email:** ___________________________
- **On-Call Number:** ___________________________

---

**Checklist Version:** 1.0.0  
**Last Updated:** 2024-01-15  
**Completed By:** ___________________________ Date: ___________