# Bootstrap Package Upload Architecture

**Status:** Implemented · **Date:** 2026-08-24
**Extends:** [POST_BOOT_PACKAGE_INSTALLATION_ARCHITECTURE.md](./POST_BOOT_PACKAGE_INSTALLATION_ARCHITECTURE.md)

## 1. Goal

Let a user drop an installer (DaVinci Resolve, Adobe, in-house tools) onto the bootstrap
page, have it land in the deployment's own S3 bucket, and have the system derive the
`installCommand` / `installArgs` / `expectedSha256` that the Windows package installer
service needs — instead of an admin hand-typing a public `downloadUrl` and silent flags.

## 2. What exists today

| Piece | Location | Behaviour |
|---|---|---|
| Catalog | `WorkstationBootstrapPackages` (pk `packageId`) | Admin CRUD via `/bootstrap-packages` |
| Catalog API | `src/lambda/bootstrap-config-service/index.ts` | GET open to authed users, mutations `requireAdmin` |
| Admin UI | `frontend/src/components/admin/BootstrapPackageManagement.tsx` | Form with free-text `downloadUrl`, `installCommand`, `installArgs` |
| Enqueue | `src/lambda/group-package-service/index.ts:652` | Snapshots catalog fields into `WorkstationPackageQueue` (30d TTL) |
| Installer | `src/windows-service/.../PackageInstallerService.cs` | Plain `HttpClient.GetAsync` (no SigV4) → HTTPS + host allowlist → optional SHA-256 → `Process.Start` |
| Storage | `${project}-transfer-${account}` | SSE-KMS (shared CMK), block-public-all, CORS `*` exposing `ETag` |
| Instance role | `lib/workstation-infrastructure-stack.ts:1164` | `kms:Decrypt` on the CMK; `s3:GetObject` only on the public NVIDIA bucket |
| VPC | `lib/workstation-infrastructure-stack.ts:165` | S3 gateway endpoint already present → in-region pulls are free, no NAT |

## 3. Decisions

1. **Download auth:** instance profile + AWS SDK inside the Windows service. No URL expiry,
   no host-allowlist coupling, per-instance CloudTrail. Costs one service change + redeploy.
2. **Storage:** new dedicated bucket, not a prefix in the transfer bucket (which carries
   lifecycle rules and `autoDeleteObjects: true` in non-prod).
3. **Permissions:** any authenticated user may upload; the package is unusable until an
   admin approves it. Uploading a binary *plus* an install command is arbitrary code
   execution as SYSTEM — the approval gate is the control.
4. **Parameter generation:** fingerprint the binary, match a recipe, prefill editable
   fields with a confidence label. Never silently trust the guess.

## 4. Infrastructure

### 4.1 Packages bucket

```ts
// lib/workstation-infrastructure-stack.ts
const packagesBucket = new s3.Bucket(this, 'PackagesBucket', {
  bucketName: `${projectName}-packages-${cdk.Stack.of(this).account}`,
  encryption: s3.BucketEncryption.KMS,
  encryptionKey: this.kmsKey,            // same CMK the instance role can already decrypt
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  enforceSSL: true,
  versioned: true,
  removalPolicy: cdk.RemovalPolicy.RETAIN,   // never auto-delete, even in dev
  lifecycleRules: [
    { abortIncompleteMultipartUploadAfter: cdk.Duration.days(7) },
    { prefix: 'quarantine/', expiration: cdk.Duration.days(14) },
    { prefix: 'packages/', noncurrentVersionExpiration: cdk.Duration.days(90) },
  ],
  cors: [{
    allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.HEAD],
    allowedOrigins: config.corsOrigins ?? ['*'],   // tighten to the CloudFront domain
    allowedHeaders: ['*'],
    exposedHeaders: ['ETag'],                       // required to complete a multipart upload
    maxAge: 3600,
  }],
});
```

**Key layout — the prefix boundary is the security boundary:**

```
quarantine/{packageId}/{sanitizedFileName}    unreviewed; workstations cannot read this
packages/{packageId}/{sanitizedFileName}      approved; instance role has GetObject here
verify/{packageId}/{sanitizedFileName}        admin-staged trial install; readable, expires in 2 days
```

