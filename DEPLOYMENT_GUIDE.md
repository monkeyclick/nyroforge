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

The deployment runs in **two phases**. This split is not cosmetic: the web UI is a
Next.js static export, and Next.js inlines the API Gateway URL and Cognito IDs
into its JavaScript bundle at *build* time. Those values do not exist until the
backend stacks are created, so the UI must be built after Phase 1 and published
in Phase 2.

**Phase 1 — backend**

1. **Pre-flight checks** — Verifies Node.js (18+), npm, AWS CLI (v2), and CDK are installed. Validates that your AWS credentials are active.
2. **Configuration prompts** — Asks for:
   - Target AWS region (defaults to your CLI default)
   - Admin email address
   - Admin first and last name (Cognito requires both — see §6)
3. **Dependency installation** — Runs `npm install` at the root, in `src/lambda/cognito-admin-service/`, and in `frontend/`.
4. **Lambda bundling** — Runs `npm run build:lambdas`, which esbuilds every function into `dist/lambda/<service>`. Each Lambda's CDK code asset points there, and `dist/` is gitignored, so this step is mandatory — without it `cdk deploy` aborts during synthesis with `Cannot find asset`.
5. **CDK bootstrap** — Checks the bootstrap stack *version* (6+ required) and bootstraps or upgrades it as needed.
6. **Backend deployment** — Deploys `WorkstationInfrastructure`, `WorkstationStorage`, `WorkstationApi`, `WorkstationAdminApi` and `WorkstationFrontend`. Roughly 15–25 minutes.

**Phase 2 — configuration and web UI**

7. **Admin user creation** — Creates a Cognito user with the email and name you provided, with a temporary password, and adds them to the `workstation-admin` group. Skips creation if the user already exists, leaving their password untouched.
8. **Package catalog seeding** — Populates the bootstrap package table with the NVIDIA GRID driver, the DCV server and the common applications. Skipping this leaves the catalog empty, so launched workstations come up with no GPU driver and no remote-access server.
9. **System parameter verification** — Confirms the SSM parameters the launcher reads are present. The CDK infrastructure stack owns these values, so the script verifies rather than overwrites them.
10. **Web UI build** — Writes `frontend/.env.local` from the deployed stack outputs and builds the static export.
11. **Website deployment** — Deploys `WorkstationWebsite`, which uploads the built UI to S3 and invalidates CloudFront.
12. **Output** — Displays the website URL, API endpoint, User Pool ID, admin email, and temporary password. Non-sensitive details are saved to `deployment-info.txt`.

Every step is idempotent. If the script fails it names the step that failed and
exits without rolling anything back — re-run it and completed work is skipped.

### After the script completes

The script prints your deployment credentials to the terminal. **Copy the temporary password immediately — it is not stored anywhere.**

Open the website URL printed in the output, log in with your admin email and temporary password, and set a permanent password when prompted. CloudFront may take a few minutes to serve the new build in every region.

To rebuild and republish only the web UI later (after a UI change, or after a
backend redeploy moved an endpoint):

```bash
./scripts/deploy-frontend.sh
```

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

### 3.2 Build the Lambda bundles

**Required.** Every Lambda's CDK code asset is `dist/lambda/<service>`
(`lib/service-lambda.ts`), produced by esbuild. `dist/` is gitignored and
`npm install` does not build it, so skipping this step makes `cdk deploy` fail
during *synthesis* with `Cannot find asset .../dist/lambda/ec2-management` —
before any stack is created.

```bash
npm run build:lambdas
```

### 3.3 Set environment variables

```bash
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=us-west-2   # replace with your target region
export AWS_REGION=$CDK_DEFAULT_REGION
```

### 3.4 Bootstrap CDK

```bash
cdk bootstrap "aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION"
```

Skip this step if CDK is already bootstrapped at version 6 or later. Check with:

```bash
aws cloudformation describe-stacks --stack-name CDKToolkit \
  --query "Stacks[0].Outputs[?OutputKey=='BootstrapVersion'].OutputValue" --output text
```

### 3.5 Synthesise and review

```bash
cdk synth
```

Review the synthesised CloudFormation templates in `cdk.out/` before deploying.

### 3.6 Deploy the backend stacks

Deploy the backend first and leave `WorkstationWebsite` for §3.9 — its content is
the compiled UI, which needs the endpoints produced here baked in at build time.

```bash
cdk deploy \
  WorkstationInfrastructure WorkstationStorage \
  WorkstationApi WorkstationAdminApi WorkstationFrontend \
  --outputs-file cdk-outputs.json
```

You will be prompted to approve IAM and security group changes. To suppress prompts in CI environments:

