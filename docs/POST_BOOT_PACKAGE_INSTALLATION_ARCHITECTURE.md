# Post-Boot Package Installation System Architecture

**Date:** November 20, 2025  
**Version:** 1.0  
**Status:** Design Phase - Awaiting Implementation  
**Objective:** Enable installation of 5+ packages by moving package installation from UserData to post-boot service

---

## Executive Summary

The current bootstrap package system is limited by AWS EC2 UserData's 16KB size constraint, allowing only 2-3 packages to be installed during launch. This architecture implements a **post-boot package installation service** that:

1. ✅ **Removes UserData size limits** - Install unlimited packages
2. ✅ **Group-based package binding** - Associate package sets with user groups
3. ✅ **Simplified UI** - Auto-select packages based on user's group membership
4. ✅ **Real-time progress tracking** - Monitor installation status in dashboard
5. ✅ **Retry logic** - Automatically retry failed installations
6. ✅ **Better error reporting** - Detailed logs and user notifications

---

## Problem Statement

### Current Limitations

**UserData Size Limit:**
- AWS EC2 UserData: 16KB maximum (16,384 bytes unencoded)
- Current script overhead: ~1,500 bytes (passwords, RDP, DCV config)
- Per package script size: ~200-400 bytes
- **Practical limit: 2-3 packages maximum**

**User Experience Issues:**
- Users must manually remember which packages they need
- No standardization across teams/departments
- Complex selection process with 30+ available packages
- Installation failures are silent (no feedback)

**Administrative Challenges:**
- No centralized package management per group
- Can't enforce standard software configurations
- Difficult to audit what's installed where
- No installation progress visibility

### Requirements

1. **Install 5+ packages** per workstation reliably
2. **Group-based package binding** - Admins assign packages to groups
3. **Simple UI** - Users see packages relevant to their group(s)
4. **Progress tracking** - Real-time installation status
5. **Error handling** - Retry failed installations, report errors
6. **Audit trail** - Track what was installed when and by whom

---

## System Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (NextJS)                        │
│  ┌─────────────────────┐  ┌──────────────────────────────────┐ │
│  │ Launch Workstation  │  │   Admin: Group Management        │ │
│  │ Modal               │  │   - Bind packages to groups      │ │
│  │ - Auto-selects      │  │   - Create package presets       │ │
│  │   packages based on │  │   - Set installation order       │ │
│  │   user's groups     │  └──────────────────────────────────┘ │
│  └─────────────────────┘                                        │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 │ API Calls
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                   API GATEWAY + LAMBDA FUNCTIONS                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  EC2Management Lambda                                     │  │
│  │  - Launch instance with minimal UserData                 │  │
│  │  - Create package installation queue items               │  │
│  │  - Only installs: GPU driver + DCV in UserData           │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  PackageQueueService Lambda                               │  │
│  │  - GET /workstations/{id}/packages - List pending        │  │
│  │  - POST /workstations/{id}/packages/{pkgId}/complete     │  │
│  │  - POST /workstations/{id}/packages/{pkgId}/fail         │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  GroupManagement Lambda                                   │  │
│  │  - Associate packages with groups                        │  │
│  │  - Manage package presets                                │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 │ Read/Write
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                        DYNAMODB TABLES                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  WorkstationPackageQueue                                  │  │
│  │  PK: workstationId                                        │  │
│  │  SK: packageId#{timestamp}                               │  │
│  │  - packageId, packageName, downloadUrl                   │  │
│  │  - installCommand, installArgs                           │  │
│  │  - status: pending|installing|completed|failed           │  │
│  │  - retryCount, maxRetries                                │  │
│  │  - errorMessage, installedAt                             │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  GroupPackageBindings                                     │  │
│  │  PK: groupId                                              │  │
│  │  SK: packageId                                            │  │
│  │  - packageId, installOrder, required                     │  │
│  │  - createdAt, createdBy                                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  WorkstationBootstrapPackages (existing)                  │  │
│  │  - All available packages                                │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 │ Queries queue via HTTPS
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│              WINDOWS WORKSTATION (EC2 Instance)                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  WorkstationPackageInstaller.ps1 (Scheduled Task)        │  │
│  │  - Runs every 2 minutes                                  │  │
│  │  - Queries API for pending packages                      │  │
│  │  - Downloads and installs packages sequentially          │  │
│  │  - Reports status back to API                            │  │
│  │  - Logs to C:\ProgramData\PackageInstaller\logs          │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Detailed Component Design

