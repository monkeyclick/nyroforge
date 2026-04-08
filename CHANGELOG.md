# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [1.0.0] - 2024-01-01

### Added

#### Core Workstation Management
- Launch, list, and terminate GPU workstations (G4/G5/G6 instance families) via a React/Next.js web interface
- Support for Windows Server 2019 and 2022 instances with automated user data configuration
- One-click launch using pre-configured workstation templates
- Real-time dashboard showing live workstation status and metrics
- Workstation detail view with instance metadata, runtime, and cost data
- RDP file download for direct workstation connectivity
- Credential management with secure password generation and retrieval

#### Authentication and Authorization
- AWS Cognito User Pool integration with MFA support
- Role-based access control: `workstation-admin` and standard user roles
- Admin role grants full access to all workstations and users; user role restricts access to own workstations
- Short-lived JWT tokens (1-hour expiry) enforced on all API endpoints
- Lambda authorizer on API Gateway validates every request

#### Security Group Management
- Six pre-configured security group templates: Remote Desktop (RDP), SSH Access, HP Anywhere (RGS), Amazon DCV, Full Remote Access, and Web Server
- Client IP auto-detection for creating restricted ingress rules
- AWS Console-style rule management UI (add, edit, delete rules)
- Security group assignment matrix for associating groups with workstations
- IAM-scoped Lambda function with least-privilege EC2 permissions

#### Cost Tracking and Analytics
- AWS Cost Explorer integration for real-time cost data
- Per-user and per-workstation cost breakdown
- Monthly and daily cost trend views
- Configurable budget alert thresholds via SNS notifications
- Estimated cost display before launching a workstation

#### Auto-Termination and Cost Controls
- Configurable idle timeout per workstation (default: 8 hours)
- Scheduled auto-termination via EventBridge rules
- Cost overrun prevention with hard termination limits

#### Multi-Region Support
- Workstations deployable across 20+ AWS regions including Local Zones
- Region availability and instance type filtering per region
- Default region configurable via SSM Parameter Store

#### Domain Join (Enterprise)
- Active Directory domain join support via AWS Directory Service
- Domain join credentials stored securely in AWS Secrets Manager
- SSM Parameter Store configuration for domain name and OU path
- Post-launch domain join trigger via API

#### Infrastructure (CDK)
- Fully serverless architecture: Lambda, API Gateway, DynamoDB, Cognito, CloudFront, S3
- VPC with private subnets for workstation instances
- VPC endpoints for secure AWS service communication
- KMS encryption for DynamoDB tables and EBS volumes
- TLS 1.2+ enforced on all endpoints
- CloudTrail audit logging enabled
- WAF protection on API Gateway
- Automated one-click deployment script (`deploy-one-click.sh`)
- CDK stacks for infrastructure, frontend hosting, and monitoring

#### Monitoring and Alerting
- CloudWatch dashboards: Workstation Overview, Performance Metrics, Cost Analysis, Security Events
- Lambda execution logs and error alerts
- EC2 instance CloudWatch agent metrics
- SNS notifications for cost threshold breaches, failed launches, and security events

#### API
- RESTful API via API Gateway with full CRUD for workstations
- Endpoints: workstation management, credentials, cost analytics, region/instance-type configuration, system health
- OpenAPI-compatible request/response schemas

---

[Unreleased]: https://github.com/monkeyclick/nyroforge/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/monkeyclick/nyroforge/releases/tag/v1.0.0
