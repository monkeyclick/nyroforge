namespace WorkstationPackageInstaller.Models;

/// <summary>
/// Represents a package in the installation queue
/// </summary>
public class PackageQueueItem
{
    /// <summary>
    /// Partition key: workstation#<instanceId>
    /// </summary>
    public string PK { get; set; } = string.Empty;

    /// <summary>
    /// Sort key: package#<packageId>#<sequence>
    /// </summary>
    public string SK { get; set; } = string.Empty;

    /// <summary>
    /// Package identifier
    /// </summary>
    public string PackageId { get; set; } = string.Empty;

    /// <summary>
    /// Display name of the package
    /// </summary>
    public string PackageName { get; set; } = string.Empty;

    /// <summary>
    /// Download URL for the package installer
    /// </summary>
    public string DownloadUrl { get; set; } = string.Empty;

    /// <summary>
    /// Installation command (e.g., msiexec, powershell, cmd)
    /// </summary>
    public string InstallCommand { get; set; } = string.Empty;

    /// <summary>
    /// Arguments for the install command
    /// </summary>
    public string? InstallArgs { get; set; }

    /// <summary>
    /// Current installation status
    /// </summary>
    public PackageStatus Status { get; set; } = PackageStatus.Pending;

    /// <summary>
    /// Installation order (lower numbers install first)
    /// </summary>
    public int InstallOrder { get; set; }

    /// <summary>
    /// Whether this package is required (installation failure blocks subsequent packages)
    /// </summary>
    public bool Required { get; set; }

    /// <summary>
    /// Number of times installation has been attempted
    /// </summary>
    public int RetryCount { get; set; }

    /// <summary>
    /// Maximum number of retry attempts
    /// </summary>
    public int MaxRetries { get; set; } = 3;

    /// <summary>
    /// Timestamp of last installation attempt
    /// </summary>
    public DateTime? LastAttemptAt { get; set; }

    /// <summary>
    /// Timestamp when installation completed successfully
    /// </summary>
    public DateTime? InstalledAt { get; set; }

    /// <summary>
    /// Error message from last failed attempt
    /// </summary>
    public string? ErrorMessage { get; set; }

    /// <summary>
    /// Duration of installation in seconds
    /// </summary>
    public int? InstallDurationSeconds { get; set; }

    /// <summary>
    /// Timestamp when queue item was created
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// User who created the queue item
    /// </summary>
    public string CreatedBy { get; set; } = string.Empty;

    /// <summary>
    /// Group ID associated with this package
    /// </summary>
    public string? GroupId { get; set; }

    /// <summary>
    /// TTL timestamp for automatic deletion
    /// </summary>
    public long? Ttl { get; set; }

    /// <summary>
    /// Get the instance ID from the partition key
    /// </summary>
    public string GetInstanceId()
    {
        return PK.Replace("workstation#", "");
    }

    /// <summary>
    /// Check if package can be retried
    /// </summary>
    public bool CanRetry()
    {
        return RetryCount < MaxRetries;
    }
}

/// <summary>
/// Package installation status
/// </summary>
public enum PackageStatus
{
    Pending,
    Installing,
    Completed,
    Failed,
    Skipped
}