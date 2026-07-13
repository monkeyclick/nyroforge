using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using WorkstationPackageInstaller.Models;

namespace WorkstationPackageInstaller.Services;

/// <summary>
/// Service for downloading and installing packages
/// </summary>
public class PackageInstallerService
{
    private readonly ILogger<PackageInstallerService> _logger;
    private readonly CloudWatchLogsService _cloudWatchLogs;
    private readonly ServiceConfiguration _config;
    private readonly SecurityConfiguration _securityConfig;
    private readonly HttpClient _httpClient;

    public PackageInstallerService(
        ILogger<PackageInstallerService> logger,
        CloudWatchLogsService cloudWatchLogs,
        IOptions<ServiceConfiguration> configuration,
        SecurityConfiguration securityConfig,
        IHttpClientFactory httpClientFactory)
    {
        _logger = logger;
        _cloudWatchLogs = cloudWatchLogs;
        _config = configuration.Value;
        _securityConfig = securityConfig;
        _httpClient = httpClientFactory.CreateClient();
        _httpClient.Timeout = TimeSpan.FromMinutes(_config.InstallTimeoutMinutes);
    }

    /// <summary>
    /// Install a package
    /// </summary>
    public async Task<InstallationResult> InstallPackageAsync(
        PackageQueueItem package,
        CancellationToken cancellationToken = default)
    {
        var startTime = DateTime.UtcNow;
        // Create unique temp directory per installation to avoid race conditions
        var uniqueId = Guid.NewGuid().ToString("N");
        var tempDir = Path.Combine(Path.GetTempPath(), "workstation-packages", $"{package.PackageId}-{uniqueId}");
        Directory.CreateDirectory(tempDir);

        try
        {
            _logger.LogInformation("Starting installation of {PackageName}", package.PackageName);
            _cloudWatchLogs.LogInstallation(package.PackageName, "Starting installation");

            // Step 1: Download installer
            _cloudWatchLogs.LogInstallation(package.PackageName, $"Downloading from {package.DownloadUrl}");
            var installerPath = await DownloadInstallerAsync(package, tempDir, cancellationToken);

            // Step 2: Execute installer
            _cloudWatchLogs.LogInstallation(package.PackageName, "Executing installer");
            await ExecuteInstallerAsync(package, installerPath, cancellationToken);

            // Step 3: Verify installation (optional, based on package metadata)
            _cloudWatchLogs.LogInstallation(package.PackageName, "Verifying installation");

            var duration = (int)(DateTime.UtcNow - startTime).TotalSeconds;
            _cloudWatchLogs.LogInstallation(
                package.PackageName,
                $"Installation completed successfully in {duration} seconds");

            return new InstallationResult
            {
                Success = true,
                DurationSeconds = duration
            };
        }
        catch (OperationCanceledException)
        {
            _logger.LogWarning("Installation of {PackageName} was cancelled", package.PackageName);
            _cloudWatchLogs.LogInstallation(
                package.PackageName,
                "Installation cancelled",
                LogLevel.Warning);

            return new InstallationResult
            {
                Success = false,
                ErrorMessage = "Installation cancelled"
            };
        }
        catch (Exception ex)
        {
            var duration = (int)(DateTime.UtcNow - startTime).TotalSeconds;
            _logger.LogError(ex, "Error installing {PackageName}", package.PackageName);
            _cloudWatchLogs.LogInstallation(
                package.PackageName,
                $"Installation failed: {ex.Message}",
                LogLevel.Error);

            return new InstallationResult
            {
                Success = false,
                ErrorMessage = ex.Message,
                DurationSeconds = duration
            };
        }
        finally
        {
            // Cleanup temp files
            try
            {
                if (Directory.Exists(tempDir))
                {
                    Directory.Delete(tempDir, true);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to cleanup temp directory");
            }
        }
    }

    /// <summary>
    /// Download installer file
    /// </summary>
    private async Task<string> DownloadInstallerAsync(
        PackageQueueItem package,
        string tempDir,
        CancellationToken cancellationToken)
    {
        // Security: reject disallowed URLs/hosts before making any network call
        ValidateDownloadUrl(package);

        var fileName = GetFileNameFromUrl(package.DownloadUrl);
        var installerPath = Path.Combine(tempDir, fileName);

        try
        {
            _logger.LogInformation("Downloading {FileName} from {Url}", fileName, package.DownloadUrl);

            using var response = await _httpClient.GetAsync(package.DownloadUrl, cancellationToken);
            response.EnsureSuccessStatusCode();

            var totalBytes = response.Content.Headers.ContentLength ?? 0;
            using var contentStream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var fileStream = new FileStream(installerPath, FileMode.Create, FileAccess.Write, FileShare.None);

            var buffer = new byte[8192];
            long totalBytesRead = 0;
            int bytesRead;

            while ((bytesRead = await contentStream.ReadAsync(buffer, cancellationToken)) > 0)
            {
                await fileStream.WriteAsync(buffer.AsMemory(0, bytesRead), cancellationToken);
                totalBytesRead += bytesRead;

                if (totalBytes > 0)
                {
                    var progress = (int)((totalBytesRead * 100) / totalBytes);
                    if (progress % 25 == 0) // Log at 25%, 50%, 75%, 100%
                    {
                        _cloudWatchLogs.LogInstallation(
                            package.PackageName,
                            $"Download progress: {progress}%");
                    }
                }
            }

            _logger.LogInformation(
                "Downloaded {FileName} ({Size} bytes)",
                fileName,
                totalBytesRead);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error downloading installer for {PackageName}", package.PackageName);
            throw new InvalidOperationException($"Failed to download installer: {ex.Message}", ex);
        }

        // Security: verify SHA-256 integrity before the installer is handed off for execution
        await VerifyInstallerIntegrityAsync(package, installerPath, cancellationToken);

        return installerPath;
    }

    /// <summary>
    /// Validate the download URL against the security policy (HTTPS + host allowlist)
    /// before any network request is made.
    /// </summary>
    private void ValidateDownloadUrl(PackageQueueItem package)
    {
        var url = package.DownloadUrl;

        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url, UriKind.Absolute, out var uri))
        {
            throw new InvalidOperationException(
                $"Package '{package.PackageName}' has an invalid or missing download URL.");
        }

