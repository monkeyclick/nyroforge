# Stack Deletion Patterns and Best Practices

This document describes patterns to prevent CloudFormation stack deletion failures and best practices for managing AWS CDK infrastructure.

## Common Deletion Failure Scenarios

### 1. Subnet Dependency Errors

**Error Message:**
```
The subnet 'subnet-xxx' has dependencies and cannot be deleted.
(Service: Ec2, Status Code: 400)
```

**Root Cause:**
- External resources (EKS clusters, Lambda functions in VPC, EFS mount targets) create Network Interfaces (ENIs) in the VPC subnets
- CloudFormation cannot delete subnets while these ENIs exist
- The stack deletion fails with `DELETE_FAILED` status

**Solution Applied:**
The `WorkstationInfrastructureStack` now sets VPC resources to `RETAIN` by default, which:
- Allows stack deletion to complete successfully
- Preserves VPC resources that have external dependencies
- Prevents cascading failures during cleanup

### 2. CDK Execution Role Missing

**Error Message:**
```
Role arn:aws:iam::xxx:role/cdk-hnb659fds-cfn-exec-role-xxx is invalid or cannot be assumed
```

**Root Cause:**
- CDKToolkit stack was deleted before application stacks
- The CDK execution role is required for CloudFormation operations

**Solution:**
Always delete stacks in dependency order:
1. Frontend stacks (WorkstationFrontend, WorkstationWebsite)
2. API stacks (WorkstationApi, WorkstationAdminApi)
3. Storage stacks (WorkstationStorage)
4. Infrastructure stack (WorkstationInfrastructure)
5. CDKToolkit (only after all other stacks are deleted)

### 3. S3 Bucket Not Empty

**Error Message:**
```
The bucket you tried to delete is not empty
```

**Solution:**
Empty S3 buckets before stack deletion:
```bash
aws s3 rm s3://bucket-name --recursive
```

## Configuration Options

### WorkstationInfrastructureStack Props

```typescript
interface WorkstationInfrastructureStackProps {
  // Retain VPC resources on delete (prevents subnet dependency errors)
  retainVpcOnDelete?: boolean; // default: true
  
  // Enable CloudFormation termination protection
  enableTerminationProtection?: boolean; // default: false (true for prod)
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `RETAIN_VPC_ON_DELETE` | Set to "false" to allow VPC deletion | true |
| `ENVIRONMENT` | Environment type (dev/staging/prod) | dev |

## Stack Deletion Procedure

### Safe Deletion Order

```bash
# 1. Delete frontend stacks first (no dependencies on them)
aws cloudformation delete-stack --stack-name WorkstationFrontend

# 2. Delete website stack
aws cloudformation delete-stack --stack-name WorkstationWebsite
# Note: Empty S3 bucket first if needed

# 3. Wait for above to complete, then delete API stacks
aws cloudformation wait stack-delete-complete --stack-name WorkstationFrontend
aws cloudformation wait stack-delete-complete --stack-name WorkstationWebsite
aws cloudformation delete-stack --stack-name WorkstationAdminApi
aws cloudformation delete-stack --stack-name WorkstationApi

# 4. Delete storage stack
aws cloudformation wait stack-delete-complete --stack-name WorkstationAdminApi
aws cloudformation wait stack-delete-complete --stack-name WorkstationApi
aws cloudformation delete-stack --stack-name WorkstationStorage

# 5. Delete infrastructure stack (VPC, DynamoDB, Cognito)
aws cloudformation wait stack-delete-complete --stack-name WorkstationStorage
aws cloudformation delete-stack --stack-name WorkstationInfrastructure

# 6. Finally, delete CDK bootstrap (optional, usually kept)
aws cloudformation wait stack-delete-complete --stack-name WorkstationInfrastructure
aws cloudformation delete-stack --stack-name CDKToolkit
```

### Handling DELETE_FAILED Status

If a stack enters `DELETE_FAILED` state:

1. **Identify failing resources:**
   ```bash
   aws cloudformation describe-stack-events --stack-name STACK_NAME \
     --query 'StackEvents[?ResourceStatus==`DELETE_FAILED`]'
   ```

2. **Option A - Retry with retain-resources:**
   ```bash
   aws cloudformation delete-stack --stack-name STACK_NAME \
     --retain-resources Resource1 Resource2
   ```

3. **Option B - Manual cleanup:**
   - Identify and delete blocking resources manually (ENIs, EKS clusters, etc.)
   - Retry stack deletion

4. **Option C - Create temporary execution role:**
   ```bash
   # If CDK role is missing, create a temporary one
   aws iam create-role \
     --role-name cdk-hnb659fds-cfn-exec-role-ACCOUNT-REGION \
     --assume-role-policy-document file://trust-policy.json
   
   aws iam attach-role-policy \
     --role-name cdk-hnb659fds-cfn-exec-role-ACCOUNT-REGION \
     --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
   ```

## VPC Resource Retention

### When VPC Resources Are Retained

If `retainVpcOnDelete: true` (default), the following resources will be retained after stack deletion:

- VPC
- All Subnets (Public and Private)
- Internet Gateway
- NAT Gateways
- Route Tables
- Security Groups
- VPC Endpoints

### Manual VPC Cleanup

After stack deletion with retained VPC resources, manually clean up:

```bash
# 1. List resources in the VPC
VPC_ID="vpc-xxx"

# 2. Delete EKS clusters using the VPC (if any)
aws eks list-clusters

# 3. Delete Lambda ENIs
aws ec2 describe-network-interfaces \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query 'NetworkInterfaces[*].NetworkInterfaceId'

# 4. Delete NAT Gateways
aws ec2 describe-nat-gateways \
  --filter "Name=vpc-id,Values=$VPC_ID" \
  --query 'NatGateways[*].NatGatewayId'

# 5. Delete Internet Gateway
aws ec2 describe-internet-gateways \
  --filters "Name=attachment.vpc-id,Values=$VPC_ID"

# 6. Delete Subnets
aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query 'Subnets[*].SubnetId'

# 7. Finally, delete the VPC
aws ec2 delete-vpc --vpc-id $VPC_ID
```

## Best Practices

### 1. Use Termination Protection in Production

```typescript
new WorkstationInfrastructureStack(app, 'WorkstationInfrastructure', {
  enableTerminationProtection: true, // Prevents accidental deletion
});
```

### 2. Tag Resources for Identification

```typescript
cdk.Tags.of(app).add('Project', 'MediaWorkstationAutomation');
cdk.Tags.of(app).add('Environment', environmentType);
```

### 3. Document External Dependencies

Before sharing VPC with external resources, document:
- What resources will use the VPC
- How to identify and clean up those resources
- Expected deletion order

### 4. Use CDK Destroy Command

For complete cleanup with CDK handling:
```bash
# This respects dependencies and handles cleanup in correct order
cdk destroy --all
```

### 5. Test Deletion in Dev First

Always test stack deletion in development environment before attempting production cleanup.

## Related Files

- [`lib/workstation-infrastructure-stack.ts`](../../lib/workstation-infrastructure-stack.ts) - VPC and infrastructure definitions
- [`bin/app.ts`](../../bin/app.ts) - Stack instantiation with configuration
- [`cleanup-and-redeploy.sh`](../../cleanup-and-redeploy.sh) - Cleanup script

## References

- [AWS CDK RemovalPolicy](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.RemovalPolicy.html)
- [CloudFormation Stack Deletion](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-deleting-stack.html)
- [Troubleshooting Stack Deletion Issues](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/troubleshooting.html#troubleshooting-errors-delete-stack-fails)
