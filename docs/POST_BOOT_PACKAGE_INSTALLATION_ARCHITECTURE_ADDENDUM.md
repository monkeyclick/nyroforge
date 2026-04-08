# Architecture Addendum - Finalized Decisions

**Date:** November 20, 2025  
**Version:** 1.1 (Updated after user review)  
**Status:** Approved for Implementation

---

## Architecture Decisions - FINALIZED

Based on user review and approval, the following architectural decisions have been finalized:

### 1. Group Package Binding: **MANDATORY**
- ✅ Group-assigned packages are **mandatory** for group members
- ✅ Users **cannot** deselect group packages during launch
- ✅ Ensures standardization across teams
- ⚠️ Admins must carefully curate group packages

**Implementation Impact:**
- Frontend: Remove checkbox controls for group packages
- Backend: Enforce group package selection in launch validation
- UI: Show group packages with "lock" icon or "Required by: [group name]" label

### 2. Installation Mode: **PARALLEL**
- ✅ Install **multiple packages simultaneously** (up to 3 at once)
- ✅ **Faster** total installation time
- ⚠️ More complex dependency management
- ⚠️ Resource contention monitoring required

**Implementation Changes from Original Design:**
```typescript
// Original: Sequential (one at a time)
GET /workstations/{id}/packages → Returns 1 package

// Updated: Parallel (up to 3 at once)
GET /workstations/{id}/packages?limit=3 → Returns up to 3 packages

Windows Service queries every 30 seconds instead of 2 minutes
Launches 3 parallel installation processes
Monitors resource usage (CPU, memory, disk I/O)
```

**Parallel Installation Strategy:**
- **Low-resource packages** (< 100MB): Install 3 simultaneously
- **High-resource packages** (> 1GB): Install 1 at a time
- **GPU drivers**: Always install alone (requires full system resources)
- **DCV Server**: Always install alone (modifies system settings)

### 3. Failed Packages: **BLOCK WORKSTATION READINESS**
- ✅ Failed required packages **block** workstation from "ready" state
- ✅ Workstation marked as "partially ready" with clear error message
- ✅ User can still access workstation (RDP/DCV works)
- ✅ Admins notified of failures immediately

**Implementation Impact:**
```typescript
// Workstation status values
type WorkstationStatus = 
  | 'launching'
  | 'installing_packages'      // NEW: Packages installing
  | 'partially_ready'           // NEW: Some packages failed
  | 'ready'                     // All packages installed
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'terminated';

// Dashboard shows:
// "⚠️ Workstation Partially Ready - 2 packages failed installation"
```

### 4. Timeline: **ACCELERATED 8-10 DAYS**
- ✅ Compressed implementation schedule
- ✅ Parallel development where possible
- ⚠️ Reduced testing time - requires careful planning

**Revised Implementation Schedule:**

| Phase | Duration | Days | Parallel Work |
|-------|----------|------|---------------|
| Phase 1: Database | 1 day | Day 1 | - |
| Phase 2: Backend | 2 days | Days 2-3 | Can parallelize Lambda development |
| Phase 3: Windows Service | 2 days | Days 4-5 | Can start while backend testing |
| Phase 4: Frontend | 2 days | Days 6-7 | Can start once backend APIs defined |
| Phase 5: Integration Testing | 2 days | Days 8-9 | Critical path |
| Phase 6: Deployment | 1 day | Day 10 | - |

**Total: 10 days**

### 5. Deployment Strategy: **FULL DEPLOYMENT**
- ✅ Deploy to **all users** immediately
- ✅ No phased rollout
- ⚠️ Requires thorough testing in Phase 5
- ⚠️ Have rollback plan ready

**Rollback Plan:**
1. Keep old UserData-based system code in separate branch
2. Feature flag in frontend to switch between systems
3. If issues detected, switch feature flag OFF immediately
4. Monitor CloudWatch metrics for first 24 hours post-deployment

### 6. Windows Service: **NATIVE WINDOWS SERVICE**
- ✅ Professional, production-grade solution
- ✅ Better resource management
- ✅ Automatic restart on failure
- ⚠️ More complex deployment (requires compilation)

**Implementation Changes from Original Design:**

**Original:** PowerShell script via Scheduled Task
```powershell
Register-ScheduledTask -TaskName "WorkstationPackageInstaller" ...
```

**Updated:** Native Windows Service written in C# or Go
```
Service Name: WorkstationPackageInstaller
Display Name: Workstation Package Installer Service
Description: Installs software packages from cloud queue
Start Type: Automatic
Account: Local System
Recovery: Restart service on failure (3 attempts)
```

**Service Architecture:**
```
WorkstationPackageInstaller.exe
  ├── Main Service Loop (runs continuously)
  ├── Package Queue Manager (queries API every 30s)
  ├── Parallel Installation Manager (up to 3 concurrent)
  ├── Resource Monitor (CPU, memory, disk)
  ├── Error Handler & Logger
  └── Status Reporter (updates API)
```