### 1. DynamoDB Schema

#### Table: WorkstationPackageQueue

**Purpose:** Track package installation queue for each workstation

```javascript
{
  PK: "workstation#i-0abc123def456",     // Partition Key
  SK: "package#dcv-server-2024#001",     // Sort Key (packageId + sequence)
  
  // Package Details
  packageId: "dcv-server-2024",
  packageName: "NICE DCV Server 2025",
  downloadUrl: "https://d1uj6qtbmh3dt5.cloudfront.net/.../nice-dcv-server.msi",
  installCommand: "Start-Process msiexec.exe -ArgumentList",
  installArgs: "\"/i INSTALLER_PATH /quiet /norestart\" -Wait",
  
  // Installation State
  status: "pending",  // pending|installing|completed|failed|skipped
  installOrder: 1,    // Order to install packages
  required: true,     // If false, continue on failure
  
  // Retry Logic
  retryCount: 0,
  maxRetries: 3,
  lastAttemptAt: "2025-11-20T21:00:00Z",
  
  // Results
  installedAt: null,
  errorMessage: null,
  installDurationSeconds: null,
  
  // Metadata
  createdAt: "2025-11-20T20:00:00Z",
  createdBy: "user@example.com",
  groupId: "developers",  // Which group this came from
  
  // Expiration
  ttl: 1732233600  // Auto-delete after 30 days
}
```

**Indexes:**
- **Primary:** PK + SK (workstationId + packageId)
- **GSI1:** status + createdAt (query failed packages)
- **GSI2:** groupId + createdAt (audit trail)

**Queries:**
```javascript
// Get pending packages for a workstation
QueryCommand({
  KeyConditionExpression: "PK = :wid AND begins_with(SK, :pkg)",
  FilterExpression: "#status = :pending",
  ExpressionAttributeValues: {
    ":wid": "workstation#i-0abc123",
    ":pkg": "package#",
    ":pending": "pending"
  }
})

// Get all packages by status
QueryCommand({
  IndexName: "GSI1",
  KeyConditionExpression: "#status = :failed",
  ExpressionAttributeValues: {
    ":failed": "failed"
  }
})
```

#### Table: GroupPackageBindings

**Purpose:** Associate packages with user groups

```javascript
{
  PK: "group#developers",              // Partition Key
  SK: "package#visual-studio-2022",    // Sort Key
  
  packageId: "visual-studio-2022",
  installOrder: 5,       // Install order within group
  required: true,        // Must succeed for workstation to be "ready"
  autoInstall: true,     // Automatically add to queue on launch
  
  createdAt: "2025-11-20T20:00:00Z",
  createdBy: "admin@example.com",
  updatedAt: "2025-11-20T20:00:00Z"
}
```

**Queries:**
```javascript
// Get all packages for a group
QueryCommand({
  KeyConditionExpression: "PK = :gid AND begins_with(SK, :pkg)",
  ExpressionAttributeValues: {
    ":gid": "group#developers",
    ":pkg": "package#"
  }
})

// Get which groups use a specific package
QueryCommand({
  IndexName: "GSI1-PackageIndex",
  KeyConditionExpression: "packageId = :pkgId",
  ExpressionAttributeValues: {
    ":pkgId": "visual-studio-2022"
  }
})
```

---

### 2. Backend Lambda Functions

#### A. EC2Management Lambda (Enhanced)

**Changes Required:**

