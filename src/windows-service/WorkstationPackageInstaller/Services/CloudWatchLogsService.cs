using Amazon.CloudWatchLogs;
using Amazon.CloudWatchLogs.Model;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System.Collections.Concurrent;

namespace WorkstationPackageInstaller.Services;

/// <summary>
/// Service for sending installation logs to CloudWatch Logs
/// </summary>
public class CloudWatchLogsService : IDisposable
{
    private readonly ILogger<CloudWatchLogsService> _logger;
    private readonly IAmazonCloudWatchLogs _cloudWatchLogs;
    private readonly string _logGroupName;
    private readonly string _logStreamName;
    private readonly ConcurrentQueue<InputLogEvent> _logQueue;
    private readonly Timer _flushTimer;
    private readonly SemaphoreSlim _flushSemaphore;
    private bool _logStreamCreated;

    public CloudWatchLogsService(
        ILogger<CloudWatchLogsService> logger,
        IAmazonCloudWatchLogs cloudWatchLogs,
        IOptions<ServiceConfiguration> configuration)
    {
        _logger = logger;
        _cloudWatchLogs = cloudWatchLogs;
        
        var config = configuration.Value.AWS.CloudWatchLogs;
        _logGroupName = config.LogGroupName;
        
        var instanceId = GetInstanceIdFromMetadata();
        _logStreamName = $"{config.LogStreamPrefix}{instanceId}";
        
        _logQueue = new ConcurrentQueue<InputLogEvent>();
        _flushSemaphore = new SemaphoreSlim(1, 1);
        
        // Flush logs every 5 seconds
        _flushTimer = new Timer(
            async _ => await FlushLogsAsync(),
            null,
            TimeSpan.FromSeconds(5),
            TimeSpan.FromSeconds(5));
    }

    /// <summary>
    /// Log an installation event
    /// </summary>
    public void LogInstallation(string packageName, string message, LogLevel logLevel = LogLevel.Information)
    {
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var formattedMessage = $"[{logLevel}] [{packageName}] {message}";
        
        _logQueue.Enqueue(new InputLogEvent
        {
            Timestamp = timestamp,
            Message = formattedMessage
        });

        _logger.Log(logLevel, "{Package}: {Message}", packageName, message);
    }

    /// <summary>
    /// Flush queued logs to CloudWatch
    /// </summary>
    private async Task FlushLogsAsync()
    {
        if (_logQueue.IsEmpty)
            return;

        await _flushSemaphore.WaitAsync();
        List<InputLogEvent>? batch = null;
        try
        {
            // Ensure log stream exists
            if (!_logStreamCreated)
            {
                await EnsureLogStreamExistsAsync();
            }

            // Dequeue up to 100 log events (CloudWatch limit per request)
            batch = new List<InputLogEvent>();
            while (batch.Count < 100 && _logQueue.TryDequeue(out var logEvent))
            {
                batch.Add(logEvent);
            }

            if (batch.Count == 0)
                return;

            // Sort by timestamp (required by CloudWatch)
            batch = batch.OrderBy(e => e.Timestamp).ToList();

            // Send to CloudWatch (no SequenceToken — deprecated by AWS)
            var request = new PutLogEventsRequest
            {
                LogGroupName = _logGroupName,
                LogStreamName = _logStreamName,
                LogEvents = batch
            };

            await _cloudWatchLogs.PutLogEventsAsync(request);

            _logger.LogDebug("Flushed {Count} log events to CloudWatch", batch.Count);
        }
        catch (InvalidSequenceTokenException)
        {
            _logger.LogWarning("InvalidSequenceTokenException received (deprecated). Retrying without token.");
            if (batch is { Count: > 0 })
            {
                try
                {
                    var retryRequest = new PutLogEventsRequest
                    {
                        LogGroupName = _logGroupName,
                        LogStreamName = _logStreamName,
                        LogEvents = batch
                    };
                    await _cloudWatchLogs.PutLogEventsAsync(retryRequest);
                    _logger.LogDebug("Retry succeeded: flushed {Count} log events to CloudWatch", batch.Count);
                }
                catch (Exception retryEx)
                {
                    _logger.LogError(retryEx, "Retry failed, re-queuing {Count} events", batch.Count);
                    foreach (var logEvent in batch)
                    {
                        _logQueue.Enqueue(logEvent);
                    }
                }
            }
        }
        catch (ResourceNotFoundException)
        {
            _logger.LogWarning("Log stream not found, will recreate on next flush");
            _logStreamCreated = false;
            // Re-queue the failed batch
            if (batch is { Count: > 0 })
            {
                foreach (var logEvent in batch)
                {
                    _logQueue.Enqueue(logEvent);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to flush logs to CloudWatch, re-queuing {Count} events", batch?.Count ?? 0);
            // Re-queue the failed batch
            if (batch is { Count: > 0 })
            {
                foreach (var logEvent in batch)
                {
                    _logQueue.Enqueue(logEvent);
                }
            }
        }
        finally
        {
            _flushSemaphore.Release();
        }
    }

    /// <summary>
    /// Ensure log group and stream exist
    /// </summary>
    private async Task EnsureLogStreamExistsAsync()
    {
        try
        {
            // Check if log group exists, create if not
            try
            {
                await _cloudWatchLogs.DescribeLogGroupsAsync(new DescribeLogGroupsRequest
                {
                    LogGroupNamePrefix = _logGroupName
                });
            }
            catch (ResourceNotFoundException)
            {
                await _cloudWatchLogs.CreateLogGroupAsync(new CreateLogGroupRequest
                {
                    LogGroupName = _logGroupName
                });
                _logger.LogInformation("Created CloudWatch log group: {LogGroup}", _logGroupName);
            }

            // Create log stream
            await _cloudWatchLogs.CreateLogStreamAsync(new CreateLogStreamRequest
            {
                LogGroupName = _logGroupName,
                LogStreamName = _logStreamName
            });

            _logStreamCreated = true;
            
            _logger.LogInformation("Created CloudWatch log stream: {LogStream}", _logStreamName);
        }
        catch (ResourceAlreadyExistsException)
        {
            // Stream already exists, that's fine
            _logStreamCreated = true;
            _logger.LogDebug("Log stream already exists: {LogStream}", _logStreamName);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating CloudWatch log stream");
            throw;
        }
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
            return metadataResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult().Trim();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to get instance ID from IMDS, using fallback");
            return Environment.MachineName;
        }
    }

    public void Dispose()
    {
        // Flush remaining logs
        FlushLogsAsync().Wait(TimeSpan.FromSeconds(10));
        
        _flushTimer?.Dispose();
        _flushSemaphore?.Dispose();
    }
}