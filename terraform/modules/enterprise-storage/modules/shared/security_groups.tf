#------------------------------------------------------------------------------
# Shared Security Groups Module
# 
# Creates security groups for storage access control across all storage types.
#------------------------------------------------------------------------------

locals {
  sg_tags = merge(var.tags, {
    Module    = "shared-security-groups"
    Purpose   = "Storage Access Control"
    ManagedBy = "terraform"
  })
}

#------------------------------------------------------------------------------
# FSx Windows Security Group
#------------------------------------------------------------------------------

resource "aws_security_group" "fsx_windows" {
  count = var.create_fsx_windows_sg ? 1 : 0

  name        = "${var.project_name}-${var.environment}-fsx-windows-sg"
  description = "Security group for FSx for Windows File Server"
  vpc_id      = var.vpc_id

  # SMB
  ingress {
    description     = "SMB over TCP"
    from_port       = 445
    to_port         = 445
    protocol        = "tcp"
    cidr_blocks     = var.allowed_cidr_blocks
    security_groups = var.allowed_security_group_ids
  }

  # Windows Remote Management
  ingress {
    description     = "Windows Remote Management (HTTP)"
    from_port       = 5985
    to_port         = 5985
    protocol        = "tcp"
    cidr_blocks     = var.management_cidr_blocks
    security_groups = var.allowed_security_group_ids
  }

  ingress {
    description     = "Windows Remote Management (HTTPS)"
    from_port       = 5986
    to_port         = 5986
    protocol        = "tcp"
    cidr_blocks     = var.management_cidr_blocks
    security_groups = var.allowed_security_group_ids
  }

  # DNS (for AD integration)
  ingress {
    description     = "DNS (UDP)"
    from_port       = 53
    to_port         = 53
    protocol        = "udp"
    cidr_blocks     = var.allowed_cidr_blocks
    security_groups = var.allowed_security_group_ids
  }

  ingress {
    description     = "DNS (TCP)"
    from_port       = 53
    to_port         = 53
    protocol        = "tcp"
    cidr_blocks     = var.allowed_cidr_blocks
    security_groups = var.allowed_security_group_ids
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.sg_tags, {
    Name        = "${var.project_name}-${var.environment}-fsx-windows-sg"
    StorageType = "FSx-Windows"
  })

  lifecycle {
    create_before_destroy = true
  }
}

#------------------------------------------------------------------------------
# FSx Lustre Security Group
#------------------------------------------------------------------------------

resource "aws_security_group" "fsx_lustre" {
  count = var.create_fsx_lustre_sg ? 1 : 0

  name        = "${var.project_name}-${var.environment}-fsx-lustre-sg"
  description = "Security group for FSx for Lustre"
  vpc_id      = var.vpc_id

  # Lustre
  ingress {
    description     = "Lustre"
    from_port       = 988
    to_port         = 988
    protocol        = "tcp"
    cidr_blocks     = var.allowed_cidr_blocks
    security_groups = var.allowed_security_group_ids
  }

  ingress {
    description     = "Lustre MGS/MDS/OSS"
    from_port       = 1021
    to_port         = 1023
    protocol        = "tcp"
    cidr_blocks     = var.allowed_cidr_blocks
    security_groups = var.allowed_security_group_ids
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.sg_tags, {
    Name        = "${var.project_name}-${var.environment}-fsx-lustre-sg"
    StorageType = "FSx-Lustre"
  })

  lifecycle {
    create_before_destroy = true
  }
}

#------------------------------------------------------------------------------
# FSx ONTAP Security Group
#------------------------------------------------------------------------------

