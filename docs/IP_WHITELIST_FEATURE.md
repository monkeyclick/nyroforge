# IP Whitelist Feature Documentation

## Overview

The IP Whitelist feature automatically manages RDP access to workstations by detecting user IP addresses and adding them to security group rules. This eliminates the need for manual security group configuration and simplifies remote access.

## Features

### 1. Automatic IP Whitelisting on Launch

When launching a new workstation, the system automatically:
- Detects the user's public IP address from the API request
- Adds the IP to the workstation's security group with an RDP rule (TCP port 3389)
- Associates the IP with the user's identity for audit purposes

**How it works:**
1. User clicks "Launch Workstation" from the frontend
2. API Gateway forwards the request to the EC2 Management Lambda
3. Lambda extracts the user's IP from request headers:
   - First checks `X-Forwarded-For` header (original client IP from proxy)
   - Falls back to `X-Real-IP` header
   - Finally uses `sourceIp` from API Gateway request context
4. After creating the EC2 instance, Lambda automatically adds the IP to the security group
5. User can immediately connect via RDP without additional configuration

### 2. Manual "Allow My IP" Button

For existing running workstations, users can whitelist their current IP address:
- Green "Allow My IP" button appears on each running workstation card
- One-click operation to add current IP for RDP access
- Useful when user's IP changes or connecting from a new location

**How it works:**
1. User clicks "Allow My IP" button on a running workstation
2. Frontend calls the `/admin/security-groups/allow-my-ip` API endpoint
3. Security Group Service Lambda:
   - Extracts user's current IP from request headers
   - Verifies user owns the workstation (or has admin permissions)
   - Adds RDP rule (TCP 3389) to the security group
   - Handles duplicate rules gracefully (returns success if IP already exists)
4. Success notification displays the whitelisted IP address
5. User can immediately connect via RDP

## API Endpoints

### POST /admin/security-groups/allow-my-ip

Adds the user's current IP address to a workstation's security group for RDP access.

**Request Body:**
```json
{
  "workstationId": "i-1234567890abcdef0"
}
```

**Response:**
```json
{
  "message": "Your IP address has been added to the security group",
  "ipAddress": "203.0.113.42",
  "securityGroupId": "sg-0123456789abcdef0",
  "workstationId": "i-1234567890abcdef0"
}
```

**Error Responses:**
- `400` - Missing or invalid workstation ID
- `403` - User does not have permission to modify this workstation
- `404` - Workstation not found
- `500` - AWS service error or unexpected failure

## Security Considerations

### IP Detection
The system uses multiple sources to determine the user's IP address, in order of preference:
1. **X-Forwarded-For** - Contains the original client IP when behind a proxy/load balancer
2. **X-Real-IP** - Alternative header used by some proxies
3. **sourceIp** - API Gateway's view of the request source

### Permission Model
- Users can only whitelist their IP on workstations they own
- Admin users with `system:admin` or `security:manage` permissions can whitelist any workstation
- All whitelist operations are logged in DynamoDB audit logs

### CIDR Notation
All IP addresses are converted to /32 CIDR notation (single host) to ensure precise access control.

### Duplicate Handling
The system gracefully handles duplicate IP rules:
- If the IP already exists in the security group, the operation succeeds without error
- Prevents accumulation of duplicate rules
- Returns user-friendly success message regardless of whether rule was newly added

## Implementation Details

### Modified Files

#### Backend

**`src/lambda/ec2-management/index.ts`**
- Added automatic IP detection and whitelisting during workstation launch
- New functions:
  - `getUserIpAddress(event)` - Extracts IP from API Gateway event headers
  - `addIpToSecurityGroup(securityGroupId, ip, description)` - Adds RDP rule to security group
- Modified `launchWorkstation()` to accept event parameter and call IP whitelisting after instance launch

**`src/lambda/security-group-service/index.ts`**
- Added `/allow-my-ip` endpoint handler
- New functions:
  - `allowMyIpToWorkstation(event)` - Manual IP whitelisting for existing instances
  - `getUserIpFromEvent(event)` - Extracts IP from event headers
- Includes permission verification and duplicate rule handling

**`lib/workstation-api-stack.ts`**
- Added `ec2:AuthorizeSecurityGroupIngress` permission to EC2 Management Lambda IAM role
- Created API Gateway resource: `/admin/security-groups/allow-my-ip`
- Added POST method with Cognito authorization

#### Frontend

**`frontend/src/services/api.ts`**
- Added `allowMyIp(workstationId)` method to API client

