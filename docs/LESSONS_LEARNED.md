# NyroForge — Lessons Learned & Pending Code Fixes

> Captured from initial deployment session — June 2026

---

## 1. AWS Tag Policy: `Owner` vs `owner`

### What Happened
The Qumulo AWS org enforces a tag policy requiring lowercase `owner`. Every resource that used `Owner` (capital O) was rejected — CloudFormation stack rollback, DynamoDB table failures, and EC2 `RunInstances` failures all traced back to this.

### Files Fixed
- `bin/app.ts` — global CDK tag changed from `Owner` to `owner`
- `src/lambda/ec2-management/index.ts` — `CostAllocationTags` interface, `generateCostAllocationTags()`, and all `TagSpecifications` entries

### Still Needed
- Audit every Lambda for any hardcoded `Owner` tag key (grep: `Key: 'Owner'`)
- Add a pre-deploy linter or CDK Aspect that enforces lowercase tag keys against the org tag policy

---

## 2. Duplicate `owner` Tag on EC2 Launch

### What Happened
After fixing `Owner` → `owner`, both the system cost-allocation tags and the user-supplied custom tags included `owner`, causing EC2 to reject `RunInstances` with `Duplicate tag key 'owner' specified`.

### Fix Applied
`src/lambda/ec2-management/index.ts` — tag merging now uses a `Map<string, string>` to deduplicate, with user tags winning on conflict.

### Still Needed
- Unit test covering the tag merge logic to catch regressions

---

## 3. VPC Limit — Use Existing VPC

### What Happened
Account `123456789012` in `us-west-2` had hit the default VPC limit (5). CDK attempted to create a new VPC and failed.

### Fix Applied
- `lib/workstation-infrastructure-stack.ts` — replaced `new ec2.Vpc(...)` with `ec2.Vpc.fromLookup(this, 'WorkstationVPC', { vpcId: 'vpc-0123456789abcdef0' })`
- `lib/workstation-api-stack.ts` — changed `vpc: ec2.Vpc` prop type to `ec2.IVpc`
- `lib/workstation-infrastructure-stack.ts` — `addInterfaceEndpoint()` calls replaced with explicit `new ec2.InterfaceVpcEndpoint(...)` constructors (required for `IVpc`)

### Still Needed
- Make the VPC ID configurable via CDK context (`cdk.json`) or an environment variable rather than hardcoded in the stack
- Document the VPC ID and subnet layout in `DEPLOYMENT_GUIDE.md`

---

## 4. Gateway Endpoints Already Exist in VPC

### What Happened
The existing VPC `vpc-0123456789abcdef0` already had S3 and DynamoDB gateway endpoints. CDK tried to create them again and failed with `route table already has a route`.

### Fix Applied
`lib/workstation-infrastructure-stack.ts` — removed `GatewayVpcEndpoint` constructs for S3 and DynamoDB.

### Still Needed
- Before any future VPC reuse, check existing endpoints with:
  ```bash
  aws ec2 describe-vpc-endpoints --filters Name=vpc-id,Values=<vpc-id>
  ```
- Add CDK context flag `existingGatewayEndpoints: true` to skip creation conditionally

---

## 5. EC2 Instances Launching Without Public IP

### What Happened
Both subnets in the existing VPC have `MapPublicIpOnLaunch=false`. Instances launched without a public IP, causing the DCV connection URL to render as `https://undefined:8443`.

### Fix Applied
`src/lambda/ec2-management/index.ts` — `RunInstancesCommand` now uses `NetworkInterfaces` with `AssociatePublicIpAddress: true` instead of top-level `SubnetId`/`SecurityGroupIds`:

```typescript
NetworkInterfaces: [{
  DeviceIndex: 0,
  SubnetId: subnetId,
  Groups: [securityGroupId],
  AssociatePublicIpAddress: true,
}]
```

### Still Needed
- For production, evaluate using an Elastic IP or an internal-only connection via SSM Session Manager instead of public IPs
- If workstations should not be publicly reachable, remove `AssociatePublicIpAddress` and route DCV traffic through a load balancer or VPN

---

## 6. IAM Condition `aws:ResourceTag` Cannot Gate `RunInstances`

### What Happened
The CDK-generated Lambda role policy allowed `ec2:RunInstances` only when `aws:ResourceTag/Project == NyroForge`. `aws:ResourceTag` checks tags that already exist on the resource — impossible for a new instance that hasn't been created yet. Every launch was silently blocked.

