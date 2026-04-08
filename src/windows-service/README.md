# Workstation Package Installer Service

A native Windows Service for post-boot package installation on EC2 workstations, supporting parallel installation of up to 3 packages with resource monitoring.

## Features

- **Parallel Installation**: Install up to 3 packages simultaneously
- **Resource Monitoring**: Monitor CPU, memory, and disk I/O to prevent system overload
- **Automatic Retry**: Retry failed installations up to 3 times with configurable delay
- **CloudWatch Integration**: Stream installation logs to CloudWatch Logs in real-time
- **DynamoDB Queue**: Poll package queue from DynamoDB every 30 seconds
- **IAM Authentication**: Uses EC2 instance profile for AWS API authentication
- **Graceful Shutdown**: Allows active installations to complete before stopping

## Architecture

```
WorkstationPackageInstaller.exe (Windows Service)
├── Worker (Background Service)
│   └── Polls for packages every 30 seconds
├── ParallelInstallationManager
│   ├── Manages up to 3 concurrent installations
│   └── Enforces installation order
├── PackageInstallerService
│   ├── Downloads package installers
│   └── Executes installation commands
├── PackageQueueService
│   ├── Queries DynamoDB for pending packages
│   └── Updates package status
├── CloudWatchLogsService
│   └── Streams logs to CloudWatch
└── ResourceMonitor
    ├── Monitors CPU usage
    ├── Monitors memory usage
    └── Monitors disk I/O
```

## Requirements

- Windows Server 2019 or later
- .NET 8.0 Runtime (self-contained build includes runtime)
- EC2 Instance with IAM role attached
- Network access to AWS services (DynamoDB, CloudWatch Logs)

## Building

### Prerequisites

- .NET 8.0 SDK
- PowerShell 5.1 or later

### Build Command

```powershell
# Build the service
.\build-service.ps1

# Output will be in: WorkstationPackageInstaller\publish\
# Deployment package: WorkstationPackageInstaller.zip
```

## Installation

### On EC2 Workstation

1. **Upload Service Package** to S3 or download directly
2. **Extract Package** to temporary location
3. **Run Installation Script** as Administrator:

```powershell
# Install service
.\install-service.ps1

# Reinstall service
.\install-service.ps1 -Reinstall

# Uninstall service
.\install-service.ps1 -Uninstall
```

### Manual Installation

```powershell
# Copy files to program directory
Copy-Item -Path "publish\*" -Destination "C:\Program Files\WorkstationPackageInstaller\" -Recurse

# Create and start service
New-Service -Name "WorkstationPackageInstaller" `
            -BinaryPathName "C:\Program Files\WorkstationPackageInstaller\WorkstationPackageInstaller.exe" `
            -StartupType Automatic

Start-Service -Name "WorkstationPackageInstaller"
```

## Configuration

Configuration file: `appsettings.json`

```json
{
  "ServiceConfiguration": {
    "PollingIntervalSeconds": 30,
    "MaxConcurrentInstallations": 3,
    "MaxRetries": 3,
    "RetryDelaySeconds": 60,
    "InstallTimeoutMinutes": 30,
    "ResourceMonitoring": {
      "CpuThresholdPercent": 80,
      "MemoryThresholdPercent": 85,
      "DiskIOThresholdPercent": 90,
      "CheckIntervalSeconds": 10
    }
  },
  "AWS": {
    "Region": "us-west-2",
    "DynamoDB": {
      "PackageQueueTableName": "WorkstationPackageQueue",
      "BootstrapPackagesTableName": "WorkstationBootstrapPackages"
    },
    "CloudWatchLogs": {
      "LogGroupName": "/aws/workstation/package-installer",
      "LogStreamPrefix": "workstation-"
    }
  }
}
```

## IAM Permissions

The EC2 instance must have an IAM role with the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:UpdateItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:*:*:table/WorkstationPackageQueue",
        "arn:aws:dynamodb:*:*:table/WorkstationPackageQueue/index/*"
      ],
      "Condition": {
        "ForAllValues:StringLike": {
          "dynamodb:LeadingKeys": ["workstation#${ec2:SourceInstanceARN}"]
        }
      }
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/aws/workstation/package-installer:*"
    }
  ]
}
```

## Monitoring

### Windows Event Log

View service events in Event Viewer:
- Application Log > Source: "WorkstationPackageInstaller"

### CloudWatch Logs

View installation logs in CloudWatch:
- Log Group: `/aws/workstation/package-installer`
- Log Stream: `workstation-{instance-id}`

### Service Status

```powershell
# Check service status
Get-Service -Name "WorkstationPackageInstaller"

