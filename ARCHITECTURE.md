# NyroForge Architecture

**Owner:** Matt Herson
**Website:** [nyroforge.com](https://nyroforge.com)

NyroForge is a fully serverless AWS application that provisions, manages, and monitors virtual GPU editing workstations (EC2 G-family instances) for media and VFX workflows. It eliminates the need for on-premises hardware by letting artists and engineers spin up Windows Server workstations on demand, with role-based access control, cost analytics, enterprise storage, and automated lifecycle management.

---

## 1. Overview

### Design Philosophy

| Principle | Implementation |
|---|---|
| **Serverless-first** | All business logic runs in Lambda. No persistent compute outside the workstations themselves. |
| **Infrastructure as Code** | Every AWS resource is defined in AWS CDK (TypeScript). No manual console clicks. |
| **Separation of concerns** | Six CDK stacks with explicit dependency edges. User-facing API and admin API are separate stacks with separate API Gateways. |
| **Defense in depth** | KMS encryption for all DynamoDB tables and EBS volumes, VPC with private subnets, VPC endpoints for all AWS services, IAM with least-privilege, Cognito JWT on every route. |
| **Cost visibility** | Real-time cost analytics via AWS Cost Explorer integration plus per-workstation hourly and monthly estimates. |

---

## 2. System Architecture Diagram

```
                              ┌─────────────────────────────────────────────────────────┐
                              │                     USERS                               │
                              └─────────────────────┬───────────────────────────────────┘
                                                     │ HTTPS
                              ┌──────────────────────▼───────────────────────────────────┐
                              │             CloudFront Distribution                       │
                              │         (WorkstationWebsite stack)                        │
                              │  S3 static origin · HTTPS-only · SPA 404→200 redirect    │
                              └──────────────────────┬───────────────────────────────────┘
                                                     │
                              ┌──────────────────────▼───────────────────────────────────┐
                              │         Next.js 14 Frontend (Static Export)               │
                              │  Amplify / aws-amplify v6 · Zustand · TanStack Query     │
                              │  Tailwind CSS · Recharts · React Hook Form                │
                              └──────────┬───────────────────────────┬────────────────────┘
                                         │ JWT Bearer token           │ JWT Bearer token
                                         │                            │
                  ┌──────────────────────▼──────────┐  ┌─────────────▼──────────────────┐
                  │   User API Gateway (stage: api)  │  │ Admin API Gateway (stage: prod)│
                  │   WorkstationApi stack           │  │ WorkstationAdminApi stack      │
                  │   Rate: 100 rps / 200 burst      │  │ Rate: 50 rps / 100 burst       │
                  │   Quota: 10,000 req/day          │  │ Cognito authorizer             │
                  │   Cognito authorizer             │  └──────┬─────────────────────────┘
                  └──────┬───────────────────────────┘         │
                         │                                     │
         ┌───────────────▼─────────────────────────────────────▼──────────────────────────┐
         │                          Lambda Functions (Node.js 20.x)                        │
         │                           (VPC private subnets, 512 MB default)                 │
         │                                                                                  │
         │  User API stack                    Admin API stack                               │
         │  ─────────────                     ─────────────────                            │
         │  EC2Management                     CognitoAdminService (admin)                  │
         │  StatusMonitor (also EventBridge)  GroupManagementService (admin)               │
         │  CostAnalytics                     SecurityGroupService (admin)                 │
         │  ConfigService                     AmiValidationService (admin)                 │
         │  CredentialsService                InstanceTypeService (admin)                  │
         │  UserProfileService                BootstrapConfigService (admin)               │
         │  UserManagementService             GroupPackageService (admin)                  │
         │  GroupManagementService            StorageService (admin)                       │
         │  SecurityGroupService              Ec2DiscoveryService (admin)                  │
         │  CognitoAdminService               InstanceFamilyService (admin)                │
         │  AmiValidationService              UserManagementService (admin)                │
         │  InstanceTypeService                                                             │
         │  BootstrapConfigService                                                          │
         │  AnalyticsService                                                                │
         │  GroupPackageService                                                             │
         │  StorageService                                                                  │
         │  UserAttributeChangeProcessor  ◄── DynamoDB Streams (EnhancedUsers)             │
         │  GroupMembershipReconciliation  ◄── EventBridge cron (daily 02:00 UTC)          │
         └───────────────┬─────────────────────────────────────┬──────────────────────────┘
                         │                                     │
         ┌───────────────▼───────────────┐   ┌────────────────▼────────────────────────────┐
         │       AWS Data Plane           │   │        AWS Management Plane                  │
         │                               │   │                                              │
         │  DynamoDB (18 tables, KMS)    │   │  Cognito User Pool (JWT, MFA, groups)        │
         │  Secrets Manager (creds)      │   │  SSM Parameter Store (config)                │
         │  S3 (nyroforge-workstation-*) │   │  Cost Explorer (analytics)                   │
         │  EFS (shared project storage) │   │  CloudWatch (metrics + logs)                 │
         │  FSx Windows/Lustre (opt.)    │   │  EventBridge (auto-terminate, reconcile)     │
         └───────────────────────────────┘   └─────────────────────────────────────────────┘
                         │
         ┌───────────────▼───────────────────────────────────────────────────────────────────┐
         │                         EC2 Workstations (VPC private subnets)                    │
         │                                                                                    │
         │  G4dn · G5 · G6 instance families   Windows Server 2019 / 2022                   │
         │  AmazonSSMManagedInstanceCore        CloudWatchAgentServerPolicy                  │
         │  VPC endpoint access only (no SSH)   Auto-terminate via EventBridge + StatusMonitor│
         └───────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Infrastructure Stacks

All six stacks are composed in `bin/app.ts`. Dependencies flow in one direction.

```
WorkstationInfrastructure
        │
        ├──► WorkstationStorage     (depends on: Infrastructure)
        ├──► WorkstationApi         (depends on: Infrastructure)
        └──► WorkstationAdminApi    (depends on: Infrastructure)
                    │
                    └──► WorkstationFrontend (depends on: Api + AdminApi)

WorkstationWebsite  (standalone, no cross-stack dependencies)
```

### WorkstationInfrastructureStack (`lib/workstation-infrastructure-stack.ts`)

The foundational stack. All other stacks receive outputs from this one.

| Resource | Details |
|---|---|
| **VPC** | CIDR `10.0.0.0/16`, 3 AZs, 1 NAT Gateway, public + private subnets |
| **VPC Gateway Endpoints** | S3, DynamoDB (avoid NAT costs for high-volume traffic) |
| **VPC Interface Endpoints** | EC2, SSM, SSM Messages, EC2 Messages, Secrets Manager, KMS |
| **KMS Key** | Alias `alias/media-workstation-automation`, auto-rotation enabled |
| **Workstation Security Group** | Ingress: RDP TCP/3389 from `10.0.0.0/8`; HTTPS TCP/443 from VPC CIDR for SSM |
| **DynamoDB Tables** | 18 tables, all KMS-encrypted, pay-per-request billing (see Section 6) |
| **Cognito User Pool** | MFA optional (SMS + TOTP), SRP auth, 1-hour token validity, groups: `workstation-admin`, `workstation-user` |
| **Cognito User Pool Client** | Public client (no secret), SRP + Admin Password + Custom auth flows |
| **SSM Parameters** | `/workstation/config/*` for default instance type, allowed types, auto-terminate hours, Windows versions |
| **IAM Role: WorkstationInstanceRole** | Attached to EC2 instances; grants SSM, CloudWatch Agent, Secrets Manager (scoped to `workstation/*`), KMS decrypt, DynamoDB access to own package queue |

Removal policy is `RETAIN` for VPC resources (prevents `DELETE_FAILED` when EKS or Lambda ENIs occupy subnets) and environment-aware (`RETAIN` in production, `DESTROY` otherwise) for all other resources.

---

### WorkstationApiStack (`lib/workstation-api-stack.ts`)

User-facing REST API. Deployed to the `api` stage.

| Resource | Details |
|---|---|
| **API Gateway** | REST API named `Media Workstation Management API`, throttle 100 rps / 200 burst, 10,000 req/day quota |
| **Cognito Authorizer** | Validates JWT from `Authorization: Bearer <token>` header |
| **Lambda Functions** | 18 functions (Node.js 20.x, 512 MB, 5-minute default timeout, private VPC subnets) |
| **EventBridge Rules** | Auto-termination check every 5 minutes (targets StatusMonitor), group reconciliation daily at 02:00 UTC (targets GroupMembershipReconciliation) |
| **DynamoDB Stream Trigger** | `UserAttributeChangeProcessor` triggered by `EnhancedUsers` table stream, batch size 10, max-batching window 5s |

All Lambda functions receive read/write permissions to all 18 DynamoDB tables. Service-specific IAM additions are scoped by ARN or resource tag (`Project: NyroForge`).

---

### WorkstationAdminApiStack (`lib/workstation-admin-api-stack.ts`)

Separate API Gateway and Lambda set for administrative operations. Deployed to the `prod` stage.

| Resource | Details |
|---|---|
| **API Gateway** | REST API named `Workstation Admin API`, throttle 50 rps / 100 burst |
| **Shared IAM Role** | Single `AdminLambdaRole` shared by all admin Lambdas — DynamoDB (scoped ARNs), Cognito IdP (user pool ARN), EC2 describe (all) + mutate (NyroForge-tagged, home region), S3 (`nyroforge-workstation-*`), SES, SSM (`/workstation/*`), FSx/EFS (read all, delete NyroForge-tagged), KMS |
| **Lambda Functions** | CognitoAdminService, GroupManagementService, SecurityGroupService, AmiValidationService, InstanceTypeService, BootstrapConfigService, GroupPackageService, StorageService, Ec2DiscoveryService, InstanceFamilyService, UserManagementService |

Note: Several service implementations (e.g., SecurityGroupService, StorageService) are the same Lambda code deployed in both stacks with different IAM roles and API paths.

---

### EnterpriseStorageStack (`lib/enterprise-storage-stack.ts`)

Wraps `EnterpriseStorageConstruct`. All features are opt-in via environment flags.

| Resource | When enabled |
|---|---|
| **EFS File System** | Always (`enableEfs: true` default) |
| **S3 Transfer Bucket** | Always (`enableS3Transfer: true` default) |
| **FSx for Windows** | `ENABLE_FSX_WINDOWS=true` env var |
| **FSx for Lustre** | `ENABLE_FSX_LUSTRE=true` env var |
| **FSx ONTAP** | `ENABLE_FSX_ONTAP=true` env var |
| **FSx OpenZFS** | `ENABLE_FSX_OPENZFS=true` env var |
| **CloudWatch Alarms + Dashboard** | Prod environment only |
| **AWS Backup** | Prod environment only |
| **IAM Policies** | Always (`createIamPolicies: true`) |

Storage endpoints are registered in SSM Parameter Store under `/{projectName}/storage/*` so Lambda functions can discover them at runtime.

---

### WorkstationFrontendStack (`lib/workstation-frontend-stack.ts`)

A thin stack that:
1. Creates an IAM role for AWS Amplify (`AdministratorAccess-Amplify`).
2. Writes frontend configuration to SSM Parameter Store at `/workstation/frontend/config` (region, User Pool ID, User Pool Client ID, API Gateway URL) and `/workstation/frontend/auth` (Cognito auth settings including MFA configuration).

The Amplify app itself is deployed manually via CLI or Console. The stack outputs instructions and the role ARN.

---

### WorkstationWebsiteStack (`lib/workstation-website-stack.ts`)

Hosts the compiled Next.js static export.

| Resource | Details |
|---|---|
| **S3 Bucket** | `workstation-ui-{account}-{region}`, private, no public access, OAI restricted |
| **CloudFront Distribution** | Default root `index.html`, HTTPS-only redirect, SPA error handling (403/404 → `index.html`, HTTP 200), optimized caching |
| **S3 BucketDeployment** | Deploys `frontend/out` to the S3 bucket and invalidates CloudFront |

Security headers (CSP, HSTS, etc.) must be applied at the CloudFront layer, as Next.js `output: 'export'` does not apply the `headers()` configuration.

---

## 4. Lambda Microservices

All Lambda functions use Node.js 20.x and run inside the VPC private subnets. Common environment variables include table names, User Pool ID, KMS Key ID, and VPC ID.

| Function Name (CDK) | AWS Function Name | Purpose | Key Endpoints | Key AWS Services |
|---|---|---|---|---|
| `EC2ManagementFunction` | `MediaWorkstation-EC2Management` | Full workstation lifecycle: launch, stop, start, terminate, RBAC enforcement, bootstrap package queue seeding | `GET/POST /workstations`, `GET/DELETE/PATCH /workstations/{id}`, `PUT /workstations/reconcile` | EC2, DynamoDB, Secrets Manager, SSM |
| `StatusMonitorFunction` | `MediaWorkstation-StatusMonitor` | Dashboard aggregation, health check, auto-termination enforcement (scheduled every 5 min) | `GET /dashboard/status`, `GET /health` | EC2, DynamoDB, CloudWatch |
| `CostAnalyticsFunction` | `MediaWorkstation-CostAnalytics` | Cost breakdown queries with 10-minute timeout for slow Cost Explorer calls | `GET /costs` | Cost Explorer, DynamoDB |
| `ConfigServiceFunction` | `MediaWorkstation-ConfigService` | Region, instance type, and OS version catalogue; reads SSM parameters | `GET /regions`, `GET /instance-types`, `GET /config` | EC2 (describe), SSM |
| `CredentialsServiceFunction` | `MediaWorkstation-CredentialsService` | Retrieve local admin credentials or domain-join status; SSM Run Command for password resets | `GET /workstations/{id}/credentials` | Secrets Manager, DynamoDB, SSM |
| `UserProfileServiceFunction` | `MediaWorkstation-UserProfileService` | Per-user preferences (default region, instance type, theme, notifications) | `GET/PUT /profile`, `PATCH /preferences` | DynamoDB |
| `UserManagementServiceFunction` | `MediaWorkstation-UserManagementService` | User CRUD with Cognito sync; soft-delete/hard-delete; password management; SES email notifications | `GET/POST /admin/users`, `GET/PUT/DELETE /admin/users/{id}`, soft-delete, restore, password APIs | DynamoDB, Cognito IdP, SES |
| `GroupManagementServiceFunction` | `MediaWorkstation-GroupManagementService` | Static and dynamic group management, hierarchical groups, rule evaluation | `GET/POST /admin/groups`, membership and rule APIs | DynamoDB |
| `SecurityGroupServiceFunction` | `MediaWorkstation-SecurityGroupService` | EC2 security group CRUD, template rules (RDP, DCV, HP Anywhere), "allow my IP" | `GET/POST /admin/security-groups`, add/remove rule, attach-to-workstation | EC2 |
| `CognitoAdminServiceFunction` | `MediaWorkstation-CognitoAdminService` | Cognito user and group administration for admin UI | `GET/POST/DELETE /admin/users`, roles, permissions, audit-logs | Cognito IdP, DynamoDB |
| `AmiValidationServiceFunction` | `MediaWorkstation-AmiValidationService` | Validates that a given AMI ID exists and is accessible in the target region | `GET/POST /admin/validate-ami` | EC2 (DescribeImages) |
| `InstanceTypeServiceFunction` | `MediaWorkstation-InstanceTypeService` | Manages the allowed-instance-types allowlist; discovers GPU instances from EC2 API | `GET/PUT /admin/instance-types`, discover | EC2 (DescribeInstanceTypes), SSM |
| `BootstrapConfigServiceFunction` | `MediaWorkstation-BootstrapConfigService` | CRUD for bootstrap packages (drivers, software) that are installed at workstation launch | `GET/POST/PUT/DELETE /admin/bootstrap-packages` | DynamoDB |
| `AnalyticsServiceFunction` | `MediaWorkstation-AnalyticsService` | Ingests client-side analytics events and feedback submissions | `POST /analytics/track`, `POST /analytics/feedback`, `GET /analytics/user/{id}` | DynamoDB |
| `UserAttributeChangeProcessorFunction` | `MediaWorkstation-UserAttributeChangeProcessor` | DynamoDB Streams consumer; re-evaluates dynamic group membership when user attributes change; max 10 concurrent executions | Triggered by `EnhancedUsers` stream | DynamoDB |
| `GroupMembershipReconciliationFunction` | `MediaWorkstation-GroupMembershipReconciliation` | Full re-evaluation of all users against all dynamic group rules; 15-minute timeout, 1 GB memory | Triggered by EventBridge cron (02:00 UTC daily) | DynamoDB |
| `GroupPackageServiceFunction` | `MediaWorkstation-GroupPackageService` | Manages group-to-package bindings and per-workstation package installation queues | `GET/POST /user/group-packages`, workstation package queue endpoints | DynamoDB |
| `StorageServiceFunction` | `MediaWorkstation-StorageService` | S3 file listing, presigned upload/download URLs, EFS and FSx filesystem discovery, SSM storage config | `GET /admin/storage/config`, list, upload-url, download, delete, filesystems | S3, EFS, FSx, SSM |

**Admin API additional Lambdas** (separate instances in `WorkstationAdminApiStack`):

| Function | AWS Name | Purpose |
|---|---|---|
| Ec2DiscoveryService | `workstation-ec2-discovery-service` | Imports existing EC2 instances into DynamoDB |
| InstanceFamilyService | `workstation-instance-family-service` | Manages allowed EC2 instance families (G4, G5, G6, etc.) via SSM |

---

## 5. Frontend Architecture

### Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14.0.4 (`pages` router, `output: 'export'` for static S3/CloudFront hosting) |
| Auth | `@aws-amplify/auth` v6, `@aws-amplify/ui-react` v6 |
| State management | Zustand v4 (`persist` middleware with localStorage) |
| Server state | TanStack React Query v5 |
| Forms | React Hook Form v7 |
| Charts | Recharts v2 |
| Styling | Tailwind CSS v3 + `@tailwindcss/forms` |
| Notifications | react-hot-toast |
| Animations | Framer Motion |

### Directory Structure

```
frontend/
├── pages/                  # Next.js page routes
│   ├── index.tsx           # Workstation dashboard (main view)
│   ├── login.tsx           # Cognito login page
│   ├── signup.tsx          # Signup (disabled by default via Cognito settings)
│   ├── profile.tsx         # User profile & preferences
│   └── admin/
│       └── index.tsx       # Admin panel (tab-based single page)
└── src/
    ├── components/
    │   ├── admin/          # 19 admin-specific components
    │   │   ├── AdminDashboard.tsx
    │   │   ├── UserManagementModal.tsx
    │   │   ├── GroupManagement.tsx
    │   │   ├── RoleManagement.tsx
    │   │   ├── SecurityManagement.tsx
    │   │   ├── StorageManagement.tsx
    │   │   ├── BootstrapPackageManagement.tsx
    │   │   ├── InstanceTypeManagement.tsx
    │   │   ├── InstanceFamilyManagement.tsx
    │   │   ├── AnalyticsDashboard.tsx
    │   │   ├── AuditLogsViewer.tsx
    │   │   └── ... (others)
    │   ├── dashboard/      # StatusMetrics, CostAnalyticsChart
    │   └── workstation/    # WorkstationCard, LaunchWorkstationModal,
    │                       # RdpCredentialsModal, DcvConnectionModal,
    │                       # BootstrapPackageSelector, PackageInstallationProgress
    ├── stores/
    │   └── authStore.ts    # Zustand store — user, roles, groups, permissions, isAdmin
    ├── services/
    │   ├── api.ts          # ApiClient class — wraps both User API and Admin API
    │   └── analytics.ts    # Analytics event tracking
    ├── hooks/
    │   └── useAnalytics.ts # Analytics hook
    ├── types/              # TypeScript interfaces (Workstation, User, Role, Group, etc.)
    └── layouts/            # Page layout wrappers
```

### State Management

The `authStore` (Zustand + `persist`) holds the full auth context after login:
- `user: EnhancedUser` — id, email, roleIds, groupIds, directPermissions
- `roles: Role[]` — resolved role objects with permission arrays
- `groups: Group[]` — resolved group objects
- `isAdmin: boolean` — computed from effective permissions
- `effectivePermissions: Permission[]` — union of direct permissions + role permissions + group role permissions

On hydration from localStorage, `onRehydrateStorage` recalculates effective permissions to pick up any role changes.

Permissions checked in the UI match system roles defined in `SYSTEM_ROLES`:
- `super-admin` — `admin:full-access`
- `admin` — workstations, users, groups, roles, analytics, settings (read/write/delete)
- `user` — workstations own CRUD only
- `viewer` — workstations read + analytics read

### API Client

`ApiClient` (`services/api.ts`) reads `NEXT_PUBLIC_API_ENDPOINT` and `NEXT_PUBLIC_ADMIN_API_ENDPOINT` at build time. Every request calls `fetchAuthSession()` from `aws-amplify/auth` to obtain a fresh Cognito ID token and attaches it as `Authorization: Bearer <token>`.

---

## 6. Data Model

All tables use KMS customer-managed encryption (`alias/media-workstation-automation`) and pay-per-request billing.

### WorkstationManagement (workstations)

| Attribute | Type | Notes |
|---|---|---|
| `PK` | String (partition) | Workstation ID |
| `SK` | String (sort) | Record type discriminator |
| `userId` | String | Owner email |
| `status` | String | `running`, `stopped`, `terminated`, etc. |
| `createdAt` | String (ISO 8601) | |

**GSIs:** `UserIdIndex` (PK: `userId`, SK: `createdAt`), `StatusIndex` (PK: `status`, SK: `createdAt`)
**Streams:** `NEW_AND_OLD_IMAGES`

### CostAnalytics (costs)

| Attribute | Type | Notes |
|---|---|---|
| `PK` | String (partition) | Cost record key |
| `SK` | String (sort) | Time period or record type |
| `ttl` | Number | Auto-expiry for old cost data |

### UserSessions

| Attribute | Type | Notes |
|---|---|---|
| `PK` | String (partition) | Session key |
| `SK` | String (sort) | |
| `ttl` | Number | Session expiry |

### UserProfiles

| Attribute | Type | Notes |
|---|---|---|
| `userId` | String (partition) | Cognito email |

Stores per-user preferences: default region, instance type, auto-terminate hours, theme.

### EnhancedUsers

| Attribute | Type | Notes |
|---|---|---|
| `id` | String (partition) | UUID |
| `email` | String | |
| `status` | String | `active`, `suspended`, `pending`, `deleted` |
| `roleIds` | List | |
| `groupIds` | List | |

**GSIs:** `EmailIndex` (PK: `email`), `StatusIndex` (PK: `status`, SK: `createdAt`)
**Streams:** `NEW_AND_OLD_IMAGES` — triggers `UserAttributeChangeProcessor`

### UserRoles

| Attribute | Type | Notes |
|---|---|---|
| `id` | String (partition) | Role UUID |
| `isSystem` | String | `"true"` / `"false"` |
| `name` | String | |
| `permissions` | List | |

**GSI:** `SystemRoleIndex` (PK: `isSystem`, SK: `name`)

### UserGroups

| Attribute | Type | Notes |
|---|---|---|
| `id` | String (partition) | Group UUID |
| `membershipType` | String | `static` or `dynamic` |
| `parentGroupId` | String | For nested groups |

**GSIs:** `DefaultGroupIndex`, `ParentGroupIndex`, `MembershipTypeIndex`, `CreatorIndex`
**Streams:** `NEW_AND_OLD_IMAGES`

### GroupMemberships

| Attribute | Type | Notes |
|---|---|---|
| `id` | String (partition) | Format: `user#<userId>#group#<groupId>` |
| `userId` | String | |
| `groupId` | String | |
| `membershipType` | String | `static`, `dynamic`, `nested` |
| `expiresAt` | Number | TTL — supports temporary memberships |

**GSIs:** `UserGroupsIndex` (PK: `userId`, SK: `groupId`), `GroupMembersIndex` (PK: `groupId`, SK: `userId`), `MembershipTypeIndex`

### GroupAuditLogs

| Attribute | Type | Notes |
|---|---|---|
| `id` | String (partition) | UUID |
| `timestamp` | String (sort) | ISO 8601 |
| `ttl` | Number | Auto-expiry |

**GSIs:** `GroupActivityIndex`, `ActionIndex`, `PerformerIndex`

### AuditLogs

| Attribute | Type | Notes |
|---|---|---|
| `id` | String (partition) | UUID |
| `timestamp` | String (sort) | ISO 8601 |
| `userId` | String | |
| `resource` | String | |
| `ttl` | Number | Auto-expiry |

**GSIs:** `UserActionIndex`, `ResourceIndex`

### WorkstationBootstrapPackages

| Attribute | Type | Notes |
|---|---|---|
| `packageId` | String (partition) | UUID |
| `type` | String | Package category (driver, app, etc.) |
| `category` | String | |
| `order` | Number | Installation order |
| `isRequired` | String | `"true"` / `"false"` |

**GSIs:** `TypeIndex`, `CategoryIndex`, `RequiredIndex`

### WorkstationPackageQueue (packageQueue)

Tracks per-workstation package installation jobs from group bindings.

**GSIs:** `WorkstationIndex` (PK: `workstationId`), `StatusIndex`, `GroupIndex`

### GroupPackageBindings

| Attribute | Type | Notes |
|---|---|---|
| `PK` | String (partition) | Group ID composite key |
| `SK` | String (sort) | Package binding key |
| `autoInstall` | String | `"true"` / `"false"` |
| `installOrder` | Number | |

**GSIs:** `PackageIndex`, `AutoInstallIndex`

### UserAnalytics

| Attribute | Type | Notes |
|---|---|---|
| `eventId` | String (partition) | UUID |
| `timestamp` | String (sort) | ISO 8601 |
| `userId` | String | |
| `eventType` | String | |
| `ttl` | Number | Auto-expiry |

**GSIs:** `UserIndex`, `EventTypeIndex`, `CategoryIndex`

### UserFeedback

| Attribute | Type | Notes |
|---|---|---|
| `feedbackId` | String (partition) | UUID |
| `timestamp` | String (sort) | |
| `userId` | String | |

**GSI:** `UserIndex`

### DeletedUsers

Soft-delete archive with restorable flag and scheduled purge date. TTL auto-purges after configurable retention period.

**GSIs:** `DeletionDateIndex`, `DeletedByIndex`, `PurgeDateIndex`

### PasswordResetRecords

Tracks every admin-initiated password change for compliance audit trails. TTL auto-expiry.

**GSI:** `UserResetIndex`

### PasswordPolicySettings

Singleton-style table storing organization-wide password policy (min length, complexity, expiry).

---

## 7. Authentication and Authorization Flow

```
Browser                 CloudFront           API Gateway              Lambda              Cognito
  │                        │                     │                      │                   │
  │──── HTTPS request ─────►│                    │                      │                   │
  │     (static assets)     │                    │                      │                   │
  │◄────────────────────────│                    │                      │                   │
  │                         │                    │                      │                   │
  │ aws-amplify.signIn()    │                    │                      │                   │
  │─────────────────────────┼────────────────────┼──────────────────────┼──── SRP auth ─────►│
  │◄────────────────────────┼────────────────────┼──────────────────────┼─── ID + Access ───│
  │  (tokens stored in      │                    │                      │    + Refresh token │
  │   localStorage)         │                    │                      │                   │
  │                         │                    │                      │                   │
  │ fetchAuthSession()      │                    │                      │                   │
  │ → idToken (1-hour JWT)  │                    │                      │                   │
  │                         │                    │                      │                   │
  │── API call + Bearer ────┼────────────────────►│                     │                   │
  │                         │  Authorization:     │                      │                   │
  │                         │  Bearer <idToken>   │                      │                   │
  │                         │                    │                      │                   │
  │                         │         CognitoUserPoolsAuthorizer         │                   │
  │                         │                    │──── validate JWT ─────┼───────────────────►│
  │                         │                    │◄─── claims ───────────┼───────────────────│
  │                         │                    │  (email, cognito:groups)                  │
  │                         │                    │                      │                   │
  │                         │                    │─── proxy + claims ───►│                  │
  │                         │                    │                      │                   │
  │                         │                    │      Lambda reads:    │                   │
  │                         │                    │      - email (userId) │                   │
  │                         │                    │      - cognito:groups │                   │
  │                         │                    │      - isAdmin check  │                   │
  │                         │                    │      - RBAC from      │                   │
  │                         │                    │        DynamoDB       │                   │
```

### Token Lifecycle

| Token | Validity | Notes |
|---|---|---|
| ID Token | 1 hour | Used as Bearer token for API calls; contains `cognito:groups` claim |
| Access Token | 1 hour | Available but ID token used by this app |
| Refresh Token | 30 days | Used by Amplify to silently refresh ID/Access tokens |

### Authorization Layers

1. **API Gateway (infrastructure):** `CognitoUserPoolsAuthorizer` rejects any request without a valid, unexpired JWT issued by the configured User Pool. Returns HTTP 401 before Lambda is invoked.

2. **Cognito Groups (coarse-grained):** Lambda reads `requestContext.authorizer.claims['cognito:groups']`. Membership in `workstation-admin` grants admin privileges.

3. **DynamoDB RBAC (fine-grained):** Lambda resolves the caller's `EnhancedUser` record from DynamoDB, expands `roleIds` and `groupIds` to effective permissions, and enforces ownership checks (users can only operate on their own workstations unless they hold `workstations:manage-all`).

4. **Frontend guard:** `useAuthStore.hasPermission()` / `isAdmin` hides or disables UI elements based on the Zustand permission set — but this is a UX layer only, not a security boundary.

---

## 8. Security Boundaries

### VPC Layout

```
VPC: 10.0.0.0/16  (3 AZs)
├── Public Subnets (10.0.0.0/24, 10.0.1.0/24, 10.0.2.0/24)
│   └── NAT Gateway (1, shared across AZs)
│       Internet Gateway
└── Private Subnets (10.0.3.0/24, 10.0.4.0/24, 10.0.5.0/24)
    ├── Lambda functions (all 18+ functions run here)
    └── EC2 Workstations (G-family GPU instances)
```

Lambda functions never have public IPs. All outbound traffic from Lambdas routes through the NAT Gateway or via VPC endpoints (S3, DynamoDB, EC2, SSM, Secrets Manager, KMS) without traversing the public internet.

### Security Groups

| Security Group | Ingress | Egress |
|---|---|---|
| `WorkstationSecurityGroup` | TCP 3389 (RDP) from `10.0.0.0/8` only; TCP 443 from VPC CIDR (SSM) | All traffic allowed |
| Lambda SG (CDK-managed) | No inbound; VPC-internal only | All traffic (NAT + VPC endpoints) |

### IAM Role Separation

| Principal | Role | Key Permissions |
|---|---|---|
| EC2 Workstation | `WorkstationInstanceRole` | SSM core, CloudWatch Agent, Secrets Manager (`workstation/*`), KMS decrypt, DynamoDB own package queue |
| User API Lambdas | Per-function execution roles | DynamoDB all tables, EC2 mutate (NyroForge-tagged), SSM params (`/workstation/*`), Secrets Manager (`workstation/*`), Cognito IdP (scoped), Cost Explorer |
| Admin API Lambdas | Shared `AdminLambdaRole` | DynamoDB (explicit ARNs), Cognito IdP (user pool ARN), EC2 (home region + NyroForge-tagged for mutating), S3 (`nyroforge-workstation-*`), SES, SSM, FSx/EFS |
| Amplify | `AmplifyRole` | `AdministratorAccess-Amplify` managed policy |

Resource-level tag conditions (`aws:ResourceTag/Project: NyroForge`) are applied to all EC2 and FSx/EFS mutating actions to prevent Lambda functions from operating on resources outside the project.

### Encryption

| Data | Encryption |
|---|---|
| DynamoDB tables | KMS CMK (`alias/media-workstation-automation`), PITR enabled on all sensitive tables |
| EC2 EBS volumes | KMS (via EC2 launch configuration) |
| Secrets Manager | KMS CMK |
| S3 Transfer Bucket | SSE-KMS |
| EFS | KMS CMK |
| In-transit | TLS 1.2+ enforced by CloudFront (HTTPS-only viewer policy), API Gateway, all AWS service endpoints |

### Audit

- CloudTrail captures all API calls (not configured in CDK but recommended).
- `AuditLogs` and `GroupAuditLogs` DynamoDB tables provide application-level audit trails with TTL-based retention.
- `PasswordResetRecords` provides compliance records for all admin-initiated password changes.
- `DeletedUsers` provides a soft-delete archive before permanent purge.

---

## 9. Key Design Decisions

### 1. Serverless-first over containerized compute

All application logic lives in Lambda rather than ECS or EC2-backed services. This eliminates idle-capacity costs — the application costs near zero when no workstations are being managed. Lambda cold starts are acceptable here because workstation management operations (launch, terminate, status checks) are human-initiated, not latency-sensitive sub-100ms workflows.

### 2. Two separate API Gateways for user vs. admin surfaces

Rather than using a single API Gateway with resource policies or custom authorizers to gate admin routes, the project deploys `WorkstationApiStack` (user-facing) and `WorkstationAdminApiStack` (admin-facing) as completely separate stacks with separate IAM roles and API Gateway endpoints. This gives:
- Independent throttle configurations (admin gets lower limits)
- Separate CloudWatch dashboards and log groups
- Clear blast-radius isolation — a misconfiguration in admin Lambda code cannot affect user-facing availability

### 3. DynamoDB over RDS for all application state

A relational database would require a VPC-resident instance or Aurora Serverless, adding always-on cost and VPC complexity. DynamoDB with pay-per-request billing costs virtually nothing at low traffic and scales automatically. The access patterns (lookup by workstation ID, user ID, status, group membership) map well to single-table and GSI patterns. PITR is enabled on all business-critical tables for point-in-time recovery.

### 4. CDK (TypeScript) as the sole IaC tool for AWS infrastructure

A `terraform/` directory exists in the repository but the CDK stacks in `lib/` are the authoritative infrastructure definition. TypeScript CDK was chosen because:
- Lambda function code is also TypeScript — the same language toolchain covers both application and infrastructure code
- CDK constructs provide higher-level abstractions (e.g., `grantReadWriteData`, `addEventSource`) that reduce boilerplate compared to raw CloudFormation or HCL
- Cross-stack references (passing `vpc`, `tables`, `userPool` between stacks) are typed at compile time

### 5. DynamoDB Streams + EventBridge for reactive group membership

Dynamic groups evaluate rules (e.g., "all users in department=VFX") automatically. Rather than re-scanning all users on every API call, two complementary mechanisms keep group membership current:
- **DynamoDB Streams** trigger `UserAttributeChangeProcessor` on every `EnhancedUsers` write, incrementally updating affected group memberships (batch size 10, max 10 concurrent executions to prevent DynamoDB throttling)
- **EventBridge cron** at 02:00 UTC triggers `GroupMembershipReconciliation` for a full re-evaluation pass to catch any drift

This avoids expensive full-table scans at query time while keeping membership accurate within seconds of attribute changes.
