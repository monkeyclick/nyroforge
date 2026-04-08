using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System.Collections.Concurrent;
using WorkstationPackageInstaller.Models;

namespace WorkstationPackageInstaller.Services;

/// <summary>
/// Manages parallel installation of up to 3 packages simultaneously with resource monitoring
/// </summary>
public class ParallelInstallationManager
{
    private readonly ILogger<ParallelInstallationManager> _logger;
    private readonly PackageQueueService _queueService;
    private readonly PackageInstallerService _installerService;
    private readonly CloudWatchLogsService _cloudWatchLogs;
    private readonly ResourceMonitor _resourceMonitor;
    private readonly ServiceConfiguration _config;
    private readonly SemaphoreSlim _installationSlots;
    private readonly ConcurrentDictionary<string, Task> _runningInstallations;

    public ParallelInstallationManager(
        ILogger<ParallelInstallationManager> logger,
        PackageQueueService queueService,
        PackageInstallerService installerService,
        CloudWatchLogsService cloudWatchLogs,
        ResourceMonitor resourceMonitor,
        IOptions<ServiceConfiguration> configuration)
    {
        _logger = logger;
        _queueService = queueService;
        _installerService = installerService;
        _cloudWatchLogs = cloudWatchLogs;
        _resourceMonitor = resourceMonitor;
        _config = configuration.Value;
        _installationSlots = new SemaphoreSlim(_config.MaxConcurrentInstallations);
        _runningInstallations = new ConcurrentDictionary<string, Task>();
    }

    /// <summary>
    /// Process pending packages with parallel installation
    /// </summary>
    public async Task ProcessPendingPackagesAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            // Get pending packages sorted by install order
            var pendingPackages = await _queueService.GetPendingPackagesAsync(cancellationToken);

            if (pendingPackages.Count == 0)
            {
                _logger.LogDebug("No pending packages to install");
                return;
            }

            _logger.LogInformation("Found {Count} pending packages to process", pendingPackages.Count);
            _resourceMonitor.LogResourceUsage();

            // Process packages in order, but allow parallel execution
            foreach (var package in pendingPackages)
            {
                if (cancellationToken.IsCancellationRequested)
                    break;

                // Check if we have installation slots available
                var slotsAvailable = _installationSlots.CurrentCount;
                if (slotsAvailable == 0)
                {
                    _logger.LogDebug("All installation slots busy, waiting...");
                    await WaitForAvailableSlotAsync(cancellationToken);
                }

                // Check resource availability before starting new installation
                var resourceStatus = await _resourceMonitor.CheckResourceAvailability();
                if (!resourceStatus.IsAvailable)
                {
                    _logger.LogInformation(
                        "System resources above threshold, waiting before starting {PackageName}",
                        package.PackageName);
                    
                    // Wait a bit and check again
                    await Task.Delay(TimeSpan.FromSeconds(_config.ResourceMonitoring.CheckIntervalSeconds), 
                        cancellationToken);
                    continue;
                }

                // Start installation in background
                _ = Task.Run(async () => await InstallPackageAsync(package, cancellationToken), cancellationToken);
            }

