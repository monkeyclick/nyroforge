# Bootstrap System Deployment Guide

## ✅ Implementation Complete

All components of the bootstrap system have been implemented and are ready for deployment.

## 📦 What Was Built

### Backend Components

1. **Bootstrap Config Service Lambda**
   - Location: [`src/lambda/bootstrap-config-service/index.ts`](src/lambda/bootstrap-config-service/index.ts)
   - Package.json: [`src/lambda/bootstrap-config-service/package.json`](src/lambda/bootstrap-config-service/package.json)
   - CRUD API for managing bootstrap packages

2. **DynamoDB Table**
   - Table Name: `WorkstationBootstrapPackages`
   - GSIs: TypeIndex, CategoryIndex, RequiredIndex
   - Infrastructure: [`lib/workstation-infrastructure-stack.ts`](lib/workstation-infrastructure-stack.ts)

3. **API Routes**
   - Admin: `/api/admin/bootstrap-packages` (CRUD)
   - User: `/api/bootstrap-packages` (read-only)
   - Updated: [`lib/workstation-api-stack.ts`](lib/workstation-api-stack.ts)

4. **Enhanced EC2 Management**
   - Smart package selection based on instance type
   - UserData script generation with PowerShell
   - Updated: [`src/lambda/ec2-management/index.ts`](src/lambda/ec2-management/index.ts)

5. **Seed Script**
   - 13 pre-configured packages (NVIDIA GRID + apps)
   - Location: [`scripts/seed-bootstrap-packages.js`](scripts/seed-bootstrap-packages.js)

### Frontend Components

1. **Bootstrap Package Selector** (User)
   - Location: [`frontend/src/components/workstation/BootstrapPackageSelector.tsx`](frontend/src/components/workstation/BootstrapPackageSelector.tsx)
   - Category tabs, package cards, estimated time
   - Integrated into launch modal

2. **Bootstrap Package Management** (Admin)
   - Location: [`frontend/src/components/admin/BootstrapPackageManagement.tsx`](frontend/src/components/admin/BootstrapPackageManagement.tsx)
   - Full CRUD interface
   - Enable/disable, required/optional toggles
   - Search and filtering

3. **API Client Updates**
   - Added bootstrap package methods
   - Location: [`frontend/src/services/api.ts`](frontend/src/services/api.ts)

4. **Launch Modal Integration**
   - Bootstrap selector integrated
   - Updated: [`frontend/src/components/workstation/LaunchWorkstationModal.tsx`](frontend/src/components/workstation/LaunchWorkstationModal.tsx)

### Documentation

1. **Implementation Guide**: [`BOOTSTRAP_SYSTEM_IMPLEMENTATION.md`](BOOTSTRAP_SYSTEM_IMPLEMENTATION.md)
2. **This Deployment Guide**: [`BOOTSTRAP_DEPLOYMENT_GUIDE.md`](BOOTSTRAP_DEPLOYMENT_GUIDE.md)

## 🚀 Deployment Steps

### 1. Build Lambda Functions

```bash
# Install dependencies and build
npm install
npm run build

# This will compile all TypeScript Lambda functions to dist/ directory
```

### 2. Deploy Infrastructure

```bash
# Deploy all CDK stacks
cdk deploy --all

# Or deploy individually
cdk deploy WorkstationInfrastructureStack
cdk deploy WorkstationApiStack
cdk deploy WorkstationFrontendStack
```

Expected output:
```
✅ WorkstationInfrastructureStack
   Outputs:
   - BootstrapPackagesTableName = WorkstationBootstrapPackages
   - VpcId = vpc-xxxxx
   ...

✅ WorkstationApiStack
   Outputs:
   - ApiEndpoint = https://xxxxx.execute-api.region.amazonaws.com/api
   ...
```

### 3. Seed Bootstrap Packages

```bash
# Set environment variable (or export from CDK output)
export BOOTSTRAP_PACKAGES_TABLE="WorkstationBootstrapPackages"

# Run seed script
node scripts/seed-bootstrap-packages.js
```