### Fix Applied
- **Immediate:** Added inline IAM policy `WorkstationLaunchPolicy` directly to the role, granting EC2 mutating actions without a tag condition
- **CDK source:** `lib/workstation-api-stack.ts` — condition changed from `aws:ResourceTag/Project` to `aws:RequestTag/Project` (checks tags being set in the request)

### Still Needed
- The inline policy and the CDK-managed policy now overlap. On next `cdk deploy`, the CDK policy will be updated to use `aws:RequestTag`, making the inline policy redundant. Remove the inline `WorkstationLaunchPolicy` after the next full CDK deploy.

---

## 7. EFS Enabled by Default

### What Happened
`bin/app.ts` had `enableEfs: true` hardcoded, meaning EFS deployed with every stack — unexpected cost (~$30–500/month) and not needed for initial deployment.

### Fix Applied
`bin/app.ts` — changed to `enableEfs: process.env.ENABLE_EFS === 'true'`, matching the opt-in pattern of all other storage options.

---

## 8. Bootstrap Packages Table Not Seeded

### What Happened
`WorkstationBootstrapPackages` DynamoDB table was empty after fresh deployment. No seed data mechanism exists in CDK.

### Fix Applied
Manually seeded 12 packages via `dynamodb:BatchWriteItem`. Packages include NVIDIA/AMD drivers, Chrome, 7-Zip, Notepad++, AWS CLI, VLC, HandBrake, Acrobat Reader, Git, Python 3.11, VS Code.

### Still Needed
- Add a CDK `CustomResource` or a `scripts/seed-bootstrap-packages.ts` script that runs post-deploy to populate default packages
- `isRequired` must be stored as a `String` (`"true"`/`"false"`), not a `Boolean`, because `RequiredIndex` GSI uses `AttributeType.STRING`

---

## 9. Bootstrap Package API Pointing at Wrong Base URL

### What Happened
Several API client methods in `frontend/src/services/api.ts` called `/admin/bootstrap-packages` or `/bootstrap-packages` against the **main API** (`<MAIN_API_ID>`). Bootstrap packages are only exposed by the **Admin API** (`<ADMIN_API_ID>`). Affected methods:

- `getBootstrapPackages()` — user-side launch modal
- `getAdminBootstrapPackages()` — admin panel
- `createBootstrapPackage()`, `updateBootstrapPackage()`, `deleteBootstrapPackage()`

### Fix Applied
All five methods updated to pass `useAdminApi: true` (third argument to `this.request()`) and use `/bootstrap-packages` path (not `/admin/bootstrap-packages`).

### Still Needed
- The main API (`WorkstationApiStack`) has a `BootstrapConfigService` Lambda wired to no API route. Either:
  - Remove the Lambda and its permissions from `workstation-api-stack.ts` (duplicate of admin service), or
  - Add a `GET /bootstrap-packages` route on the main API for read-only user access (avoids coupling to admin API)

---

## 10. Lambda Fallback Region Defaults to `us-east-1`

### What Happened
Two Lambda functions use `process.env.AWS_REGION || 'us-east-1'` as a fallback. Since this project defaults to `us-west-2`, the fallback is wrong and would misdirect SDK calls if `AWS_REGION` were unset.

### Files
- `src/lambda/instance-type-service/index.ts` lines 205, 376
- `src/lambda/storage-service/index.ts` line 56

### Still Needed
Change fallback from `'us-east-1'` to `'us-west-2'` in both files. `AWS_REGION` is always set by Lambda at runtime so this is low priority, but the wrong default is a latent bug.

---

## 11. Deprecated CDK `logRetention` API

### What Happened
All Lambda functions use `logRetention: logs.RetentionDays.ONE_MONTH` which is deprecated in favour of `logGroup`. CDK prints a warning but still deploys.

### Still Needed
Replace `logRetention` with an explicit `logGroup` on each Lambda function:

```typescript
logGroup: new logs.LogGroup(this, 'MyFunctionLogs', {
  retention: logs.RetentionDays.ONE_MONTH,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
}),
```

This is a low-risk, low-urgency cleanup but will become a breaking change on the next CDK major version.

---

## 12. `retainVpcOnDelete` Prop No Longer Used

### What Happened
`WorkstationInfrastructureStackProps` still exposes `retainVpcOnDelete?: boolean` and `bin/app.ts` still passes it, but the VPC is now looked up (not created), so there is nothing to retain.

