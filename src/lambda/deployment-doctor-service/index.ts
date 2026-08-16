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
  action?: string;
}

export interface DeploymentDoctorReport {
  schemaVersion: '1.0';
  generatedAt: string;
  status: DeploymentDoctorOverallStatus;
  context: { accountId: string; region: string };
  summary: { total: number; passed: number; warnings: number; failed: number; skipped: number };
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
  run: () => Promise<Pick<DeploymentDoctorCheck, 'status' | 'message' | 'action'>>;
}

function checkResult(
  status: DeploymentDoctorCheckStatus,
  message: string,
  action?: string,
): Pick<DeploymentDoctorCheck, 'status' | 'message' | 'action'> {
  return action ? { status, message, action } : { status, message };
}

async function isolateCheck(definition: CheckDefinition): Promise<DeploymentDoctorCheck> {
  const { run, ...metadata } = definition;
  try {
    return { ...metadata, ...(await run()) };
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
      action: 'Review this Lambda’s read-only IAM permissions and the AWS service status, then rerun the doctor.',
    };
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
      run: async () => accountId !== 'unknown' && Boolean(region)
        ? checkResult('pass', 'The deployed account and region context is available.')
        : checkResult('fail', 'The deployed account or region context is unavailable.', 'Verify the Lambda deployment environment.'),
    },
    {
      id: 'network',
      category: 'network',
      title: 'VPC, subnet, and endpoint configuration',
      required: true,
      run: async () => {
        if (!vpcId) return checkResult('fail', 'No workstation VPC is configured.', 'Redeploy the admin API with VPC_ID configured.');
        const vpcs = await ec2.send(new DescribeVpcsCommand({ VpcIds: [vpcId] }));
        const subnets = await ec2.send(new DescribeSubnetsCommand({ Filters: [{ Name: 'vpc-id', Values: [vpcId] }] }));
        const endpoints = await ec2.send(new DescribeVpcEndpointsCommand({ Filters: [{ Name: 'vpc-id', Values: [vpcId] }], MaxResults: 20 }));
        const vpcAvailable = vpcs.Vpcs?.some((vpc) => vpc.State === 'available');
        const availableSubnets = subnets.Subnets?.filter((subnet) => subnet.State === 'available').length ?? 0;
        if (!vpcAvailable || availableSubnets === 0) {
          return checkResult('fail', 'The workstation VPC or its subnets are not available.', 'Verify the VPC and subnet deployment.');
        }
        if (!(endpoints.VpcEndpoints?.some((endpoint) => endpoint.State === 'Available'))) {
          return checkResult('warning', `The VPC has ${availableSubnets} available subnet(s), but no available VPC endpoints were found.`, 'Confirm outbound connectivity or add the endpoints required by private workstations.');
        }
        return checkResult('pass', `The VPC, ${availableSubnets} subnet(s), and at least one VPC endpoint are available.`);
      },
    },
    {
      id: 'gpu-offerings',
      category: 'compute',
      title: 'GPU instance offerings',
      required: true,
      run: async () => {
        const response = await ec2.send(new DescribeInstanceTypeOfferingsCommand({
          LocationType: 'region',
          Filters: [{ Name: 'instance-type', Values: GPU_INSTANCE_TYPES }],
          MaxResults: 10,
        }));
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
      run: async () => {
        const response = await quotas.send(new GetServiceQuotaCommand({ ServiceCode: 'ec2', QuotaCode: 'L-DB2E81BA' }));
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
      run: async () => {
        if (!userPoolId) return checkResult('fail', 'No Cognito user pool is configured.', 'Redeploy with USER_POOL_ID configured.');
        await cognito.send(new GetGroupCommand({ UserPoolId: userPoolId, GroupName: ADMIN_GROUP }));
        const users = await cognito.send(new ListUsersInGroupCommand({ UserPoolId: userPoolId, GroupName: ADMIN_GROUP, Limit: 1 }));
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
      run: async () => {
        const configuredAmi = process.env.DEFAULT_AMI_ID?.trim();
        const response = configuredAmi
          ? await ec2.send(new DescribeImagesCommand({ ImageIds: [configuredAmi] }))
          : await ec2.send(new DescribeImagesCommand({
              Owners: ['801119661308'],
              Filters: [
                { Name: 'name', Values: ['Windows_Server-2022-English-Full-Base-*'] },
                { Name: 'state', Values: ['available'] },
              ],
            }));
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
      run: async () => {
        const parameters = await ssm.send(new GetParametersCommand({ Names: CONFIG_PARAMETERS, WithDecryption: false }));
        const found = new Set(parameters.Parameters?.map((parameter) => parameter.Name).filter(Boolean));
        const missing = CONFIG_PARAMETERS.filter((name) => !found.has(name));
        if (missing.length > 0) {
          return checkResult('fail', `${missing.length} required workstation configuration parameter(s) are missing.`, 'Redeploy the infrastructure configuration parameters.');
        }
        const managed = await ssm.send(new DescribeInstanceInformationCommand({ MaxResults: 5 }));
        if (!(managed.InstanceInformationList?.some((instance) => instance.PingStatus === 'Online'))) {
          return checkResult('warning', 'Workstation configuration parameters exist, but no online SSM managed instance was found.', 'This is expected before the first launch; after launch, verify the SSM agent and instance profile.');
        }
        return checkResult('pass', 'Required workstation parameters exist and an SSM managed instance is online.');
      },
    },
    {
      id: 'budget',
      category: 'cost',
      title: 'Budget configuration',
      required: false,
      run: async () => {
        const response = await budgets.send(new DescribeBudgetsCommand({ AccountId: accountId, MaxResults: 5 }));
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
      run: async () => {
        const response = await eventBridge.send(new DescribeRuleCommand({ Name: AUTO_STOP_RULE }));
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
      run: async () => {
        if (!vpcId) return checkResult('skipped', 'Remote access was not checked because no VPC is configured.');
        const response = await ec2.send(new DescribeSecurityGroupsCommand({ Filters: [{ Name: 'vpc-id', Values: [vpcId] }] }));
        const ports = new Set<number>();
        for (const group of response.SecurityGroups ?? []) {
          for (const permission of group.IpPermissions ?? []) {
            if (permission.FromPort !== undefined && permission.ToPort !== undefined) {
              for (const expected of [3389, 8443]) {
                if (permission.FromPort <= expected && permission.ToPort >= expected) ports.add(expected);
              }
            }
          }
        }
        return ports.has(3389) && ports.has(8443)
          ? checkResult('pass', 'Security-group rules support both RDP and DCV remote-access ports.')
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
    passed: checks.filter((check) => check.status === 'pass').length,
    warnings: checks.filter((check) => check.status === 'warning').length,
    failed: checks.filter((check) => check.status === 'fail').length,
    skipped: checks.filter((check) => check.status === 'skipped').length,
  };
  const report: DeploymentDoctorReport = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    status: reportStatus(checks),
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
