using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace WorkstationPackageInstaller.Services;

/// <summary>
/// Background worker service that polls for packages and coordinates installations
/// </summary>
public class Worker : BackgroundService
{
    private readonly ILogger<Worker> _logger;
    private readonly ParallelInstallationManager _installationManager;
    private readonly ResourceMonitor _resourceMonitor;
    private readonly CloudWatchLogsService _cloudWatchLogs;
    private readonly ServiceConfiguration _config;

    public Worker(
        ILogger<Worker> logger,
        ParallelInstallationManager installationManager,
        ResourceMonitor resourceMonitor,
        CloudWatchLogsService cloudWatchLogs,
        IOptions<ServiceConfiguration> configuration)
    {
        _logger = logger;
        _installationManager = installationManager;
        _resourceMonitor = resourceMonitor;
        _cloudWatchLogs = cloudWatchLogs;
        _config = configuration.Value;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Workstation Package Installer Service starting...");
        _cloudWatchLogs.LogInstallation(
            "Service",
            "Workstation Package Installer Service started");

        try
        {
            // Wait a bit for system to stabilize after boot
            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    _logger.LogDebug("Checking for pending packages...");

                    // Process pending packages
                    await _installationManager.ProcessPendingPackagesAsync(stoppingToken);

                    // Log current status
                    var status = _installationManager.GetStatus();
                    if (status.ActiveInstallations > 0)
                    {
                        _logger.LogInformation(
                            "Active installations: {Active}/{Max}, Queued: {Queued}",
                            status.ActiveInstallations,
                            status.MaxConcurrentInstallations,
                            status.QueuedInstallations);
                    }

                    // Wait for next polling interval
                    await Task.Delay(
                        TimeSpan.FromSeconds(_config.PollingIntervalSeconds),
                        stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    // Service is stopping, exit gracefully
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error in service loop");
                    _cloudWatchLogs.LogInstallation(
                        "Service",
                        $"Error in service loop: {ex.Message}",
                        LogLevel.Error);

                    // Wait a bit before retrying to avoid tight loop on persistent errors
                    await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Service is stopping
        }
        finally
        {
            _logger.LogInformation("Workstation Package Installer Service stopping...");
            _cloudWatchLogs.LogInstallation(
                "Service",
                "Workstation Package Installer Service stopped");
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Stop requested, waiting for active installations to complete...");
        
        // Give active installations up to 5 minutes to complete
        var timeout = TimeSpan.FromMinutes(5);
        var cts = new CancellationTokenSource(timeout);
        
        try
        {
            await base.StopAsync(cts.Token);
        }
        catch (OperationCanceledException)
        {
            _logger.LogWarning("Stop timeout exceeded, forcing shutdown");
        }
    }
}