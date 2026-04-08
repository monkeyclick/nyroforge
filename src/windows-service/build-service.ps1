# Build script for Windows Service
# This script builds the Windows Service as a self-contained executable

param(
    [string]$Configuration = "Release",
    [string]$OutputPath = "publish"
)

$ErrorActionPreference = "Stop"

Write-Host "Building Workstation Package Installer Service..." -ForegroundColor Cyan

# Navigate to project directory
$ProjectDir = Join-Path $PSScriptRoot "WorkstationPackageInstaller"
Push-Location $ProjectDir

try {
    # Clean previous builds
    if (Test-Path $OutputPath) {
        Write-Host "Cleaning previous build..." -ForegroundColor Yellow
        Remove-Item $OutputPath -Recurse -Force
    }

    # Restore dependencies
    Write-Host "Restoring NuGet packages..." -ForegroundColor Yellow
    dotnet restore

    # Build and publish
    Write-Host "Building and publishing..." -ForegroundColor Yellow
    dotnet publish `
        --configuration $Configuration `
        --runtime win-x64 `
        --self-contained true `
        --output $OutputPath `
        /p:PublishSingleFile=true `
        /p:PublishTrimmed=false `
        /p:IncludeNativeLibrariesForSelfExtract=true

    if ($LASTEXITCODE -ne 0) {
        throw "Build failed with exit code $LASTEXITCODE"
    }

    # Get the output file path
    $ExePath = Join-Path $OutputPath "WorkstationPackageInstaller.exe"
    
    if (Test-Path $ExePath) {
        $FileSize = (Get-Item $ExePath).Length / 1MB
        Write-Host "Build successful!" -ForegroundColor Green
        Write-Host "Output: $ExePath" -ForegroundColor Green
        Write-Host "Size: $([math]::Round($FileSize, 2)) MB" -ForegroundColor Green
    } else {
        throw "Build completed but executable not found at $ExePath"
    }

    # Create deployment package
    Write-Host "`nCreating deployment package..." -ForegroundColor Yellow
    $ZipPath = Join-Path $PSScriptRoot "WorkstationPackageInstaller.zip"
    
    if (Test-Path $ZipPath) {
        Remove-Item $ZipPath -Force
    }

    Compress-Archive -Path "$OutputPath\*" -DestinationPath $ZipPath -Force
    
    $ZipSize = (Get-Item $ZipPath).Length / 1MB
    Write-Host "Deployment package created: $ZipPath" -ForegroundColor Green
    Write-Host "Package size: $([math]::Round($ZipSize, 2)) MB" -ForegroundColor Green

    Write-Host "`n=== Build Summary ===" -ForegroundColor Cyan
    Write-Host "Configuration: $Configuration"
    Write-Host "Executable: $ExePath"
    Write-Host "Package: $ZipPath"
    Write-Host "Ready for deployment!" -ForegroundColor Green

} catch {
    Write-Host "Error: $_" -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}