```bash
cdk deploy ... --require-approval never --outputs-file cdk-outputs.json
```

Deployment takes approximately 15–20 minutes.

> `cdk deploy --all` also works. `WorkstationWebsite` deploys a placeholder page
> when `frontend/out` does not exist yet, and §3.9 replaces it with the real UI.

### 3.7 Create the admin user

```bash
USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name WorkstationInfrastructure \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)

# Generate a compliant temporary password. The suffix guarantees one character
# from each required class; `tr` strips openssl's trailing newline too.
ADMIN_PASSWORD="$(openssl rand -base64 24 | tr -d '+/=\n' | cut -c1-16)!A1a"

# given_name and family_name are REQUIRED attributes on this user pool.
# Omitting them fails with:
#   InvalidParameterException: Attributes did not conform to the schema:
#   given_name: The attribute is required
aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username admin@yourcompany.com \
  --user-attributes \
    Name=email,Value=admin@yourcompany.com \
    Name=email_verified,Value=true \
    Name=given_name,Value=System \
    Name=family_name,Value=Administrator \
  --temporary-password "$ADMIN_PASSWORD" \
  --message-action SUPPRESS \
  --region "$CDK_DEFAULT_REGION"

# Cognito group membership is what grants admin rights.
aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$USER_POOL_ID" \
  --username admin@yourcompany.com \
  --group-name workstation-admin \
  --region "$CDK_DEFAULT_REGION"

echo "Temporary password: $ADMIN_PASSWORD"
echo "Change this password on first login."
```

Or use the script, which handles both steps and is safe to re-run:

```bash
USER_POOL_ID="$USER_POOL_ID" \
ADMIN_EMAIL=admin@yourcompany.com \
ADMIN_FIRST_NAME=System ADMIN_LAST_NAME=Administrator \
  node scripts/init-admin-system.js
```

> Passwords must be at least **12** characters and include uppercase, lowercase, numbers, and special characters. Never commit passwords to source control.

### 3.8 Seed the bootstrap package catalog

**Required for usable workstations.** Without it the catalog is empty, so
launched instances get no GPU driver and no DCV remote-access server — the
instance boots but cannot be used.

```bash
export BOOTSTRAP_PACKAGES_TABLE=$(aws cloudformation describe-stacks \
  --stack-name WorkstationInfrastructure \
  --query "Stacks[0].Outputs[?OutputKey=='BootstrapPackagesTableName'].OutputValue" --output text)

node scripts/seed-bootstrap-packages.js
node scripts/seed-dcv-package.js
```

### 3.9 Build and publish the web UI

```bash
cdk deploy WorkstationWebsite --require-approval never
./scripts/deploy-frontend.sh
```

`deploy-frontend.sh` reads the deployed endpoints from CloudFormation, writes
`frontend/.env.local`, builds the static export, syncs it to S3 and invalidates
CloudFront. Run it again after any UI change.

---

## 4. Post-Deployment Configuration

### 4.1 First login

1. Open the CloudFront URL from `deployment-info.txt` or `cdk-outputs.json`.
2. Log in with your admin email and the temporary password.
3. You will be prompted to set a new permanent password.
4. Configure MFA (strongly recommended for admin accounts).

### 4.2 Configure SSM parameters

The `WorkstationInfrastructure` stack creates these parameters with the defaults
below, and CloudFormation owns them. Overriding a value by hand works until the
next `cdk deploy`, which resets it — change the value in
`lib/workstation-infrastructure-stack.ts` if you want it to persist.

| Parameter | Default |
|-----------|---------|
| `/workstation/config/defaultInstanceType` | `g4dn.xlarge` |
| `/workstation/config/allowedInstanceTypes` | `g4dn`/`g5`/`g6` in xlarge, 2xlarge and 4xlarge |
| `/workstation/config/defaultAutoTerminateHours` | `24` |
| `/workstation/config/windowsVersions` | `["Windows Server 2019","Windows Server 2022"]` |
| `/workstation/config/instanceProfileArn` | The workstation instance profile |
| `/workstation/config/instanceRoleArn` | The workstation instance role |

To override one for the current deployment:

```bash
aws ssm put-parameter \
  --name "/workstation/config/allowedInstanceTypes" \
  --value '["g4dn.xlarge","g5.xlarge","g6.xlarge"]' \
  --type "String" \
  --overwrite \
  --region "$CDK_DEFAULT_REGION"
```

### 4.3 Configure Active Directory domain join (optional)

Domain join is configured **per workstation at launch time** in the web UI
(**Workstations** → **Launch** → authentication method **Domain**), not through
deployment-time configuration. The domain name and OU travel with the launch
request; there are no `/workstation/domain/*` SSM parameters.