```typescript
// In launchWorkstation() function
async function launchWorkstation(event: APIGatewayProxyEvent) {
  // ... existing code ...
  
  // 1. Get user's groups
  const userGroups = await getUserGroups(userId);
  
  // 2. Get packages for user's groups
  const groupPackages = await getGroupPackages(userGroups);
  
  // 3. Merge with manually selected packages (if any)
  const allPackages = mergePackages(groupPackages, event.bootstrapPackages);
  
  // 4. Split into UserData packages vs Post-Boot packages
  const userDataPackages = allPackages.filter(p => 
    p.packageId === 'gpu-driver' || p.packageId === 'dcv-server-2024'
  );
  const postBootPackages = allPackages.filter(p =>
    p.packageId !== 'gpu-driver' && p.packageId !== 'dcv-server-2024'
  );
  
  // 5. Generate minimal UserData (only GPU + DCV)
  const userData = generateUserDataScript(userDataPackages, password);
  
  // 6. Launch instance
  const instance = await launchEC2Instance(userData);
  
  // 7. Create package queue items for post-boot installation
  await createPackageQueue(instance.instanceId, postBootPackages, userId);
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      workstationId: instance.instanceId,
      packagesQueued: postBootPackages.length,
      message: `Workstation launching. ${postBootPackages.length} packages will install after boot.`
    })
  };
}

async function getGroupPackages(groupIds: string[]): Promise<Package[]> {
  const packages = [];
  for (const groupId of groupIds) {
    const result = await dynamodb.query({
      TableName: 'GroupPackageBindings',
      KeyConditionExpression: 'PK = :gid AND begins_with(SK, :pkg)',
      ExpressionAttributeValues: {
        ':gid': `group#${groupId}`,
        ':pkg': 'package#'
      }
    });
    packages.push(...result.Items);
  }
  // Sort by installOrder and deduplicate
  return deduplicateAndSort(packages);
}

async function createPackageQueue(
  workstationId: string,
  packages: Package[],
  userId: string
): Promise<void> {
  const items = packages.map((pkg, index) => ({
    PK: `workstation#${workstationId}`,
    SK: `package#${pkg.packageId}#${String(index).padStart(3, '0')}`,
    packageId: pkg.packageId,
    packageName: pkg.name,
    downloadUrl: pkg.downloadUrl,
    installCommand: pkg.installCommand,
    installArgs: pkg.installArgs,
    status: 'pending',
    installOrder: index + 1,
    required: pkg.required || false,
    retryCount: 0,
    maxRetries: 3,
    createdAt: new Date().toISOString(),
    createdBy: userId,
    groupId: pkg.groupId,
    ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days
  }));
  
  // Batch write to DynamoDB
  await batchWriteItems('WorkstationPackageQueue', items);
}
```

#### B. PackageQueueService Lambda (NEW)

**Endpoints:**

```typescript
// GET /workstations/{workstationId}/packages
// Returns pending packages for workstation to install
async function getPendingPackages(workstationId: string) {
  const result = await dynamodb.query({
    TableName: 'WorkstationPackageQueue',
    KeyConditionExpression: 'PK = :wid AND begins_with(SK, :pkg)',
    FilterExpression: '#status = :pending',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':wid': `workstation#${workstationId}`,
      ':pkg': 'package#',
      ':pending': 'pending'
    },
    Limit: 1  // Install one at a time
  });
  
  if (result.Items.length > 0) {
    // Mark as installing
    const pkg = result.Items[0];
    await dynamodb.update({
      TableName: 'WorkstationPackageQueue',
      Key: { PK: pkg.PK, SK: pkg.SK },
      UpdateExpression: 'SET #status = :installing, lastAttemptAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':installing': 'installing',
        ':now': new Date().toISOString()
      }
    });
  }
  
  return result.Items[0] || null;
}

// POST /workstations/{workstationId}/packages/{packageId}/complete
// Mark package installation as complete
async function markPackageComplete(
  workstationId: string,
  packageId: string,
  installDuration: number
) {
  await dynamodb.update({
    TableName: 'WorkstationPackageQueue',
    Key: {
      PK: `workstation#${workstationId}`,
      SK: `package#${packageId}#*`  // Need to query first to get exact SK
    },
    UpdateExpression: 'SET #status = :completed, installedAt = :now, installDurationSeconds = :duration',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':completed': 'completed',
      ':now': new Date().toISOString(),
      ':duration': installDuration
    }
  });
}