# View recent logs
Get-EventLog -LogName Application -Source "WorkstationPackageInstaller" -Newest 10
```

## Package Queue Format

Packages in DynamoDB `WorkstationPackageQueue` table:

```json
{
  "PK": "workstation#i-1234567890abcdef0",
  "SK": "package#chrome#1",
  "packageId": "chrome",
  "packageName": "Google Chrome",
  "downloadUrl": "https://dl.google.com/chrome/install/ChromeStandaloneSetup64.exe",
  "installCommand": "msiexec",
  "installArgs": "/i {installer} /qn",
  "status": "pending",
  "installOrder": 1,
  "required": false,
  "retryCount": 0,
  "maxRetries": 3,
  "createdAt": "2025-11-20T21:00:00Z",
  "createdBy": "admin@example.com"
}
```

### Package Status Values

- `pending`: Waiting to be installed
- `installing`: Currently being installed
- `completed`: Successfully installed
- `failed`: Installation failed after all retries
- `skipped`: Skipped due to required package failure

## Installation Flow

1. **Poll Queue**: Service checks DynamoDB every 30 seconds
2. **Check Resources**: Verify CPU/memory/disk are below thresholds
3. **Acquire Slot**: Wait for available installation slot (max 3)
4. **Mark Installing**: Update status to "installing" in DynamoDB
5. **Download**: Download installer from URL
6. **Execute**: Run installation command with arguments
7. **Update Status**: Mark as "completed" or "failed"
8. **Retry Logic**: If failed and retries available, mark as "pending"
9. **Required Packages**: If required package fails, skip remaining packages

## Troubleshooting

### Service Won't Start

1. Check Event Viewer for error details
2. Verify IAM role is attached to EC2 instance
3. Ensure network connectivity to AWS services
4. Check appsettings.json configuration

### Packages Not Installing

1. Check CloudWatch Logs for detailed error messages
2. Verify package queue items exist in DynamoDB
3. Ensure download URLs are accessible
4. Check resource thresholds aren't blocking installations

### High Resource Usage

1. Reduce `MaxConcurrentInstallations` in configuration
2. Increase resource thresholds
3. Increase `PollingIntervalSeconds` to reduce frequency

## Development

### Project Structure

```
WorkstationPackageInstaller/
├── Models/
│   └── PackageQueueItem.cs          # Package queue data model
├── Services/
│   ├── CloudWatchLogsService.cs     # CloudWatch integration
│   ├── PackageInstallerService.cs   # Installation logic
│   ├── PackageQueueService.cs       # DynamoDB integration
│   ├── ParallelInstallationManager.cs # Parallel execution
│   ├── ResourceMonitor.cs           # Resource monitoring
│   └── Worker.cs                    # Background service
├── Program.cs                        # Entry point
├── appsettings.json                  # Configuration
└── WorkstationPackageInstaller.csproj # Project file
```

### Testing Locally

```powershell
# Run as console application (not as service)
dotnet run --project WorkstationPackageInstaller

# Note: Requires AWS credentials in environment or ~/.aws/credentials
```

### Dependencies

- `AWSSDK.DynamoDBv2`: DynamoDB client
- `AWSSDK.CloudWatchLogs`: CloudWatch Logs client
- `Microsoft.Extensions.Hosting.WindowsServices`: Windows Service support
- `Microsoft.Extensions.Http`: HTTP client factory

## Security Considerations

- Service runs with SYSTEM account privileges
- IAM role restricts DynamoDB access to own workstation (by instance ID)
- Downloaded installers are executed with SYSTEM privileges
- Installers should only be downloaded from trusted sources
- Use HTTPS URLs for all downloads

## Performance

- **Memory Usage**: ~50-100 MB baseline
- **CPU Usage**: Minimal when idle, depends on installers during execution
- **Network**: Depends on installer sizes
- **Disk I/O**: Temporary files in %TEMP%\workstation-packages

## Deployment via UserData

Include in EC2 UserData script:

```powershell
# Download service package
$serviceUrl = "https://your-bucket.s3.amazonaws.com/WorkstationPackageInstaller.zip"
$tempZip = "$env:TEMP\service.zip"
$installDir = "C:\Program Files\WorkstationPackageInstaller"

Invoke-WebRequest -Uri $serviceUrl -OutFile $tempZip
Expand-Archive -Path $tempZip -DestinationPath $installDir -Force

# Install and start service
New-Service -Name "WorkstationPackageInstaller" `
            -BinaryPathName "$installDir\WorkstationPackageInstaller.exe" `
            -StartupType Automatic `
            -Description "Automatically installs packages on EC2 workstations"

Start-Service -Name "WorkstationPackageInstaller"
```

## License

Internal use only - EC2 Workstation Manager project

## Support

For issues or questions, refer to:
- [Main Documentation](../../docs/POST_BOOT_PACKAGE_INSTALLATION_ARCHITECTURE.md)
- [Architecture Addendum](../../docs/POST_BOOT_PACKAGE_INSTALLATION_ARCHITECTURE_ADDENDUM.md)
- CloudWatch Logs: `/aws/workstation/package-installer`