Expected output:
```
Seeding bootstrap packages to table: WorkstationBootstrapPackages
Total packages to seed: 13
✓ Seeded: Windows Server Optimization
✓ Seeded: NVIDIA GRID Driver
✓ Seeded: AMD GPU Driver
✓ Seeded: 7-Zip
✓ Seeded: VLC Media Player
✓ Seeded: LibreOffice
✓ Seeded: Google Chrome
✓ Seeded: Notepad++
✓ Seeded: Adobe Acrobat Reader DC
✓ Seeded: FFmpeg
✓ Seeded: Python 3.12
✓ Seeded: OBS Studio
✓ Seeded: Git for Windows

=== Seeding Complete ===
Success: 13
Errors: 0
Total: 13
```

### 4. Verify API Endpoints

```bash
# Get API endpoint from CDK output
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name WorkstationApiStack \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text)

# Test bootstrap packages endpoint (requires auth token)
curl -X GET "${API_ENDPOINT}/bootstrap-packages" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  | jq .
```

### 5. Deploy Frontend

```bash
cd frontend

# Update .env.local with API endpoint
echo "NEXT_PUBLIC_API_ENDPOINT=${API_ENDPOINT}" > .env.local

# Build and deploy
npm install
npm run build
npm run deploy  # or your deployment method
```

### 6. Configure Admin Access

Add the Bootstrap Package Management page to admin navigation:

Edit `frontend/pages/admin/index.tsx`:
```tsx
import { BootstrapPackageManagement } from '../../src/components/admin/BootstrapPackageManagement';

// Add to your admin dashboard tabs/routes
<Tab label="Bootstrap Packages">
  <BootstrapPackageManagement />
</Tab>
```

## 🧪 Testing

### 1. Admin Interface Testing

1. Login as admin user
2. Navigate to Admin → Bootstrap Packages
3. Verify all 13 packages are listed
4. Test filters (All, Required, Optional, Disabled)
5. Test search functionality
6. Edit a package and verify changes
7. Toggle enabled/required status
8. Create a new test package
9. Delete the test package

### 2. User Interface Testing

1. Login as regular user
2. Click "Launch Workstation"
3. Select instance type (e.g., g5.xlarge)
4. Select OS version (e.g., Windows Server 2022)
5. Verify "Software Installation" section appears
6. Check that required packages are shown (disabled)
7. Check that NVIDIA GRID driver is auto-included for GPU instance
8. Select optional packages (e.g., VLC, Chrome)
9. Verify estimated time updates
10. Complete launch and note selected packages in payload

### 3. Workstation Launch Testing

1. Launch a workstation with selected packages
2. Wait for instance to reach "running" state
3. RDP into the workstation
4. Check `C:\WorkstationSetup.log` for installation progress
5. Verify `C:\WorkstationSetup-Complete.json` exists
6. Confirm installed applications are present
7. Test application functionality

Example log check:
```powershell
# RDP into workstation
Get-Content C:\WorkstationSetup.log -Tail 100

# Check completion marker
Get-Content C:\WorkstationSetup-Complete.json | ConvertFrom-Json
```

### 4. API Testing

```bash
# List all packages (admin)
curl -X GET "${API_ENDPOINT}/admin/bootstrap-packages" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  | jq '.summary'

# List user-available packages
curl -X GET "${API_ENDPOINT}/bootstrap-packages" \
  -H "Authorization: Bearer ${USER_TOKEN}" \
  | jq '.packages | length'

# Create test package
curl -X POST "${API_ENDPOINT}/admin/bootstrap-packages" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Package",
    "description": "Test package for verification",
    "type": "application",
    "category": "utility",
    "downloadUrl": "https://example.com/test.exe",
    "installCommand": "Start-Process",
    "osVersions": ["windows-server-2022"],
    "isRequired": false,
    "isEnabled": true,
    "order": 999,
    "estimatedInstallTimeMinutes": 1
  }'

# Update package
curl -X PUT "${API_ENDPOINT}/admin/bootstrap-packages/pkg-test-id" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"isEnabled": false}'

# Delete package
curl -X DELETE "${API_ENDPOINT}/admin/bootstrap-packages/pkg-test-id" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"
```

