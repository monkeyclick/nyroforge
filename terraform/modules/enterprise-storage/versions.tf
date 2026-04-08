#------------------------------------------------------------------------------
# Enterprise Storage Module - Provider Version Requirements
# 
# This module supports AWS FSx (Windows, Lustre, NetApp ONTAP, OpenZFS),
# AWS EFS, and third-party storage solutions integration.
#------------------------------------------------------------------------------

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0.0, < 6.0.0"
    }

    random = {
      source  = "hashicorp/random"
      version = ">= 3.5.0"
    }

    time = {
      source  = "hashicorp/time"
      version = ">= 0.9.0"
    }

    null = {
      source  = "hashicorp/null"
      version = ">= 3.2.0"
    }

    # Kubernetes provider for Portworx integration
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = ">= 2.23.0"
    }

    # Helm provider for deploying storage solutions
    helm = {
      source  = "hashicorp/helm"
      version = ">= 2.11.0"
    }

    # TLS provider for certificate generation
    tls = {
      source  = "hashicorp/tls"
      version = ">= 4.0.0"
    }
  }
}

#------------------------------------------------------------------------------
# Local Values for Version Management
#------------------------------------------------------------------------------
locals {
  module_version = "1.0.0"
  
  # Supported FSx file system types
  supported_fsx_types = [
    "WINDOWS",
    "LUSTRE",
    "ONTAP",
    "OPENZFS"
  ]
  
  # Supported third-party storage solutions
  supported_third_party_storage = [
    "netapp_cloud_volumes",
    "pure_storage_cbs",
    "portworx",
    "minio"
  ]
  
  # AWS regions supporting all FSx types
  fsx_full_support_regions = [
    "us-east-1",
    "us-east-2",
    "us-west-1",
    "us-west-2",
    "eu-west-1",
    "eu-west-2",
    "eu-central-1",
    "ap-northeast-1",
    "ap-southeast-1",
    "ap-southeast-2"
  ]
}