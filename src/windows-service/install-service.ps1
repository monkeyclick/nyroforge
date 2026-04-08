# Installation script for Workstation Package Installer Service
# Must be run as Administrator on the Windows Server workstation

param(
    [string]$ServicePath = "C:\Program Files\WorkstationPackageInstaller",
    [switch]$Uninstall,
    [switch]$Reinstall
)

$ErrorActionPreference = "Stop"

# Check for admin privileges
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Error: This script must be run as Administrator" -ForegroundColor Red
    exit 1
}

$ServiceName = "WorkstationPackageInstaller"
$ServiceDisplayName = "Workstation Package Installer"
$ServiceDescription = "Automatically installs packages on EC2 workstations after boot"
$ExeName = "WorkstationPackageInstaller.exe"

function Uninstall-Service {
    Write-Host "Checking if service exists..." -ForegroundColor Yellow
    
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    
    if ($service) {
        Write-Host "Stopping service..." -ForegroundColor Yellow
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        
        Write-Host "Removing service..." -ForegroundColor Yellow
        sc.exe delete $ServiceName
        
        Start-Sleep -Seconds 2
        Write-Host "Service uninstalled successfully" -ForegroundColor Green
    } else {
        Write-Host "Service not found, skipping uninstall" -ForegroundColor Gray
    }
}

function Install-Service {
    Write-Host "Installing Workstation Package Installer Service..." -ForegroundColor Cyan
    
    # Create service directory
    if (-not (Test-Path $ServicePath)) {
        Write-Host "Creating service directory: $ServicePath" -ForegroundColor Yellow
        New-Item -ItemType Directory -Path $ServicePath -Force | Out-Null
    }
    
    # Copy service files
    Write-Host "Copying service files..." -ForegroundColor Yellow
    $SourcePath = Join-Path $PSScriptRoot "WorkstationPackageInstaller\publish\*"
    
    if (-not (Test-Path $SourcePath)) {
        throw "Service files not found. Please run build-service.ps1 first."
    }
    
    Copy-Item -Path $SourcePath -Destination $ServicePath -Recurse -Force
    
    # Verify executable exists
    $ExePath = Join-Path $ServicePath $ExeName
    if (-not (Test-Path $ExePath)) {
        throw "Service executable not found at $ExePath"
    }
    
    # Create the service
    Write-Host "Creating Windows Service..." -ForegroundColor Yellow
    New-Service -Name $ServiceName `
                -DisplayName $ServiceDisplayName `
                -Description $ServiceDescription `
                -BinaryPathName $ExePath `
                -StartupType Automatic `
                -ErrorAction Stop
    
    Write-Host "Service created successfully" -ForegroundColor Green
    
    # Start the service
    Write-Host "Starting service..." -ForegroundColor Yellow
    Start-Service -Name $ServiceName
    
    # Wait for service to start
    Start-Sleep -Seconds 3
    
    # Check service status
    $service = Get-Service -Name $ServiceName
    if ($service.Status -eq 'Running') {
        Write-Host "Service started successfully!" -ForegroundColor Green
    } else {
        Write-Host "Warning: Service did not start. Status: $($service.Status)" -ForegroundColor Yellow
        Write-Host "Check Event Viewer for error details" -ForegroundColor Yellow
    }
    
    Write-Host "`n=== Installation Complete ===" -ForegroundColor Cyan
    Write-Host "Service Name: $ServiceName"
    Write-Host "Service Path: $ServicePath"
    Write-Host "Status: $($service.Status)"
    Write-Host "`nTo view logs, check:" -ForegroundColor Yellow
    Write-Host "  - Event Viewer > Windows Logs > Application"
    Write-Host "  - CloudWatch Logs: /aws/workstation/package-installer"
}

# Main execution
try {
    if ($Uninstall) {
        Uninstall-Service
    } elseif ($Reinstall) {
        Write-Host "Performing reinstallation..." -ForegroundColor Cyan
        Uninstall-Service
        Start-Sleep -Seconds 2
        Install-Service
    } else {
        Install-Service
    }
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}