What you do need is the join account, in Secrets Manager:

```bash
aws secretsmanager create-secret \
  --name "workstation/domain-join" \
  --region "$CDK_DEFAULT_REGION" \
  --secret-string '{
    "username": "domain-join-user@corp.example.com",
    "password": "your-secure-password"
  }'
```

Your workstation subnets must also be able to resolve and reach the domain
controllers (DNS, and the usual AD ports).

> The domain join account needs only the permission to join computers to the specified OU. Do not use a domain admin account for this purpose.

### 4.4 Launch your first workstation

1. Log into the web UI as admin.
2. Navigate to **Workstations** > **Launch**.
3. Select a region, instance type, and authentication method.
4. Set an auto-termination timeout.
5. Click **Launch** and wait for the instance to reach the Running state (~3–5 minutes).
6. Retrieve the RDP file or credentials from the workstation detail view.

### 4.5 Seed bootstrap packages

The `WorkstationBootstrapPackages` DynamoDB table is empty after a fresh
deployment. Without packages the launch modal shows nothing to install, and —
more importantly — workstations come up with no GPU driver and no DCV
remote-access server. `deploy-one-click.sh` and `deploy.sh` do this for you; run
it by hand with:

```bash
export BOOTSTRAP_PACKAGES_TABLE=$(aws cloudformation describe-stacks \
  --stack-name WorkstationInfrastructure \
  --query "Stacks[0].Outputs[?OutputKey=='BootstrapPackagesTableName'].OutputValue" --output text)

node scripts/seed-bootstrap-packages.js   # drivers + common applications
node scripts/seed-dcv-package.js          # Amazon DCV server
```

Both scripts are idempotent (`PutItem` by `packageId`) and exit non-zero if any
entry fails.

#### Catalog entry contract

Getting these wrong makes installs fail *silently* — the launcher wraps each
package in `try { … } catch { }`, so a bad command leaves no trace on the
instance beyond missing software.

- **`installCommand` holds the complete PowerShell command**, with the literal
  token `${INSTALLER}` wherever the downloaded file's local path belongs. The
  launcher substitutes it with `C:\Temp\<filename-from-downloadUrl>`. Do not
  hardcode the path — if it disagrees with the filename in `downloadUrl`, the
  installer runs against a path that does not exist.
- **`installArgs` should be `null`.** It exists only for legacy rows and is
  appended verbatim after the command.
- **`downloadUrl: 'none'`** means nothing is downloaded and `installCommand` is
  spliced in as a bare inline PowerShell statement — no executable prefix.
- **`isRequired` must be a String** (`"true"` / `"false"`), not a Boolean,
  because the `RequiredIndex` GSI uses `AttributeType.STRING`.
- **`isEnabled` must be a real Boolean.** It is not a GSI key, and a string
  `"false"` is truthy in the filters that read it.

### 4.6 Create additional users