### Still Needed
- Remove `retainVpcOnDelete` from the props interface and `bin/app.ts`
- Remove the comment block in `WorkstationInfrastructureStack` referencing VPC retention

---

---

## 13. Admin Panel User Management — Wrong API and Wrong Paths

### What Happened
All user/role/group/permission/audit-log methods in `frontend/src/services/api.ts` called paths like `/admin/users`, `/admin/roles`, etc. against the **main API** (`<MAIN_API_ID>`). The main API has no admin routes — those routes live on the **Admin API** (`<ADMIN_API_ID>`) at `/users`, `/roles`, `/groups`, etc. (no `/admin/` prefix).

### Files Fixed
- `frontend/src/services/api.ts` — every user/role/group/permission/audit-log method updated to use `useAdminApi: true` and drop the `/admin/` prefix

### Rule
Any call that should reach the Admin API must pass `useAdminApi: true` as the third argument to `this.request()`. The Admin API base URL is `NEXT_PUBLIC_ADMIN_API_ENDPOINT`. Never put `/admin/` in paths for the Admin API — that prefix only exists on the main API's handful of admin-facing routes.

---

## 14. `cognito-admin-service` Lambda Path Routing Mismatch

### What Happened
The Admin API CDK stack (`lib/workstation-admin-api-stack.ts`) wires `/users`, `/roles`, `/permissions`, `/audit-logs` to the `workstation-cognito-admin-service` Lambda. But the Lambda's router checked `pathParts.includes('cognito-users')` — a legacy prefix that never appeared in any live API route. Every admin panel call returned 404.

Additional mismatches:
- Path segment names `enable`/`disable` didn't match the actual route names `activate`/`suspend`
- Path length and index checks were off by 1 compared to the live `/users/{id}` paths
- No handler existed for `GET /users/{id}`, `PUT /users/{id}`, `/roles`, `/permissions`, or `/audit-logs`

### Files Fixed
- `src/lambda/cognito-admin-service/index.ts` — router updated to match `/users` (not `cognito-users`); path indices corrected; `activate`/`suspend` keywords added; `getUser`, `updateUser`, `listRoles`, `createRole`, `updateRole`, `deleteRoleById`, `listPermissions`, `listAuditLogs` handlers added

### Rule
When adding a new Lambda to the Admin API CDK stack, verify that the route path the Lambda receives in `event.path` matches what the Lambda's router actually checks. Test with a direct `aws lambda invoke` using a realistic payload before deploying.

---

## 15. Cognito User Shape vs Frontend `EnhancedUser` Shape

### What Happened
The `listUsers` function returned raw Cognito records — `{ Attributes: [{Name, Value}], Username, Enabled, UserStatus }`. The frontend expects a flat `EnhancedUser` object — `{ id, name, email, status, roleIds, ... }`. All users displayed as "No Name" because `user.name` was `undefined`.

### Files Fixed
- `src/lambda/cognito-admin-service/index.ts` — added `mapCognitoUser()` helper that extracts `given_name`/`family_name` → `name`, `email` attribute → `email`, `sub` → `id`, and maps `Enabled`/`UserStatus` → `status`

### Rule
Cognito's `ListUsers` / `AdminGetUser` responses use an `Attributes[]` array. Always map to a flat domain object before returning from the Lambda. The frontend `EnhancedUser` type is the authoritative shape.

---

## 16. `CognitoGroupsList` and `EnhancedUserEditModal` Hardcoded Wrong API Paths

### What Happened
`frontend/src/components/admin/CognitoGroupsList.tsx` and `EnhancedUserEditModal.tsx` bypassed `api.ts` named methods and called `apiClient.get('/admin/cognito-groups')` / `apiClient.post('admin/cognito-users/...')` directly — hitting the main API at paths that don't exist.

### Files Fixed
- `CognitoGroupsList.tsx` — replaced direct calls with `apiClient.getGroups()`, `createGroup()`, `deleteGroup()`
- `EnhancedUserEditModal.tsx` — replaced all hardcoded paths with admin API calls; password reset uses `apiClient.setUserPassword()`

### Rule
Never call `apiClient.get/post/delete` with a hardcoded path string for admin operations. Always add a named method to `api.ts` so the `useAdminApi` flag and path are centrally managed.

---

## 17. Create User Requires Password — None Sent by Form