// POST /workstations/{workstationId}/packages/{packageId}/fail
// Mark package installation as failed, increment retry count
async function markPackageFailed(
  workstationId: string,
  packageId: string,
  errorMessage: string
) {
  const pkg = await getPackageQueueItem(workstationId, packageId);
  
  const newRetryCount = (pkg.retryCount || 0) + 1;
  const newStatus = newRetryCount >= pkg.maxRetries ? 'failed' : 'pending';
  
  await dynamodb.update({
    TableName: 'WorkstationPackageQueue',
    Key: { PK: pkg.PK, SK: pkg.SK },
    UpdateExpression: 'SET #status = :status, retryCount = :count, errorMessage = :error, lastAttemptAt = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': newStatus,
      ':count': newRetryCount,
      ':error': errorMessage,
      ':now': new Date().toISOString()
    }
  });
}
```

#### C. GroupManagement Lambda (Enhanced)

**New Endpoints:**

```typescript
// POST /groups/{groupId}/packages
// Bind a package to a group
async function addPackageToGroup(groupId: string, request: {
  packageId: string,
  installOrder: number,
  required: boolean,
  autoInstall: boolean
}) {
  await dynamodb.put({
    TableName: 'GroupPackageBindings',
    Item: {
      PK: `group#${groupId}`,
      SK: `package#${request.packageId}`,
      packageId: request.packageId,
      installOrder: request.installOrder,
      required: request.required,
      autoInstall: request.autoInstall,
      createdAt: new Date().toISOString(),
      createdBy: event.requestContext.authorizer.userId
    }
  });
}

// DELETE /groups/{groupId}/packages/{packageId}
// Remove package binding from group
async function removePackageFromGroup(groupId: string, packageId: string) {
  await dynamodb.delete({
    TableName: 'GroupPackageBindings',
    Key: {
      PK: `group#${groupId}`,
      SK: `package#${packageId}`
    }
  });
}

// GET /groups/{groupId}/packages
// List packages bound to a group
async function getGroupPackages(groupId: string) {
  const result = await dynamodb.query({
    TableName: 'GroupPackageBindings',
    KeyConditionExpression: 'PK = :gid AND begins_with(SK, :pkg)',
    ExpressionAttributeValues: {
      ':gid': `group#${groupId}`,
      ':pkg': 'package#'
    }
  });
  
  return result.Items.sort((a, b) => a.installOrder - b.installOrder);
}
```

---

### 3. Windows Installation Service

#### PowerShell Script: WorkstationPackageInstaller.ps1

**Location:** `C:\ProgramData\PackageInstaller\WorkstationPackageInstaller.ps1`

```powershell
# WorkstationPackageInstaller.ps1
# Runs as Scheduled Task every 2 minutes

$ErrorActionPreference = 'Continue'
$LogFile = "C:\ProgramData\PackageInstaller\logs\installer_$(Get-Date -Format 'yyyyMMdd').log"
$ApiEndpoint = "https://YOUR-API-GATEWAY-URL/api"

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    "$timestamp - $Message" | Out-File -FilePath $LogFile -Append
    Write-Output $Message
}

function Get-WorkstationMetadata {
    try {
        $instanceId = (Invoke-RestMethod -Uri 'http://169.254.169.254/latest/meta-data/instance-id' -TimeoutSec 2)
        $region = (Invoke-RestMethod -Uri 'http://169.254.169.254/latest/meta-data/placement/region' -TimeoutSec 2)
        return @{
            instanceId = $instanceId
            region = $region
        }
    } catch {
        Write-Log "ERROR: Failed to get instance metadata: $_"
        return $null
    }
}

function Get-AuthToken {
    # In production, workstation would have IAM role with permissions
    # For now, use instance identity document signature
    try {
        $identity = Invoke-RestMethod -Uri 'http://169.254.169.254/latest/dynamic/instance-identity/document' -TimeoutSec 2
        return $identity
    } catch {
        Write-Log "ERROR: Failed to get auth token: $_"
        return $null
    }
}

function Get-PendingPackage {
    param([string]$workstationId, [object]$authToken)
    
    try {
        $headers = @{
            'Content-Type' = 'application/json'
            'x-workstation-id' = $workstationId
        }
        
        $response = Invoke-RestMethod `
            -Uri "$ApiEndpoint/workstations/$workstationId/packages" `
            -Method Get `
            -Headers $headers `
            -TimeoutSec 10
        
        return $response.package
    } catch {
        Write-Log "ERROR: Failed to get pending package: $_"
        return $null
    }
}

