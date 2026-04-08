# NyroForge — EC2 Workstation Manager

**[nyroforge.com](https://nyroforge.com)** · [Deployment Guide](DEPLOYMENT_GUIDE.md) · [Architecture](ARCHITECTURE.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

A serverless AWS application for managing virtual GPU editing workstations, built for Media & Entertainment workflows. React/Next.js frontend with full support for domain-joined and standalone Windows Server instances, comprehensive monitoring, cost tracking, and security group management.

## 📸 Screenshots

> Screenshots and demo video coming soon. See [nyroforge.com](https://nyroforge.com) for a live preview.

<!-- To add screenshots: place images in docs/screenshots/ and reference them here -->
<!-- Example: ![Dashboard](docs/screenshots/dashboard.png) -->

## 📖 Quick Links

- **[Complete Deployment Guide](DEPLOYMENT_GUIDE.md)** - Step-by-step instructions for deploying to your AWS account
- **[Architecture Overview](ARCHITECTURE.md)** - Detailed system design, stacks, and data model
- **[API Documentation](#-api-documentation)** - REST API reference
- **[Security Model](#-security-model)** - Authentication and authorization

---

## 🏗️ Architecture Overview

### System Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   API Layer     │    │   Data Layer    │
│                 │    │                 │    │                 │
│ React/Next.js   │◄──►│ API Gateway     │◄──►│ DynamoDB        │
│ AWS Amplify     │    │ Lambda Functions│    │ Secrets Manager │
│ Cognito Auth    │    │ Authorizers     │    │ Parameter Store │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AWS Services                                 │
│                                                                 │
│  EC2 (G4/G5/G6)  │  VPC/Security  │  Cost Explorer │  SSM     │
│  CloudWatch       │  KMS/Encryption│  EventBridge   │  S3      │
└─────────────────────────────────────────────────────────────────┘
```

### Key Features

#### Core Functionality
- **Serverless Architecture**: Built entirely on AWS serverless services (Lambda, DynamoDB, API Gateway)
- **Dual Authentication**: Domain join OR local admin credentials
- **Multi-Region Support**: Deploy workstations across 20+ AWS regions including Local Zones
- **Auto-Termination**: Scheduled shutdowns to prevent cost overruns
- **Cost Tracking**: Real-time cost analytics with AWS Cost Explorer integration

#### Security & Access Control
- **Security Group Management**:
  - 6 pre-configured templates (RDP, SSH, HP Anywhere, Amazon DCV, etc.)
  - Client IP auto-detection for restricted access
  - AWS Console-style rule management UI
  - Security group assignment matrix
- **Cognito Authentication**: MFA-enabled user management
- **Role-Based Access**: Admin and user roles with fine-grained permissions
- **VPC Security**: Private subnets, security groups, VPC endpoints

#### User Experience
- **Modern React/Next.js UI**: Fast, responsive interface
- **Real-Time Dashboard**: Live workstation status and metrics
- **One-Click Launch**: Pre-configured templates for quick deployment
- **Credential Management**: Secure password generation and RDP file downloads
- **Mobile Responsive**: Works on desktop, tablet, and mobile devices

## 🚀 Quick Start

> **New Deployment?** See the **[Complete Deployment Guide](DEPLOYMENT_GUIDE.md)** for detailed step-by-step instructions.

### 🎯 One-Click Deployment (Recommended)

The easiest way to deploy is using our automated script:

```bash
# 1. Clone repository
git clone <repository-url>
cd ec2mgr4me

# 2. Configure AWS credentials
aws configure

# 3. Run one-click deployment
./deploy-one-click.sh
```

The script will:
- ✅ Verify all prerequisites (Node.js, npm, AWS CLI, CDK)
- ✅ Install dependencies automatically
- ✅ Prompt for configuration (region, admin email, domain settings)
- ✅ Bootstrap and deploy CDK stacks
- ✅ Create admin user with temporary password
- ✅ Configure system parameters
- ✅ Save deployment information to `deployment-info.txt`

**Deployment time:** ~20-25 minutes

After deployment completes, check `deployment-info.txt` for:
- CloudFront URL for accessing the application
- Admin username and temporary password
- API endpoint URL
- User Pool ID

### Manual Deploy (Advanced Users)

```bash
# 1. Clone repository
git clone <repository-url>
cd ec2mgr4me
npm install

# 2. Configure AWS
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=us-west-2

# 3. Bootstrap and deploy
cdk bootstrap
cdk deploy --all --outputs-file cdk-outputs.json

# 4. Create admin user
USER_POOL_ID=$(cat cdk-outputs.json | jq -r '.WorkstationInfrastructureStack.UserPoolId')
ADMIN_PASSWORD=$(openssl rand -base64 16 | tr -d '+/=' | head -c 16)'!A1'
aws cognito-idp admin-create-user \
  --user-pool-id $USER_POOL_ID \
  --username admin@yourcompany.com \
  --user-attributes Name=email,Value=admin@yourcompany.com \
  --temporary-password "$ADMIN_PASSWORD" \
  --message-action SUPPRESS
echo "Temporary password: $ADMIN_PASSWORD"
echo "⚠️  Save this password - change it on first login."

aws cognito-idp admin-add-user-to-group \
  --user-pool-id $USER_POOL_ID \
  --username admin@yourcompany.com \
  --group-name workstation-admin
```

> **Note:** Passwords must be at least 8 characters and include uppercase, lowercase, numbers, and special characters. Never commit real passwords to source control.

**Deployment time:** ~20 minutes

For comprehensive instructions including prerequisites, troubleshooting, and post-deployment configuration, see **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)**.

## 📋 API Documentation

### Authentication

All API endpoints require Cognito JWT token in Authorization header:
```
Authorization: Bearer <jwt-token>
```

### Core Endpoints

#### Workstation Management

```http
# Launch new workstation
POST /api/workstations
Content-Type: application/json

{
  "region": "us-west-2",
  "instanceType": "g4dn.xlarge",
  "osVersion": "Windows Server 2019",
  "authMethod": "local",
  "localAdminConfig": {
    "username": "Administrator"
  },
  "autoTerminateHours": 24,
  "tags": {
    "Project": "VFX-Project-Alpha",
    "Department": "Post-Production"
  }
}
```

```http
# List workstations
GET /api/workstations?userId=user@company.com&status=running

# Get workstation details
GET /api/workstations/{workstationId}

# Terminate workstation
DELETE /api/workstations/{workstationId}
```

#### Status & Monitoring

```http
# Real-time dashboard
GET /api/dashboard/status

# System health
GET /api/health
```

#### Cost Analytics

```http
# Cost breakdown
GET /api/costs?period=monthly&userId=user@company.com
```

#### Configuration

```http
# Available regions
GET /api/regions

# Instance types
GET /api/instance-types

# System configuration
GET /api/config
```

#### Credentials

```http
# Get workstation credentials
GET /api/workstations/{workstationId}/credentials

# Reset local admin password
POST /api/workstations/{workstationId}/credentials
{
  "action": "reset-password"
}

# Initiate domain join
POST /api/workstations/{workstationId}/credentials
{
  "action": "domain-join"
}
```

## 🔒 Security Model

### Authentication & Authorization

- **Cognito User Pools**: MFA-enabled authentication
- **Admin Role**: Full access to all workstations and users
- **User Role**: Access only to own workstations
- **JWT Tokens**: Short-lived access tokens (1 hour)

### Network Security

- **VPC**: Private subnets for workstations
- **Security Groups**: Minimal required ports (RDP 3389)
- **VPC Endpoints**: Secure AWS service communication
- **WAF**: API Gateway protection

### Data Protection

- **Encryption at Rest**: KMS-encrypted DynamoDB and EBS
- **Encryption in Transit**: TLS 1.2+ everywhere
- **Secrets Management**: AWS Secrets Manager for credentials
- **Audit Logging**: CloudTrail for all API calls

### Workstation Security

- **Instance Profiles**: Minimal required permissions
- **Systems Manager**: Secure access without SSH/RDP keys
- **Auto-Shutdown**: Prevents resource waste and exposure
- **Domain Integration**: Enterprise identity management

## 💰 Cost Management

### Cost Optimization Features

1. **Auto-Termination**: Configurable idle timeouts
2. **Instance Rightsizing**: G4/G5/G6 options for different workloads
3. **Cost Tracking**: Real-time cost monitoring
4. **Budget Alerts**: Automated cost threshold notifications
5. **Usage Analytics**: Identify optimization opportunities

### Estimated Costs

| Component | Monthly Cost (est.) |
|-----------|-------------------|
| DynamoDB (Pay-per-request) | $5-50 |
| Lambda Functions | $10-100 |
| API Gateway | $3-30 |
| Cognito | $2-20 |
| **Workstation Costs** | |
| g4dn.xlarge (24/7) | ~$379 |
| g5.xlarge (24/7) | ~$724 |
| g6.xlarge (24/7) | ~$513 |

*Workstation costs vary by region and usage patterns*

## 🏢 Enterprise Configuration

### Domain Integration

For enterprise environments with Active Directory:

1. **AWS Directory Service**
   ```bash
   # Set domain configuration
   aws ssm put-parameter \
     --name "/workstation/domain/name" \
     --value "corp.example.com" \
     --type "String"
   
   aws ssm put-parameter \
     --name "/workstation/domain/ou-path" \
     --value "OU=Workstations,DC=corp,DC=example,DC=com" \
     --type "String"
   ```

2. **Domain Join Credentials**
   ```bash
   # Store domain join credentials
   aws secretsmanager create-secret \
     --name "workstation/domain-join" \
     --secret-string '{
       "username": "domain-join-user@corp.example.com",
       "password": "secure-password"
     }'
   ```

### Multi-Environment Setup

```bash
# Development environment
cdk deploy --all --context environment=dev

# Production environment  
cdk deploy --all --context environment=prod
```

## 🔧 Customization

### Adding New Instance Types

1. Update SSM parameter:
   ```bash
   aws ssm put-parameter \
     --name "/workstation/config/allowedInstanceTypes" \
     --value '["g4dn.xlarge","g5.xlarge","g6.xlarge","p3.2xlarge"]' \
     --type "String" \
     --overwrite
   ```

2. Update cost calculations in Lambda functions

### Custom Applications

Extend the user data script in [`ec2-management/index.ts`](src/lambda/ec2-management/index.ts):

```typescript
function generateUserDataScript(request: LaunchWorkstationRequest) {
  return `
<powershell>
# Your custom application installations
# Install Creative Cloud
$ccUrl = "https://download.adobe.com/pub/adobe/creative-cloud/CCCreativeCloudSetup.exe"
# Add installation logic
</powershell>
`;
}
```

### Monitoring Integration

Add custom CloudWatch dashboards:

```typescript
const dashboard = new cloudwatch.Dashboard(this, 'CustomDashboard', {
  widgets: [
    // Add custom metrics widgets
  ]
});
```

## 🧪 Testing

### Unit Tests
```bash
npm test
```

### Integration Tests
```bash
npm run test:integration
```

### Load Testing
```bash
# Use Artillery or similar tool
artillery run load-test-config.yml
```

## 📊 Monitoring & Alerting

### CloudWatch Dashboards

Access pre-built dashboards in AWS Console:
- **Workstation Overview**: Instance counts, costs, status
- **Performance Metrics**: CPU, network, storage utilization  
- **Cost Analysis**: Daily/monthly trends and projections
- **Security Events**: Authentication failures, unauthorized access

### Automated Alerts

Configure SNS notifications for:
- High cost thresholds exceeded
- Failed workstation launches
- Security events
- System health degradation

### Logging

- **API Gateway**: Request/response logs
- **Lambda Functions**: Execution logs and errors
- **EC2 Instances**: CloudWatch agent metrics
- **Security**: CloudTrail audit logs

## 🚨 Troubleshooting

### Common Issues

1. **Workstation Launch Failures**
   ```bash
   # Check Lambda logs
   aws logs filter-log-events \
     --log-group-name /aws/lambda/MediaWorkstation-EC2Management \
     --start-time $(date -d '1 hour ago' +%s)000
   ```

2. **Authentication Issues**
   ```bash
   # Verify Cognito configuration
   aws cognito-idp describe-user-pool \
     --user-pool-id <USER_POOL_ID>
   ```

3. **Network Connectivity**
   ```bash
   # Check VPC endpoints
   aws ec2 describe-vpc-endpoints \
     --filters "Name=vpc-id,Values=<VPC_ID>"
   ```

4. **Cost Explorer Access**
   ```bash
   # Verify Cost Explorer is enabled
   aws ce get-cost-and-usage \
     --time-period Start=2024-01-01,End=2024-01-02 \
     --granularity DAILY \
     --metrics BlendedCost
   ```

### Support Resources

- **AWS Documentation**: [EC2](https://docs.aws.amazon.com/ec2/), [Lambda](https://docs.aws.amazon.com/lambda/), [API Gateway](https://docs.aws.amazon.com/apigateway/)
- **CDK Documentation**: [AWS CDK Guide](https://docs.aws.amazon.com/cdk/)
- **Community**: [AWS re:Post](https://repost.aws/), [Stack Overflow](https://stackoverflow.com/questions/tagged/amazon-web-services)

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📞 Support

For technical support:
- Website: [nyroforge.com](https://nyroforge.com)
- Create GitHub Issues for bugs and feature requests

---

**Built with ❤️ for Media & Entertainment workflows**

**Owner:** Matt Herson | [nyroforge.com](https://nyroforge.com)