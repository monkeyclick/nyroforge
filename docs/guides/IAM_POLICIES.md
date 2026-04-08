# IAM Policies Reference

This document provides detailed IAM policy requirements for deploying and operating the EC2 Workstation Manager.

## Table of Contents

1. [Deployment Permissions](#deployment-permissions)
2. [Runtime Service Roles](#runtime-service-roles)
3. [User Permissions](#user-permissions)
4. [Least Privilege Examples](#least-privilege-examples)

---

## Deployment Permissions

### Administrator Deployment (Recommended)

For initial deployment, the simplest approach is to use an IAM user/role with `AdministratorAccess`:

```json
{
  "Version": "2012-01-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "*",
      "Resource": "*"
    }
  ]
}
```

### Minimal Deployment Permissions

If you cannot use administrator access, the deploying user needs these specific permissions:

```json
{
  "Version": "2012-01-17",
  "Statement": [
    {
      "Sid": "CDKBootstrapPermissions",
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "s3:*",
        "iam:*",
        "ssm:GetParameter",
        "ssm:PutParameter"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CDKDeploymentPermissions",
      "Effect": "Allow",
      "Action": [
        "ec2:*",
        "lambda:*",
        "apigateway:*",
        "cognito-idp:*",
        "dynamodb:*",
        "logs:*",
        "events:*",
        "secretsmanager:*",
        "kms:*",
        "cloudfront:*",
        "s3:*",
        "sts:AssumeRole"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## Runtime Service Roles

### 1. Lambda Execution Role - EC2 Management

**Purpose:** Allows Lambda to launch, terminate, and manage EC2 instances.

```json
{
  "Version": "2012-01-17",
  "Statement": [
    {
      "Sid": "EC2Management",
      "Effect": "Allow",
      "Action": [
        "ec2:RunInstances",
        "ec2:TerminateInstances",
        "ec2:DescribeInstances",
        "ec2:DescribeInstanceStatus",
        "ec2:DescribeImages",
        "ec2:DescribeAvailabilityZones",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeSubnets",
        "ec2:DescribeVpcs",
        "ec2:CreateTags",
        "ec2:CreateSecurityGroup",
        "ec2:DeleteSecurityGroup",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:RevokeSecurityGroupIngress",
        "ec2:AuthorizeSecurityGroupEgress",
        "ec2:RevokeSecurityGroupEgress",
        "ec2:ModifyInstanceAttribute"
      ],
      "Resource": "*"
    },
    {
      "Sid": "IAMPassRole",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::*:role/WorkstationInstanceRole*"
    },
    {
      "Sid": "DynamoDBAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Scan",
        "dynamodb:Query"
      ],
      "Resource": [
        "arn:aws:dynamodb:*:*:table/Workstations",
        "arn:aws:dynamodb:*:*:table/Workstations/index/*"
      ]
    },
    {
      "Sid": "SecretsManagerAccess",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:CreateSecret",
        "secretsmanager:UpdateSecret",
        "secretsmanager:PutSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:*:*:secret:workstation/*"
    },
    {
      "Sid": "SSMParameters",
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath"
      ],
      "Resource": "arn:aws:ssm:*:*:parameter/workstation/*"
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

### 2. Lambda Execution Role - Credentials Service

**Purpose:** Manages workstation credentials and password resets.

```json
{
  "Version": "2012-01-17",
  "Statement": [
    {
      "Sid": "EC2PasswordData",
      "Effect": "Allow",
      "Action": [
        "ec2:GetPasswordData",
        "ec2:DescribeInstances"
      ],
      "Resource": "*"
    },
    {
      "Sid": "SecretsManager",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:CreateSecret",
        "secretsmanager:UpdateSecret",
        "secretsmanager:PutSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:*:*:secret:workstation/*"
    },
    {
      "Sid": "DynamoDBRead",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/Workstations"
    },
    {
      "Sid": "SSMSendCommand",
      "Effect": "Allow",
      "Action": [
        "ssm:SendCommand",
        "ssm:GetCommandInvocation"
      ],
      "Resource": [
        "arn:aws:ec2:*:*:instance/*",
        "arn:aws:ssm:*:*:document/AWS-RunPowerShellScript"
      ]
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

### 3. Lambda Execution Role - Cost Analytics

**Purpose:** Retrieves cost data from AWS Cost Explorer.

```json
{
  "Version": "2012-01-17",
  "Statement": [
    {
      "Sid": "CostExplorer",
      "Effect": "Allow",
      "Action": [
        "ce:GetCostAndUsage",
        "ce:GetCostForecast",
        "ce:GetDimensionValues",
        "ce:GetTags"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DynamoDBRead",
      "Effect": "Allow",
      "Action": [
        "dynamodb:Scan",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/Workstations"
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

### 4. Lambda Execution Role - Security Group Service

**Purpose:** Manages security groups and their rules.

```json
{
  "Version": "2012-01-17",
  "Statement": [
    {
      "Sid": "SecurityGroupManagement",
      "Effect": "Allow",
      "Action": [
        "ec2:CreateSecurityGroup",
        "ec2:DeleteSecurityGroup",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeSecurityGroupRules",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:RevokeSecurityGroupIngress",
        "ec2:AuthorizeSecurityGroupEgress",
        "ec2:RevokeSecurityGroupEgress",
        "ec2:ModifyInstanceAttribute",
        "ec2:DescribeInstances",
        "ec2:DescribeVpcs",
        "ec2:CreateTags"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DynamoDBAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:Scan",
        "dynamodb:Query",
        "dynamodb:UpdateItem"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/Workstations"
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

### 5. Lambda Execution Role - User Management

**Purpose:** Manages Cognito users and groups.

```json
{
  "Version": "2012-01-17",
  "Statement": [
    {
      "Sid": "CognitoUserManagement",
      "Effect": "Allow",
      "Action": [
        "cognito-idp:AdminCreateUser",
        "cognito-idp:AdminDeleteUser",
        "cognito-idp:AdminUpdateUserAttributes",
        "cognito-idp:AdminGetUser",
        "cognito-idp:ListUsers",
        "cognito-idp:AdminListGroupsForUser",
        "cognito-idp:AdminAddUserToGroup",
        "cognito-idp:AdminRemoveUserFromGroup",
        "cognito-idp:ListGroups"
      ],
      "Resource": "arn:aws:cognito-idp:*:*:userpool/*"
    },
    {
      "Sid": "DynamoDBUserData",
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/Users"
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

### 6. EC2 Instance Profile Role

**Purpose:** Permissions for workstation EC2 instances.

```json
{
  "Version": "2012-01-17",
  "Statement": [
    {
      "Sid": "SSMCoreAccess",
      "Effect": "Allow",
      "Action": [
        "ssm:UpdateInstanceInformation",
        "ssmmessages:CreateControlChannel",
        "ssmmessages:CreateDataChannel",
        "ssmmessages:OpenControlChannel",
        "ssmmessages:OpenDataChannel"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    },
    {
      "Sid": "SecretsManagerAccess",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:*:*:secret:workstation/domain-join-credentials*"
    },
    {
      "Sid": "SSMParameters",
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters"
      ],
      "Resource": "arn:aws:ssm:*:*:parameter/workstation/*"
    },
    {
      "Sid": "EC2Tags",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeTags"
      ],
      "Resource": "*"
    }
  ]
}
```

### 7. EventBridge Rule Role

**Purpose:** Allows EventBridge to trigger Lambda functions.

```json
{
  "Version": "2012-01-17",
  "Statement": [
    {
      "Sid": "InvokeLambda",
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:*:*:function:MediaWorkstation-*"
    }
  ]
}
```

---

## User Permissions

### Admin User Policy

**Purpose:** Full access to all workstation management features.

```json
{
  "Version": "2012-01-17",
  "Statement": [
    {
      "Sid": "AdminFullAccess",
      "Effect": "Allow",
      "Action": [
        "execute-api:Invoke"
      ],
      "Resource": "arn:aws:execute-api:*:*:*/*/api/*"
    }
  ]
}
```

*Note: Actual authorization is handled by Cognito groups in the API Gateway authorizer.*

### Regular User Policy

**Purpose:** Access to own workstations only.

```json
{
  "Version": "2012-01-17",
  "Statement": [
    {
      "Sid": "UserLimitedAccess",
      "Effect": "Allow",
      "Action": [
        "execute-api:Invoke"
      ],
      "Resource": [
        "arn:aws:execute-api:*:*:*/*/api/workstations",
        "arn:aws:execute-api:*:*:*/*/api/workstations/*",
        "arn:aws:execute-api:*:*:*/*/api/regions",
        "arn:aws:execute-api:*:*:*/*/api/instance-types",
        "arn:aws:execute-api:*:*:*/*/api/config"
      ]
    }
  ]
}
```

---

## Least Privilege Examples

### Operator Role (Launch & Terminate Only)

For users who only need to launch and terminate workstations:

```json
{
  "Version": "2012-01-17",
  "Statement": [
    {
      "Sid": "WorkstationOperations",
      "Effect": "Allow",
      "Action": [
        "execute-api:Invoke"
      ],
      "Resource": [
        "arn:aws:execute-api:*:*:*/*/api/workstations",
        "arn:aws:execute-api:*:*:*/*/api/regions",
        "arn:aws:execute-api:*:*:*/*/api/instance-types"
      ]
    }
  ]
}
```

### Read-Only Auditor Role

For compliance auditing without modification rights:

```json
{
  "Version": "2012-01-17",
  "Statement": [
    {
      "Sid": "ReadOnlyAccess",
      "Effect": "Allow",
      "Action": [
        "execute-api:Invoke"
      ],
      "Resource": [
        "arn:aws:execute-api:*:*:*/GET/api/*"
      ]
    },
    {
      "Sid": "DenyModifications",
      "Effect": "Deny",
      "Action": [
        "execute-api:Invoke"
      ],
      "Resource": [
        "arn:aws:execute-api:*:*:*/POST/api/*",
        "arn:aws:execute-api:*:*:*/PUT/api/*",
        "arn:aws:execute-api:*:*:*/DELETE/api/*"
      ]
    }
  ]
}
```

### Cost Manager Role

For finance team to view cost analytics:

```json
{
  "Version": "2012-01-17",
  "Statement": [
    {
      "Sid": "CostAnalyticsAccess",
      "Effect": "Allow",
      "Action": [
        "execute-api:Invoke"
      ],
      "Resource": [
        "arn:aws:execute-api:*:*:*/*/api/costs",
        "arn:aws:execute-api:*:*:*/*/api/costs/*",
        "arn:aws:execute-api:*:*:*/*/api/dashboard/status"
      ]
    }
  ]
}
```

---

## Trust Relationships

### Lambda Execution Role Trust Policy

```json
{
  "Version": "2012-01-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

### EC2 Instance Profile Trust Policy

```json
{
  "Version": "2012-01-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

### EventBridge Trust Policy

```json
{
  "Version": "2012-01-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "events.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

---

## IAM Policy Best Practices

### 1. Use Least Privilege

Always start with minimum permissions and add as needed:

```bash
# Example: Create operator role
aws iam create-role \
  --role-name WorkstationOperator \
  --assume-role-policy-document file://trust-policy.json

aws iam put-role-policy \
  --role-name WorkstationOperator \
  --policy-name OperatorAccess \
  --policy-document file://operator-policy.json
```

### 2. Use Conditions for Enhanced Security

Add IP restrictions:

```json
{
  "Version": "2012-01-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "execute-api:Invoke",
      "Resource": "*",
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": [
            "203.0.113.0/24",
            "198.51.100.0/24"
          ]
        }
      }
    }
  ]
}
```

Add MFA requirement:

```json
{
  "Version": "2012-01-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:*:*:*/*/api/admin/*",
      "Condition": {
        "Bool": {
          "aws:MultiFactorAuthPresent": "true"
        }
      }
    }
  ]
}
```

### 3. Use Resource-Based Policies

Lambda resource policy example:

```bash
aws lambda add-permission \
  --function-name MediaWorkstation-EC2Management \
  --statement-id AllowAPIGatewayInvoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:us-west-2:123456789012:*/*/POST/api/workstations"
```

### 4. Enable CloudTrail Logging

Ensure all IAM actions are logged:

```bash
aws cloudtrail create-trail \
  --name workstation-audit-trail \
  --s3-bucket-name my-audit-logs-bucket

aws cloudtrail start-logging \
  --name workstation-audit-trail
```

### 5. Regular Permission Audits

Use IAM Access Analyzer:

```bash
# Create analyzer
aws accessanalyzer create-analyzer \
  --analyzer-name workstation-analyzer \
  --type ACCOUNT

# List findings
aws accessanalyzer list-findings \
  --analyzer-arn arn:aws:access-analyzer:us-west-2:123456789012:analyzer/workstation-analyzer
```

---

## Automated Policy Deployment

### Using AWS CDK (Recommended)

All IAM policies are automatically created by CDK during deployment. The policies are defined in:

- `lib/workstation-infrastructure-stack.ts` - Core infrastructure roles
- `lib/workstation-api-stack.ts` - API and Lambda roles

### Manual Policy Creation

If you need to create policies manually:

```bash
# 1. Save policy to file
cat > ec2-management-policy.json << 'EOF'
{
  "Version": "2012-01-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ec2:RunInstances", "ec2:TerminateInstances"],
      "Resource": "*"
    }
  ]
}
EOF

# 2. Create policy
aws iam create-policy \
  --policy-name WorkstationEC2Management \
  --policy-document file://ec2-management-policy.json

# 3. Attach to role
aws iam attach-role-policy \
  --role-name MediaWorkstation-EC2Management \
  --policy-arn arn:aws:iam::123456789012:policy/WorkstationEC2Management
```

---

## Troubleshooting IAM Issues

### Issue: "Access Denied" Errors

**Check 1: Verify role has required permissions**
```bash
aws iam get-role-policy \
  --role-name MediaWorkstation-EC2Management \
  --policy-name EC2ManagementPolicy
```

**Check 2: Verify trust relationship**
```bash
aws iam get-role \
  --role-name MediaWorkstation-EC2Management \
  --query 'Role.AssumeRolePolicyDocument'
```

**Check 3: Check CloudTrail for denied actions**
```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=RunInstances \
  --max-results 10
```

### Issue: Lambda Cannot Assume Role

**Verify trust policy allows Lambda**
```bash
aws iam get-role \
  --role-name MediaWorkstation-EC2Management \
  --query 'Role.AssumeRolePolicyDocument' \
  --output json
```

Expected output should include:
```json
{
  "Service": "lambda.amazonaws.com"
}
```

### Issue: EC2 Instance Cannot Access Secrets

**Check instance profile**
```bash
# Get instance profile ARN
aws ec2 describe-instances \
  --instance-ids i-1234567890abcdef0 \
  --query 'Reservations[0].Instances[0].IamInstanceProfile.Arn'

# Verify role permissions
aws iam list-role-policies --role-name WorkstationInstanceRole
```

---

## Security Checklist

- [ ] Use AWS-managed policies where possible
- [ ] Enable MFA for admin users
- [ ] Restrict API access by IP when possible
- [ ] Enable CloudTrail in all regions
- [ ] Use IAM Access Analyzer
- [ ] Regular permission audits (quarterly)
- [ ] Remove unused roles and policies
- [ ] Enable AWS Config rules for IAM compliance
- [ ] Use temporary credentials (STS) for CLI access
- [ ] Document all custom policies

---

## Additional Resources

- [AWS IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [AWS Security Best Practices](https://docs.aws.amazon.com/security/latest/userguide/security-best-practices.html)
- [IAM Policy Simulator](https://policysim.aws.amazon.com/)
- [AWS IAM Access Analyzer](https://docs.aws.amazon.com/IAM/latest/UserGuide/what-is-access-analyzer.html)

---

**Document Version:** 1.0.0  
**Last Updated:** 2024-01-15