**`frontend/src/components/workstation/WorkstationCard.tsx`**
- Added "Allow My IP" button to workstation cards (green button, appears for running instances)
- Implemented React Query mutation for IP whitelisting
- Added loading states and success/error notifications
- Button includes helpful tooltip text

### AWS Services Used

- **EC2 Security Groups** - Manages inbound firewall rules
- **API Gateway** - Provides request routing and IP detection via headers
- **Lambda** - Executes business logic for IP whitelisting
- **DynamoDB** - Stores workstation metadata and audit logs
- **IAM** - Controls permissions for security group modifications

### Error Handling

The system includes robust error handling:

1. **IP Detection Failure** (Launch)
   - Logs warning but continues workstation creation
   - User can manually whitelist IP using "Allow My IP" button
   
2. **Duplicate Rule** (Manual)
   - Catches `InvalidPermission.Duplicate` error
   - Returns success message to user
   
3. **AWS Service Errors**
   - Logs detailed error information
   - Returns user-friendly error messages
   
4. **Permission Denied**
   - Validates user ownership before modification
   - Returns 403 error with clear message

## Usage Guide

### For End Users

**Launching a New Workstation:**
1. Navigate to the home page
2. Click "Launch Workstation"
3. Configure your workstation settings
4. Click "Launch"
5. Your IP is automatically whitelisted - no additional steps needed!

**Whitelisting IP on Existing Workstation:**
1. Navigate to the home page
2. Find your running workstation
3. Click the green "Allow My IP" button
4. Success message displays your whitelisted IP
5. Connect via RDP immediately

### For Administrators

**Monitoring IP Whitelist Operations:**
- All IP whitelist operations are logged in DynamoDB audit logs
- View audit logs from the Admin Dashboard > Audit Logs tab
- Filter by action type: `whitelist_ip_launch` or `whitelist_ip_manual`

**Troubleshooting:**
1. Check CloudWatch logs for EC2 Management or Security Group Service Lambda
2. Verify security group rules in AWS Console
3. Check API Gateway access logs for request headers
4. Review DynamoDB workstation records for security group IDs

## Testing

### Manual Testing Checklist

**Automatic Whitelisting:**
- [ ] Launch a new workstation
- [ ] Verify your IP appears in the security group inbound rules (port 3389)
- [ ] Confirm RDP connection works immediately after launch

**Manual Whitelisting:**
- [ ] Find a running workstation you own
- [ ] Click "Allow My IP" button
- [ ] Verify success message shows your IP address
- [ ] Check security group shows the new rule
- [ ] Click button again - should succeed without error (duplicate handling)
- [ ] Try from different IP address - should add second rule

**Permission Testing:**
- [ ] Try "Allow My IP" on another user's workstation (should fail)
- [ ] Test as admin user (should succeed on any workstation)

**IP Detection Testing:**
- [ ] Test from different networks (home, office, VPN)
- [ ] Verify correct IP is detected in each case
- [ ] Check audit logs show accurate IP addresses

## Deployment

The feature was deployed on **2025-11-12**:

1. **Backend Deployment:**
   ```bash
   npm run build
   cdk deploy WorkstationApi --exclusively --require-approval never
   ```

2. **Frontend Deployment:**
   ```bash
   cd frontend && npm run build
   aws s3 sync frontend/out/ s3://workstation-ui-YOUR_AWS_ACCOUNT_ID-us-west-2/ --delete
   aws cloudfront create-invalidation --distribution-id E3RTHNIB6GLS45 --paths "/*"
   ```

## Future Enhancements

Potential improvements for future versions:

1. **IP Range Support**
   - Allow users to whitelist IP ranges (e.g., office networks)
   - Support CIDR blocks larger than /32

2. **Named IP Lists**
   - Save frequently-used IPs with friendly names (e.g., "Home", "Office")
   - Quick selection from saved IPs

3. **Automatic IP Refresh**
   - Detect when user's IP changes
   - Prompt to update security group automatically

4. **Expiration**
   - Optional TTL for whitelisted IPs
   - Automatic cleanup of old rules

5. **Multi-Port Support**
   - Allow whitelisting for additional ports (SSH, custom apps)
   - Port selection in UI

6. **Bulk Operations**
   - Whitelist IP across multiple workstations simultaneously
   - Admin function to update all user workstations

## Support

For issues or questions about the IP Whitelist feature:
- Check CloudWatch logs for detailed error messages
- Review security group rules in AWS Console
- Contact system administrator for permission-related issues