#!/usr/bin/env ts-node

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_OUTPUTS = 'cdk-outputs.json';
const DEFAULT_TIMEOUT_MS = 10_000;
const REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/;

export type CheckStatus = 'pass' | 'warning' | 'fail' | 'skipped';
export type CheckCategory =
  | 'local'
  | 'identity'
  | 'network'
  | 'gpu'
  | 'cognito'
  | 'ami'
  | 'ssm'
  | 'application'
  | 'cost-controls'
  | 'remote-access';

export interface CommandSpec {
  command: string;
  args: string[];
  timeoutMs: number;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export type CommandRunner = (spec: CommandSpec) => Promise<CommandResult>;

export interface DoctorCheck {
  id: string;
  category: CheckCategory;
  title: string;
  status: CheckStatus;
  required: boolean;
  message: string;
  action?: string;
}

export interface DoctorReport {
  schemaVersion: 1;
  generatedAt: string;
  region?: string;
  profile?: string;
  outputsFile: string;
  results: DoctorCheck[];
  summary: Record<CheckStatus, number> & { total: number; requiredFailures: number };
}

export interface DoctorExecution {
  exitCode: 0 | 1 | 2;
  stdout: string;
  stderr: string;
  report?: DoctorReport;
}

interface DoctorOptions {
  json: boolean;
  help: boolean;
  region?: string;
  profile?: string;
  outputs: string;
}

interface DoctorDependencies {
  runner?: CommandRunner;
  readFile?: (path: string) => Promise<string>;
  timeoutMs?: number;
  now?: () => Date;
}

interface AwsContext {
  options: DoctorOptions;
  runner: CommandRunner;
  timeoutMs: number;
}

const HELP = `NyroForge deployment doctor

Usage: npm run doctor -- [options]

Runs bounded, read-only checks against local tools and AWS. It never changes
resources. A missing optional deployment configuration is reported as a warning.

Options:
  --region <region>    AWS region to inspect (otherwise uses AWS CLI config)
  --profile <profile>  AWS CLI named profile
  --outputs <path>     CDK outputs JSON file (default: cdk-outputs.json)
  --json               Emit JSON only (no ANSI or progress output)
  --help, -h           Show this help

Exit codes:
  0  No required checks failed
  1  One or more required checks failed
  2  Invalid arguments
`;

function parseArgs(argv: string[]): { options?: DoctorOptions; error?: string } {
  const options: DoctorOptions = { json: false, help: false, outputs: DEFAULT_OUTPUTS };
  const valued = new Set(['--region', '--profile', '--outputs']);

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (raw === '--json') {
      options.json = true;
      continue;
    }
    if (raw === '--help' || raw === '-h') {
      options.help = true;
      continue;
    }

    const equals = raw.indexOf('=');
    const flag = equals >= 0 ? raw.slice(0, equals) : raw;
    if (!valued.has(flag)) {
      return { error: `Unknown option: ${raw}` };
    }
    const value = equals >= 0 ? raw.slice(equals + 1) : argv[++index];
    if (!value || value.startsWith('--')) {
      return { error: `${flag} requires a value` };
    }
    if (flag === '--region') options.region = value;
    if (flag === '--profile') options.profile = value;
    if (flag === '--outputs') options.outputs = value;
  }

  if (options.region && !REGION_PATTERN.test(options.region)) {
    return { error: `Invalid AWS region: ${options.region}` };
  }
  if (options.profile && !/^[A-Za-z0-9_+=,.@-]+$/.test(options.profile)) {
    return { error: 'Invalid AWS profile name' };
  }
  if (!options.outputs.trim()) {
    return { error: '--outputs requires a non-empty path' };
  }
  return { options };
}