**Deployment via UserData:**
```powershell
# Download compiled service binary from S3
Invoke-WebRequest -Uri "https://YOUR-S3-BUCKET/WorkstationPackageInstaller.exe" `
  -OutFile "C:\Program Files\WorkstationPackageInstaller\WorkstationPackageInstaller.exe"

# Install as Windows Service
New-Service -Name "WorkstationPackageInstaller" `
  -BinaryPathName "C:\Program Files\WorkstationPackageInstaller\WorkstationPackageInstaller.exe" `
  -DisplayName "Workstation Package Installer" `
  -Description "Installs software packages from cloud queue" `
  -StartupType Automatic

# Configure recovery options
sc.exe failure WorkstationPackageInstaller reset= 86400 actions= restart/60000/restart/60000/restart/60000

# Start service
Start-Service WorkstationPackageInstaller
```

### 7. Authentication: **IAM ROLES**
- ✅ More secure than instance identity
- ✅ Fine-grained permissions
- ✅ Integration with AWS best practices
- ⚠️ Requires IAM role creation during instance launch

**Implementation Changes from Original Design:**

**Original:** Instance identity document authentication
```typescript
// Workstation sends instance identity document
// API validates signature
```

**Updated:** IAM role-based authentication
```typescript
// Instance has IAM role: WorkstationPackageInstallerRole
// Role has policy: AllowPackageQueueAccess
// Windows Service uses AWS SDK with implicit credentials
// API validates IAM role and restricts to own workstation ID
```

**IAM Role Policy:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:Query",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/WorkstationPackageQueue",
      "Condition": {
        "StringEquals": {
          "dynamodb:LeadingKeys": ["workstation#${ec2:SourceInstanceARN}"]
        }
      }
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/aws/workstation/package-installer"
    }
  ]
}
```

**Benefits:**
- Service can only access its own workstation's queue
- No API Gateway authentication needed (direct DynamoDB access)
- Audit trail in CloudTrail
- Can revoke access by modifying role

### 8. UI Progress Display: **MODAL POPUP**
- ✅ Prominent, impossible to miss
- ✅ Dedicated space for detailed information
- ✅ Can include retry buttons and error details
- ⚠️ May be intrusive if packages take long time

**Implementation:**

**Modal Trigger:**
- Automatically opens when workstation status is "installing_packages"
- Shows on dashboard and workstation detail page
- User can dismiss but will reappear on next status check
- Persistent notification badge if dismissed

**Modal Content:**
```
┌─────────────────────────────────────────────────────┐
│  Installing Software Packages                    [X]│
├─────────────────────────────────────────────────────┤
│                                                      │
│  Your workstation is installing 6 packages...       │
│                                                      │
│  Progress: 3/6 Complete                             │
│  ████████████░░░░░░░░ 50%                           │
│                                                      │
│  Currently Installing:                              │
│  ↻ Visual Studio 2022 (2m 15s remaining)           │
│  ↻ Docker Desktop (45s remaining)                   │
│  ↻ Node.js (15s remaining)                          │
│                                                      │
│  Completed:                                          │
│  ✓ NICE DCV Server (12s)                            │
│  ✓ NVIDIA GPU Driver (45s)                          │
│  ✓ Git (8s)                                         │
│                                                      │
│  Pending:                                            │
│  ○ MongoDB Compass                                  │
│  ○ Postman                                          │
│  ○ Visual Studio Code                               │
│                                                      │
│  [View Detailed Logs]  [Retry Failed]  [Dismiss]   │
└─────────────────────────────────────────────────────┘
```

**Modal Features:**
- Real-time updates every 5 seconds
- Estimated time remaining per package
- Expandable error details for failures
- "Retry Failed" button for manual retry
- "View Detailed Logs" opens new tab with CloudWatch logs
- Notification when all packages complete

---

## Updated Architecture Diagrams

### Parallel Installation Flow

```
Windows Service Main Loop (every 30 seconds):
  │
  ├─→ Query API: "Give me up to 3 packages to install"
  │   API returns: [Package A, Package B, Package C]
  │
  ├─→ Check system resources
  │   CPU < 80%? Memory < 90%? Disk I/O < 80%?
  │   If YES: Install all 3 in parallel
  │   If NO: Install 1 at a time
  │
  ├─→ Launch 3 parallel PowerShell processes:
  │   Process 1: Install Package A
  │   Process 2: Install Package B  
  │   Process 3: Install Package C
  │
  ├─→ Monitor installation progress:
  │   Each process reports: downloading... installing... configuring...
  │
  └─→ Wait for all processes to complete:
      Process 1: SUCCESS (Visual Studio installed in 120s)
      Process 2: SUCCESS (Docker installed in 45s)
      Process 3: FAILED (Node.js failed - port conflict)
      
      Report results to API:
        - Mark Package A: completed
        - Mark Package B: completed
        - Mark Package C: failed (retry count 1/3)
```

### IAM Authentication Flow