            // Wait for all running installations to complete
            await WaitForAllInstallationsAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing pending packages");
        }
    }

    /// <summary>
    /// Install a single package
    /// </summary>
    private async Task InstallPackageAsync(PackageQueueItem package, CancellationToken cancellationToken)
    {
        // Acquire installation slot
        await _installationSlots.WaitAsync(cancellationToken);

        try
        {
            // Track this installation
            var installationTask = Task.CompletedTask;
            _runningInstallations[package.PackageId] = installationTask;

            _logger.LogInformation(
                "Starting installation of {PackageName} (slot {Slot}/{Max})",
                package.PackageName,
                _config.MaxConcurrentInstallations - _installationSlots.CurrentCount,
                _config.MaxConcurrentInstallations);

            // Increment retry count and mark as installing
            package.RetryCount++;
            await _queueService.MarkAsInstallingAsync(package, cancellationToken);

            // Execute installation
            var result = await _installerService.InstallPackageAsync(package, cancellationToken);

            // Update status based on result
            if (result.Success)
            {
                await _queueService.MarkAsCompletedAsync(
                    package,
                    result.DurationSeconds,
                    cancellationToken);

                _logger.LogInformation(
                    "Successfully installed {PackageName} in {Duration}s",
                    package.PackageName,
                    result.DurationSeconds);
            }
            else
            {
                // Check if we should retry
                if (package.CanRetry())
                {
                    _logger.LogWarning(
                        "Installation of {PackageName} failed (attempt {Retry}/{Max}), will retry: {Error}",
                        package.PackageName,
                        package.RetryCount,
                        package.MaxRetries,
                        result.ErrorMessage);

                    // Update to pending for retry
                    await _queueService.MarkAsPendingAsync(
                        package,
                        $"Retry {package.RetryCount}/{package.MaxRetries}: {result.ErrorMessage}",
                        cancellationToken);

                    // Wait before retry becomes available
                    await Task.Delay(
                        TimeSpan.FromSeconds(_config.RetryDelaySeconds),
                        cancellationToken);
                }
                else
                {
                    _logger.LogError(
                        "Installation of {PackageName} failed after {Retry} attempts: {Error}",
                        package.PackageName,
                        package.RetryCount,
                        result.ErrorMessage);

                    await _queueService.MarkAsFailedAsync(
                        package,
                        result.ErrorMessage ?? "Unknown error",
                        cancellationToken);

                    // If this was a required package, skip remaining packages
                    if (package.Required)
                    {
                        await SkipRemainingPackagesAsync(
                            package,
                            $"Required package {package.PackageName} failed",
                            cancellationToken);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unexpected error installing {PackageName}", package.PackageName);
            
            try
            {
                await _queueService.MarkAsFailedAsync(
                    package,
                    $"Unexpected error: {ex.Message}",
                    cancellationToken);
            }
            catch (Exception updateEx)
            {
                _logger.LogError(updateEx, "Failed to update package status after error");
            }
        }
        finally
        {
            // Release installation slot
            _installationSlots.Release();
            _runningInstallations.TryRemove(package.PackageId, out _);

            _logger.LogDebug(
                "Released installation slot for {PackageName} (available: {Available}/{Max})",
                package.PackageName,
                _installationSlots.CurrentCount,
                _config.MaxConcurrentInstallations);
        }
    }

    /// <summary>
    /// Skip remaining packages after a required package fails
    /// </summary>
    private async Task SkipRemainingPackagesAsync(
        PackageQueueItem failedPackage,
        string reason,
        CancellationToken cancellationToken)
    {
        try
        {
            var pendingPackages = await _queueService.GetPendingPackagesAsync(cancellationToken);
            
            // Skip packages with higher install order
            var packagesToSkip = pendingPackages
                .Where(p => p.InstallOrder > failedPackage.InstallOrder)
                .ToList();

            if (packagesToSkip.Count > 0)
            {
                _logger.LogWarning(
                    "Skipping {Count} remaining packages due to required package failure",
                    packagesToSkip.Count);

                foreach (var package in packagesToSkip)
                {
                    await _queueService.MarkAsSkippedAsync(package, reason, cancellationToken);
                    _cloudWatchLogs.LogInstallation(
                        package.PackageName,
                        $"Skipped: {reason}",
                        LogLevel.Warning);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error skipping remaining packages");
        }
    }

    /// <summary>
    /// Wait for an installation slot to become available
    /// </summary>
    private async Task WaitForAvailableSlotAsync(CancellationToken cancellationToken)
    {
        var pollInterval = TimeSpan.FromSeconds(5);
        while (_installationSlots.CurrentCount == 0 && !cancellationToken.IsCancellationRequested)
        {
            await Task.Delay(pollInterval, cancellationToken);
        }
    }

    /// <summary>
    /// Wait for all running installations to complete
    /// </summary>
    private async Task WaitForAllInstallationsAsync()
    {
        if (_runningInstallations.IsEmpty)
            return;

        _logger.LogInformation(
            "Waiting for {Count} installations to complete",
            _runningInstallations.Count);

        var tasks = _runningInstallations.Values.ToArray();
        await Task.WhenAll(tasks);

        _logger.LogInformation("All installations completed");
    }

    /// <summary>
    /// Get current installation status
    /// </summary>
    public InstallationStatus GetStatus()
    {
        return new InstallationStatus
        {
            ActiveInstallations = _config.MaxConcurrentInstallations - _installationSlots.CurrentCount,
            MaxConcurrentInstallations = _config.MaxConcurrentInstallations,
            QueuedInstallations = _runningInstallations.Count
        };
    }
}

/// <summary>
/// Current installation status
/// </summary>
public class InstallationStatus
{
    public int ActiveInstallations { get; set; }
    public int MaxConcurrentInstallations { get; set; }
    public int QueuedInstallations { get; set; }
}