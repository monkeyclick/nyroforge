# Download NVIDIA GRID Driver from AWS S3
# This script downloads the latest NVIDIA GRID driver from AWS's official S3 bucket

param(
    [string]$OutputPath = "$env:TEMP\NVIDIA",
    [string]$Region = "us-east-1"
)

Write-Host "=" * 80
Write-Host "NVIDIA GRID Driver Download from AWS S3"
Write-Host "=" * 80
Write-Host ""

# Configuration
$Bucket = "ec2-windows-nvidia-drivers"
$KeyPrefix = "latest"

Write-Host "Configuration:"
Write-Host "  Bucket: $Bucket"
Write-Host "  Region: $Region"
Write-Host "  Output: $OutputPath"
Write-Host ""

# Create output directory if it doesn't exist
if (-not (Test-Path $OutputPath)) {
    Write-Host "Creating output directory: $OutputPath"
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
}

try {
    # Check if AWS PowerShell module is installed
    if (-not (Get-Module -ListAvailable -Name AWS.Tools.S3)) {
        Write-Host "Installing AWS Tools for PowerShell..." -ForegroundColor Yellow
        Install-Module -Name AWS.Tools.S3 -Force -AllowClobber
    }

    Import-Module AWS.Tools.S3

    Write-Host "Listing objects in s3://$Bucket/$KeyPrefix..." -ForegroundColor Cyan
    
    # List all objects in the bucket with the prefix
    $Objects = Get-S3Object -BucketName $Bucket -KeyPrefix $KeyPrefix -Region $Region
    
    Write-Host "Found $($Objects.Count) objects" -ForegroundColor Green
    Write-Host ""

    $DownloadedFiles = @()
    
    foreach ($Object in $Objects) {
        $LocalFileName = $Object.Key
        
        # Skip if it's a directory marker or empty
        if ($LocalFileName -eq '' -or $Object.Size -eq 0) {
            continue
        }
        
        $LocalFilePath = Join-Path $OutputPath $LocalFileName
        $FileSize = [math]::Round($Object.Size / 1MB, 2)
        
        Write-Host "Downloading: $LocalFileName" -ForegroundColor Cyan
        Write-Host "  Size: $FileSize MB"
        Write-Host "  Path: $LocalFilePath"
        
        # Create subdirectories if needed
        $FileDir = Split-Path $LocalFilePath -Parent
        if (-not (Test-Path $FileDir)) {
            New-Item -ItemType Directory -Path $FileDir -Force | Out-Null
        }
        
        # Download the file
        Copy-S3Object -BucketName $Bucket -Key $Object.Key -LocalFile $LocalFilePath -Region $Region
        
        if (Test-Path $LocalFilePath) {
            Write-Host "  ✓ Downloaded successfully" -ForegroundColor Green
            $DownloadedFiles += @{
                Key = $Object.Key
                LocalPath = $LocalFilePath
                Size = $FileSize
                S3Uri = "s3://$Bucket/$($Object.Key)"
            }
        } else {
            Write-Host "  ✗ Download failed" -ForegroundColor Red
        }
        
        Write-Host ""
    }
    
    # Summary
    Write-Host "=" * 80
    Write-Host "Download Complete" -ForegroundColor Green
    Write-Host "=" * 80
    Write-Host "Total files downloaded: $($DownloadedFiles.Count)"
    Write-Host ""
    
    if ($DownloadedFiles.Count -gt 0) {
        Write-Host "Downloaded Files:"
        foreach ($file in $DownloadedFiles) {
            Write-Host "  • $($file.Key) ($($file.Size) MB)"
            Write-Host "    Local: $($file.LocalPath)"
            Write-Host "    S3 URI: $($file.S3Uri)"
            Write-Host ""
        }
        
        # Find the main installer
        $MainInstaller = $DownloadedFiles | Where-Object { $_.Key -match '\.exe$' -and $_.Key -match 'GRID' } | Select-Object -First 1
        
        if ($MainInstaller) {
            Write-Host "Main Installer:" -ForegroundColor Yellow
            Write-Host "  File: $($MainInstaller.LocalPath)"
            Write-Host "  S3 URI: $($MainInstaller.S3Uri)"
            Write-Host ""
            Write-Host "To install manually, run:" -ForegroundColor Cyan
            Write-Host "  Start-Process '$($MainInstaller.LocalPath)' -ArgumentList '/s', '/noreboot' -Wait"
        }
    }
    
    Write-Host ""
    Write-Host "✓ Script completed successfully" -ForegroundColor Green
    
} catch {
    Write-Host ""
    Write-Host "✗ Error occurred:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "  1. Ensure AWS credentials are configured"
    Write-Host "  2. Check IAM permissions for s3:GetObject on bucket: $Bucket"
    Write-Host "  3. Verify region is correct: $Region"
    Write-Host ""
    exit 1
}