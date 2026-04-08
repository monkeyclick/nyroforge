using System.Diagnostics;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace WorkstationPackageInstaller.Services;

/// <summary>
/// Monitors system resources (CPU, Memory, Disk I/O) to ensure installations don't overload the system
/// </summary>
public class ResourceMonitor : IDisposable
{
    private readonly ILogger<ResourceMonitor> _logger;
    private readonly ResourceMonitoringConfig _config;
    private readonly PerformanceCounter? _cpuCounter;
    private readonly PerformanceCounter? _memoryCounter;

    public ResourceMonitor(
        ILogger<ResourceMonitor> logger,
        IOptions<ServiceConfiguration> configuration)
    {
        _logger = logger;
        _config = configuration.Value.ResourceMonitoring;

        try
        {
            // Initialize performance counters
            _cpuCounter = new PerformanceCounter("Processor", "% Processor Time", "_Total", true);
            _memoryCounter = new PerformanceCounter("Memory", "% Committed Bytes In Use", true);

            // Prime the counters (first call returns 0)
            _cpuCounter.NextValue();
            _memoryCounter.NextValue();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to initialize performance counters. Resource monitoring will be limited.");
        }
    }

    /// <summary>
    /// Check if system resources are within acceptable thresholds for starting a new installation
    /// </summary>
    public async Task<ResourceStatus> CheckResourceAvailability()
    {
        try
        {
            var cpuUsage = GetCpuUsage();
            var memoryUsage = GetMemoryUsage();
            var diskIOUsage = await GetDiskIOUsageAsync();

            var status = new ResourceStatus
            {
                CpuUsagePercent = cpuUsage,
                MemoryUsagePercent = memoryUsage,
                DiskIOUsagePercent = diskIOUsage,
                IsAvailable = cpuUsage < _config.CpuThresholdPercent &&
                             memoryUsage < _config.MemoryThresholdPercent &&
                             diskIOUsage < _config.DiskIOThresholdPercent
            };

            if (!status.IsAvailable)
            {
                _logger.LogDebug(
                    "System resources above threshold. CPU: {Cpu}%, Memory: {Memory}%, DiskIO: {DiskIO}%",
                    cpuUsage, memoryUsage, diskIOUsage);
            }

            return status;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error checking resource availability");
            // Return available status to prevent blocking installations
            return new ResourceStatus { IsAvailable = true };
        }
    }

    /// <summary>
    /// Get current CPU usage percentage
    /// </summary>
    private float GetCpuUsage()
    {
        try
        {
            if (_cpuCounter == null)
                return 0;

            // Wait briefly to get accurate reading
            Thread.Sleep(100);
            return _cpuCounter.NextValue();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to get CPU usage");
            return 0;
        }
    }

    /// <summary>
    /// Get current memory usage percentage
    /// </summary>
    private float GetMemoryUsage()
    {
        try
        {
            if (_memoryCounter == null)
            {
                // Fallback to GC memory info
                var gcMemInfo = GC.GetGCMemoryInfo();
                return (float)(gcMemInfo.HeapSizeBytes * 100.0 / gcMemInfo.TotalAvailableMemoryBytes);
            }

            return _memoryCounter.NextValue();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to get memory usage");
            return 0;
        }
    }

    /// <summary>
    /// Get current disk I/O usage percentage
    /// </summary>
    private async Task<float> GetDiskIOUsageAsync()
    {
        try
        {
            // Get disk I/O counters for C: drive
            using var diskCounter = new PerformanceCounter(
                "PhysicalDisk",
                "% Disk Time",
                "_Total",
                true);

            // Prime the counter
            diskCounter.NextValue();
            await Task.Delay(100);

            return diskCounter.NextValue();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to get disk I/O usage");
            return 0;
        }
    }

    /// <summary>
    /// Log current system resource usage
    /// </summary>
    public void LogResourceUsage()
    {
        try
        {
            var cpu = GetCpuUsage();
            var memory = GetMemoryUsage();

            _logger.LogInformation(
                "System Resources - CPU: {Cpu:F1}%, Memory: {Memory:F1}%",
                cpu, memory);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to log resource usage");
        }
    }

    public void Dispose()
    {
        _cpuCounter?.Dispose();
        _memoryCounter?.Dispose();
    }
}

/// <summary>
/// Resource monitoring configuration
/// </summary>
public class ResourceMonitoringConfig
{
    public int CpuThresholdPercent { get; set; } = 80;
    public int MemoryThresholdPercent { get; set; } = 85;
    public int DiskIOThresholdPercent { get; set; } = 90;
    public int CheckIntervalSeconds { get; set; } = 10;
}

/// <summary>
/// Current resource status
/// </summary>
public class ResourceStatus
{
    public float CpuUsagePercent { get; set; }
    public float MemoryUsagePercent { get; set; }
    public float DiskIOUsagePercent { get; set; }
    public bool IsAvailable { get; set; }
}

/// <summary>
/// Service configuration
/// </summary>
public class ServiceConfiguration
{
    public int PollingIntervalSeconds { get; set; } = 30;
    public int MaxConcurrentInstallations { get; set; } = 3;
    public int MaxRetries { get; set; } = 3;
    public int RetryDelaySeconds { get; set; } = 60;
    public int InstallTimeoutMinutes { get; set; } = 30;
    public ResourceMonitoringConfig ResourceMonitoring { get; set; } = new();
    public AWSConfiguration AWS { get; set; } = new();
}