        if (!string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"Package '{package.PackageName}' download URL must use HTTPS (was '{uri.Scheme}').");
        }

        var allowedHosts = _securityConfig.AllowedDownloadHosts ?? Array.Empty<string>();
        if (!allowedHosts.Any(pattern => IsHostAllowed(uri.Host, pattern)))
        {
            _cloudWatchLogs.LogInstallation(
                package.PackageName,
                $"Download host '{uri.Host}' is not in the allowlist",
                LogLevel.Error);
            throw new InvalidOperationException(
                $"Package '{package.PackageName}' download host '{uri.Host}' is not in the allowed hosts list. Refusing to download.");
        }
    }

    /// <summary>
    /// Match a host against an allowlist pattern. A leading "*." matches the apex
    /// domain and any subdomain (e.g. "*.s3.amazonaws.com"); otherwise an exact,
    /// case-insensitive host match is required.
    /// </summary>
    private static bool IsHostAllowed(string host, string pattern)
    {
        if (string.IsNullOrWhiteSpace(pattern))
        {
            return false;
        }

        if (pattern.StartsWith("*.", StringComparison.Ordinal))
        {
            var suffix = pattern.Substring(2);
            return host.Equals(suffix, StringComparison.OrdinalIgnoreCase)
                || host.EndsWith("." + suffix, StringComparison.OrdinalIgnoreCase);
        }

        return host.Equals(pattern, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Verify the SHA-256 integrity of a downloaded installer. On mismatch, or when
    /// a hash is required but absent, the installer file is deleted and an exception
    /// is thrown so the installer is never executed.
    /// </summary>
    private async Task VerifyInstallerIntegrityAsync(
        PackageQueueItem package,
        string installerPath,
        CancellationToken cancellationToken)
    {
        var expectedHash = package.ExpectedSha256?.Trim();

        if (string.IsNullOrEmpty(expectedHash))
        {
            if (_securityConfig.RequirePackageHash)
            {
                DeleteInstallerFile(installerPath);
                throw new InvalidOperationException(
                    $"Package '{package.PackageName}' has no expected SHA-256 hash and Security:RequirePackageHash is enabled. Refusing to install.");
            }

            _logger.LogWarning(
                "No expected SHA-256 hash for {PackageName}; skipping integrity verification (RequirePackageHash=false)",
                package.PackageName);
            _cloudWatchLogs.LogInstallation(
                package.PackageName,
                "No hash provided; integrity verification skipped (RequirePackageHash=false)",
                LogLevel.Warning);
            return;
        }

        string actualHash;
        using (var sha256 = SHA256.Create())
        using (var stream = new FileStream(installerPath, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            var hashBytes = await sha256.ComputeHashAsync(stream, cancellationToken);
            actualHash = Convert.ToHexString(hashBytes);
        }

        if (!string.Equals(actualHash, expectedHash, StringComparison.OrdinalIgnoreCase))
        {
            DeleteInstallerFile(installerPath);
            _cloudWatchLogs.LogInstallation(
                package.PackageName,
                "SHA-256 integrity check FAILED - hash mismatch; installer deleted",
                LogLevel.Error);
            throw new InvalidOperationException(
                $"SHA-256 mismatch for package '{package.PackageName}'. Expected '{expectedHash}', computed '{actualHash}'. Installer deleted; not executing.");
        }

        _logger.LogInformation("SHA-256 integrity verified for {PackageName}", package.PackageName);
        _cloudWatchLogs.LogInstallation(package.PackageName, "SHA-256 integrity check passed");
    }

    /// <summary>
    /// Delete a downloaded installer file, logging (but not throwing) on failure.
    /// </summary>
    private void DeleteInstallerFile(string installerPath)
    {
        try
        {
            if (File.Exists(installerPath))
            {
                File.Delete(installerPath);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to delete installer file at {Path}", installerPath);
        }
    }

    /// <summary>
    /// Execute installer
    /// </summary>
    private async Task ExecuteInstallerAsync(
        PackageQueueItem package,
        string installerPath,
        CancellationToken cancellationToken)
    {
        try
        {
            var processStartInfo = new ProcessStartInfo
            {
                FileName = package.InstallCommand,
                Arguments = BuildInstallArguments(package, installerPath),
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                WorkingDirectory = Path.GetDirectoryName(installerPath)
            };

            _logger.LogInformation(
                "Executing: {Command} {Arguments}",
                processStartInfo.FileName,
                processStartInfo.Arguments);

            using var process = new Process { StartInfo = processStartInfo };
            var outputBuilder = new StringBuilder();
            var errorBuilder = new StringBuilder();

            process.OutputDataReceived += (sender, args) =>
            {
                if (!string.IsNullOrEmpty(args.Data))
                {
                    outputBuilder.AppendLine(args.Data);
                    _logger.LogDebug("Output: {Data}", args.Data);
                }
            };

            process.ErrorDataReceived += (sender, args) =>
            {
                if (!string.IsNullOrEmpty(args.Data))
                {
                    errorBuilder.AppendLine(args.Data);
                    _logger.LogWarning("Error: {Data}", args.Data);
                }
            };

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            // Wait for completion with timeout
            var timeout = TimeSpan.FromMinutes(_config.InstallTimeoutMinutes);
            var completed = await WaitForExitAsync(process, timeout, cancellationToken);

            if (!completed)
            {
                process.Kill();
                throw new TimeoutException(
                    $"Installation exceeded timeout of {_config.InstallTimeoutMinutes} minutes");
            }

            if (process.ExitCode != 0)
            {
                var errorOutput = errorBuilder.ToString();
                throw new InvalidOperationException(
                    $"Installation failed with exit code {process.ExitCode}. Error: {errorOutput}");
            }

            _logger.LogInformation(
                "Installation command completed successfully for {PackageName}",
                package.PackageName);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error executing installer for {PackageName}", package.PackageName);
            throw;
        }
    }

    /// <summary>
    /// Build installation arguments
    /// </summary>
    private string BuildInstallArguments(PackageQueueItem package, string installerPath)
    {
        var args = package.InstallArgs ?? string.Empty;

        // Replace {installer} placeholder with actual path
        args = args.Replace("{installer}", $"\"{installerPath}\"");

        // For msiexec, ensure installArgs is wrapped in quotes if it contains /i
        if (package.InstallCommand.Equals("msiexec", StringComparison.OrdinalIgnoreCase))
        {
            if (!args.Contains("/i") && !args.Contains("/qn"))
            {
                // Default MSI silent install arguments
                args = $"/i \"{installerPath}\" /qn /norestart {args}";
            }
        }

        return args;
    }

    /// <summary>
    /// Wait for process to exit with cancellation support
    /// </summary>
    private async Task<bool> WaitForExitAsync(
        Process process,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        var tcs = new TaskCompletionSource<bool>();

        process.EnableRaisingEvents = true;
        process.Exited += (sender, args) => tcs.TrySetResult(true);

        using var timeoutCts = new CancellationTokenSource(timeout);
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);

        linkedCts.Token.Register(() => tcs.TrySetResult(false));

        return await tcs.Task;
    }

    /// <summary>
    /// Extract filename from URL
    /// </summary>
    private string GetFileNameFromUrl(string url)
    {
        try
        {
            var uri = new Uri(url);
            var fileName = Path.GetFileName(uri.LocalPath);
            return string.IsNullOrEmpty(fileName) ? "installer.exe" : fileName;
        }
        catch
        {
            return "installer.exe";
        }
    }
}

/// <summary>
/// Installation result
/// </summary>
public class InstallationResult
{
    public bool Success { get; set; }
    public string? ErrorMessage { get; set; }
    public int DurationSeconds { get; set; }
}

/// <summary>
/// Security configuration for package downloads and integrity verification
/// </summary>
public class SecurityConfiguration
{
    /// <summary>
    /// When true, packages without an expected SHA-256 hash are refused (fail-closed).
    /// Set to false only to grandfather legacy hash-less packages.
    /// </summary>
    public bool RequirePackageHash { get; set; } = true;

    /// <summary>
    /// Hosts permitted for installer downloads. A leading "*." matches the apex
    /// domain and any subdomain. HTTPS is always required regardless of this list.
    /// </summary>
    public string[] AllowedDownloadHosts { get; set; } =
    {
        "*.s3.us-west-2.amazonaws.com",
        "*.s3.amazonaws.com",
        "*.cloudfront.net"
    };
}