resource "aws_security_group" "fsx_ontap" {
  count = var.create_fsx_ontap_sg ? 1 : 0

  name        = "${var.project_name}-${var.environment}-fsx-ontap-sg"
  description = "Security group for FSx for NetApp ONTAP"
  vpc_id      = var.vpc_id

  # SSH (management)
  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.management_cidr_blocks
  }

  # HTTPS (management)
  ingress {
    description = "HTTPS Management"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.management_cidr_blocks
  }

  # NFS
  ingress {
    description     = "NFS Portmapper (TCP)"
    from_port       = 111
    to_port         = 111
    protocol        = "tcp"
    cidr_blocks     = var.allowed_cidr_blocks
    security_groups = var.allowed_security_group_ids
  }

  ingress {
    description     = "NFS Portmapper (UDP)"
    from_port       = 111
    to_port         = 111
    protocol        = "udp"
    cidr_blocks     = var.allowed_cidr_blocks
    security_groups = var.allowed_security_group_ids
  }

  ingress {
    description     = "NFS (TCP)"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    cidr_blocks     = var.allowed_cidr_blocks
    security_groups = var.allowed_security_group_ids
  }

  ingress {
    description     = "NFS (UDP)"
    from_port       = 2049
    to_port         = 2049
    protocol        = "udp"
    cidr_blocks     = var.allowed_cidr_blocks
    security_groups = var.allowed_security_group_ids
  }

  # SMB/CIFS
  ingress {
    description     = "NetBIOS (UDP)"
    from_port       = 137
    to_port         = 138
    protocol        = "udp"
    cidr_blocks     = var.allowed_cidr_blocks
    security_groups = var.allowed_security_group_ids
  }

  ingress {
    description     = "NetBIOS Session (TCP)"
    from_port       = 139
    to_port         = 139
    protocol        = "tcp"
    cidr_blocks     = var.allowed_cidr_blocks
    security_groups = var.allowed_security_group_ids
  }

  ingress {
    description     = "SMB/CIFS"
    from_port       = 445
    to_port         = 445
    protocol        = "tcp"
    cidr_blocks     = var.allowed_cidr_blocks
    security_groups = var.allowed_security_group_ids
  }

  # iSCSI
  ingress {
    description     = "iSCSI"
    from_port       = 3260
    to_port         = 3260
    protocol        = "tcp"
    cidr_blocks     = var.allowed_cidr_blocks
    security_groups = var.allowed_security_group_ids
  }

  # SnapMirror
  ingress {
    description = "SnapMirror Intercluster"
    from_port   = 11104
    to_port     = 11105
    protocol    = "tcp"
    cidr_blocks = var.replication_cidr_blocks
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.sg_tags, {
    Name        = "${var.project_name}-${var.environment}-fsx-ontap-sg"
    StorageType = "FSx-ONTAP"
  })

  lifecycle {
    create_before_destroy = true
  }
}

#------------------------------------------------------------------------------
# FSx OpenZFS Security Group
#------------------------------------------------------------------------------

resource "aws_security_group" "fsx_openzfs" {
  count = var.create_fsx_openzfs_sg ? 1 : 0

  name        = "${var.project_name}-${var.environment}-fsx-openzfs-sg"
  description = "Security group for FSx for OpenZFS"
  vpc_id      = var.vpc_id

  # NFS
  ingress {
    description     = "NFS Portmapper (TCP)"
    from_port       = 111
    to_port         = 111
    protocol        = "tcp"
    cidr_blocks     = var.allowed_cidr_blocks
    security_groups = var.allowed_security_group_ids
  }

  ingress {
    description     = "NFS Portmapper (UDP)"
    from_port       = 111
    to_port         = 111
    protocol        = "udp"
    cidr_blocks     = var.allowed_cidr_blocks
    security_groups = var.allowed_security_group_ids
  }

  ingress {
    description     = "NFS (TCP)"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    cidr_blocks     = var.allowed_cidr_blocks
    security_groups = var.allowed_security_group_ids
  }

  ingress {
    description     = "NFS (UDP)"
    from_port       = 2049
    to_port         = 2049
    protocol        = "udp"
    cidr_blocks     = var.allowed_cidr_blocks
    security_groups = var.allowed_security_group_ids
  }

  ingress {
    description     = "NFS Mount Daemon (TCP)"
    from_port       = 20001
    to_port         = 20003
    protocol        = "tcp"
    cidr_blocks     = var.allowed_cidr_blocks
    security_groups = var.allowed_security_group_ids
  }

  ingress {
    description     = "NFS Mount Daemon (UDP)"
    from_port       = 20001
    to_port         = 20003
    protocol        = "udp"
    cidr_blocks     = var.allowed_cidr_blocks
    security_groups = var.allowed_security_group_ids
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.sg_tags, {
    Name        = "${var.project_name}-${var.environment}-fsx-openzfs-sg"
    StorageType = "FSx-OpenZFS"
  })

  lifecycle {
    create_before_destroy = true
  }
}

#------------------------------------------------------------------------------
# EFS Security Group
#------------------------------------------------------------------------------

resource "aws_security_group" "efs" {
  count = var.create_efs_sg ? 1 : 0

  name        = "${var.project_name}-${var.environment}-efs-sg"
  description = "Security group for Amazon EFS"
  vpc_id      = var.vpc_id

  # NFS
  ingress {
    description     = "NFS"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    cidr_blocks     = var.allowed_cidr_blocks
    security_groups = var.allowed_security_group_ids
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.sg_tags, {
    Name        = "${var.project_name}-${var.environment}-efs-sg"
    StorageType = "EFS"
  })

  lifecycle {
    create_before_destroy = true
  }
}

#------------------------------------------------------------------------------
# Generic Storage Client Security Group
#------------------------------------------------------------------------------

resource "aws_security_group" "storage_client" {
  count = var.create_storage_client_sg ? 1 : 0

  name        = "${var.project_name}-${var.environment}-storage-client-sg"
  description = "Security group for storage clients"
  vpc_id      = var.vpc_id

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.sg_tags, {
    Name    = "${var.project_name}-${var.environment}-storage-client-sg"
    Purpose = "Storage Client"
  })

  lifecycle {
    create_before_destroy = true
  }
}