export function redact(input: string): string {
  return input
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '[REDACTED_AWS_ACCESS_KEY]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]')
    .replace(/((?:password|passwd|secret|token|sessionToken|accessKey)\s*[=:]\s*)[^\s,;"'}]+/gi, '$1[REDACTED]')
    .replace(/("(?:password|secret|token|accessKeyId|secretAccessKey|sessionToken)"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2');
}

export const defaultCommandRunner: CommandRunner = async ({ command, args, timeoutMs }) => {
  try {
    const result = await execFileAsync(command, args, {
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
      windowsHide: true,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as Error & { code?: string | number; killed?: boolean; stdout?: string; stderr?: string };
    return {
      exitCode: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? failure.message,
      timedOut: failure.killed === true || failure.code === 'ETIMEDOUT',
    };
  }
};

async function boundedRun(runner: CommandRunner, spec: CommandSpec): Promise<CommandResult> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<CommandResult>(resolve => {
    timer = setTimeout(() => resolve({ exitCode: 124, stdout: '', stderr: 'Command timed out', timedOut: true }), spec.timeoutMs);
  });
  try {
    return await Promise.race([runner(spec), timeout]);
  } catch (error) {
    return { exitCode: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function failureMessage(result: CommandResult): string {
  if (result.timedOut) return 'Check timed out before AWS or the local tool responded.';
  const detail = redact(result.stderr.trim()).slice(0, 240);
  return detail ? `Command failed: ${detail}` : `Command failed with exit code ${result.exitCode}.`;
}

function parseJson(stdout: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

async function aws(context: AwsContext, service: string, operation: string, args: string[] = []): Promise<CommandResult> {
  const global = ['--no-cli-pager', '--output', 'json'];
  if (context.options.region) global.push('--region', context.options.region);
  if (context.options.profile) global.push('--profile', context.options.profile);
  return boundedRun(context.runner, {
    command: 'aws',
    args: [service, operation, ...args, ...global],
    timeoutMs: context.timeoutMs,
  });
}

function check(
  id: string,
  category: CheckCategory,
  title: string,
  status: CheckStatus,
  required: boolean,
  message: string,
  action?: string,
): DoctorCheck {
  return { id, category, title, status, required, message: redact(message), ...(action ? { action } : {}) };
}

function flattenOutputs(value: unknown, destination: Record<string, string>): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (typeof nested === 'string') destination[key.toLowerCase()] = nested;
    else flattenOutputs(nested, destination);
  }
}

function arrayAt<T = Record<string, unknown>>(value: Record<string, unknown> | undefined, key: string): T[] {
  const candidate = value?.[key];
  return Array.isArray(candidate) ? candidate as T[] : [];
}

async function localChecks(context: AwsContext): Promise<DoctorCheck> {
  const tools = [
    { command: 'node', args: ['--version'], label: 'Node.js' },
    { command: 'npm', args: ['--version'], label: 'npm' },
    { command: 'aws', args: ['--version'], label: 'AWS CLI' },
    { command: 'npx', args: ['--no-install', 'cdk', '--version'], label: 'AWS CDK' },
  ];
  const failures: string[] = [];
  for (const tool of tools) {
    const result = await boundedRun(context.runner, { ...tool, timeoutMs: context.timeoutMs });
    if (result.exitCode !== 0) failures.push(`${tool.label}: ${failureMessage(result)}`);
  }
  return failures.length === 0
    ? check('local-prerequisites', 'local', 'Local prerequisites', 'pass', true, 'Node.js, npm, AWS CLI, and AWS CDK responded successfully.')
    : check('local-prerequisites', 'local', 'Local prerequisites', 'fail', true, failures.join(' '), 'Install or repair the listed tool, then rerun the doctor.');
}

async function identityCheck(context: AwsContext): Promise<{ result: DoctorCheck; account?: string }> {
  if (!context.options.region) {
    const args = ['configure', 'get', 'region'];
    if (context.options.profile) args.push('--profile', context.options.profile);
    const configuredRegion = await boundedRun(context.runner, { command: 'aws', args, timeoutMs: context.timeoutMs });
    const region = configuredRegion.stdout.trim();
    if (configuredRegion.exitCode !== 0 || !REGION_PATTERN.test(region)) {
      return { result: check('aws-identity-region', 'identity', 'AWS identity and region', 'fail', true, configuredRegion.exitCode === 0 ? 'AWS CLI has no valid default region.' : failureMessage(configuredRegion), 'Pass --region or configure a default AWS CLI region.') };
    }
    context.options.region = region;
  }

  const identity = await aws(context, 'sts', 'get-caller-identity');
  if (identity.exitCode !== 0) {
    return { result: check('aws-identity-region', 'identity', 'AWS identity and region', 'fail', true, failureMessage(identity), 'Refresh AWS credentials and verify the selected profile and region.') };
  }
  const data = parseJson(identity.stdout);
  const account = typeof data?.Account === 'string' ? data.Account : undefined;
  if (!account) {
    return { result: check('aws-identity-region', 'identity', 'AWS identity and region', 'fail', true, 'AWS returned no account identifier.', 'Verify that aws sts get-caller-identity returns JSON.') };
  }
  return {
    account,
    result: check('aws-identity-region', 'identity', 'AWS identity and region', 'pass', true, `Authenticated to AWS account ${account} in ${context.options.region}.`),
  };
}

async function networkCheck(context: AwsContext, outputs: Record<string, string>): Promise<DoctorCheck> {
  const vpcId = outputs.vpcid;
  if (!vpcId) return check('network', 'network', 'VPC and subnets', 'skipped', false, 'No VpcId was found in the CDK outputs.', 'Deploy the infrastructure or pass its CDK outputs with --outputs.');
  const vpcs = await aws(context, 'ec2', 'describe-vpcs', ['--vpc-ids', vpcId]);
  if (vpcs.exitCode !== 0) return check('network', 'network', 'VPC and subnets', 'fail', true, failureMessage(vpcs), 'Confirm the VPC exists in the selected account and region.');
  const subnets = await aws(context, 'ec2', 'describe-subnets', ['--filters', `Name=vpc-id,Values=${vpcId}`]);
  if (subnets.exitCode !== 0) return check('network', 'network', 'VPC and subnets', 'fail', true, failureMessage(subnets), 'Grant read access to EC2 network metadata and verify the VPC.');
  const subnetCount = arrayAt(parseJson(subnets.stdout), 'Subnets').length;
  return subnetCount > 0
    ? check('network', 'network', 'VPC and subnets', 'pass', true, `VPC ${vpcId} exists and has ${subnetCount} visible subnet(s).`)
    : check('network', 'network', 'VPC and subnets', 'fail', true, `VPC ${vpcId} has no visible subnets.`, 'Create or expose subnets suitable for workstation launches.');
}

async function gpuCheck(context: AwsContext): Promise<DoctorCheck> {
  const quotas = await aws(context, 'service-quotas', 'list-service-quotas', ['--service-code', 'ec2', '--max-results', '100']);
  if (quotas.exitCode !== 0) return check('gpu-capacity', 'gpu', 'GPU quota and offerings', 'fail', true, failureMessage(quotas), 'Grant Service Quotas read access and inspect EC2 GPU quotas.');
  const offerings = await aws(context, 'ec2', 'describe-instance-type-offerings', ['--location-type', 'region', '--filters', 'Name=instance-type,Values=g4dn.*,g5.*,g6.*', '--max-results', '100']);
  if (offerings.exitCode !== 0) return check('gpu-capacity', 'gpu', 'GPU quota and offerings', 'fail', true, failureMessage(offerings), 'Grant EC2 describe access and verify GPU offerings in this region.');
  const quotaItems = arrayAt<Record<string, unknown>>(parseJson(quotas.stdout), 'Quotas');
  const gpuQuotas = quotaItems.filter(item => typeof item.QuotaName === 'string' && /\b(G|VT|P)\b|accelerated|graphics/i.test(item.QuotaName));
  const offered = arrayAt(parseJson(offerings.stdout), 'InstanceTypeOfferings').length;
  if (offered === 0) return check('gpu-capacity', 'gpu', 'GPU quota and offerings', 'fail', true, 'No G4, G5, or G6 instance type offerings were returned for this region.', 'Choose a region with a supported GPU offering.');
  if (gpuQuotas.length === 0) return check('gpu-capacity', 'gpu', 'GPU quota and offerings', 'warning', false, `${offered} GPU offering(s) are visible, but no matching GPU quota could be identified.`, 'Review EC2 On-Demand G and VT quotas before launching.');
  const positive = gpuQuotas.some(item => typeof item.Value === 'number' && item.Value > 0);
  return positive
    ? check('gpu-capacity', 'gpu', 'GPU quota and offerings', 'pass', true, `${offered} GPU offering(s) are visible and at least one matching quota is above zero.`)
    : check('gpu-capacity', 'gpu', 'GPU quota and offerings', 'warning', false, `${offered} GPU offering(s) are visible, but identified GPU quotas are zero.`, 'Request an EC2 GPU quota increase before launch.');
}

async function cognitoCheck(context: AwsContext, outputs: Record<string, string>): Promise<DoctorCheck> {
  const pool = outputs.userpoolid;
  if (!pool) return check('cognito-admin', 'cognito', 'Cognito and administrator', 'skipped', false, 'No UserPoolId was found in the CDK outputs.', 'Pass deployed CDK outputs to verify Cognito and the admin group.');
  const describe = await aws(context, 'cognito-idp', 'describe-user-pool', ['--user-pool-id', pool]);
  if (describe.exitCode !== 0) return check('cognito-admin', 'cognito', 'Cognito and administrator', 'fail', true, failureMessage(describe), 'Verify the user pool ID and Cognito read permissions.');
  const admins = await aws(context, 'cognito-idp', 'list-users-in-group', ['--user-pool-id', pool, '--group-name', 'workstation-admin', '--limit', '1']);
  if (admins.exitCode !== 0) return check('cognito-admin', 'cognito', 'Cognito and administrator', 'fail', true, failureMessage(admins), 'Create the workstation-admin group and verify Cognito read permissions.');
  const count = arrayAt(parseJson(admins.stdout), 'Users').length;
  return count > 0
    ? check('cognito-admin', 'cognito', 'Cognito and administrator', 'pass', true, 'The user pool exists and at least one workstation-admin member is visible.')
    : check('cognito-admin', 'cognito', 'Cognito and administrator', 'fail', true, 'The workstation-admin group has no visible users.', 'Add an enabled administrator to workstation-admin.');
}

async function amiCheck(context: AwsContext): Promise<DoctorCheck> {
  const result = await aws(context, 'ec2', 'describe-images', ['--owners', '801119661308', '--filters', 'Name=name,Values=Windows_Server-2022-English-Full-Base-*', 'Name=state,Values=available', '--max-items', '20']);
  if (result.exitCode !== 0) return check('windows-ami', 'ami', 'Windows AMI availability', 'fail', true, failureMessage(result), 'Grant ec2:DescribeImages and verify the selected region.');
  const count = arrayAt(parseJson(result.stdout), 'Images').length;
  return count > 0
    ? check('windows-ami', 'ami', 'Windows AMI availability', 'pass', true, 'At least one available Amazon-owned Windows Server 2022 AMI is visible. The doctor did not test launching it.')
    : check('windows-ami', 'ami', 'Windows AMI availability', 'fail', true, 'No available Amazon-owned Windows Server 2022 AMI was returned.', 'Confirm AMI availability in the selected region.');
}

async function ssmCheck(context: AwsContext): Promise<DoctorCheck> {
  const names = ['/workstation/config/defaultInstanceType', '/workstation/config/allowedInstanceTypes', '/workstation/config/defaultAutoTerminateHours'];
  const result = await aws(context, 'ssm', 'get-parameters', ['--names', ...names, '--no-with-decryption']);
  if (result.exitCode !== 0) return check('ssm-config', 'ssm', 'SSM configuration', 'warning', false, failureMessage(result), 'Grant ssm:GetParameters or deploy the configuration parameters.');
  const data = parseJson(result.stdout);
  const found = arrayAt(data, 'Parameters').length;
  const invalid = arrayAt(data, 'InvalidParameters').length;
  return found === names.length && invalid === 0
    ? check('ssm-config', 'ssm', 'SSM configuration', 'pass', true, 'Required workstation defaults are present. Parameter values were not requested with decryption and are not included in this report.')
    : check('ssm-config', 'ssm', 'SSM configuration', 'warning', false, `${found} of ${names.length} expected workstation parameters are present.`, 'Deploy or configure the missing /workstation/config parameters.');
}

async function applicationCheck(context: AwsContext, outputs: Record<string, string>, outputsLoaded: boolean): Promise<DoctorCheck> {
  const urls = [outputs.apiendpoint, outputs.adminapiurl, outputs.websiteurl].filter(Boolean);
  if (!outputsLoaded || urls.length === 0) return check('api-frontend', 'application', 'API and frontend configuration', 'warning', false, 'No API or frontend URLs were available in the CDK outputs.', 'Deploy the application and pass its CDK outputs with --outputs.');
  if (urls.some(url => { try { return new URL(url).protocol !== 'https:'; } catch { return true; } })) {
    return check('api-frontend', 'application', 'API and frontend configuration', 'fail', true, 'One or more configured application URLs are invalid or do not use HTTPS.', 'Correct the API/frontend stack outputs and redeploy.');
  }
  const apis = await aws(context, 'apigateway', 'get-rest-apis', ['--limit', '100']);
  if (apis.exitCode !== 0) return check('api-frontend', 'application', 'API and frontend configuration', 'warning', false, failureMessage(apis), 'Grant apigateway:GET to verify deployed REST APIs.');
  const visible = arrayAt(parseJson(apis.stdout), 'items').length;
  return visible > 0
    ? check('api-frontend', 'application', 'API and frontend configuration', 'pass', true, `${urls.length} HTTPS application URL(s) are configured and ${visible} REST API(s) are visible. Endpoint reachability was not tested.`)
    : check('api-frontend', 'application', 'API and frontend configuration', 'fail', true, 'Application URLs are configured, but no REST APIs are visible in this region.', 'Verify API deployment and the selected account and region.');
}

async function costControlCheck(context: AwsContext, outputs: Record<string, string>, account?: string): Promise<DoctorCheck> {
  if (!account) return check('budget-auto-stop', 'cost-controls', 'Budget and auto-stop', 'skipped', false, 'AWS account identity was unavailable, so budgets could not be queried.', 'Fix the AWS identity check and rerun.');
  const budgets = await aws(context, 'budgets', 'describe-budgets', ['--account-id', account, '--max-results', '100']);
  const budgetCount = budgets.exitCode === 0 ? arrayAt(parseJson(budgets.stdout), 'Budgets').length : 0;
  const ruleArn = outputs.autoterminationrulearn;
  if (!ruleArn) {
    const budgetNote = budgets.exitCode === 0 ? `${budgetCount} budget(s) are visible` : 'Budget configuration could not be read';
    return check('budget-auto-stop', 'cost-controls', 'Budget and auto-stop', 'warning', false, `${budgetNote}, but no AutoTerminationRuleArn was found in the outputs.`, 'Configure a budget and deploy the auto-termination schedule.');
  }
  const ruleName = ruleArn.split('/').pop() ?? ruleArn;
  const rule = await aws(context, 'events', 'describe-rule', ['--name', ruleName]);
  if (rule.exitCode !== 0) return check('budget-auto-stop', 'cost-controls', 'Budget and auto-stop', 'warning', false, failureMessage(rule), 'Verify the EventBridge auto-termination rule.');
  const state = parseJson(rule.stdout)?.State;
  if (state !== 'ENABLED') return check('budget-auto-stop', 'cost-controls', 'Budget and auto-stop', 'warning', false, 'The auto-termination rule is not enabled.', 'Enable the deployed auto-termination EventBridge rule.');
  return budgetCount > 0
    ? check('budget-auto-stop', 'cost-controls', 'Budget and auto-stop', 'pass', true, 'The auto-termination rule is enabled and at least one account budget is visible.')
    : check('budget-auto-stop', 'cost-controls', 'Budget and auto-stop', 'warning', false, 'The auto-termination rule is enabled, but no account budget was found.', 'Create an AWS Budget with appropriate alerts.');
}

async function remoteAccessCheck(context: AwsContext, outputs: Record<string, string>): Promise<DoctorCheck> {
  const vpcId = outputs.vpcid;
  if (!vpcId) return check('remote-access', 'remote-access', 'Remote access rules', 'skipped', false, 'No VPC was available for security group inspection.', 'Pass deployed CDK outputs to inspect remote access rules.');
  const result = await aws(context, 'ec2', 'describe-security-groups', ['--filters', `Name=vpc-id,Values=${vpcId}`, '--max-results', '100']);
  if (result.exitCode !== 0) return check('remote-access', 'remote-access', 'Remote access rules', 'warning', false, failureMessage(result), 'Grant ec2:DescribeSecurityGroups to inspect RDP/DCV rules.');
  const groups = arrayAt<Record<string, unknown>>(parseJson(result.stdout), 'SecurityGroups');
  const hasSupportedPort = groups.some(group => arrayAt<Record<string, unknown>>(group, 'IpPermissions').some(permission => {
    const from = permission.FromPort;
    const to = permission.ToPort;
    return typeof from === 'number' && typeof to === 'number' && ((from <= 3389 && to >= 3389) || (from <= 8443 && to >= 8443));
  }));
  return hasSupportedPort
    ? check('remote-access', 'remote-access', 'Remote access rules', 'pass', false, 'A security group rule for RDP or DCV is present. The doctor did not test end-to-end connectivity or rule source safety.')
    : check('remote-access', 'remote-access', 'Remote access rules', 'warning', false, 'No visible security group rule includes RDP (3389) or DCV (8443).', 'Configure restricted ingress for the remote access method you use.');
}

function summarize(results: DoctorCheck[]): DoctorReport['summary'] {
  const summary = { pass: 0, warning: 0, fail: 0, skipped: 0, total: results.length, requiredFailures: 0 };
  for (const result of results) {
    summary[result.status] += 1;
    if (result.required && result.status === 'fail') summary.requiredFailures += 1;
  }
  return summary;
}

function humanReport(report: DoctorReport): string {
  const marker: Record<CheckStatus, string> = { pass: 'PASS', warning: 'WARN', fail: 'FAIL', skipped: 'SKIP' };
  const lines = [
    'NyroForge deployment doctor',
    `Region: ${report.region ?? 'AWS CLI default'}${report.profile ? `  Profile: ${report.profile}` : ''}`,
    `Outputs: ${report.outputsFile}`,
    '',
  ];
  for (const result of report.results) {
    lines.push(`[${marker[result.status]}] ${result.title}${result.required ? ' (required)' : ' (optional)'}`);
    lines.push(`       ${result.message}`);
    if (result.action) lines.push(`       Action: ${result.action}`);
  }
  lines.push('', `Summary: ${report.summary.pass} passed, ${report.summary.warning} warnings, ${report.summary.fail} failed, ${report.summary.skipped} skipped.`);
  return `${lines.join('\n')}\n`;
}

export async function executeDoctor(argv: string[], dependencies: DoctorDependencies = {}): Promise<DoctorExecution> {
  const parsed = parseArgs(argv);
  if (!parsed.options) {
    return { exitCode: 2, stdout: '', stderr: `Error: ${parsed.error}\n\n${HELP}` };
  }
  const options = parsed.options;
  if (options.help) return { exitCode: 0, stdout: HELP, stderr: '' };

  const runner = dependencies.runner ?? defaultCommandRunner;
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const context: AwsContext = { options, runner, timeoutMs };
  const outputValues: Record<string, string> = {};
  let outputsLoaded = false;
  let outputWarning: DoctorCheck | undefined;
  try {
    const content = await (dependencies.readFile ?? (path => readFile(path, 'utf8')))(options.outputs);
    flattenOutputs(JSON.parse(content) as unknown, outputValues);
    outputsLoaded = true;
  } catch (error) {
    const reason = error instanceof SyntaxError ? 'The outputs file is not valid JSON.' : 'The outputs file is missing or unreadable.';
    outputWarning = check('deployment-outputs', 'application', 'Deployment outputs', 'warning', false, reason, `Create it with cdk deploy --outputs-file ${options.outputs}, or pass --outputs <path>.`);
  }

  const results: DoctorCheck[] = [];
  results.push(await localChecks(context));
  const identity = await identityCheck(context);
  results.push(identity.result);
  if (outputWarning) results.push(outputWarning);
  results.push(await networkCheck(context, outputValues));
  results.push(await gpuCheck(context));
  results.push(await cognitoCheck(context, outputValues));
  results.push(await amiCheck(context));
  results.push(await ssmCheck(context));
  results.push(await applicationCheck(context, outputValues, outputsLoaded));
  results.push(await costControlCheck(context, outputValues, identity.account));
  results.push(await remoteAccessCheck(context, outputValues));

  const report: DoctorReport = {
    schemaVersion: 1,
    generatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    ...(options.region ? { region: options.region } : {}),
    ...(options.profile ? { profile: options.profile } : {}),
    outputsFile: options.outputs,
    results,
    summary: summarize(results),
  };
  const exitCode = report.summary.requiredFailures > 0 ? 1 : 0;
  return {
    exitCode,
    stdout: options.json ? `${JSON.stringify(report, null, 2)}\n` : humanReport(report),
    stderr: '',
    report,
  };
}

async function main(): Promise<void> {
  const result = await executeDoctor(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

if (require.main === module) {
  void main();
}