function Install-Package {
    param([object]$package)
    
    Write-Log "Installing package: $($package.packageName)"
    $startTime = Get-Date
    
    try {
        # Download package
        $fileName = $package.downloadUrl.Split('/')[-1]
        $downloadPath = "C:\Temp\$fileName"
        
        if ($package.downloadUrl -ne 'none') {
            Write-Log "Downloading from: $($package.downloadUrl)"
            Invoke-WebRequest -Uri $package.downloadUrl -OutFile $downloadPath -UseBasicParsing
            Write-Log "Downloaded to: $downloadPath"
        }
        
        # Replace INSTALLER_PATH placeholder
        $installArgs = $package.installArgs -replace 'INSTALLER_PATH', $downloadPath
        
        # Execute installation command
        Write-Log "Executing: $($package.installCommand) $installArgs"
        
        if ($package.installCommand -match 'msiexec') {
            # MSI installation
            $process = Start-Process -FilePath $package.installCommand -ArgumentList $installArgs -Wait -PassThru -NoNewWindow
        } else {
            # EXE installation
            $process = Start-Process -FilePath $downloadPath -ArgumentList $installArgs -Wait -PassThru -NoNewWindow
        }
        
        $exitCode = $process.ExitCode
        Write-Log "Installation exit code: $exitCode"
        
        # Cleanup
        if (Test-Path $downloadPath) {
            Remove-Item $downloadPath -Force
        }
        
        $duration = ((Get-Date) - $startTime).TotalSeconds
        
        if ($exitCode -eq 0) {
            return @{
                success = $true
                duration = $duration
            }
        } else {
            return @{
                success = $false
                error = "Installation failed with exit code: $exitCode"
                duration = $duration
            }
        }
        
    } catch {
        $duration = ((Get-Date) - $startTime).TotalSeconds
        Write-Log "ERROR: Installation failed: $_"
        return @{
            success = $false
            error = $_.Exception.Message
            duration = $duration
        }
    }
}

