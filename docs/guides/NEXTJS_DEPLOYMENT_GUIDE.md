# Next.js Frontend Deployment Guide

Complete guide for deploying and testing the Next.js frontend for the Media Workstation Management System.

---

## 📋 Prerequisites

### Required Tools
- Node.js 18+ and npm
- AWS CLI configured
- AWS CDK CLI (`npm install -g aws-cdk`)
- Access to AWS account with appropriate permissions

### AWS Resources Required
- Cognito User Pool (already deployed)
- API Gateway endpoint (already deployed)
- S3 bucket for frontend hosting (created by CDK)
- CloudFront distribution (created by CDK)

---

## 🚀 Quick Start

### 1. Configure Environment Variables

```bash
cd frontend

# Copy the example file
cp .env.local.example .env.local

# Edit with your actual values
nano .env.local
```

**Get your configuration values:**

```bash
# From CDK outputs (after infrastructure deployment)
aws cloudformation describe-stacks \
  --stack-name WorkstationInfrastructure \
  --query 'Stacks[0].Outputs' \
  --output table
```

Edit `.env.local`:
```env
NEXT_PUBLIC_AWS_REGION=us-west-2
NEXT_PUBLIC_USER_POOL_ID=us-west-2_XXXXXXXXX
NEXT_PUBLIC_USER_POOL_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
NEXT_PUBLIC_API_ENDPOINT=https://xxxxxxxxxx.execute-api.us-west-2.amazonaws.com/prod
```

### 2. Install Dependencies

```bash
cd frontend
npm install
```

### 3. Local Development

```bash
# Run development server
npm run dev

# Open browser to http://localhost:3000
```

### 4. Build for Production

```bash
# Build static export
npm run build

# Output will be in frontend/out/
# Test locally:
npx serve out
```

---

## 📦 Deployment Options

### Option A: Automatic Deployment via CDK (Recommended)

The CDK stack now automatically builds and deploys the Next.js frontend.

```bash
# From project root
cd ../

# Deploy the website stack
npm run cdk deploy WorkstationWebsite

# This will:
# 1. Build the Next.js frontend (npm install + npm run build)
# 2. Create/update S3 bucket
# 3. Deploy static files to S3
# 4. Create/update CloudFront distribution
# 5. Output the website URL
```

**Note:** If frontend is already built, it will skip the build step. To force rebuild:
```bash
rm -rf frontend/out
npm run cdk deploy WorkstationWebsite
```

### Option B: Manual Build and Deploy

```bash
# Build frontend manually
cd frontend
npm run build

# Deploy via CDK (will use existing build)
cd ../
npm run cdk deploy WorkstationWebsite
```

### Option C: Deploy to Different Environment

```bash
# Build with specific environment
cd frontend
cp .env.production .env.local
npm run build

# Deploy to specific AWS profile
cd ../
AWS_PROFILE=production npm run cdk deploy WorkstationWebsite
```

---

## 🧪 Testing Strategy

### Local Testing

#### 1. Development Mode Testing
```bash
cd frontend
npm run dev
```

**Test Checklist:**
- [ ] Login page loads at http://localhost:3000/login
- [ ] Can navigate between pages
- [ ] Dashboard page loads (will show auth warning)
- [ ] Admin page accessible (will redirect to login)
- [ ] Hot reload works when editing files

#### 2. Production Build Testing
```bash
cd frontend
npm run build
npx serve out -p 3000
```

**Test Checklist:**
- [ ] All routes work as static files
- [ ] Images load correctly
- [ ] CSS/Tailwind styles applied
- [ ] Navigation between pages works
- [ ] No 404 errors in browser console

### Integration Testing

#### 1. API Integration Test
```bash
# Ensure backend is deployed
cd frontend
npm run dev

# Test API calls (requires auth to be implemented)
# - Launch workstation
# - Get workstations list
# - View credentials
# - Terminate workstation
```

#### 2. Authentication Flow Test
*After implementing AWS Amplify integration:*

```bash
# Test signup
1. Navigate to /signup
2. Fill in form
3. Check email for verification
4. Verify account

# Test login
1. Navigate to /login
2. Enter credentials
3. Should redirect to dashboard
4. Check auth state persists on refresh

# Test logout
1. Click logout button
2. Should redirect to login
3. Check auth state cleared
```

### Deployment Testing

#### 1. Test Deployed Application

After deploying, get the CloudFront URL:
```bash
aws cloudformation describe-stacks \
  --stack-name WorkstationWebsite \
  --query 'Stacks[0].Outputs[?OutputKey==`WebsiteUrl`].OutputValue' \
  --output text
```

**Test Checklist:**
- [ ] Website loads at CloudFront URL
- [ ] HTTPS works correctly
- [ ] All pages accessible
- [ ] API calls work (CORS configured)
- [ ] No console errors
- [ ] CloudFront caching works

#### 2. CloudFront Cache Invalidation

After updates, invalidate cache:
```bash
# Get distribution ID
DIST_ID=$(aws cloudformation describe-stacks \
  --stack-name WorkstationWebsite \
  --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDistributionId`].OutputValue' \
  --output text)

# Invalidate all paths
aws cloudfront create-invalidation \
  --distribution-id $DIST_ID \
  --paths "/*"