The `verify/` prefix exists because withholding read on `quarantine/*` is
exactly what stops an unreviewed upload from executing — which also means a
trial install cannot run against a quarantined object. A verify action copies
the artifact somewhere the instance role can reach, deliberately and one
package at a time, onto a workstation the admin names. The copy is deleted on
approval and swept by lifecycle rule regardless.

### 4.2 IAM

```ts
// Workstation instance role — approved packages only, never quarantine
workstationInstanceRole.addToPolicy(new iam.PolicyStatement({
  actions: ['s3:GetObject'],
  resources: [`${packagesBucket.bucketArn}/packages/*`],
}));
// kms:Decrypt on this.kmsKey already granted at line 1184
```

`package-upload-service` gets read/write on `quarantine/*` plus multipart actions.
`package-analyzer` gets `GetObject` on `quarantine/*`. Only the approval handler gets
`s3:PutObject` on `packages/*` and `s3:DeleteObject` on `quarantine/*`.

## 5. Data model

New fields on `BootstrapPackage` (all additive — existing URL-based packages keep working):

```ts
source: 'url' | 's3';          // 'url' for every pre-existing record
s3Bucket?: string;
s3Key?: string;
fileName?: string;
fileSizeBytes?: number;
expectedSha256?: string;       // always set for uploads, computed server-side

status: 'uploading' | 'analyzing' | 'needs_review' | 'approved'
      | 'rejected' | 'analysis_failed';

uploadedBy?: string;           // Cognito email
uploadedAt?: string;
reviewedBy?: string;
reviewedAt?: string;
reviewNotes?: string;

analysis?: {
  installerType: 'msi' | 'inno' | 'nsis' | 'installshield' | 'wix-burn'
               | 'msix' | 'sfx-7z' | 'squirrel' | 'zip' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  architecture?: 'x64' | 'x86' | 'arm64';
  detectedProductName?: string;
  detectedVersion?: string;
  detectedVendor?: string;
  archiveEntry?: string;       // inner installer path when the upload is a .zip
  recipeId?: string;           // which recipe produced the suggestion
  suggestedInstallCommand: string;
  suggestedInstallArgs: string;
  warnings: string[];
  analyzedAt: string;
};
```

`isEnabled` may only be set true when `status === 'approved'` — enforce in
`bootstrap-config-service`, not just the UI.

New GSI on `WorkstationBootstrapPackages` for the review queue:

```ts
{ indexName: 'StatusIndex', partitionKey: 'status' (S), sortKey: 'createdAt' (S) }
```

## 6. Upload flow

API Gateway caps request bodies at 10 MB, so the bytes never touch Lambda. Resolve is
~3–4 GB, which also rules out a single presigned PUT (5 GB cap, one shot, no resume).
Presigned **multipart** it is.

```
Browser                        package-upload-service              S3
   │  POST /bootstrap-packages/uploads
   │      {fileName, fileSizeBytes, contentType}
   │─────────────────────────────────►│
   │                                   │ create catalog row (status: uploading)
   │                                   │ CreateMultipartUpload(quarantine/{id}/{name})
   │                                   │──────────────────────────────►│
   │  ◄── {packageId, uploadId, partSizeBytes, partCount}
   │
   │  POST /uploads/{packageId}/parts  {partNumbers: [1..50]}
   │─────────────────────────────────►│ presign UploadPart × 50 (1h)
   │  ◄── [{partNumber, url}]
   │
   │  PUT part → S3 direct, 4 concurrent, retry per part, capture ETag
   │──────────────────────────────────────────────────────────────────►│
   │      (request another batch of presigned parts as needed)
   │
   │  POST /uploads/{packageId}/complete  {parts: [{PartNumber, ETag}]}
   │─────────────────────────────────►│ CompleteMultipartUpload
   │                                   │ status → analyzing
   │                                   │ Invoke(package-analyzer, Event) ──►
   │  ◄── 200
```

The analyzer is invoked asynchronously by the complete handler rather than by
an S3 `ObjectCreated` notification. A notification would have pointed the
bucket (infrastructure stack) at a Lambda in the admin API stack, which already
depends on the infrastructure stack — a circular stack reference. The direct
invoke also carries the `packageId` rather than making the analyzer re-derive
it from the object key, and Lambda retries a failed async invoke twice on its
own. `POST /bootstrap-packages/{packageId}/review` with `action: "reanalyze"`
covers the case where those retries are also exhausted.

- `partSizeBytes = max(64MB, ceil(fileSizeBytes / 9000))` — keeps part count under the
  10,000 limit for any size while staying efficient for typical 1–5 GB installers.
- **Do not** put `x-amz-server-side-encryption` headers on the presigned `UploadPart`
  signature. Encryption is fixed at `CreateMultipartUpload`; adding it to part signatures
  is the classic cause of `SignatureDoesNotMatch` on SSE-KMS multipart uploads.
- `DELETE /uploads/{packageId}` → `AbortMultipartUpload` + delete the catalog row. The
  7-day abort lifecycle rule cleans up browsers that just close the tab.
- Presigned part URLs are signed by the Lambda role, so they expire with its session.
  Re-request a batch on 403 rather than presigning all 64 parts up front.
- Frontend keeps `{packageId, uploadId, partSize, completedParts[]}` in `localStorage`
  so a refresh mid-upload can resume instead of restarting a 4 GB transfer.

## 7. The analyzer

New Lambda `src/lambda/package-analyzer/`. S3 `ObjectCreated:*` on `quarantine/`,
2048 MB memory, 900 s timeout, **10 GB ephemeral storage** (needed to extract an inner
installer out of a ZIP — Resolve ships that way).

**Pass 1 — hash and size.** Stream `GetObject` through `crypto.createHash('sha256')`.
A 4 GB object in-region runs ~45 s. This is the authoritative hash; do not trust a
browser-computed one, and note that S3's own `ChecksumSHA256` on a multipart object is a
composite-of-parts value, not the whole-object digest.

**Pass 2 — fingerprint.** Ranged reads, cheapest and most definitive checks first:

| Signal | How | Type | Confidence |
|---|---|---|---|
| `D0CF11E0A1B11AE1` at offset 0 | magic | MSI (CFB) | high |
| `PK\x03\x04` + `AppxManifest.xml` in central dir | magic + dir | MSIX/APPX | high |
| PE section named `.wixburn` | PE section table | WiX burn bundle | high |
| `Nullsoft.NSIS.exehead` / `NullsoftInst` | string scan | NSIS | medium |
| `Inno Setup Setup Data` | string scan | Inno Setup | medium |
| `InstallShield` / `ISSetupPrerequisites` / `setup.inx` | string scan | InstallShield | medium |
| `7z` SFX config marker `;!@Install@!UTF-8!` | string scan | 7-Zip SFX | medium |
| `Squirrel` + `Update.exe` | string scan | Squirrel | medium |
| `MZ` only | PE header | unknown EXE | low |

String scans cover the first 2 MB and last 2 MB — enough for every marker above without
reading the whole object twice.

**Metadata extraction:**
- **MSI:** parse the compound file with the `cfb` npm package, read the `Property` table
  for `ProductName`, `ProductVersion`, `ProductCode`, `Manufacturer`. High-value: these
  populate name/version/vendor exactly, no guessing.
- **PE:** parse `VS_VERSIONINFO` from the resource directory for `ProductName`,
  `CompanyName`, `FileVersion`. This is the single best prefill signal for EXEs.
- **ZIP:** read the EOCD + central directory via ranged reads, pick the largest
  `.exe`/`.msi` entry, stream-extract just that entry to `/tmp`, and recurse the
  fingerprint on it. Record it as `analysis.archiveEntry`.

**Pass 3 — recipe match.** `src/lambda/package-analyzer/recipes.json`, evaluated in order:
a vendor rule (regex on filename + optional `CompanyName`/`ProductName` from version info)
wins over the generic installer-type rule.

```jsonc
{
  "installerTypes": {
    "msi":        { "installCommand": "msiexec.exe",
                    "installArgs": "/i \"{installer}\" /qn /norestart" },
    "inno":       { "installCommand": "{installer}",
                    "installArgs": "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-" },
    "nsis":       { "installCommand": "{installer}", "installArgs": "/S" },
    "wix-burn":   { "installCommand": "{installer}", "installArgs": "/quiet /norestart" },
    "installshield": { "installCommand": "{installer}",
                       "installArgs": "/s /v\"/qn REBOOT=ReallySuppress\"" },
    "sfx-7z":     { "installCommand": "{installer}", "installArgs": "-y" },
    "squirrel":   { "installCommand": "{installer}", "installArgs": "--silent" }
  },
  "vendorRules": [
    {
      "id": "blackmagic-resolve",
      "match": { "fileNameRegex": "(?i)davinci[_ ]?resolve.*\\.(zip|exe)$" },
      "installerType": "installshield",
      "warnings": [
        "Resolve's silent flags vary by release — verify on one workstation before publishing.",
        "Studio activation and the first-run registration dialog are not handled by a silent install."
      ]
    }
  ]
}
```

**ZIP output shape.** The Windows service runs exactly one process, so an archive becomes
a single PowerShell invocation — no service change needed:

```
installCommand: powershell.exe
installArgs:    -NoProfile -ExecutionPolicy Bypass -Command
                "$d=Join-Path $env:TEMP 'pkg-{packageId}';
                 Expand-Archive -LiteralPath '{installer}' -DestinationPath $d -Force;
                 $p=Start-Process -FilePath (Join-Path $d '<archiveEntry>')
                    -ArgumentList '<innerArgs>' -Wait -PassThru;
                 exit $p.ExitCode"
```

`exit $p.ExitCode` matters — the service treats a non-zero exit as failure, and without
the propagation every archive install would report success.

On failure the analyzer sets `status: 'analysis_failed'` with the reason and still records
the hash and size, so an admin can fill the fields in manually rather than re-uploading.

## 8. Review and approval

`GET /bootstrap-packages?status=needs_review` (admin, via `StatusIndex`) drives a new
review tab. The approve handler:

1. Validates `installCommand` against an allowlist — `msiexec.exe`, `powershell.exe`,
   `cmd.exe`, or the literal `{installer}`. An approving admin can edit the args freely;
   the allowlist just stops a rogue command name from reaching `Process.Start`.
2. Copies `quarantine/{id}/{name}` → `packages/{id}/{name}`. `CopyObject` handles ≤5 GB;
   above that use `UploadPartCopy` (a Resolve Studio ZIP can get close).
3. Deletes the quarantine object, sets `s3Key`, `status: 'approved'`, `reviewedBy/At`.

Rejection deletes the object and marks the row `rejected` with notes.

The move is not cosmetic — it *is* the enforcement. The instance role can only read
`packages/*`, so an unapproved binary is unreachable by every workstation even if
something else in the catalog points at it.

**Optional hardening:** enable GuardDuty Malware Protection for S3 on this bucket and
block approval while the object carries a `THREATS_FOUND` scan tag.

## 9. Install-path changes

### 9.1 Enqueue

`group-package-service.addPackagesToWorkstation` copies the new fields into the queue item
and refuses to enqueue anything whose `status !== 'approved'`:

```ts
source: packageData.source ?? 'url',
s3Bucket: packageData.s3Bucket,
s3Key: packageData.s3Key,
```

### 9.2 Windows service

Three changes in `src/windows-service/WorkstationPackageInstaller/`:

1. **`WorkstationPackageInstaller.csproj`** — add `AWSSDK.S3`.
2. **`Models/PackageQueueItem.cs`** + `PackageQueueService.MapToPackageQueueItem` — add
   `S3Bucket` / `S3Key` (both optional), and make `DownloadUrl` optional.
3. **`PackageInstallerService.DownloadInstallerAsync`** — branch before `ValidateDownloadUrl`:

```csharp
if (!string.IsNullOrEmpty(package.S3Key))
{
    // Instance profile credentials; SSE-KMS decrypt happens transparently.
    // TransferUtility does a ranged parallel download — meaningfully faster than
    // a single stream for multi-GB installers.
    var transfer = new TransferUtility(_s3Client);
    await transfer.DownloadAsync(installerPath, package.S3Bucket, package.S3Key, cancellationToken);
}
else
{
    ValidateDownloadUrl(package);   // unchanged HTTPS + allowlist path
    ...existing HttpClient download...
}
```

SHA-256 verification runs afterwards unchanged, and uploaded packages always carry a hash.

### 9.3 Pre-existing defects found and fixed

Two of these were discovered while implementing the S3 download path, and
between them meant post-boot package installation could not have been working
at all. They are unrelated to uploads but sit directly in its path.

**The workstation instance role denied every package-queue read.** The policy
carried `dynamodb:LeadingKeys` of `workstation#${ec2:SourceInstanceARN}`.
`ec2:SourceInstanceARN` is an EC2 service condition key and is simply not
present on a DynamoDB request, so the policy variable never resolved and the
condition failed closed; even had it resolved, it expands to a full instance
ARN while the partition key is `workstation#i-0123…`. The installer service
therefore got AccessDenied on every poll.

No IAM condition key carries the bare instance id, so the fix is to make the
key match the one variable that exists: the queue is now partitioned by
**instance ARN**, and the condition is restored as
`ForAllValues:StringEquals` on `workstation#${ec2:SourceInstanceARN}`. A
workstation can now read and update its own partition and provably nothing
else.

Four places build that key and had to agree: `ec2-management` (launch-time
enqueue), `group-package-service` (admin enqueue, status, retry, remove),
`package-upload-service` (trial installs) and `PackageQueueService.cs`, which
now reads region and account from the IMDSv2 instance identity document rather
than just the instance id. The Lambdas take the account id from the API Gateway
request context, falling back to a `DEPLOY_ACCOUNT_ID` environment variable
injected by the stack.

Rows written before the change keep the bare-id key and live up to 30 days
under the queue table's TTL, so reads query both partitions until they age
out. Verification records store the exact partition key they wrote rather than
reconstructing it.

**The queue was written to two different partitions.** `ec2-management` writes
`workstation#{instanceId}` / `package#{packageId}#{order}`, which is what
`PackageQueueService.cs` queries. `group-package-service` wrote and read
`WORKSTATION#{workstationId}` / `PACKAGE#{packageId}` — a different partition
entirely. The two halves failed in complementary ways: packages queued at
launch installed but never appeared in the progress UI, and packages an admin
added appeared in the UI but were never installed. Everything now uses the
installer service's format, and retry/remove locate an item by `packageId`
within the partition instead of reconstructing a sort key, so both historical
shapes still resolve.

### 9.4 Two further defects in the install path

- **`installCommand` is `ProcessStartInfo.FileName`.** The form's placeholder
  suggested `Start-Process`, a PowerShell cmdlet rather than an executable —
  `Process.Start` throws `Win32Exception` on it, so any package saved with the
  suggested value could never install. `BuildInstallArguments` substituted
  `{installer}` into arguments only. A new `ResolveInstallCommand` now performs
  the same substitution on `FileName`, so a generated recipe can say
  `installCommand: "{installer}"` and mean "run the downloaded artifact". The
  path is intentionally left unquoted there: with `UseShellExecute=false` the
  value reaches `CreateProcess` verbatim and surrounding quotes would become
  part of the filename. The form field is now a select over the four permitted
  commands rather than free text.
- **Region-locked allowlist.** `appsettings.json` hardcoded
  `*.s3.us-west-2.amazonaws.com`, and `IsHostAllowed` only understood a leading
  `*.`, so any deployment outside us-west-2 rejected its own bucket endpoint
  before the download began. The matcher now handles `*` anywhere in the
  pattern (anchored, with a bounded-time regex), and the allowlist carries
  `*.s3.*.amazonaws.com`. Uploaded packages bypass this path entirely — they
  are fetched with the instance profile — but URL packages still depend on it.

### 9.5 Rollout ordering

An older installer service ignores `s3Key` and tries an empty `downloadUrl`, so the
service update must reach the fleet **before** the first uploaded package is approved.
Gate on it: have the service report its version into the queue table heartbeat, and have
the approve handler warn when any active workstation is still below the required version.

## 10. API surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/bootstrap-packages/uploads` | authed | init multipart, create row |
| POST | `/bootstrap-packages/uploads/{packageId}/parts` | uploader/admin | batch presign parts |
| POST | `/bootstrap-packages/uploads/{packageId}/complete` | uploader/admin | complete + trigger analysis |
| DELETE | `/bootstrap-packages/uploads/{packageId}` | uploader/admin | abort + cleanup |
| POST | `/bootstrap-packages/{packageId}/review` | admin | `approve` / `reject` / `verify` / `reanalyze` |
| GET | `/bootstrap-packages/{packageId}` | authed | package incl. analysis and live verification state |
| GET | `/bootstrap-packages?status=needs_review` | admin | review queue, via `StatusIndex` |

The review actions share one resource rather than one endpoint each, and
analysis results are read back through the existing single-package GET rather
than a dedicated route — the analyzer writes them onto the package record
anyway.

That frugality was originally forced: the stack synthesized 462 resources
against CloudFormation's hard limit of 500. The real cause turned out to be
`AWS::Lambda::Permission`, at 176 of those 463 — CDK emits two per method, one
for the deploy stage and one for API Gateway's console "Test" button. Setting
`allowTestInvoke: false` on every integration drops the stack to **375
resources**, which costs only the console test feature and avoids splitting the
stack (and with it changing the API's URL).

Uploader-scoped endpoints compare `uploadedBy` against the caller's email claim, matching
the ownership pattern in `group-package-service.requireWorkstationAccess`.

## 11. Frontend

- **`BootstrapPackageForm`** gains a source toggle: *Upload installer* (default) or
  *External URL* (today's behaviour).
- **Upload step:** drag-and-drop, per-part progress bar with overall percentage and
  throughput, cancel, and resume-after-refresh from `localStorage`.
- **Analysis step:** result card — "Detected: Inno Setup · medium confidence" — with the
  prefilled fields visually marked as auto-generated and fully editable, plus any recipe
  warnings shown inline.
- **New `PackageReviewQueue` tab** in `AdminNavigation.tsx`: pending uploads, submitter,
  size, hash, detected type, the exact command that will run, approve/reject/verify,
  with a count badge on the nav item so waiting work is visible without opening it.
- **`/packages`** is the user-facing half. `/admin` redirects non-admins, so the
  wizard living only there meant the chosen "users upload, admins approve" model
  had no route a user could reach. This page carries the same wizard plus the
  submitter's own uploads and their status, including the rejection reason —
  the one thing a user most needs told.
- `frontend/src/services/api.ts`: `initPackageUpload`, `getUploadPartUrls`,
  `completePackageUpload`, `abortPackageUpload`, `getPackageAnalysis`,
  `approvePackage`, `rejectPackage`.

## 12. Phasing

| Phase | Scope | Status |
|---|---|---|
| 1 | Packages bucket + IAM + CDK wiring; catalog schema/GSI; `{installer}` FileName fix; allowlist fix | Done |
| 2 | `package-upload-service` (multipart init/parts/complete/abort) + API routes | Done |
| 3 | Frontend upload wizard with resume | Done |
| 4 | `package-analyzer`: hash, PE/MSI/ZIP fingerprint, recipes, version-info extraction | Done |
| 5 | Review queue UI + approve/reject/promote | Done |
| 6 | Windows service S3 download path | Code complete; not compiled (see below) |
| 7 | Trial-install verification (queue onto a named workstation, capture exit code) | Done |

### Verification performed

`npm run typecheck`, `npm run build:lambdas` and `cdk synth --all` all pass
with no warnings. The backend suite is 310 tests across 15 files (was 202/13),
the frontend 40 across 11 (was 25/10), and `next build` succeeds.

The Windows service is the exception: it targets `net10.0-windows`, which
cannot be compiled on macOS, and no .NET SDK is present. Its changes are
reviewed but unbuilt — compile and run it on Windows before rolling it to the
fleet.

### Runtime and dependency currency

The service was on .NET 8 (end of support November 2026) with AWS SDK v3.7
packages from late 2023. It now targets **.NET 10** (LTS, supported to November
2028) with `Microsoft.Extensions.*` at 10.0.11 and **AWS SDK for .NET v4**.
Versions were resolved from the NuGet API rather than assumed. .NET 9 was
skipped deliberately — it left support in May 2026.

Because the build is `SelfContained` with `PublishSingleFile`, the runtime ships
inside the executable: the build machine needs the .NET 10 SDK (a `global.json`
records that floor), and the workstation AMIs need nothing.

Two AWS SDK v4 breaking changes affect this code, both confirmed against AWS's
own changelog rather than recalled:

- **Value types became nullable.** `AttributeValue.BOOL` is now `bool?`, so
  `item["required"].BOOL` could no longer be a `&&` operand — a compile error,
  now `== true`.
- **Response collections are null by default** where v3 initialised them to
  empty. `AWSConfigs.InitializeCollections = true` in `Program.cs` restores the
  v3 behaviour globally, which is the safer choice than auditing every access on
  a project that cannot be compiled here; `response.Items` in the queue poll is
  additionally null-guarded at the one place it actually matters.

`System.Text.Json` lost its explicit `PackageReference`: it is part of the base
class library on net10.0, so the reference could only pin an older copy than the
runtime ships — and the previous 8.0.4 pin was two security patches behind.

## 13. Publication gates

Approval runs four checks before an artifact is promoted, in this order. Each
returns 409 with an actionable message rather than failing silently.

| Gate | Refuses when | Override |
|---|---|---|
| Installer version | any workstation reports an installer service below 2.0.0 | `force: true` |
| Malware scan | GuardDuty tagged the object `THREATS_FOUND` | none — reject it |
| Trial install | analysis confidence is below `high` and no trial install has passed | `force: true`, recorded in the review notes |
| Integrity | no server-computed SHA-256 exists | none — re-run analysis |

**Installer version.** The Windows service stamps `installerVersion` onto every
queue row it moves to `installing`, so recent queue activity is the evidence.
A workstation that has never installed anything reports nothing and is not
counted — "old service" and "brand new instance" are indistinguishable there,
and blocking on it would make the very first approval impossible. This is the
guardrail the rollout ordering in §9.5 previously left to a note in a document.

**Trial install.** `high` confidence comes from structural facts — an MSI
compound file, a `.wixburn` section — where the command line is defined by the
format itself. Everything below that is an inference about whether a particular
vendor build honours its framework's silent switches, which only running it
settles. Forcing past the gate is allowed and is written into the review notes
as `[verification overridden]`, so the decision is never invisible.

## 14. Version lineage

An upload can declare `supersedesPackageId`. On approval the predecessor is
marked `supersededByPackageId`, disabled, and its group bindings are rewritten
to point at the new package — bindings are keyed `GROUP#<id>` / `PACKAGE#<id>`,
so migration is a write plus a delete rather than an update.

The old package is disabled rather than deleted: its artifact and audit trail
survive, and a workstation part-way through installing it is not left pointing
at an object that has gone. Migration runs only after the new artifact is
safely promoted, and reports any binding it could not move rather than
unwinding an approval that already succeeded.

The analyzer also warns when an upload is byte-identical to an existing
package. That is a warning, not a refusal — deliberately re-uploading to
replace a rejected entry is legitimate.

## 15. Notifications

Two waits existed in the review loop and both were silent: an admin waiting to
learn something was uploaded, and an uploader waiting to learn what was
decided. `src/lambda/shared/notify.ts` closes them over SES — admins are
emailed when a package reaches the review queue, uploaders when it is approved,
rejected, or fails analysis. The admin console also carries a count badge on
the Package review tab.

Delivery is best-effort by construction: every function swallows its own errors
after logging. A failed email must never fail the approval it is reporting on.

## 16. Known limits

- **Silent flags are a guess.** Fingerprinting identifies the *framework* reliably;
  whether a given vendor's build honours the framework's standard flags is only knowable
  by running it. That is what phase 7 exists for — treat medium/low confidence as
  "verify before publishing", and surface it that way in the UI.
- **Resolve specifically** ships as a ZIP wrapping an installer, needs the archive path
  above, and does not handle Studio activation or the first-run registration dialog
  through a silent install. Licensing stays a manual or separately-scripted step.
- **Licensing/redistribution** of vendor installers into the customer's own bucket for
  their own machines is the customer's call; the system does not police EULAs.
- **Cost** is negligible: ~$0.09/month per 4 GB copy in S3 Standard, and downloads are
  free through the existing S3 gateway endpoint. GuardDuty Malware Protection
  for S3 is charged per GB scanned, so it is worth watching if uploads become
  frequent; set `ENABLE_MALWARE_SCANNING=false` to opt out.
- **`RequirePackageHash` is still `false`.** Uploaded packages always carry a
  server-computed hash, but legacy URL packages mostly do not, and the flag is
  global. Run `node scripts/backfill-package-hashes.js --write` to download and
  hash them, then set it to `true` so the installer service fails closed on any
  artifact it cannot verify. The script reports which packages it could not
  hash, and those must be resolved first.
- **The installer-version gate reasons from queue activity.** A workstation that
  has never installed anything reports no version and cannot be judged, so a
  fleet where nothing has ever been installed will not block an approval. This
  is deliberate — the alternative makes the first approval impossible — but it
  means the gate is a strong signal rather than a proof.
