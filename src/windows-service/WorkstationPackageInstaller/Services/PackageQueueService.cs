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
    private readonly string _partitionKey;

    /// <summary>
    /// Capability version of this installer service, written onto every queue
    /// row it touches. 2.0.0 is the first version that can fetch a package from
    /// S3 with instance-profile credentials; earlier versions only understand
    /// downloadUrl and would fail on an uploaded package.
    /// </summary>
    public const string ServiceVersion = "2.0.0";

    public PackageQueueService(
        ILogger<PackageQueueService> logger,
        IAmazonDynamoDB dynamoDb,
        IOptions<ServiceConfiguration> configuration)
    {
        _logger = logger;
        _dynamoDb = dynamoDb;
        _tableName = configuration.Value.AWS.DynamoDB.PackageQueueTableName;
        var identity = GetInstanceIdentityFromMetadata();
        _instanceId = identity.InstanceId;
        _partitionKey = BuildPartitionKey(identity);
    }

    /// <summary>
    /// Partition key for this instance's queue.
    ///
    /// The key is the instance ARN, not the bare instance id, because the
    /// workstation instance role scopes DynamoDB access with a
    /// `dynamodb:LeadingKeys` condition on `${ec2:SourceInstanceARN}` — the only
    /// IAM condition key that identifies the calling instance, and one that
    /// expands to a full ARN. Any other key shape makes that condition
    /// unmatchable, and a policy variable that fails to resolve denies the
    /// request rather than ignoring the condition.
    ///
    /// Falls back to the bare instance id when the identity document is
    /// unavailable, which matches how rows were keyed before this change.
    /// </summary>
    private static string BuildPartitionKey(InstanceIdentity identity)
    {
        if (string.IsNullOrEmpty(identity.Region) || string.IsNullOrEmpty(identity.AccountId))
        {
            return $"workstation#{identity.InstanceId}";
        }

        return $"workstation#arn:aws:ec2:{identity.Region}:{identity.AccountId}:instance/{identity.InstanceId}";
    }

    /// <summary>
    /// Get pending packages for this workstation
    /// </summary>
    public async Task<List<PackageQueueItem>> GetPendingPackagesAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var pk = _partitionKey;

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

            _logger.LogDebug(
                "Polling package queue for {InstanceId} (partition {PartitionKey})",
                _instanceId, _partitionKey);

            var response = await _dynamoDb.QueryAsync(request, cancellationToken);
            
            // Belt and braces alongside AWSConfigs.InitializeCollections in
            // Program.cs: in SDK v4 an empty result set yields a null Items
            // rather than an empty list.
            var packages = (response.Items ?? new List<Dictionary<string, AttributeValue>>())
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
                // installerVersion lets the approve handler in
                // package-upload-service tell whether the fleet is new enough
                // to understand S3-sourced packages before one is published.
                UpdateExpression = "SET #status = :installing, lastAttemptAt = :now, retryCount = :retryCount, installerVersion = :version",
                ExpressionAttributeNames = new Dictionary<string, string>
                {
                    { "#status", "status" }
                },
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    { ":installing", new AttributeValue { S = "installing" } },
                    { ":now", new AttributeValue { S = DateTime.UtcNow.ToString("O") } },
                    { ":retryCount", new AttributeValue { N = package.RetryCount.ToString() } },
                    { ":version", new AttributeValue { S = ServiceVersion } }
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
            Source = item.ContainsKey("source") ? item["source"].S : null,
            DownloadUrl = item.ContainsKey("downloadUrl") ? item["downloadUrl"].S : string.Empty,
            S3Bucket = item.ContainsKey("s3Bucket") ? item["s3Bucket"].S : null,
            S3Key = item.ContainsKey("s3Key") ? item["s3Key"].S : null,
            ExpectedSha256 = item.ContainsKey("expectedSha256") ? item["expectedSha256"].S : null,
            InstallCommand = item["installCommand"].S,
            InstallArgs = item.ContainsKey("installArgs") ? item["installArgs"].S : null,
            Status = Enum.Parse<PackageStatus>(item["status"].S, true),
            InstallOrder = int.Parse(item["installOrder"].N),
            // AttributeValue.BOOL is bool? in SDK v4 (value types became
            // nullable), so it cannot be used directly as a bool operand.
            Required = item.ContainsKey("required") && item["required"].BOOL == true,
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
    /// Identity of the instance this service is running on.
    /// </summary>
    private sealed record InstanceIdentity(string InstanceId, string Region, string AccountId);

    /// <summary>
    /// Read instance id, region and account id from IMDSv2.
    ///
    /// The instance identity document carries all three in one request, which
    /// is what lets the queue partition key be built as a full instance ARN.
    /// </summary>
    private InstanceIdentity GetInstanceIdentityFromMetadata()
    {
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };

            // IMDSv2: First get a token
            var tokenRequest = new HttpRequestMessage(HttpMethod.Put, "http://169.254.169.254/latest/api/token");
            tokenRequest.Headers.Add("X-aws-ec2-metadata-token-ttl-seconds", "21600");
            var tokenResponse = client.SendAsync(tokenRequest).GetAwaiter().GetResult();
            var token = tokenResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult();

            var documentRequest = new HttpRequestMessage(
                HttpMethod.Get,
                "http://169.254.169.254/latest/dynamic/instance-identity/document");
            documentRequest.Headers.Add("X-aws-ec2-metadata-token", token);
            var documentResponse = client.SendAsync(documentRequest).GetAwaiter().GetResult();
            var json = documentResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult();

            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            var instanceId = root.GetProperty("instanceId").GetString() ?? string.Empty;
            var region = root.GetProperty("region").GetString() ?? string.Empty;
            var accountId = root.GetProperty("accountId").GetString() ?? string.Empty;

            _logger.LogInformation(
                "Retrieved instance identity from metadata: {InstanceId} in {Region}",
                instanceId, region);

            return new InstanceIdentity(instanceId, region, accountId);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to get instance identity from IMDS, using fallback");
            return new InstanceIdentity(Environment.MachineName, string.Empty, string.Empty);
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