```

---

## 🐛 Troubleshooting

### Build Issues

#### Problem: "Module not found" errors
```bash
# Solution: Clean install
cd frontend
rm -rf node_modules package-lock.json
npm install
npm run build
```

#### Problem: TypeScript errors during build
```bash
# Check for errors
cd frontend
npm run lint

# Fix common issues
npm run build -- --no-lint  # Skip linting (temporary)
```

#### Problem: Out of memory during build
```bash
# Increase Node memory
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build
```

### Deployment Issues

#### Problem: CDK deployment fails at frontend build
```bash
# Build frontend separately first
cd frontend
npm run build

# Then deploy
cd ../
npm run cdk deploy WorkstationWebsite
```

#### Problem: S3 deployment fails
```bash
# Check S3 bucket exists
aws s3 ls | grep workstation-ui

# If missing, deploy infrastructure first
npm run cdk deploy WorkstationInfrastructure
```

#### Problem: CloudFront shows 403 errors
```bash
# Check S3 bucket policy
aws s3api get-bucket-policy \
  --bucket workstation-ui-ACCOUNT_ID-REGION

# Check CloudFront OAI has access
# Redeploy stack to fix
npm run cdk deploy WorkstationWebsite --force
```

### Runtime Issues

#### Problem: API calls return CORS errors
```bash
# Check API Gateway CORS configuration
# Ensure NEXT_PUBLIC_API_ENDPOINT is correct in .env.local
cat frontend/.env.local | grep API_ENDPOINT
```

#### Problem: Authentication not working
```bash
# Verify Cognito configuration
aws cognito-idp describe-user-pool \
  --user-pool-id YOUR_USER_POOL_ID

# Check User Pool Client ID is correct
cat frontend/.env.local | grep CLIENT_ID
```

#### Problem: Page shows blank/white screen
```bash
# Check browser console for errors
# Common causes:
# - Missing environment variables
# - JavaScript errors
# - Failed API calls

# Test with error boundaries
# Check .next/server errors
```

---

## 🔄 Update Workflow

### Making Changes

```bash
# 1. Make code changes
cd frontend
# Edit files...

# 2. Test locally
npm run dev

# 3. Build and test
npm run build
npx serve out

# 4. Deploy
cd ../
npm run cdk deploy WorkstationWebsite

# 5. Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id $DIST_ID \
  --paths "/*"

# 6. Verify deployment
curl -I https://your-cloudfront-domain.cloudfront.net
```

### Rollback Procedure

```bash
# 1. Get previous deployment
git log --oneline | head -5

# 2. Revert to previous commit
git revert HEAD
# OR
git checkout PREVIOUS_COMMIT_HASH frontend/

# 3. Rebuild and redeploy
cd frontend
rm -rf out
npm run build
cd ../
npm run cdk deploy WorkstationWebsite
```

---

## 📊 Monitoring

### CloudFront Metrics

```bash
# View distribution metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name Requests \
  --dimensions Name=DistributionId,Value=$DIST_ID \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

### S3 Bucket Size

```bash
# Check deployment size
aws s3 ls s3://workstation-ui-ACCOUNT_ID-REGION/ --recursive --human-readable --summarize
```

### Error Logs

```bash
# CloudFront access logs (if enabled)
aws s3 ls s3://cloudfront-logs-bucket/

# Application errors
# Check browser console
# Check API Gateway logs
```

---

## 🔐 Security Checklist

Before production deployment:

- [ ] Environment variables not committed to git
- [ ] S3 bucket has public access blocked
- [ ] CloudFront uses HTTPS only
- [ ] Cognito User Pool has proper password policy
- [ ] API Gateway has authentication enabled
- [ ] CORS properly configured
- [ ] CloudFront has appropriate cache policies
- [ ] No sensitive data in client-side code

---

## 📝 Post-Deployment Checklist

After deploying:

- [ ] Website loads at CloudFront URL
- [ ] Login/signup pages work
- [ ] Dashboard displays workstations
- [ ] Can launch new workstations
- [ ] Can terminate workstations
- [ ] Can view credentials
- [ ] Admin page accessible (for admins)
- [ ] Security tab works (in admin)
- [ ] Cost analytics display
- [ ] Status metrics display
- [ ] Mobile responsive
- [ ] No console errors

---

## 🎯 Performance Optimization

### Recommended CloudFront Settings

```typescript
// In workstation-website-stack.ts
cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED, // For production
```

### Build Optimization

```bash
# Analyze bundle size
cd frontend
npm install --save-dev @next/bundle-analyzer
npm run build

# Check for large dependencies
npx webpack-bundle-analyzer .next/static/chunks/*.js
```

---

## 📞 Support

If issues persist:

1. Check [`NEXTJS_MIGRATION_STATUS.md`](NEXTJS_MIGRATION_STATUS.md) for known issues
2. Review [`NEXTJS_MIGRATION_PLAN.md`](NEXTJS_MIGRATION_PLAN.md) for architecture details
3. Check AWS CloudWatch logs for errors
4. Review browser console for client-side errors

---

## 🔗 Related Documentation

- [Migration Plan](NEXTJS_MIGRATION_PLAN.md)
- [Migration Status](NEXTJS_MIGRATION_STATUS.md)
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [Next.js Static Export](https://nextjs.org/docs/app/building-your-application/deploying/static-exports)