```
Windows Service Startup:
  │
  ├─→ Load AWS SDK with implicit credentials
  │   SDK automatically uses EC2 instance IAM role
  │
  ├─→ Get instance metadata:
  │   Instance ID: i-0abc123def456
  │   Region: us-west-2
  │
  ├─→ Query DynamoDB directly (no API Gateway):
  │   Table: WorkstationPackageQueue
  │   PK: workstation#i-0abc123def456
  │   IAM policy restricts to own workstation ID only
  │
  ├─→ DynamoDB validates IAM credentials:
  │   Role: WorkstationPackageInstallerRole
  │   Policy allows: Query on own PK only
  │   Result: Return packages or Access Denied
  │
  └─→ Service processes packages and updates DynamoDB
      All operations logged to CloudTrail for audit
```

---

## Implementation Priority Changes

### CRITICAL PATH (Must Complete for Launch)

**Day 1: Database + IAM Setup**
- Create DynamoDB tables with GSIs
- Create IAM role: WorkstationPackageInstallerRole
- Create IAM policy with conditional access
- Test IAM permissions from EC2 instance

**Days 2-3: Windows Service Development**
- Develop C#/Go Windows Service
- Implement parallel installation manager
- Implement resource monitoring
- Implement DynamoDB direct access with AWS SDK
- Unit tests for all components

**Days 4-5: Backend Lambda Updates**
- Enhance EC2Management Lambda to:
  - Attach IAM role to launched instances
  - Create package queue items
  - Support mandatory group packages
- Create admin APIs for group package management
- Update workstation status tracking

**Days 6-7: Frontend Development**
- Modal progress popup component
- Group package management UI
- Workstation status badges
- Error display and retry controls

**Days 8-9: Integration Testing**
- Test parallel installation (3 packages)
- Test resource contention scenarios
- Test failure scenarios and retry logic
- Test IAM permission boundaries
- Load testing (10 concurrent workstations)

**Day 10: Deployment**
- Deploy DynamoDB tables
- Deploy IAM roles and policies
- Upload Windows Service binary to S3
- Deploy Lambda functions
- Deploy frontend
- Monitor first workstation launches

### DEFERRED TO PHASE 2

- Package dependencies
- Conditional installation rules
- Package version management
- Advanced monitoring dashboards
- Slack/Email notifications

---

## Risk Mitigation

### Risk 1: Parallel Installation Failures
**Mitigation:**
- Implement resource monitoring before starting installations
- Fall back to sequential if resources constrained
- Extensive testing in Phase 5

### Risk 2: Windows Service Deployment Complexity
**Mitigation:**
- Pre-compile and test service on multiple Windows versions
- Automated testing in Phase 5
- Clear error messages if service fails to install

### Risk 3: IAM Permission Issues
**Mitigation:**
- Test IAM policies thoroughly on Day 1
- Clear error messages when permissions denied
- Documentation for troubleshooting

### Risk 4: Compressed Timeline
**Mitigation:**
- Daily standup to track progress
- Identify blockers immediately
- Have rollback plan ready
- Focus on critical path only

---

## Success Criteria

### Day 10 - Must Be Working:
- ✅ Workstation launches with IAM role attached
- ✅ Windows Service installs and starts automatically
- ✅ Service queries DynamoDB successfully
- ✅ 3 packages install in parallel
- ✅ Installation progress shows in modal
- ✅ Failed packages retry automatically
- ✅ Workstation status updates correctly
- ✅ Group packages enforced (mandatory)
- ✅ Admin can bind packages to groups

### Phase 2 Enhancements (After Day 10):
- Package dependencies
- Conditional installation
- Advanced monitoring
- Notifications
- Package updates

---

## Updated Cost Estimate

### Development Effort

| Phase | Original | Accelerated | Saved |
|-------|----------|-------------|-------|
| Phase 1: Database | 1.5 days | 1 day | 0.5 days |
| Phase 2: Backend | 3.5 days | 2 days | 1.5 days |
| Phase 3: Windows Service | 2.5 days | 2 days | 0.5 days |
| Phase 4: Frontend | 3.5 days | 2 days | 1.5 days |
| Phase 5: Testing | 2.5 days | 2 days | 0.5 days |
| Phase 6: Deployment | 1 day | 1 day | 0 days |
| **TOTAL** | **14.5 days** | **10 days** | **4.5 days** |

### Infrastructure Costs

**Additional AWS Resources:**
- DynamoDB tables (2): ~$5/month (on-demand pricing)
- IAM roles: Free
- CloudWatch logs: ~$2/month (5GB ingestion)
- Lambda executions: Negligible (covered by free tier)
- S3 storage for service binary: <$0.01/month

**Total Additional Cost: ~$7/month**

---

## Next Steps

1. ✅ **Architecture Approved** - User selected option 3 (all advanced features)
2. ⏳ **Switch to Code Mode** - Begin Phase 1 implementation
3. ⏳ **Day 1:** Create DynamoDB tables and IAM roles
4. ⏳ **Days 2-3:** Develop Windows Service
5. ⏳ **Days 4-5:** Update backend Lambda functions
6. ⏳ **Days 6-7:** Build frontend components
7. ⏳ **Days 8-9:** Integration testing
8. ⏳ **Day 10:** Production deployment

---

**Document Version:** 1.1  
**Last Updated:** November 20, 2025  
**Status:** Approved for Implementation  
**Implementation Start:** Ready to begin Phase 1