## 📊 Monitoring

### CloudWatch Logs

Monitor bootstrap execution:
```bash
# Get log group for EC2 instance
aws logs tail /aws/ec2/workstation --follow

# Or check specific instance logs via console
```

### DynamoDB

Check package records:
```bash
aws dynamodb scan \
  --table-name WorkstationBootstrapPackages \
  --query 'Items[*].[name.S, isEnabled.BOOL, isRequired.BOOL]' \
  --output table
```

### Audit Logs

Check package management actions:
```bash
aws dynamodb query \
  --table-name AuditLogs \
  --index-name ResourceIndex \
  --key-condition-expression "resource = :resource" \
  --expression-attribute-values '{":resource":{"S":"bootstrap-package"}}' \
  --limit 20
```

## 🔧 Troubleshooting

### Package Not Installing

**Symptoms**: Package listed but not installed on workstation

**Checks**:
1. Check UserData script was generated correctly
2. Verify download URL is accessible from instance
3. Check `C:\WorkstationSetup.log` for errors
4. Verify instance has internet access
5. Check install command syntax

**Solution**:
```powershell
# Manual test on instance
$url = "PACKAGE_URL"
$dest = "C:\Temp\test.exe"
Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
Start-Process -FilePath $dest -ArgumentList "/S" -Wait
```

### NVIDIA Driver Not Auto-Selected

**Symptoms**: GPU instance launched without NVIDIA driver

**Checks**:
1. Verify instance type starts with g4, g5, or g6
2. Check package `requiresGpu` is true
3. Check package `supportedGpuFamilies` includes 'NVIDIA'
4. Check package `osVersions` includes selected OS

**Solution**: Update package configuration in admin UI

### API Errors

**Symptoms**: 500 errors from bootstrap API

**Checks**:
1. Check Lambda logs in CloudWatch
2. Verify DynamoDB table exists
3. Check Lambda has table permissions
4. Verify environment variables are set

**Solution**:
```bash
# Check Lambda configuration
aws lambda get-function-configuration \
  --function-name MediaWorkstation-BootstrapConfigService

# Check table exists
aws dynamodb describe-table \
  --table-name WorkstationBootstrapPackages
```

## 🎯 Post-Deployment

### 1. Update Package URLs

Regularly update download URLs for packages:
- Check for newer versions
- Test download links
- Update metadata (version, size)

### 2. Add Custom Packages

For organization-specific tools:
1. Host installer in S3 or internal server
2. Create package via admin UI
3. Test installation on dev workstation
4. Enable for production use

### 3. Monitor Usage

Track which packages are most popular:
- Query audit logs for package selections
- Analyze workstation launch patterns
- Optimize default selections

### 4. Performance Optimization

For frequently used packages:
- Copy to S3 in same region for faster downloads
- Create custom AMI with packages pre-installed
- Use CloudFront for package distribution

## 📝 Summary

The bootstrap system is now fully implemented with:

✅ **Backend**: Lambda functions, DynamoDB, API routes
✅ **Frontend**: User selector, Admin management UI
✅ **Integration**: Launch workflow updated
✅ **Packages**: 13 pre-configured packages ready
✅ **Documentation**: Complete guides provided

**Next Steps**:
1. Deploy infrastructure: `cdk deploy --all`
2. Seed packages: `node scripts/seed-bootstrap-packages.js`
3. Test admin UI: Add/Edit/Delete packages
4. Test user UI: Launch workstation with packages
5. Verify installation: RDP and check logs

**Support**:
- Review logs in CloudWatch
- Check DynamoDB for package data
- Monitor audit logs for actions
- Refer to [`BOOTSTRAP_SYSTEM_IMPLEMENTATION.md`](BOOTSTRAP_SYSTEM_IMPLEMENTATION.md) for details