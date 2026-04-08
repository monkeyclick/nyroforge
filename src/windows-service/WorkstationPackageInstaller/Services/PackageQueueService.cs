using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System.Text.Json;
using WorkstationPackageInstaller.Models;

namespace WorkstationPackageInstaller.Services;

/// <summary>
/// Service for interacting with the DynamoDB package queue
/// </summary>
public class PackageQueueService
{
    private readonly ILogger<PackageQueueService> _logger;
    private readonly IAmazonDynamoDB _dynamoDb;
    private readonly string _tableName;
    private readonly string _instanceId;

    public PackageQueueService(
        ILogger<PackageQueueService> logger,
        IAmazonDynamoDB dynamoDb,
        IOptions<ServiceConfiguration> configuration)
    {
        _logger = logger;
        _dynamoDb = dynamoDb;
        _tableName = configuration.Value.AWS.DynamoDB.PackageQueueTableName;
        _instanceId = GetInstanceIdFromMetadata();
    }

    /// <summary>
    /// Get pending packages for this workstation
    /// </summary>
    public async Task<List<PackageQueueItem>> GetPendingPackagesAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var pk = $"workstation#{_instanceId}";

            var request = new QueryRequest
            {
                TableName = _tableName,
                KeyConditionExpression = "PK = :pk",
                FilterExpression = "#status = :pending",
                ExpressionAttributeNames = new Dictionary<string, string>
                {
                    { "#status", "status" }
                },
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    { ":pk", new AttributeValue { S = pk } },
                    { ":pending", new AttributeValue { S = "pending" } }
                }
            };

            var response = await _dynamoDb.QueryAsync(request, cancellationToken);
            
            var packages = response.Items
                .Select(MapToPackageQueueItem)
                .OrderBy(p => p.InstallOrder)
                .ToList();

            _logger.LogDebug("Found {Count} pending packages", packages.Count);
            return packages;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting pending packages from DynamoDB");
            throw;
        }
    }

    /// <summary>
    /// Update package status to "installing"
    /// </summary>
    public async Task MarkAsInstallingAsync(PackageQueueItem package, CancellationToken cancellationToken = default)
    {
        try
        {
            var request = new UpdateItemRequest
            {
                TableName = _tableName,
                Key = new Dictionary<string, AttributeValue>
                {
                    { "PK", new AttributeValue { S = package.PK } },
                    { "SK", new AttributeValue { S = package.SK } }
                },
                UpdateExpression = "SET #status = :installing, lastAttemptAt = :now, retryCount = :retryCount",
                ExpressionAttributeNames = new Dictionary<string, string>
                {
                    { "#status", "status" }
                },
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    { ":installing", new AttributeValue { S = "installing" } },
                    { ":now", new AttributeValue { S = DateTime.UtcNow.ToString("O") } },
                    { ":retryCount", new AttributeValue { N = package.RetryCount.ToString() } }
                }
            };

            await _dynamoDb.UpdateItemAsync(request, cancellationToken);
            _logger.LogInformation("Marked package {PackageName} as installing", package.PackageName);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error marking package {PackageName} as installing", package.PackageName);
            throw;
        }
    }

    /// <summary>
    /// Update package status to "completed"
    /// </summary>
    public async Task MarkAsCompletedAsync(
        PackageQueueItem package,
        int durationSeconds,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var request = new UpdateItemRequest
            {
                TableName = _tableName,
                Key = new Dictionary<string, AttributeValue>
                {
                    { "PK", new AttributeValue { S = package.PK } },
                    { "SK", new AttributeValue { S = package.SK } }
                },
                UpdateExpression = "SET #status = :completed, installedAt = :now, installDurationSeconds = :duration",
                ExpressionAttributeNames = new Dictionary<string, string>
                {
                    { "#status", "status" }
                },
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    { ":completed", new AttributeValue { S = "completed" } },
                    { ":now", new AttributeValue { S = DateTime.UtcNow.ToString("O") } },
                    { ":duration", new AttributeValue { N = durationSeconds.ToString() } }
                }
            };

            await _dynamoDb.UpdateItemAsync(request, cancellationToken);
            _logger.LogInformation("Marked package {PackageName} as completed in {Duration}s", 
                package.PackageName, durationSeconds);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error marking package {PackageName} as completed", package.PackageName);
            throw;
        }
    }

    /// <summary>
    /// Update package status to "failed"
    /// </summary>
    public async Task MarkAsFailedAsync(
        PackageQueueItem package,
        string errorMessage,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var request = new UpdateItemRequest
            {
                TableName = _tableName,
                Key = new Dictionary<string, AttributeValue>
                {
                    { "PK", new AttributeValue { S = package.PK } },
                    { "SK", new AttributeValue { S = package.SK } }
                },
                UpdateExpression = "SET #status = :failed, errorMessage = :error, retryCount = :retryCount",
                ExpressionAttributeNames = new Dictionary<string, string>
                {
                    { "#status", "status" }
                },
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    { ":failed", new AttributeValue { S = "failed" } },
                    { ":error", new AttributeValue { S = errorMessage } },
                    { ":retryCount", new AttributeValue { N = package.RetryCount.ToString() } }
                }
            };

            await _dynamoDb.UpdateItemAsync(request, cancellationToken);
            _logger.LogWarning("Marked package {PackageName} as failed: {Error}", 
                package.PackageName, errorMessage);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error marking package {PackageName} as failed", package.PackageName);
            throw;
        }
    }

    /// <summary>
    /// Update package status to "skipped"
    /// </summary>
    public async Task MarkAsSkippedAsync(
        PackageQueueItem package,
        string reason,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var request = new UpdateItemRequest
            {
                TableName = _tableName,
                Key = new Dictionary<string, AttributeValue>
                {
                    { "PK", new AttributeValue { S = package.PK } },
                    { "SK", new AttributeValue { S = package.SK } }
                },
                UpdateExpression = "SET #status = :skipped, errorMessage = :reason",
                ExpressionAttributeNames = new Dictionary<string, string>
                {
                    { "#status", "status" }
                },
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    { ":skipped", new AttributeValue { S = "skipped" } },
                    { ":reason", new AttributeValue { S = reason } }
                }
            };

            await _dynamoDb.UpdateItemAsync(request, cancellationToken);
            _logger.LogInformation("Marked package {PackageName} as skipped: {Reason}", 
                package.PackageName, reason);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error marking package {PackageName} as skipped", package.PackageName);
            throw;
        }
    }

    /// <summary>
    /// Update package status to "pending" for retry
    /// </summary>
    public async Task MarkAsPendingAsync(
        PackageQueueItem package,
        string retryReason,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var request = new UpdateItemRequest
            {
                TableName = _tableName,
                Key = new Dictionary<string, AttributeValue>
                {
                    { "PK", new AttributeValue { S = package.PK } },
                    { "SK", new AttributeValue { S = package.SK } }
                },
                UpdateExpression = "SET #status = :pending, errorMessage = :reason, retryCount = :retryCount",
                ExpressionAttributeNames = new Dictionary<string, string>
                {
                    { "#status", "status" }
                },
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    { ":pending", new AttributeValue { S = "pending" } },
                    { ":reason", new AttributeValue { S = retryReason } },
                    { ":retryCount", new AttributeValue { N = package.RetryCount.ToString() } }
                }
            };

            await _dynamoDb.UpdateItemAsync(request, cancellationToken);
            _logger.LogInformation("Marked package {PackageName} as pending for retry: {Reason}",
                package.PackageName, retryReason);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error marking package {PackageName} as pending", package.PackageName);
            throw;
        }
    }

    /// <summary>
    /// Map DynamoDB item to PackageQueueItem
    /// </summary>
    private PackageQueueItem MapToPackageQueueItem(Dictionary<string, AttributeValue> item)
    {
        return new PackageQueueItem
        {
            PK = item["PK"].S,
            SK = item["SK"].S,
            PackageId = item["packageId"].S,
            PackageName = item["packageName"].S,
            DownloadUrl = item["downloadUrl"].S,
            InstallCommand = item["installCommand"].S,
            InstallArgs = item.ContainsKey("installArgs") ? item["installArgs"].S : null,
            Status = Enum.Parse<PackageStatus>(item["status"].S, true),
            InstallOrder = int.Parse(item["installOrder"].N),
            Required = item.ContainsKey("required") && item["required"].BOOL,
            RetryCount = item.ContainsKey("retryCount") ? int.Parse(item["retryCount"].N) : 0,
            MaxRetries = item.ContainsKey("maxRetries") ? int.Parse(item["maxRetries"].N) : 3,
            LastAttemptAt = item.ContainsKey("lastAttemptAt") ? DateTime.Parse(item["lastAttemptAt"].S) : null,
            InstalledAt = item.ContainsKey("installedAt") ? DateTime.Parse(item["installedAt"].S) : null,
            ErrorMessage = item.ContainsKey("errorMessage") ? item["errorMessage"].S : null,
            InstallDurationSeconds = item.ContainsKey("installDurationSeconds") ? int.Parse(item["installDurationSeconds"].N) : null,
            CreatedAt = DateTime.Parse(item["createdAt"].S),
            CreatedBy = item["createdBy"].S,
            GroupId = item.ContainsKey("groupId") ? item["groupId"].S : null,
            Ttl = item.ContainsKey("ttl") ? long.Parse(item["ttl"].N) : null
        };
    }

    /// <summary>
    /// Get EC2 instance ID from metadata service (IMDSv2)
    /// </summary>
    private string GetInstanceIdFromMetadata()
    {
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };

            // IMDSv2: First get a token
            var tokenRequest = new HttpRequestMessage(HttpMethod.Put, "http://169.254.169.254/latest/api/token");
            tokenRequest.Headers.Add("X-aws-ec2-metadata-token-ttl-seconds", "21600");
            var tokenResponse = client.SendAsync(tokenRequest).GetAwaiter().GetResult();
            var token = tokenResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult();

            // IMDSv2: Use token to get instance ID
            var metadataRequest = new HttpRequestMessage(HttpMethod.Get, "http://169.254.169.254/latest/meta-data/instance-id");
            metadataRequest.Headers.Add("X-aws-ec2-metadata-token", token);
            var metadataResponse = client.SendAsync(metadataRequest).GetAwaiter().GetResult();
            var instanceId = metadataResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult().Trim();

            _logger.LogInformation("Retrieved instance ID from metadata: {InstanceId}", instanceId);
            return instanceId;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to get instance ID from IMDS, using fallback");
            return Environment.MachineName;
        }
    }
}

/// <summary>
/// AWS configuration
/// </summary>
public class AWSConfiguration
{
    public string Region { get; set; } = "us-west-2";
    public DynamoDBConfiguration DynamoDB { get; set; } = new();
    public CloudWatchLogsConfiguration CloudWatchLogs { get; set; } = new();
}

public class DynamoDBConfiguration
{
    public string PackageQueueTableName { get; set; } = "WorkstationPackageQueue";
    public string BootstrapPackagesTableName { get; set; } = "WorkstationBootstrapPackages";
}

public class CloudWatchLogsConfiguration
{
    public string LogGroupName { get; set; } = "/aws/workstation/package-installer";
    public string LogStreamPrefix { get; set; } = "workstation-";
}