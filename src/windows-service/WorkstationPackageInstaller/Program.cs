using Amazon.CloudWatchLogs;
using Amazon.DynamoDBv2;
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