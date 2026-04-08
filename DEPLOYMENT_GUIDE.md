# Deployment Guide

This guide covers everything you need to deploy NyroForge EC2 Workstation Manager to your own AWS account, from prerequisites through post-deployment configuration and teardown.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [One-Click Deployment (Recommended)](#2-one-click-deployment-recommended)
3. [Manual Deployment](#3-manual-deployment)
4. [Post-Deployment Configuration](#4-post-deployment-configuration)
5. [Environment Variables Reference](#5-environment-variables-reference)
6. [Troubleshooting](#6-troubleshooting)
7. [Tearing Down the Stack](#7-tearing-down-the-stack)

---

## 1. Prerequisites

### Software

| Tool | Minimum Version | Notes |
|------|----------------|-------|
| Node.js | 18.x | https://nodejs.org/ |
| npm | 9.x | Bundled with Node 18 |
| AWS CLI | 2.x | https://aws.amazon.com/cli/ |
| AWS CDK | 2.117.0+ | Install: `npm install -g aws-cdk` |
| Git | Any recent | https://git-scm.com/ |

Verify your versions before proceeding:

```bash
node -v        # must be v18.x or higher
npm -v
aws --version  # must be aws-cli/2.x
cdk --version  # must be 2.117.0 or higher
```

### AWS Account Requirements

- An AWS account with billing enabled.
- AWS CLI configured with credentials that have sufficient permissions (see IAM section below).
- AWS Cost Explorer **must be enabled** in your account (one-time activation at https://console.aws.amazon.com/cost-management/home). Cost data can take up to 24 hours to appear after activation.

### IAM Permissions

The deploying identity (IAM user or role) needs broad permissions to create the infrastructure. The minimum required permissions cover:

- CloudFormation (create/update/delete stacks)
- S3 (create buckets, put objects)
- Lambda (create/update functions)
- API Gateway (create APIs, stages, authorizers)
- DynamoDB (create tables)
- Cognito (create user pools and clients)
- CloudFront (create distributions)
- EC2 (create VPCs, subnets, security groups, VPC endpoints)
- KMS (create keys)
- SSM (put/get parameters)
- Secrets Manager (create secrets)
- IAM (create roles and policies — required for CDK)
- CloudWatch (create dashboards and alarms)
- EventBridge (create rules)
- SNS (create topics)
- WAFv2 (create web ACLs)

For a new deployment in a sandbox account, attaching `AdministratorAccess` to the deploying role is the simplest option. For production deployments, create a scoped deployment role using the permissions above.

### CDK Bootstrap

CDK must be bootstrapped in your target account and region before the first deployment. The one-click script handles this automatically. For manual deployments, run:

```bash
cdk bootstrap aws://<ACCOUNT_ID>/<REGION>
```

This only needs to be run once per account/region combination.

---

## 2. One-Click Deployment (Recommended)

The `deploy-one-click.sh` script automates the entire deployment process. It is the recommended path for first-time deployments.

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/monkeyclick/nyroforge.git
cd nyroforge

# 2. Make the script executable
chmod +x scripts/deploy-one-click.sh

# 3. Configure AWS credentials
aws configure

# 4. Run the deployment script
./scripts/deploy-one-click.sh
```

### What the script does

The script walks through these stages automatically, prompting for input at each configuration step:

1. **Pre-flight checks** — Verifies Node.js (18+), npm, AWS CLI (v2), and CDK are installed. Validates that your AWS credentials are active.
2. **Configuration prompts** — Asks for:
   - Target AWS region (defaults to your CLI default)
   - Admin email address
   - Whether to configure Active Directory domain join (optional)
3. **Dependency installation** — Runs `npm install` at the root, in `src/lambda/cognito-admin-service/`, and in `frontend/`.
4. **CDK bootstrap** — Checks whether CDK is already bootstrapped in the target region and bootstraps it if not.
5. **Infrastructure deployment** — Runs `cdk deploy --all`. This takes approximately 15–25 minutes.
6. **Admin user creation** — Creates a Cognito user with the email you provided and adds them to the `workstation-admin` group with a temporary password.
7. **System parameter configuration** — Writes default SSM parameters (default region, allowed instance types, auto-termination hours).
8. **Domain join configuration** (if selected) — Writes domain name and OU path to SSM Parameter Store.
9. **Output** — Displays the website URL, API endpoint, User Pool ID, admin email, and temporary password. Non-sensitive details are saved to `deployment-info.txt`.

### After the script completes

The script prints your deployment credentials to the terminal. **Copy the temporary password immediately — it is not stored anywhere.**

Open the website URL printed in the output, log in with your admin email and temporary password, and change the password when prompted.

---

## 3. Manual Deployment

Use the manual path if you need fine-grained control over the deployment steps or are integrating into an existing CI/CD pipeline.

### 3.1 Clone and install dependencies

```bash
git clone https://github.com/monkeyclick/nyroforge.git
cd nyroforge

# Root dependencies (CDK, TypeScript, test tools)
npm install

# Lambda function dependencies
cd src/lambda/cognito-admin-service
npm install
cd ../../..

# Frontend dependencies
cd frontend
npm install
cd ..
```

### 3.2 Set environment variables

```bash
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=us-west-2   # replace with your target region
```

### 3.3 Bootstrap CDK

```bash
cdk bootstrap "aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION"
```

Skip this step if CDK is already bootstrapped in the account/region.

### 3.4 Synthesise and review

```bash
cdk synth
```

Review the synthesised CloudFormation templates in `cdk.out/` before deploying.

### 3.5 Deploy all stacks

```bash
cdk deploy --all --outputs-file cdk-outputs.json
```

You will be prompted to approve IAM and security group changes. To suppress prompts in CI environments:

```bash
cdk deploy --all --require-approval never --outputs-file cdk-outputs.json
```

Deployment takes approximately 15–20 minutes.

### 3.6 Create the admin user

```bash
USER_POOL_ID=$(cat cdk-outputs.json | grep -o '"UserPoolId"[^,]*' | cut -d'"' -f4 | head -1)

# Generate a compliant temporary password
ADMIN_PASSWORD=$(openssl rand -base64 16 | tr -d '+/=' | head -c 16)'!A1'

aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username admin@yourcompany.com \
  --user-attributes \
    Name=email,Value=admin@yourcompany.com \
    Name=email_verified,Value=true \
  --temporary-password "$ADMIN_PASSWORD" \
  --message-action SUPPRESS \
  --region "$CDK_DEFAULT_REGION"

aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$USER_POOL_ID" \
  --username admin@yourcompany.com \
  --group-name workstation-admin \
  --region "$CDK_DEFAULT_REGION"

echo "Temporary password: $ADMIN_PASSWORD"
echo "Change this password on first login."
```

> Passwords must be at least 8 characters and include uppercase, lowercase, numbers, and special characters. Never commit passwords to source control.

---

## 4. Post-Deployment Configuration

### 4.1 First login

1. Open the CloudFront URL from `deployment-info.txt` or `cdk-outputs.json`.
2. Log in with your admin email and the temporary password.
3. You will be prompted to set a new permanent password.
4. Configure MFA (strongly recommended for admin accounts).

### 4.2 Configure SSM parameters

The deployment script sets sensible defaults. Override them as needed:

```bash
# Set the default AWS region for workstation launches
aws ssm put-parameter \
  --name "/workstation/config/defaultRegion" \
  --value "us-west-2" \
  --type "String" \
  --overwrite \
  --region "$CDK_DEFAULT_REGION"

# Set allowed instance types (JSON array stored as a String)
aws ssm put-parameter \
  --name "/workstation/config/allowedInstanceTypes" \
  --value '["g4dn.xlarge","g5.xlarge","g6.xlarge","c7i.xlarge"]' \
  --type "String" \
  --overwrite \
  --region "$CDK_DEFAULT_REGION"

# Set default auto-termination timeout in hours
aws ssm put-parameter \
  --name "/workstation/config/defaultAutoTerminateHours" \
  --value "8" \
  --type "String" \
  --overwrite \
  --region "$CDK_DEFAULT_REGION"
```

### 4.3 Configure Active Directory domain join (optional)

If your workstations need to join an Active Directory domain:

```bash
# Domain configuration in SSM
aws ssm put-parameter \
  --name "/workstation/domain/name" \
  --value "corp.example.com" \
  --type "String" \
  --overwrite \
  --region "$CDK_DEFAULT_REGION"

aws ssm put-parameter \
  --name "/workstation/domain/ou-path" \
  --value "OU=Workstations,DC=corp,DC=example,DC=com" \
  --type "String" \
  --overwrite \
  --region "$CDK_DEFAULT_REGION"

# Domain join credentials in Secrets Manager
aws secretsmanager create-secret \
  --name "workstation/domain-join" \
  --region "$CDK_DEFAULT_REGION" \
  --secret-string '{
    "username": "domain-join-user@corp.example.com",
    "password": "your-secure-password"
  }'
```

> The domain join account needs only the permission to join computers to the specified OU. Do not use a domain admin account for this purpose.

### 4.4 Launch your first workstation

1. Log into the web UI as admin.
2. Navigate to **Workstations** > **Launch**.
3. Select a region, instance type, and authentication method.
4. Set an auto-termination timeout.
5. Click **Launch** and wait for the instance to reach the Running state (~3–5 minutes).
6. Retrieve the RDP file or credentials from the workstation detail view.

### 4.5 Create additional users

```bash
aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username user@yourcompany.com \
  --user-attributes \
    Name=email,Value=user@yourcompany.com \
    Name=email_verified,Value=true \
  --temporary-password "TempPass123!" \
  --region "$CDK_DEFAULT_REGION"
```

Standard users (not in `workstation-admin`) can only manage their own workstations.

---

## 5. Environment Variables Reference

These variables are used during deployment. They are not required at runtime (the application reads configuration from SSM and Secrets Manager).

| Variable | Description | Example |
|----------|-------------|---------|
| `CDK_DEFAULT_ACCOUNT` | AWS account ID for deployment | `123456789012` |
| `CDK_DEFAULT_REGION` | AWS region for deployment | `us-west-2` |

### SSM Parameter Store keys (runtime)

| Parameter | Type | Description |
|-----------|------|-------------|
| `/workstation/config/defaultRegion` | String | Default region for launching workstations |
| `/workstation/config/allowedInstanceTypes` | String | JSON-encoded array of allowed EC2 instance types |
| `/workstation/config/defaultAutoTerminateHours` | String | Hours before auto-termination (default: `8`) |
| `/workstation/domain/name` | String | Active Directory domain name (optional) |
| `/workstation/domain/ou-path` | String | OU path for domain join (optional) |

### Secrets Manager keys (runtime)

| Secret | Description |
|--------|-------------|
| `workstation/domain-join` | JSON with `username` and `password` for AD domain join |

---

## 6. Troubleshooting

### Deployment fails with "CDK bootstrap required"

```bash
cdk bootstrap "aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION"
```

Then re-run the deployment.

### Deployment fails with insufficient permissions

Check which IAM action failed in the CloudFormation event log:

```bash
aws cloudformation describe-stack-events \
  --stack-name WorkstationInfrastructureStack \
  --region "$CDK_DEFAULT_REGION" \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
  --output table
```

Grant the missing permission to the deploying IAM identity.

### Workstation launch fails

Check the EC2 management Lambda logs:

```bash
aws logs filter-log-events \
  --log-group-name /aws/lambda/MediaWorkstation-EC2Management \
  --start-time $(date -d '1 hour ago' +%s 2>/dev/null || date -v-1H +%s)000 \
  --region "$CDK_DEFAULT_REGION"
```

Common causes:
- Service limits for G-instance families (request a quota increase via the AWS console)
- Insufficient EC2 capacity in the selected availability zone (try a different region or AZ)
- Missing AMI in the selected region (confirm the Windows Server AMI is available)

### Authentication / login fails

Verify the Cognito User Pool is healthy:

```bash
aws cognito-idp describe-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --region "$CDK_DEFAULT_REGION"
```

Reset a user's password if needed:

```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username user@yourcompany.com \
  --password "NewPass123!" \
  --permanent \
  --region "$CDK_DEFAULT_REGION"
```

### API returns 401 Unauthorized

- Confirm the Cognito token has not expired (tokens expire after 1 hour).
- Verify the `Authorization: Bearer <token>` header is present and correctly formatted.
- The API Gateway uses a native Cognito User Pool authorizer (`WorkstationCognitoAuthorizer`) — there is no separate Lambda authorizer function. Check API Gateway execution logs in CloudWatch for authorizer rejection details:

```bash
aws logs describe-log-groups \
  --log-group-name-prefix "API-Gateway-Execution-Logs" \
  --region "$CDK_DEFAULT_REGION" \
  --query 'logGroups[*].logGroupName'
```

### Cost data shows as unavailable

- Ensure AWS Cost Explorer is enabled in your account (see Prerequisites).
- Cost data has a 24-hour lag. Wait a day after first enabling Cost Explorer.
- Verify the Lambda execution role has `ce:GetCostAndUsage` permission.

```bash
aws ce get-cost-and-usage \
  --time-period Start=2024-01-01,End=2024-01-02 \
  --granularity DAILY \
  --metrics BlendedCost \
  --region us-east-1
```

Note: Cost Explorer API is only available in `us-east-1` regardless of your deployment region.

### Network / VPC connectivity issues

Verify VPC endpoints are in place:

```bash
VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=tag:aws:cloudformation:stack-name,Values=WorkstationInfrastructureStack" \
  --query 'Vpcs[0].VpcId' \
  --output text \
  --region "$CDK_DEFAULT_REGION")

aws ec2 describe-vpc-endpoints \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query 'VpcEndpoints[*].[ServiceName,State]' \
  --output table \
  --region "$CDK_DEFAULT_REGION"
```

### Frontend not loading or returns 403

- CloudFront distributions take up to 15 minutes to propagate globally after creation. Wait and retry.
- Confirm the S3 bucket policy allows CloudFront access (the CDK stack configures this automatically).
- Clear your browser cache and try an incognito window.

---

## 7. Tearing Down the Stack

To completely remove all AWS resources created by this project:

```bash
# Destroy all CDK stacks (will prompt for confirmation)
cdk destroy --all --region "$CDK_DEFAULT_REGION"
```

To destroy without prompts (useful in CI):

```bash
cdk destroy --all --force --region "$CDK_DEFAULT_REGION"
```

Or use the npm shortcut:

```bash
npm run destroy
```

### Resources that may require manual cleanup

CDK will not automatically delete certain stateful resources to prevent accidental data loss:

- **DynamoDB tables** — retained by default. Delete manually via the console or CLI if not needed.
- **S3 buckets with content** — CDK will fail to delete a non-empty bucket. Empty the bucket first:
  ```bash
  aws s3 rm s3://<bucket-name> --recursive --region "$CDK_DEFAULT_REGION"
  ```
- **Cognito User Pools** — delete manually if CDK does not remove them.
- **Secrets Manager secrets** — secrets have a 7-day scheduled deletion period by default. Force-delete if needed:
  ```bash
  aws secretsmanager delete-secret \
    --secret-id workstation/domain-join \
    --force-delete-without-recovery \
    --region "$CDK_DEFAULT_REGION"
  ```
- **SSM parameters** — delete manually:
  ```bash
  aws ssm delete-parameters \
    --names \
      "/workstation/config/defaultRegion" \
      "/workstation/config/allowedInstanceTypes" \
      "/workstation/config/defaultAutoTerminateHours" \
      "/workstation/domain/name" \
      "/workstation/domain/ou-path" \
    --region "$CDK_DEFAULT_REGION"
  ```
- **Running EC2 instances** — terminate all workstations from the UI or via CLI before destroying the stack.

> Tearing down the stack removes all infrastructure but does not delete any IAM users, policies, or CDK bootstrap resources (`CDKToolkit` stack and its S3 bucket). Remove those separately if desired.

---

## Additional Resources

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS EC2 Documentation](https://docs.aws.amazon.com/ec2/)
- [AWS Lambda Documentation](https://docs.aws.amazon.com/lambda/)
- [AWS Cognito Documentation](https://docs.aws.amazon.com/cognito/)
- [NyroForge Website](https://nyroforge.com)

---

Owner: Matt Herson | [nyroforge.com](https://nyroforge.com)