### What Happened
`UserForm.tsx` submits `{ email, name, roleIds, groupIds }` with no password field. The Lambda's `AdminCreateUserCommand` requires a temporary password. Every create call returned 400 "Email and password are required".

### Fix Applied
`src/lambda/cognito-admin-service/index.ts` — when no `password` or `temporaryPassword` is in the request body, the Lambda auto-generates a secure temporary password (`Tmp-<random>`) and returns it in the response body so the admin can share it. `MessageAction: 'SUPPRESS'` prevents Cognito from sending a welcome email.

### Still Needed
- Surface the auto-generated password in the UI after successful creation so the admin can copy it

---

## 18. `user-management-service` Admin Check Uses Empty DynamoDB Table

### What Happened
`checkAdminPermission()` in `src/lambda/user-management-service/index.ts` looked up the caller's `sub` in the `EnhancedUsers` DynamoDB table. Since that table is empty (users only exist in Cognito), every call returned 403 "Admin access required" — blocking soft-delete, hard-delete, and password management.

### Files Fixed
- `src/lambda/user-management-service/index.ts` — added `checkAdminPermissionFromClaims()` which reads the `cognito:groups` claim injected by API Gateway's Cognito authorizer. The permission check now tries JWT claims first, then falls back to DynamoDB.

### Rule
Never rely solely on DynamoDB for admin permission checks when users are managed in Cognito. The API Gateway Cognito authorizer injects verified claims into `event.requestContext.authorizer.claims` — use those as the primary authority.

---

## 19. DynamoDB GSI Rejects Boolean `isSystem` Field

### What Happened
`createRole()` stored `isSystem: false` as a JavaScript boolean. The `SystemRoleIndex` GSI on the `UserRoles` table defines `isSystem` as `AttributeType.STRING`. DynamoDB rejected every `PutItem` with: `Type mismatch for Index Key isSystem Expected: S Actual: BOOL`. Roles could neither be created nor updated.

### Files Fixed
- `src/lambda/cognito-admin-service/index.ts` — `createRole` now stores `isSystem: 'false'` (string); `updateRole` coerces any existing boolean to string before writing

### Rule
Any attribute used as a GSI partition or sort key must match the declared `AttributeType` exactly. If the CDK declares `AttributeType.STRING`, store `'true'`/`'false'` strings — not booleans. See also: `isRequired` in `WorkstationBootstrapPackages` (item 8 above).

---

## 20. Truthy Check on `'false'` String Blocks Role Updates

### What Happened
After fixing `isSystem` to a string (item 19), `updateRole` checked `if (result.Item.isSystem)` to guard against editing system roles. In JavaScript, any non-empty string — including `'false'` — is truthy. Every role update was blocked with "Cannot update system roles".

### Files Fixed
- `src/lambda/cognito-admin-service/index.ts` — guard changed to `if (result.Item.isSystem === true || result.Item.isSystem === 'true')` in both `updateRole` and `deleteRoleById`

### Rule
Never use a bare truthy check on a field that stores boolean-as-string values. Always compare with strict equality against the expected truthy string (`=== 'true'`).

---

## Deployment Checklist (for Next Deploy)

- [ ] Run `cdk deploy --all` to apply `aws:RequestTag` IAM condition fix
- [ ] After deploy, delete the manual `WorkstationLaunchPolicy` inline policy from the Lambda role
- [ ] Verify bootstrap packages survive re-deploy (table has `removalPolicy: DESTROY` in dev)
- [ ] Change region fallbacks from `us-east-1` → `us-west-2` in instance-type-service and storage-service
- [ ] Make VPC ID configurable via CDK context instead of hardcoded string
- [ ] Add post-deploy seed script for bootstrap packages

---

## Known Account Constraints

| Constraint | Detail |
|---|---|
| Tag policy | `owner` must be lowercase. Applies to all taggable resources. |
| VPC limit | Account is at the 5-VPC limit in `us-west-2`. Must reuse `vpc-0123456789abcdef0`. |
| Subnet public IP | Both subnets have `MapPublicIpOnLaunch=false`. Must use `AssociatePublicIpAddress: true` in `RunInstances`. |
| Existing gateway endpoints | S3 and DynamoDB gateway endpoints already exist in the VPC. Do not attempt to recreate them. |
| Cognito self-signup | Disabled. All users must be admin-created or use the Admin API `POST /users`. |