```bash
# given_name and family_name are required attributes on this user pool.
aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username user@yourcompany.com \
  --user-attributes \
    Name=email,Value=user@yourcompany.com \
    Name=email_verified,Value=true \
    Name=given_name,Value=Jane \
    Name=family_name,Value=Doe \
  --temporary-password 'TempPassw0rd!2024' \
  --region "$CDK_DEFAULT_REGION"

aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$USER_POOL_ID" \
  --username user@yourcompany.com \
  --group-name workstation-user \
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
| `ENVIRONMENT` | `dev` \| `staging` \| `prod`. `prod` enables termination protection and RETAIN removal policies on stateful resources | `dev` |
| `NYROFORGE_RESOURCE_PREFIX` | Prefix for every globally-named resource (tables, buckets, functions, exports). Empty by default | `staging-` |
| `STACK_PREFIX` | Prefix for CloudFormation stack names. Empty by default | `staging-` |
| `ENABLE_EFS`, `ENABLE_FSX_WINDOWS`, `ENABLE_FSX_LUSTRE`, `ENABLE_FSX_ONTAP`, `ENABLE_FSX_OPENZFS` | Set to `true` to provision that storage backend | `true` |
| `RETAIN_VPC_ON_DELETE` | Set to `false` to allow VPC resources to be deleted with the stack | `false` |
| `ALARM_EMAIL` | Email subscribed to storage alarm notifications | `ops@example.com` |
| `SKIP_VPC_CHECK` | Set to `true` to skip the pre-synth VPC endpoint scan (offline/CI) | `true` |

#### Running two deployments in one account and region

Table names, the website bucket, Lambda function names and CloudFormation export
names are fixed literals by default. A second deployment into the same account
and region therefore collides — typically failing partway through with
`Table already exists` and leaving a half-created stack. Set both prefixes to
isolate it:

```bash
export NYROFORGE_RESOURCE_PREFIX=staging-
export STACK_PREFIX=staging-
```

Leave both unset for an existing deployment: the names are unchanged, so nothing
is replaced. Use a lowercase prefix — it is normalised for S3 bucket names, but
keeping it lowercase avoids surprises elsewhere.

### SSM Parameter Store keys (runtime)

| Parameter | Type | Description |
|-----------|------|-------------|
| `/workstation/config/defaultInstanceType` | String | Default EC2 instance type (`g4dn.xlarge`) |
| `/workstation/config/allowedInstanceTypes` | String | JSON-encoded array of allowed EC2 instance types |
| `/workstation/config/defaultAutoTerminateHours` | String | Hours before auto-termination (default: `24`) |
| `/workstation/config/windowsVersions` | String | JSON-encoded array of supported Windows Server versions |
| `/workstation/config/instanceProfileArn` | String | Instance profile attached to launched workstations |
| `/workstation/config/instanceRoleArn` | String | IAM role for launched workstations |
| `/workstation/frontend/config` | String | JSON frontend runtime configuration |
| `/workstation/frontend/auth` | String | JSON Cognito configuration |

### Secrets Manager keys (runtime)

| Secret | Description |
|--------|-------------|
| `workstation/domain-join` | JSON with `username` and `password` for AD domain join |

---

## 6. Troubleshooting

### Account-level constraints that affect deployment

Some AWS accounts have constraints that require workarounds before `cdk deploy` will succeed:

**VPC limit reached (default limit: 5 VPCs per region)**

If `cdk deploy` fails because the VPC limit is exceeded, edit `lib/workstation-infrastructure-stack.ts` to reuse an existing VPC instead of creating one:

```typescript
// Replace new ec2.Vpc(...) with:
const vpc = ec2.Vpc.fromLookup(this, 'WorkstationVPC', { vpcId: 'vpc-xxxxxxxxxxxxxxxxx' });
```

Change the `vpc` prop type in `lib/workstation-api-stack.ts` from `ec2.Vpc` to `ec2.IVpc`. Also replace `addInterfaceEndpoint()` calls with explicit `new ec2.InterfaceVpcEndpoint(...)` constructors. Check for existing S3/DynamoDB gateway endpoints before adding them — duplicate routes cause deployment failures.

**Tag policy enforcement**

Some AWS organizations enforce a tag policy requiring lowercase tag keys. If resource creation fails with a tag policy error, ensure all tag keys use lowercase (e.g., `owner`, not `Owner`). The CDK stack uses `owner` by default; check any Lambda functions for hardcoded `Owner` tag keys.

**Subnets have `MapPublicIpOnLaunch=false`**

If workstations launch without a public IP (DCV URL shows `https://undefined:8443`), add `AssociatePublicIpAddress: true` to the `NetworkInterfaces` block in `src/lambda/ec2-management/index.ts`.

---

### Synthesis fails with "Cannot find asset .../dist/lambda/<service>"

The Lambda bundles were never built. `dist/` is gitignored and `npm install` does
not build it, so this is the normal state of a fresh clone:

```bash
npm run build:lambdas
```

This is a *synthesis* failure, so it happens before any stack is touched —
nothing needs cleaning up. `deploy-one-click.sh` and `deploy.sh` run the build
for you.

### The website loads but shows "UI not built yet"

`WorkstationWebsite` was deployed before the UI was built, so it is serving the
placeholder page. Build and publish the real bundle:

```bash
./scripts/deploy-frontend.sh
```

### The website loads but every request fails, or login does nothing

The UI was built without the API and Cognito values. Next.js inlines
`NEXT_PUBLIC_*` at build time, so a bundle built before the backend existed — or
built by hand without `frontend/.env.local` — has empty endpoints. Check the
generated config and rebuild:

```bash
cat frontend/.env.local     # should list API, admin API, user pool and client IDs
./scripts/deploy-frontend.sh
```

If the browser console shows requests to `undefined/...`, this is the cause.

### Deployment fails with "CDK bootstrap required"

```bash
cdk bootstrap "aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION"
```

Then re-run the deployment. If assets fail to publish with a permissions or
version error, the bootstrap stack is too old — check and re-bootstrap:

```bash
aws cloudformation describe-stacks --stack-name CDKToolkit \
  --query "Stacks[0].Outputs[?OutputKey=='BootstrapVersion'].OutputValue" --output text
```

Version 6 or later is required.

### Deployment fails with "Table already exists" / "BucketAlreadyExists"

