import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import {
  DescribeImagesCommand,
  DescribeInstanceTypeOfferingsCommand,
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
  DescribeVpcEndpointsCommand,
  DescribeVpcsCommand,
  EC2Client,
} from '@aws-sdk/client-ec2';
import {
  DescribeInstanceInformationCommand,
  GetParametersCommand,
  SSMClient,
} from '@aws-sdk/client-ssm';
import {
  CognitoIdentityProviderClient,
  GetGroupCommand,
  ListUsersInGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { GetServiceQuotaCommand, ServiceQuotasClient } from '@aws-sdk/client-service-quotas';
import { BudgetsClient, DescribeBudgetsCommand } from '@aws-sdk/client-budgets';
import { DescribeRuleCommand, EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { requireAdmin } from '../shared/auth';
import { corsHeaders } from '../shared/http';

export type DeploymentDoctorCheckStatus = 'pass' | 'warning' | 'fail' | 'skipped';
export type DeploymentDoctorOverallStatus = 'pass' | 'warning' | 'fail';

export interface DeploymentDoctorCheck {
  id: string;
  category: string;
  title: string;
  status: DeploymentDoctorCheckStatus;
  required: boolean;
  message: string;
  remediation?: string;
}

export interface DeploymentDoctorReport {
  schemaVersion: '1.0';
  generatedAt: string;
  status: DeploymentDoctorOverallStatus;
  region: string;
  context: { accountId: string; region: string };
  summary: { total: number; pass: number; warning: number; fail: number; skipped: number };
  checks: DeploymentDoctorCheck[];
}

const ec2 = new EC2Client({});
const ssm = new SSMClient({});
const cognito = new CognitoIdentityProviderClient({});
const quotas = new ServiceQuotasClient({});
const budgets = new BudgetsClient({ region: 'us-east-1' });
const eventBridge = new EventBridgeClient({});

const ADMIN_GROUP = 'workstation-admin';
const AUTO_STOP_RULE = 'MediaWorkstation-AutoTerminationCheck';
const GPU_INSTANCE_TYPES = ['g4dn.xlarge', 'g5.xlarge', 'g6.xlarge'];
const CHECK_TIMEOUT_MS = 5_000;
const REQUIRED_VPC_ENDPOINT_SERVICES = ['s3', 'dynamodb', 'ec2', 'ssm', 'ssmmessages', 'ec2messages', 'secretsmanager', 'kms'];
const FRONTEND_PARAMETERS = ['/workstation/frontend/config', '/workstation/frontend/auth'];
const CONFIG_PARAMETERS = [
  '/workstation/config/defaultInstanceType',
  '/workstation/config/allowedInstanceTypes',
  '/workstation/config/defaultAutoTerminateHours',
  '/workstation/config/instanceProfileArn',
];

interface CheckDefinition {
  id: string;
  category: string;
  title: string;
  required: boolean;
  run: (abortSignal: AbortSignal) => Promise<Pick<DeploymentDoctorCheck, 'status' | 'message' | 'remediation'>>;
}

function checkResult(
  status: DeploymentDoctorCheckStatus,
  message: string,
  remediation?: string,
): Pick<DeploymentDoctorCheck, 'status' | 'message' | 'remediation'> {
  return remediation ? { status, message, remediation } : { status, message };
}

async function isolateCheck(definition: CheckDefinition): Promise<DeploymentDoctorCheck> {
  const { run, ...metadata } = definition;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error('Deployment doctor check timed out'));
      }, CHECK_TIMEOUT_MS);
    });
    return { ...metadata, ...(await Promise.race([run(controller.signal), deadline])) };
  } catch {
    return {
      id: definition.id,
      category: definition.category,
      title: definition.title,
      required: definition.required,
      status: definition.required ? 'fail' : 'warning',
      message: definition.required
        ? `Unable to verify required ${definition.title.toLowerCase()}.`
        : `Unable to verify optional ${definition.title.toLowerCase()}.`,
      remediation: 'Review this Lambda’s read-only IAM permissions and the AWS service status, then rerun the doctor.',
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function accountIdFromContext(context: Context): string {
  const match = context.invokedFunctionArn?.match(/^arn:[^:]+:lambda:[^:]*:(\d{12}):/);
  return match?.[1] ?? 'unknown';
}

function reportStatus(checks: DeploymentDoctorCheck[]): DeploymentDoctorOverallStatus {
  if (checks.some((check) => check.status === 'fail')) return 'fail';
  if (checks.some((check) => check.status === 'warning')) return 'warning';
  return 'pass';
}

function buildDefinitions(region: string, accountId: string): CheckDefinition[] {
  const vpcId = process.env.VPC_ID ?? '';
  const userPoolId = process.env.USER_POOL_ID ?? '';

  return [
    {
      id: 'aws-context',
      category: 'aws',
      title: 'AWS account and region context',
      required: true,
      run: async (abortSignal) => accountId !== 'unknown' && Boolean(region)
        ? checkResult('pass', 'The deployed account and region context is available.')
        : checkResult('fail', 'The deployed account or region context is unavailable.', 'Verify the Lambda deployment environment.'),
    },
    {
      id: 'network',
      category: 'network',
      title: 'VPC, subnet, and endpoint configuration',
      required: true,
      run: async (abortSignal) => {
        if (!vpcId) return checkResult('fail', 'No workstation VPC is configured.', 'Redeploy the admin API with VPC_ID configured.');
        const vpcs = await ec2.send(new DescribeVpcsCommand({ VpcIds: [vpcId] }), { abortSignal });
        const subnets = await ec2.send(new DescribeSubnetsCommand({ Filters: [{ Name: 'vpc-id', Values: [vpcId] }] }), { abortSignal });
        const endpoints = await ec2.send(new DescribeVpcEndpointsCommand({ Filters: [{ Name: 'vpc-id', Values: [vpcId] }], MaxResults: 100 }), { abortSignal });
        const vpcAvailable = vpcs.Vpcs?.some((vpc) => vpc.State === 'available');
        const availableSubnets = subnets.Subnets?.filter((subnet) => subnet.State === 'available').length ?? 0;
        if (!vpcAvailable || availableSubnets === 0) {
          return checkResult('fail', 'The workstation VPC or its subnets are not available.', 'Verify the VPC and subnet deployment.');
        }
        const availableServices = new Set((endpoints.VpcEndpoints ?? [])
          .filter((endpoint) => endpoint.State === 'Available')
          .map((endpoint) => endpoint.ServiceName?.split('.').pop())
          .filter((service): service is string => Boolean(service)));
        const missingServices = REQUIRED_VPC_ENDPOINT_SERVICES.filter((service) => !availableServices.has(service));
        if (missingServices.length > 0) {
          return checkResult('warning', `The VPC has ${availableSubnets} available subnet(s), but ${missingServices.length} recommended endpoint service(s) are missing.`, `Add ${missingServices.join(', ')} endpoints or confirm equivalent NAT/internet egress.`);
        }
        return checkResult('pass', `The VPC, ${availableSubnets} subnet(s), and all recommended endpoint services are available.`);
      },
    },
    {
      id: 'gpu-offerings',
      category: 'compute',
      title: 'GPU instance offerings',
      required: true,
      run: async (abortSignal) => {
        const response = await ec2.send(new DescribeInstanceTypeOfferingsCommand({
          LocationType: 'region',
          Filters: [{ Name: 'instance-type', Values: GPU_INSTANCE_TYPES }],
          MaxResults: 10,
        }), { abortSignal });
        const count = response.InstanceTypeOfferings?.length ?? 0;
        return count > 0
          ? checkResult('pass', `${count} supported GPU instance offering(s) are available in this region.`)
          : checkResult('fail', 'No supported GPU instance offerings were found in this region.', 'Choose a region that offers a supported G-family instance type.');
      },
    },
    {
      id: 'gpu-quota',
      category: 'compute',
      title: 'GPU On-Demand quota',
      required: false,
      run: async (abortSignal) => {
        const response = await quotas.send(new GetServiceQuotaCommand({ ServiceCode: 'ec2', QuotaCode: 'L-DB2E81BA' }), { abortSignal });
        const value = response.Quota?.Value;
        return typeof value === 'number' && value > 0
          ? checkResult('pass', 'The regional G and VT On-Demand instance quota is greater than zero.')
          : checkResult('warning', 'The regional G and VT On-Demand instance quota is zero or unavailable.', 'Request an EC2 G and VT On-Demand quota increase before launching GPU workstations.');
      },
    },
    {
      id: 'cognito-admin',
      category: 'identity',
      title: 'Cognito administrator group and user',
      required: true,
      run: async (abortSignal) => {
        if (!userPoolId) return checkResult('fail', 'No Cognito user pool is configured.', 'Redeploy with USER_POOL_ID configured.');
        await cognito.send(new GetGroupCommand({ UserPoolId: userPoolId, GroupName: ADMIN_GROUP }), { abortSignal });
        const users = await cognito.send(new ListUsersInGroupCommand({ UserPoolId: userPoolId, GroupName: ADMIN_GROUP, Limit: 1 }), { abortSignal });
        return (users.Users?.length ?? 0) > 0
          ? checkResult('pass', 'The exact workstation-admin group exists and contains an administrator.')
          : checkResult('fail', 'The workstation-admin group has no administrator.', 'Add at least one active user to the exact workstation-admin Cognito group.');
      },
    },
    {
      id: 'workstation-ami',
      category: 'compute',
      title: 'Workstation AMI',
      required: true,
      run: async (abortSignal) => {
        const configuredAmi = process.env.DEFAULT_AMI_ID?.trim();
        const response = configuredAmi
          ? await ec2.send(new DescribeImagesCommand({ ImageIds: [configuredAmi] }), { abortSignal })
          : await ec2.send(new DescribeImagesCommand({
              Owners: ['801119661308'],
              Filters: [
                { Name: 'name', Values: ['Windows_Server-2022-English-Full-Base-*'] },
                { Name: 'state', Values: ['available'] },
              ],
            }), { abortSignal });
        return response.Images?.some((image) => image.State === 'available')
          ? checkResult('pass', configuredAmi ? 'The configured workstation AMI exists and is available.' : 'A default Windows workstation AMI is available.')
          : checkResult('fail', configuredAmi ? 'The configured workstation AMI is unavailable.' : 'No default Windows workstation AMI was found.', 'Configure an available AMI in this region.');
      },
    },
    {
      id: 'ssm',
      category: 'management',
      title: 'SSM connectivity and workstation parameters',
      required: true,
      run: async (abortSignal) => {
        const parameters = await ssm.send(new GetParametersCommand({ Names: CONFIG_PARAMETERS, WithDecryption: false }), { abortSignal });
        const found = new Set(parameters.Parameters?.map((parameter) => parameter.Name).filter(Boolean));
        const missing = CONFIG_PARAMETERS.filter((name) => !found.has(name));
        if (missing.length > 0) {
          return checkResult('fail', `${missing.length} required workstation configuration parameter(s) are missing.`, 'Redeploy the infrastructure configuration parameters.');
        }
        const managed = await ssm.send(new DescribeInstanceInformationCommand({ MaxResults: 5 }), { abortSignal });
        if (!(managed.InstanceInformationList?.some((instance) => instance.PingStatus === 'Online'))) {
          return checkResult('warning', 'Workstation configuration parameters exist, but no online SSM managed instance was found.', 'This is expected before the first launch; after launch, verify the SSM agent and instance profile.');
        }
        return checkResult('pass', 'Required workstation parameters exist and an SSM managed instance is online.');
      },
    },
    {
      id: 'application-config',
      category: 'application',
      title: 'Admin API and frontend configuration',
      required: true,
      run: async (abortSignal) => {
        const response = await ssm.send(new GetParametersCommand({ Names: FRONTEND_PARAMETERS, WithDecryption: false }), { abortSignal });
        const found = new Set(response.Parameters?.map((parameter) => parameter.Name).filter(Boolean));
        const missing = FRONTEND_PARAMETERS.filter((name) => !found.has(name));
        return missing.length === 0
          ? checkResult('pass', 'The authenticated Admin API is reachable and both frontend configuration parameters exist.')
          : checkResult('fail', `${missing.length} frontend configuration parameter(s) are missing.`, 'Redeploy frontend configuration and verify the Admin API endpoint supplied to the frontend build.');
      },
    },
    {
      id: 'budget',
      category: 'cost',
      title: 'Budget configuration',
      required: false,
      run: async (abortSignal) => {
        const response = await budgets.send(new DescribeBudgetsCommand({ AccountId: accountId, MaxResults: 5 }), { abortSignal });
        return (response.Budgets?.length ?? 0) > 0
          ? checkResult('pass', 'At least one AWS budget is configured for this account.')
          : checkResult('warning', 'No AWS budget was found for this account.', 'Create a monthly AWS Budget with notifications for workstation spend.');
      },
    },
    {
      id: 'auto-stop',
      category: 'cost',
      title: 'Auto-stop configuration',
      required: true,
      run: async (abortSignal) => {
        const response = await eventBridge.send(new DescribeRuleCommand({ Name: AUTO_STOP_RULE }), { abortSignal });
        return response.State === 'ENABLED'
          ? checkResult('pass', 'The scheduled workstation auto-termination check is enabled.')
          : checkResult('fail', 'The scheduled workstation auto-termination check is disabled.', 'Enable the MediaWorkstation-AutoTerminationCheck EventBridge rule.');
      },
    },
    {
      id: 'remote-access',
      category: 'access',
      title: 'Remote-access configuration',
      required: false,
      run: async (abortSignal) => {
        if (!vpcId) return checkResult('skipped', 'Remote access was not checked because no VPC is configured.');
        const response = await ec2.send(new DescribeSecurityGroupsCommand({ Filters: [{ Name: 'vpc-id', Values: [vpcId] }] }), { abortSignal });
        let safeSupportedRule = false;
        let unsafeSupportedRule = false;
        for (const group of response.SecurityGroups ?? []) {
          const workstationGroup = /workstation/i.test(`${group.GroupName ?? ''} ${group.Description ?? ''}`);
          for (const permission of group.IpPermissions ?? []) {
            if (!workstationGroup || permission.IpProtocol !== 'tcp' || permission.FromPort === undefined || permission.ToPort === undefined) continue;
            const supported = [3389, 8443].some((port) => permission.FromPort! <= port && permission.ToPort! >= port);
            if (!supported) continue;
            const worldOpen = permission.IpRanges?.some((range) => range.CidrIp === '0.0.0.0/0')
              || permission.Ipv6Ranges?.some((range) => range.CidrIpv6 === '::/0');
            if (worldOpen) unsafeSupportedRule = true;
            else if ((permission.IpRanges?.length ?? 0) + (permission.Ipv6Ranges?.length ?? 0) + (permission.UserIdGroupPairs?.length ?? 0) > 0) safeSupportedRule = true;
          }
        }
        if (unsafeSupportedRule) {
          return checkResult('warning', 'A workstation remote-access rule is open to the world.', 'Restrict RDP/DCV ingress to trusted client CIDRs or security groups.');
        }
        return safeSupportedRule
          ? checkResult('pass', 'A workstation security group has restricted TCP ingress for a supported remote-access port.')
          : checkResult('warning', 'RDP and DCV remote-access rules are not both present.', 'Use the admin security-group workflow to allow only the required trusted client IPs.');
      },
    },
  ];
}

export async function handler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
  const denied = requireAdmin(event);
  if (denied) return denied;

  if (event.httpMethod !== 'GET' || !event.path.endsWith('/admin/deployment-doctor')) {
    return { statusCode: 404, headers: corsHeaders(), body: JSON.stringify({ message: 'Not found' }) };
  }

  const region = process.env.AWS_REGION ?? '';
  const accountId = accountIdFromContext(context);
  const checks = await Promise.all(buildDefinitions(region, accountId).map(isolateCheck));
  const summary = {
    total: checks.length,
    pass: checks.filter((check) => check.status === 'pass').length,
    warning: checks.filter((check) => check.status === 'warning').length,
    fail: checks.filter((check) => check.status === 'fail').length,
    skipped: checks.filter((check) => check.status === 'skipped').length,
  };
  const report: DeploymentDoctorReport = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    status: reportStatus(checks),
    region,
    context: { accountId, region },
    summary,
    checks,
  };

  return {
    statusCode: 200,
    headers: { ...corsHeaders(), 'Cache-Control': 'no-store' },
    body: JSON.stringify(report),
  };
}
