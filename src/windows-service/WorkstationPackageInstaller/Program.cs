using Amazon;
using Amazon.CloudWatchLogs;
using Amazon.DynamoDBv2;
using Amazon.S3;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using WorkstationPackageInstaller.Services;

namespace WorkstationPackageInstaller;

public class Program
{
    public static void Main(string[] args)
    {
        // AWS SDK for .NET v4 leaves response collections null by default where
        // v3 initialised them to empty ones. Restoring the v3 behaviour makes
        // every `response.Items`-style read across this service safe rather
        // than relying on having found each one by inspection.
        AWSConfigs.InitializeCollections = true;

        CreateHostBuilder(args).Build().Run();
    }

    public static IHostBuilder CreateHostBuilder(string[] args) =>
        Host.CreateDefaultBuilder(args)
            .UseWindowsService(options =>
            {
                options.ServiceName = "WorkstationPackageInstaller";
            })
            .ConfigureAppConfiguration((context, config) =>
            {
                config.AddJsonFile("appsettings.json", optional: false, reloadOnChange: true);
                config.AddEnvironmentVariables();
            })
            .ConfigureServices((hostContext, services) =>
            {
                // Configuration
                services.Configure<ServiceConfiguration>(
                    hostContext.Configuration.GetSection("ServiceConfiguration"));
                
                var awsConfig = hostContext.Configuration.GetSection("AWS").Get<AWSConfiguration>()
                    ?? new AWSConfiguration();

                services.AddSingleton(awsConfig);

                // Security configuration (download host allowlist + hash enforcement)
                var securityConfig = hostContext.Configuration.GetSection("Security").Get<SecurityConfiguration>()
                    ?? new SecurityConfiguration();

                services.AddSingleton(securityConfig);

                // AWS Services
                services.AddSingleton<IAmazonDynamoDB>(sp =>
                {
                    var config = new AmazonDynamoDBConfig
                    {
                        RegionEndpoint = Amazon.RegionEndpoint.GetBySystemName(awsConfig.Region)
                    };
                    return new AmazonDynamoDBClient(config);
                });

                services.AddSingleton<IAmazonCloudWatchLogs>(sp =>
                {
                    var config = new AmazonCloudWatchLogsConfig
                    {
                        RegionEndpoint = Amazon.RegionEndpoint.GetBySystemName(awsConfig.Region)
                    };
                    return new AmazonCloudWatchLogsClient(config);
                });

                // Resolves instance profile credentials automatically; used to
                // fetch admin-uploaded installers from the packages bucket.
                services.AddSingleton<IAmazonS3>(sp =>
                {
                    var config = new AmazonS3Config
                    {
                        RegionEndpoint = Amazon.RegionEndpoint.GetBySystemName(awsConfig.Region)
                    };
                    return new AmazonS3Client(config);
                });

                // HTTP Client
                services.AddHttpClient();

                // Application Services
                services.AddSingleton<PackageQueueService>();
                services.AddSingleton<CloudWatchLogsService>();
                services.AddSingleton<ResourceMonitor>();
                services.AddSingleton<PackageInstallerService>();
                services.AddSingleton<ParallelInstallationManager>();

                // Background Worker
                services.AddHostedService<Worker>();
            })
            .ConfigureLogging((context, logging) =>
            {
                logging.ClearProviders();
                logging.AddConsole();
                logging.AddEventLog(settings =>
                {
                    settings.SourceName = "WorkstationPackageInstaller";
                });
                
                // Set log levels from configuration
                logging.AddConfiguration(context.Configuration.GetSection("Logging"));
            });
}