function Report-PackageStatus {
    param(
        [string]$workstationId,
        [string]$packageId,
        [bool]$success,
        [int]$duration,
        [string]$error
    )
    
    try {
        $endpoint = if ($success) { 'complete' } else { 'fail' }
        $body = @{
            duration = $duration
            error = $error
        } | ConvertTo-Json
        
        $headers = @{
            'Content-Type' = 'application/json'
            'x-workstation-id' = $workstationId
        }
        
        Invoke-RestMethod `
            -Uri "$ApiEndpoint/workstations/$workstationId/packages/$packageId/$endpoint" `
            -Method Post `
            -Headers $headers `
            -Body $body `
            -TimeoutSec 10
        
        Write-Log "Reported $endpoint status for package $packageId"
    } catch {
        Write-Log "ERROR: Failed to report status: $_"
    }
}

# Main execution loop
Write-Log "========== Package Installer Started =========="

$metadata = Get-WorkstationMetadata
if (-not $metadata) {
    Write-Log "ERROR: Could not get workstation metadata. Exiting."
    exit 1
}

Write-Log "Workstation ID: $($metadata.instanceId)"
Write-Log "Region: $($metadata.region)"

$authToken = Get-AuthToken
if (-not $authToken) {
    Write-Log "ERROR: Could not get auth token. Exiting."
    exit 1
}

# Get pending package
$package = Get-PendingPackage -workstationId $metadata.instanceId -authToken $authToken

if ($package) {
    Write-Log "Found pending package: $($package.packageName)"
    
    # Install package
    $result = Install-Package -package $package
    
    # Report status
    Report-PackageStatus `
        -workstationId $metadata.instanceId `
        -packageId $package.packageId `
        -success $result.success `
        -duration $result.duration `
        -error $result.error
    
    Write-Log "Package installation $(if ($result.success) { 'succeeded' } else { 'failed' })"
} else {
    Write-Log "No pending packages found"
}

Write-Log "========== Package Installer Completed =========="
```

#### Scheduled Task Setup (via UserData)

Add to UserData script in [`ec2-management/index.ts`](../../src/lambda/ec2-management/index.ts):

```powershell
# Create Package Installer directory
New-Item -ItemType Directory -Force -Path "C:\ProgramData\PackageInstaller\logs"

# Download installer script
Invoke-WebRequest -Uri "https://YOUR-S3-BUCKET/scripts/WorkstationPackageInstaller.ps1" -OutFile "C:\ProgramData\PackageInstaller\WorkstationPackageInstaller.ps1"

# Create Scheduled Task
$action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-ExecutionPolicy Bypass -File C:\ProgramData\PackageInstaller\WorkstationPackageInstaller.ps1"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration ([TimeSpan]::MaxValue)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName "WorkstationPackageInstaller" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force
```

---

### 4. Frontend Components

#### A. Enhanced GroupManagement Component

**File:** [`frontend/src/components/admin/GroupManagement.tsx`](../../frontend/src/components/admin/GroupManagement.tsx)

**Add Package Management Tab:**

```typescript
// Add to GroupFormModal component
const [selectedTab, setSelectedTab] = useState<'details' | 'packages'>('details');
const [availablePackages, setAvailablePackages] = useState<BootstrapPackage[]>([]);
const [groupPackages, setGroupPackages] = useState<GroupPackageBinding[]>([]);

// Fetch available packages
useEffect(() => {
  const fetchPackages = async () => {
    const response = await apiClient.getBootstrapPackages();
    setAvailablePackages(response.packages);
    
    if (group) {
      const bindings = await apiClient.getGroupPackages(group.id);
      setGroupPackages(bindings);
    }
  };
  fetchPackages();
}, [group]);

// Render package binding UI
{selectedTab === 'packages' && (
  <div className="space-y-4">
    <div className="flex justify-between items-center">
      <h4 className="font-medium">Packages for this group</h4>
      <button
        type="button"
        onClick={() => setShowAddPackage(true)}
        className="text-sm text-blue-600 hover:text-blue-800"
      >
        + Add Package
      </button>
    </div>
    
    <div className="space-y-2">
      {groupPackages
        .sort((a, b) => a.installOrder - b.installOrder)
        .map((binding) => (
          <div key={binding.packageId} className="flex items-center justify-between p-3 bg-gray-50 rounded">
            <div className="flex items-center space-x-3">
              <span className="text-sm font-medium text-gray-600">
                #{binding.installOrder}
              </span>
              <span className="text-sm font-medium">
                {binding.packageName}
              </span>
              {binding.required && (
                <span className="text-xs px-2 py-0.5 bg-red-100 text-red-800 rounded">
                  Required
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => removePackageBinding(binding.packageId)}
              className="text-red-600 hover:text-red-800"
            >
              Remove
            </button>
          </div>
        ))}
    </div>
  </div>
)}
```

#### B. Enhanced LaunchWorkstationModal Component

**File:** [`frontend/src/components/workstation/LaunchWorkstationModal.tsx`](../../frontend/src/components/workstation/LaunchWorkstationModal.tsx)

**Auto-select packages based on user's groups:**

```typescript
// Add to component
const [autoSelectedPackages, setAutoSelectedPackages] = useState<string[]>([]);
const [manuallySelectedPackages, setManuallySelectedPackages] = useState<string[]>([]);

// Fetch packages for user's groups
useEffect(() => {
  const fetchGroupPackages = async () => {
    const user = await apiClient.getCurrentUser();
    const groupIds = user.groups || [];
    
    const allPackages: string[] = [];
    for (const groupId of groupIds) {
      const bindings = await apiClient.getGroupPackages(groupId);
      allPackages.push(...bindings.map(b => b.packageId));
    }
    
    // Deduplicate
    const uniquePackages = [...new Set(allPackages)];
    setAutoSelectedPackages(uniquePackages);
  };
  
  if (isOpen) {
    fetchGroupPackages();
  }
}, [isOpen]);

// Render package selection with group context
<div className="form-group">
  <label className="font-medium">Software Packages</label>
  
  {autoSelectedPackages.length > 0 && (
    <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded">
      <p className="text-sm text-blue-800 mb-2">
        <strong>Auto-selected from your groups:</strong>
      </p>
      <div className="flex flex-wrap gap-2">
        {autoSelectedPackages.map(pkgId => {
          const pkg = allPackages.find(p => p.packageId === pkgId);
          return (
            <span key={pkgId} className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded">
              {pkg?.name || pkgId}
            </span>
          );
        })}
      </div>
      <p className="text-xs text-blue-600 mt-2">
        These packages will install automatically after your workstation launches.
      </p>
    </div>
  )}
  
  <BootstrapPackageSelector
    instanceType={instanceType}
    osVersion={osVersion}
    selectedPackages={[...autoSelectedPackages, ...manuallySelectedPackages]}
    onSelectionChange={setManuallySelectedPackages}
    autoSelectedPackages={autoSelectedPackages}
  />
</div>
```

#### C. Package Installation Progress Component (NEW)

**File:** `frontend/src/components/workstation/PackageInstallationProgress.tsx`

```typescript
import React, { useState, useEffect } from 'react';
import { apiClient } from '@/services/api';

interface PackageInstallationProgressProps {
  workstationId: string;
}

export const PackageInstallationProgress: React.FC<PackageInstallationProgressProps> = ({
  workstationId
}) => {
  const [packages, setPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await apiClient.getWorkstationPackageStatus(workstationId);
        setPackages(response.packages);
      } catch (err) {
        console.error('Failed to fetch package status:', err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000); // Poll every 30s
    
    return () => clearInterval(interval);
  }, [workstationId]);
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-600';
      case 'installing': return 'text-blue-600';
      case 'failed': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };
  
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return '✓';
      case 'installing': return '↻';
      case 'failed': return '✗';
      default: return '○';
    }
  };
  
  if (loading) return <div>Loading...</div>;
  
  const pending = packages.filter(p => p.status === 'pending').length;
  const installing = packages.filter(p => p.status === 'installing').length;
  const completed = packages.filter(p => p.status === 'completed').length;
  const failed = packages.filter(p => p.status === 'failed').length;
  
  return (
    <div className="bg-white rounded-lg border p-4">
      <h4 className="font-medium mb-3">Software Installation Progress</h4>
      
      <div className="flex gap-4 mb-4 text-sm">
        <span className="text-gray-600">Pending: {pending}</span>
        <span className="text-blue-600">Installing: {installing}</span>
        <span className="text-green-600">Completed: {completed}</span>
        {failed > 0 && <span className="text-red-600">Failed: {failed}</span>}
      </div>
      
      <div className="space-y-2">
        {packages.map(pkg => (
          <div key={pkg.packageId} className="flex items-center justify-between p-2 bg-gray-50 rounded">
            <div className="flex items-center space-x-3">
              <span className={`text-lg ${getStatusColor(pkg.status)}`}>
                {getStatusIcon(pkg.status)}
              </span>
              <span className="text-sm font-medium">{pkg.packageName}</span>
              {pkg.installDurationSeconds && (
                <span className="text-xs text-gray-500">
                  ({pkg.installDurationSeconds}s)
                </span>
              )}
            </div>
            {pkg.errorMessage && (
              <span className="text-xs text-red-600">{pkg.errorMessage}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
```

---

## Implementation Plan

### Phase 1: Database Schema (1-2 days)
- [ ] Create WorkstationPackageQueue DynamoDB table
- [ ] Create GroupPackageBindings DynamoDB table
- [ ] Add indexes
- [ ] Test queries
- [ ] Seed initial data

### Phase 2: Backend Services (3-4 days)
- [ ] Implement PackageQueueService Lambda
  - [ ] GET /workstations/{id}/packages endpoint
  - [ ] POST /workstations/{id}/packages/{pkgId}/complete endpoint
  - [ ] POST /workstations/{id}/packages/{pkgId}/fail endpoint
- [ ] Enhance EC2Management Lambda
  - [ ] Add getUserGroups() function
  - [ ] Add getGroupPackages() function
  - [ ] Add createPackageQueue() function
  - [ ] Modify UserData generation to only include GPU + DCV
- [ ] Enhance GroupManagement Lambda
  - [ ] POST /groups/{id}/packages endpoint
  - [ ] DELETE /groups/{id}/packages/{pkgId} endpoint
  - [ ] GET /groups/{id}/packages endpoint
- [ ] Add authentication/authorization for workstation API calls
- [ ] Write unit tests

### Phase 3: Windows Installer Service (2-3 days)
- [ ] Create WorkstationPackageInstaller.ps1 script
- [ ] Upload script to S3
- [ ] Modify UserData to create scheduled task
- [ ] Test on Windows Server 2025
- [ ] Add logging and error handling
- [ ] Test retry logic
- [ ] Test with various package types (MSI, EXE, PowerShell)

### Phase 4: Frontend Components (3-4 days)
- [ ] Enhance GroupManagement component
  - [ ] Add Packages tab
  - [ ] Package binding UI
  - [ ] Drag-and-drop reordering
- [ ] Enhance LaunchWorkstationModal
  - [ ] Auto-select packages based on groups
  - [ ] Show which packages are from groups vs manual
  - [ ] Display installation progress estimate
- [ ] Create PackageInstallationProgress component
  - [ ] Real-time status updates
  - [ ] Progress bar
  - [ ] Error display
- [ ] Add package status to WorkstationCard
- [ ] Update TypeScript types

### Phase 5: Testing & Documentation (2-3 days)
- [ ] End-to-end testing
  - [ ] Launch workstation with 5+ packages
  - [ ] Verify all packages install
  - [ ] Test failure scenarios
  - [ ] Test retry logic
- [ ] Performance testing
  - [ ] Multiple concurrent installations
  - [ ] Large packages (1GB+)
  - [ ] Network interruptions
- [ ] Documentation
  - [ ] Architecture document (this file)
  - [ ] API documentation
  - [ ] User guide
  - [ ] Admin guide
  - [ ] Troubleshooting guide

### Phase 6: Deployment (1 day)
- [ ] Deploy DynamoDB tables
- [ ] Deploy Lambda functions
- [ ] Upload installer script to S3
- [ ] Deploy frontend
- [ ] Run smoke tests
- [ ] Monitor initial rollout

**Total Estimated Time: 12-17 days**

---

## Benefits

### For End Users
1. ✅ **Simplified Experience** - Packages auto-selected based on group membership
2. ✅ **More Software** - Can install 5+ packages instead of 2-3
3. ✅ **Real-time Feedback** - See installation progress in dashboard
4. ✅ **Reliability** - Automatic retries on failures
5. ✅ **Faster Launch** - Minimal UserData means faster instance boot

### For Administrators
1. ✅ **Centralized Management** - Bind packages to groups once, applies to all members
2. ✅ **Standardization** - Ensure teams have consistent software
3. ✅ **Audit Trail** - Track what's installed where and when
4. ✅ **Flexibility** - Easy to add/remove packages from groups
5. ✅ **Visibility** - See package installation status across all workstations

### Technical Benefits
1. ✅ **No UserData Limit** - Install unlimited packages
2. ✅ **Better Error Handling** - Detailed logs and retry logic
3. ✅ **Scalability** - DynamoDB scales automatically
4. ✅ **Maintainability** - Separation of concerns
5. ✅ **Extensibility** - Easy to add new features (webhooks, notifications, etc.)

---

## Security Considerations

### Authentication
- Workstation uses EC2 instance identity document for authentication
- API validates instance identity signature
- Rate limiting per workstation ID

### Authorization
- Workstations can only query their own package queue
- Admins can view/modify all queues
- Group membership required to auto-select packages

### Network Security
- API calls use HTTPS only
- Package downloads from trusted sources only
- Signature verification for MSI packages (future)

### Data Privacy
- Package queue items expire after 30 days (TTL)
- No sensitive data stored in queue items
- Installation logs rotated automatically

---

## Monitoring & Alerting

### CloudWatch Metrics
- Package installation success rate
- Average installation duration
- Failed package count
- Queue depth per workstation

### CloudWatch Alarms
- High failure rate (>10%)
- Long installation time (>30 minutes)
- API errors (>5 per minute)

### Dashboard
- Real-time package installation status
- Group package usage statistics
- Most/least used packages
- Installation failure trends

---

## Future Enhancements

### Phase 2 Features
1. **Package Dependencies** - Install packages in dependency order
2. **Package Versions** - Support multiple versions of same package
3. **Conditional Installation** - Install based on instance type, OS, etc.
4. **Package Presets** - Predefined package bundles (e.g., "Developer", "Artist")
5. **Custom Scripts** - Support PowerShell scripts as packages
6. **Package Updates** - Automatically update installed packages
7. **Rollback** - Uninstall packages or rollback to previous version

### Integration Opportunities
1. **Slack/Teams Notifications** - Notify users when packages complete
2. **Webhooks** - Trigger external systems on package events
3. **SSM Integration** - Use Systems Manager for package management
4. **Software Catalog** - Public marketplace for packages
5. **License Management** - Track and enforce license limits

---

## Conclusion

This architecture solves the UserData size limit problem by moving package installation to a post-boot service. The group-based package binding system simplifies user experience and provides centralized management for administrators.

**Key Innovations:**
1. Scheduled task-based installer eliminates UserData limits
2. Group package binding auto-configures software
3. Real-time progress tracking improves visibility
4. Retry logic ensures reliability

**Next Steps:**
1. Review and approve this architecture
2. Begin Phase 1 implementation (Database Schema)
3. Proceed through implementation phases
4. Deploy and monitor

---

**Document Version:** 1.0  
**Last Updated:** November 20, 2025  
**Status:** Ready for Implementation