Either another NyroForge deployment already occupies these names in this account
and region, or a previous stack was deleted while its tables were retained. To
run a second deployment alongside the first, set `NYROFORGE_RESOURCE_PREFIX` and
`STACK_PREFIX` (see §5). Otherwise delete the leftover resources, or the stack
stuck in `ROLLBACK_COMPLETE`:

```bash
aws cloudformation delete-stack --stack-name WorkstationInfrastructure \
  --region "$CDK_DEFAULT_REGION"
```

### Admin user creation fails with "given_name: The attribute is required"

`given_name` and `family_name` are required attributes on the user pool, so
`admin-create-user` must supply both. See §3.7 for the full command, or use
`scripts/init-admin-system.js`.

### Deployment fails with insufficient permissions

Check which IAM action failed in the CloudFormation event log:

```bash
aws cloudformation describe-stack-events \
  --stack-name WorkstationInfrastructure \
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

### Workstation launches, but has no GPU driver / no DCV / no software

The workstation boots and reaches Running, but nothing is installed. Two causes:

**The package catalog is empty.** Check and seed it (§4.5):

```bash
aws dynamodb scan --table-name WorkstationBootstrapPackages \
  --select COUNT --region "$CDK_DEFAULT_REGION"
```

**A catalog entry's install command is malformed.** The generated PowerShell wraps
each package in `try { … } catch { }`, so a bad command fails silently. Read the
setup log on the instance at `C:\WorkstationSetup.log`, and check the entry
against the contract in §4.5 — most often `installCommand` is missing the
`${INSTALLER}` placeholder, or hardcodes a path that disagrees with the filename
in `downloadUrl`.

### Authentication / login fails

Verify the Cognito User Pool is healthy:

```bash
aws cognito-idp describe-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --region "$CDK_DEFAULT_REGION"
```

Reset a user's password if needed. The pool requires **12+ characters** with
uppercase, lowercase, a digit and a symbol:

```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username user@yourcompany.com \
  --password 'NewPassw0rd!2024' \
  --permanent \
  --region "$CDK_DEFAULT_REGION"
```

**First login rejects the new password with an attribute error.** The user is
missing the required `given_name`/`family_name`. The login form collects both
alongside the new password and sends them with the challenge response, so this
resolves itself — but for a user created outside the UI you can also set them
directly:

```bash
aws cognito-idp admin-update-user-attributes \
  --user-pool-id "$USER_POOL_ID" \
  --username user@yourcompany.com \
  --user-attributes Name=given_name,Value=Jane Name=family_name,Value=Doe \
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
  --filters "Name=tag:aws:cloudformation:stack-name,Values=WorkstationInfrastructure" \
  --query 'Vpcs[0].VpcId' \
  --output text \
  --region "$CDK_DEFAULT_REGION")

aws ec2 describe-vpc-endpoints \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query 'VpcEndpoints[*].[ServiceName,State]' \
  --output table \
  --region "$CDK_DEFAULT_REGION"
```

### Admin panel shows no users / groups / roles

1. Confirm `NEXT_PUBLIC_ADMIN_API_ENDPOINT` is set in the frontend build environment and points to the Admin API Gateway (`WorkstationAdminApi` stack output), not the main API.

2. Confirm the Admin API routes reach the correct Lambda. The admin user and role endpoints are at `/users`, `/roles`, `/groups` on the Admin API — there is **no `/admin/` prefix** on the Admin API.

3. Test the Lambda directly:
   ```bash
   aws lambda invoke \
     --function-name workstation-cognito-admin-service \
     --payload '{"httpMethod":"GET","path":"/users","pathParameters":null,"requestContext":{"authorizer":{"claims":{"cognito:groups":"workstation-admin","email":"you@example.com"}}}}' \
     --cli-binary-format raw-in-base64-out \
     /tmp/out.json && cat /tmp/out.json
   ```

4. If all users display as "No Name", the Lambda is returning raw Cognito records. Verify `mapCognitoUser()` is called inside `listUsers()`.

5. If role create/update returns an error, check that `isSystem` is stored as the **string** `'false'` (not a boolean). The `SystemRoleIndex` GSI requires `AttributeType.STRING`.

### Frontend not loading or returns 403

- CloudFront distributions take up to 15 minutes to propagate globally after creation. Wait and retry.
- Confirm the S3 bucket policy allows CloudFront access (the CDK stack configures this automatically).
- Clear your browser cache and try an incognito window.
- If it serves an old build, the cache invalidation has not finished. `deploy-frontend.sh` waits for it; check manually with `aws cloudfront list-invalidations --distribution-id <id>`.

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
