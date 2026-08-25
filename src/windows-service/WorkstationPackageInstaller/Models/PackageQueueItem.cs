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
    /// Where the installer bytes come from: "url" for an HTTPS download,
    /// "s3" for an object fetched with the instance's own credentials.
    /// Absent on queue items written before uploads existed, which are URLs.
    /// </summary>
    public string? Source { get; set; }

    /// <summary>
    /// Download URL for the package installer. Empty for S3-sourced packages.
    /// </summary>
    public string DownloadUrl { get; set; } = string.Empty;

    /// <summary>
    /// Bucket holding the installer when <see cref="Source"/> is "s3".
    /// </summary>
    public string? S3Bucket { get; set; }

    /// <summary>
    /// Object key of the installer when <see cref="Source"/> is "s3".
    /// </summary>
    public string? S3Key { get; set; }

    /// <summary>
    /// True when this item should be fetched from S3 rather than over HTTP.
    /// </summary>
    public bool IsS3Source =>
        !string.IsNullOrWhiteSpace(S3Bucket) && !string.IsNullOrWhiteSpace(S3Key);

    /// <summary>
    /// Expected SHA-256 hash (hex) of the downloaded installer, used to verify
    /// integrity before execution. Null when the queue item does not supply one.
    /// </summary>
    public string? ExpectedSha256 { get; set; }

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
    /// Get the instance ID from the partition key.
    ///
    /// The key is `workstation#{instanceArn}` since the queue was re-keyed so
    /// the instance role could be scoped by `${ec2:SourceInstanceARN}`; the
    /// instance id is the last ARN segment. Rows predating that change hold a
    /// bare instance id, which the same parse returns unchanged.
    /// </summary>
    public string GetInstanceId()
    {
        var value = PK.Replace("workstation#", string.Empty);
        var slash = value.LastIndexOf('/');
        return slash >= 0 ? value[(slash + 1)..] : value;
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