#------------------------------------------------------------------------------
# Portworx Enterprise Storage Submodule - Outputs
#------------------------------------------------------------------------------

output "namespace" {
  description = "Portworx namespace"
  value       = var.namespace
}

output "cluster_name" {
  description = "Portworx cluster name"
  value       = var.cluster_name
}

#------------------------------------------------------------------------------
# IAM Outputs
#------------------------------------------------------------------------------

output "iam_role_arn" {
  description = "IAM role ARN for Portworx"
  value       = try(aws_iam_role.portworx[0].arn, null)
}

output "iam_role_name" {
  description = "IAM role name for Portworx"
  value       = try(aws_iam_role.portworx[0].name, null)
}

#------------------------------------------------------------------------------
# S3 Backup Outputs
#------------------------------------------------------------------------------

output "backup_bucket_id" {
  description = "S3 bucket ID for backup"
  value       = try(aws_s3_bucket.backup[0].id, null)
}

output "backup_bucket_arn" {
  description = "S3 bucket ARN for backup"
  value       = try(aws_s3_bucket.backup[0].arn, null)
}

#------------------------------------------------------------------------------
# Helm Release Outputs
#------------------------------------------------------------------------------

output "helm_release_name" {
  description = "Helm release name"
  value       = try(helm_release.portworx_operator[0].name, null)
}

output "helm_release_version" {
  description = "Helm release version"
  value       = try(helm_release.portworx_operator[0].version, null)
}

output "helm_release_status" {
  description = "Helm release status"
  value       = try(helm_release.portworx_operator[0].status, null)
}

#------------------------------------------------------------------------------
# Storage Class Outputs
#------------------------------------------------------------------------------

output "storage_classes" {
  description = "List of created storage class names"
  value       = [for sc in kubernetes_storage_class.portworx : sc.metadata[0].name]
}

output "default_storage_class" {
  description = "Default storage class name"
  value       = var.default_storage_class
}

#------------------------------------------------------------------------------
# CloudWatch Outputs
#------------------------------------------------------------------------------

output "cloudwatch_dashboard_name" {
  description = "CloudWatch dashboard name"
  value       = try(aws_cloudwatch_dashboard.portworx[0].dashboard_name, null)
}

#------------------------------------------------------------------------------
# Configuration Outputs
#------------------------------------------------------------------------------

output "portworx_version" {
  description = "Portworx version"
  value       = var.portworx_version
}

output "license_type" {
  description = "License type"
  value       = var.license_type
}

output "storage_device_size_gb" {
  description = "Storage device size in GB"
  value       = var.storage_device_size_gb
}

output "features_enabled" {
  description = "Map of enabled features"
  value = {
    stork       = var.enable_stork
    lighthouse  = var.enable_lighthouse
    autopilot   = var.enable_autopilot
    csi         = var.enable_csi
    security    = var.enable_security
    prometheus  = var.enable_prometheus
    backup      = var.enable_backup
  }
}

#------------------------------------------------------------------------------
# Usage Instructions
#------------------------------------------------------------------------------

output "pvc_example" {
  description = "Example PVC manifest"
  value = <<-EOT
    # Example PersistentVolumeClaim using Portworx
    apiVersion: v1
    kind: PersistentVolumeClaim
    metadata:
      name: my-pvc
    spec:
      storageClassName: ${var.default_storage_class}
      accessModes:
        - ReadWriteOnce
      resources:
        requests:
          storage: 10Gi
  EOT
}

output "statefulset_example" {
  description = "Example StatefulSet with Portworx storage"
  value = <<-EOT
    # Example StatefulSet using Portworx
    apiVersion: apps/v1
    kind: StatefulSet
    metadata:
      name: my-statefulset
    spec:
      serviceName: my-service
      replicas: 3
      selector:
        matchLabels:
          app: my-app
      template:
        metadata:
          labels:
            app: my-app
        spec:
          containers:
          - name: my-container
            image: my-image
            volumeMounts:
            - name: data
              mountPath: /data
      volumeClaimTemplates:
      - metadata:
          name: data
        spec:
          storageClassName: ${var.default_storage_class}
          accessModes: ["ReadWriteOnce"]
          resources:
            requests:
              storage: 10Gi
  EOT
}