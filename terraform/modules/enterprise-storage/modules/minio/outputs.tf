#------------------------------------------------------------------------------
# MinIO S3-Compatible Object Storage Submodule - Outputs
#------------------------------------------------------------------------------

output "deployment_name" {
  description = "MinIO deployment name"
  value       = var.deployment_name
}

output "namespace" {
  description = "MinIO namespace"
  value       = var.namespace
}

#------------------------------------------------------------------------------
# Helm Release Outputs
#------------------------------------------------------------------------------

output "helm_release_name" {
  description = "Helm release name"
  value       = try(helm_release.minio[0].name, null)
}

output "helm_release_version" {
  description = "Helm release version"
  value       = try(helm_release.minio[0].version, null)
}

output "helm_release_status" {
  description = "Helm release status"
  value       = try(helm_release.minio[0].status, null)
}

#------------------------------------------------------------------------------
# Endpoint Outputs
#------------------------------------------------------------------------------

output "endpoint" {
  description = "MinIO endpoint URL"
  value       = var.enabled ? "${var.enable_tls ? "https" : "http"}://${var.deployment_name}.${var.namespace}.svc.cluster.local:9000" : null
}

output "console_endpoint" {
  description = "MinIO Console endpoint URL"
  value       = var.enabled && var.enable_console ? "${var.enable_tls ? "https" : "http"}://${var.deployment_name}.${var.namespace}.svc.cluster.local:${var.console_port}" : null
}

output "internal_service_name" {
  description = "Internal Kubernetes service name"
  value       = var.enabled ? "${var.deployment_name}.${var.namespace}.svc.cluster.local" : null
}

#------------------------------------------------------------------------------
# Credential Outputs
#------------------------------------------------------------------------------

output "credentials_secret_name" {
  description = "Name of the Kubernetes secret containing credentials"
  value       = try(kubernetes_secret.minio_credentials[0].metadata[0].name, null)
}

output "root_user" {
  description = "Root user name"
  value       = var.root_user
}

output "root_password" {
  description = "Root password (from variable or generated)"
  value       = var.root_password != null ? var.root_password : try(random_password.root_password[0].result, null)
  sensitive   = true
}

#------------------------------------------------------------------------------
# TLS Outputs
#------------------------------------------------------------------------------

output "tls_enabled" {
  description = "Whether TLS is enabled"
  value       = var.enable_tls
}

output "tls_secret_name" {
  description = "Name of the TLS secret"
  value       = var.enable_tls ? (var.certificate_secret != null ? var.certificate_secret : try(kubernetes_secret.minio_tls[0].metadata[0].name, null)) : null
}

#------------------------------------------------------------------------------
# Bucket Outputs
#------------------------------------------------------------------------------

output "buckets" {
  description = "List of created bucket names"
  value       = [for b in var.buckets : b.name]
}

#------------------------------------------------------------------------------
# SSM Parameter Outputs
#------------------------------------------------------------------------------

output "endpoint_ssm_parameter" {
  description = "SSM parameter name for MinIO endpoint"
  value       = try(aws_ssm_parameter.minio_endpoint[0].name, null)
}

output "credentials_ssm_parameter" {
  description = "SSM parameter name for MinIO credentials"
  value       = try(aws_ssm_parameter.minio_credentials[0].name, null)
}

#------------------------------------------------------------------------------
# CloudWatch Outputs
#------------------------------------------------------------------------------

output "cloudwatch_dashboard_name" {
  description = "CloudWatch dashboard name"
  value       = try(aws_cloudwatch_dashboard.minio[0].dashboard_name, null)
}

#------------------------------------------------------------------------------
# Configuration Outputs
#------------------------------------------------------------------------------

output "deployment_mode" {
  description = "Deployment mode"
  value       = var.deployment_mode
}

output "replicas" {
  description = "Number of replicas"
  value       = var.replicas
}

output "total_storage_gb" {
  description = "Total storage capacity in GB"
  value       = var.replicas * var.drives_per_node * var.storage_size_gb
}

#------------------------------------------------------------------------------
# Connection Examples
#------------------------------------------------------------------------------

output "aws_cli_configuration" {
  description = "AWS CLI configuration for MinIO"
  value = <<-EOT
    # Configure AWS CLI for MinIO
    aws configure set aws_access_key_id ${var.root_user} --profile minio
    aws configure set aws_secret_access_key <your-secret-key> --profile minio
    aws configure set region us-east-1 --profile minio
    
    # Use with endpoint URL
    aws --endpoint-url ${var.enable_tls ? "https" : "http"}://<minio-host>:9000 s3 ls --profile minio
  EOT
}

output "mc_client_configuration" {
  description = "MinIO Client (mc) configuration"
  value = <<-EOT
    # Configure MinIO Client
    mc alias set myminio ${var.enable_tls ? "https" : "http"}://<minio-host>:9000 ${var.root_user} <your-secret-key>
    
    # List buckets
    mc ls myminio
    
    # Create bucket
    mc mb myminio/mybucket
    
    # Copy files
    mc cp myfile.txt myminio/mybucket/
  EOT
}

output "sdk_configuration_python" {
  description = "Python SDK configuration example"
  value = <<-EOT
    # Python (boto3) configuration for MinIO
    import boto3
    from botocore.client import Config
    
    s3 = boto3.client(
        's3',
        endpoint_url='${var.enable_tls ? "https" : "http"}://<minio-host>:9000',
        aws_access_key_id='${var.root_user}',
        aws_secret_access_key='<your-secret-key>',
        config=Config(signature_version='s3v4'),
        region_name='us-east-1'
    )
    
    # List buckets
    response = s3.list_buckets()
    print(response['Buckets'])
  EOT
}