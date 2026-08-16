import { APIGatewayProxyEvent, Context } from 'aws-lambda';

jest.mock('@aws-sdk/client-ec2', () => {
  const actual = jest.requireActual('@aws-sdk/client-ec2');
  return { ...actual, EC2Client: jest.fn() };
});
jest.mock('@aws-sdk/client-ssm', () => {
  const actual = jest.requireActual('@aws-sdk/client-ssm');
  return { ...actual, SSMClient: jest.fn() };
});
jest.mock('@aws-sdk/client-cognito-identity-provider', () => {
  const actual = jest.requireActual('@aws-sdk/client-cognito-identity-provider');
  return { ...actual, CognitoIdentityProviderClient: jest.fn() };
});
jest.mock('@aws-sdk/client-service-quotas', () => {
  const actual = jest.requireActual('@aws-sdk/client-service-quotas');
  return { ...actual, ServiceQuotasClient: jest.fn() };
});
jest.mock('@aws-sdk/client-budgets', () => {
  const actual = jest.requireActual('@aws-sdk/client-budgets');
  return { ...actual, BudgetsClient: jest.fn() };
});
jest.mock('@aws-sdk/client-eventbridge', () => {
  const actual = jest.requireActual('@aws-sdk/client-eventbridge');
  return { ...actual, EventBridgeClient: jest.fn() };
});

import { EC2Client } from '@aws-sdk/client-ec2';
import { SSMClient } from '@aws-sdk/client-ssm';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { ServiceQuotasClient } from '@aws-sdk/client-service-quotas';
import { BudgetsClient } from '@aws-sdk/client-budgets';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';

const ec2Send = jest.fn();
const ssmSend = jest.fn();
const cognitoSend = jest.fn();
const quotasSend = jest.fn();
const budgetsSend = jest.fn();
const eventsSend = jest.fn();

(EC2Client as jest.MockedClass<typeof EC2Client>).mockImplementation(
  () => ({ send: ec2Send } as unknown as EC2Client),
);
(SSMClient as jest.MockedClass<typeof SSMClient>).mockImplementation(
  () => ({ send: ssmSend } as unknown as SSMClient),
);
(CognitoIdentityProviderClient as jest.MockedClass<typeof CognitoIdentityProviderClient>).mockImplementation(
  () => ({ send: cognitoSend } as unknown as CognitoIdentityProviderClient),
);
(ServiceQuotasClient as jest.MockedClass<typeof ServiceQuotasClient>).mockImplementation(
  () => ({ send: quotasSend } as unknown as ServiceQuotasClient),
);
(BudgetsClient as jest.MockedClass<typeof BudgetsClient>).mockImplementation(
  () => ({ send: budgetsSend } as unknown as BudgetsClient),
);
(EventBridgeClient as jest.MockedClass<typeof EventBridgeClient>).mockImplementation(
  () => ({ send: eventsSend } as unknown as EventBridgeClient),
);

import { handler } from '../../src/lambda/deployment-doctor-service';

const context = {
  invokedFunctionArn: 'arn:aws:lambda:us-west-2:123456789012:function:deployment-doctor',
} as Context;

function event(groups: string | string[] | undefined = 'workstation-admin'): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/admin/deployment-doctor',
    requestContext: {
      authorizer: { claims: groups === undefined ? {} : { 'cognito:groups': groups } },
    },
  } as unknown as APIGatewayProxyEvent;
}

function commandName(command: unknown): string {
  return (command as { constructor: { name: string } }).constructor.name;
}

function installPassingAwsResponses(): void {
  ec2Send.mockImplementation((command: unknown) => {
    switch (commandName(command)) {
      case 'DescribeVpcsCommand':
        return Promise.resolve({ Vpcs: [{ VpcId: 'vpc-12345', State: 'available' }] });
      case 'DescribeSubnetsCommand':
        return Promise.resolve({ Subnets: [{ SubnetId: 'subnet-1', State: 'available', AvailabilityZone: 'us-west-2a' }] });
      case 'DescribeVpcEndpointsCommand':
        return Promise.resolve({ VpcEndpoints: [{ VpcEndpointId: 'vpce-1', State: 'Available' }] });
      case 'DescribeInstanceTypeOfferingsCommand':
        return Promise.resolve({ InstanceTypeOfferings: [{ InstanceType: 'g4dn.xlarge' }] });
      case 'DescribeImagesCommand':
        return Promise.resolve({ Images: [{ ImageId: 'ami-123', State: 'available' }] });
      case 'DescribeSecurityGroupsCommand':
        return Promise.resolve({
          SecurityGroups: [{
            GroupId: 'sg-1',
            IpPermissions: [
              { FromPort: 3389, ToPort: 3389, IpProtocol: 'tcp' },
              { FromPort: 8443, ToPort: 8443, IpProtocol: 'tcp' },
            ],
          }],
        });
      default:
        throw new Error(`Unexpected EC2 command ${commandName(command)}`);
    }
  });
  ssmSend.mockImplementation((command: unknown) => {
    switch (commandName(command)) {
      case 'GetParametersCommand':
        return Promise.resolve({ Parameters: [
          { Name: '/workstation/config/defaultInstanceType' },
          { Name: '/workstation/config/allowedInstanceTypes' },
          { Name: '/workstation/config/defaultAutoTerminateHours' },
          { Name: '/workstation/config/instanceProfileArn' },
        ] });
      case 'DescribeInstanceInformationCommand':
        return Promise.resolve({ InstanceInformationList: [{ InstanceId: 'i-123', PingStatus: 'Online' }] });
      default:
        throw new Error(`Unexpected SSM command ${commandName(command)}`);
    }
  });
  cognitoSend.mockImplementation((command: unknown) => {
    if (commandName(command) === 'GetGroupCommand') return Promise.resolve({ Group: { GroupName: 'workstation-admin' } });
    if (commandName(command) === 'ListUsersInGroupCommand') return Promise.resolve({ Users: [{ Username: 'admin' }] });
    throw new Error(`Unexpected Cognito command ${commandName(command)}`);
  });
  quotasSend.mockResolvedValue({ Quota: { Value: 8 } });
  budgetsSend.mockResolvedValue({ Budgets: [{ BudgetName: 'WorkstationMonthlyBudget' }] });
  eventsSend.mockResolvedValue({ Name: 'MediaWorkstation-AutoTerminationCheck', State: 'ENABLED' });
}

describe('deployment doctor service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AWS_REGION = 'us-west-2';
    process.env.VPC_ID = 'vpc-12345';
    process.env.USER_POOL_ID = 'us-west-2_TestPool123';
    process.env.DEFAULT_AMI_ID = '';
    installPassingAwsResponses();
  });

  it('denies callers that are not in the exact workstation-admin group before calling AWS', async () => {
    const response = await handler(event('workstation-administrator'), context);

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({ error: 'Forbidden: admin access required' });
    expect(ec2Send).not.toHaveBeenCalled();
    expect(ssmSend).not.toHaveBeenCalled();
  });

  it('returns a stable all-pass report when deployed prerequisites are healthy', async () => {
    const response = await handler(event(['workstation-user', 'workstation-admin']), context);
    const report = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(report.schemaVersion).toBe('1.0');
    expect(report.status).toBe('pass');
    expect(report.context).toEqual({ accountId: '123456789012', region: 'us-west-2' });
    expect(report.checks.map((check: { id: string }) => check.id)).toEqual([
      'aws-context',
      'network',
      'gpu-offerings',
      'gpu-quota',
      'cognito-admin',
      'workstation-ami',
      'ssm',
      'budget',
      'auto-stop',
      'remote-access',
    ]);
    expect(report.checks.every((check: { status: string }) => check.status === 'pass')).toBe(true);
    expect(report.summary).toEqual({ total: 10, passed: 10, warnings: 0, failed: 0, skipped: 0 });
    expect(response.body.length).toBeLessThan(32_000);
  });

  it('isolates partial AWS failures and returns the remaining check results', async () => {
    ec2Send.mockImplementation((command: unknown) => {
      if (commandName(command) === 'DescribeVpcsCommand') {
        return Promise.reject(Object.assign(new Error('network unavailable'), { name: 'ServiceUnavailable' }));
      }
      if (commandName(command) === 'DescribeInstanceTypeOfferingsCommand') {
        return Promise.resolve({ InstanceTypeOfferings: [{ InstanceType: 'g4dn.xlarge' }] });
      }
      if (commandName(command) === 'DescribeImagesCommand') {
        return Promise.resolve({ Images: [{ ImageId: 'ami-123', State: 'available' }] });
      }
      if (commandName(command) === 'DescribeSecurityGroupsCommand') {
        return Promise.resolve({ SecurityGroups: [{ IpPermissions: [{ FromPort: 3389, ToPort: 3389 }] }] });
      }
      return Promise.resolve({});
    });

    const response = await handler(event(), context);
    const report = JSON.parse(response.body);
    const byId = Object.fromEntries(report.checks.map((check: { id: string }) => [check.id, check]));

    expect(response.statusCode).toBe(200);
    expect(report.status).toBe('fail');
    expect(byId.network.status).toBe('fail');
    expect(byId['gpu-offerings'].status).toBe('pass');
    expect(byId['cognito-admin'].status).toBe('pass');
    expect(report.summary.failed).toBe(1);
  });

  it('never leaks exception messages, credentials, tokens, parameter values, or stacks', async () => {
    const secret = 'AKIAIOSFODNN7EXAMPLE bearer-super-secret';
    budgetsSend.mockRejectedValue(Object.assign(new Error(secret), {
      name: 'AccessDeniedException',
      stack: `STACK ${secret}`,
      SecretAccessKey: secret,
    }));
    ssmSend.mockImplementation((command: unknown) => {
      if (commandName(command) === 'GetParametersCommand') {
        return Promise.resolve({ Parameters: [{ Name: '/workstation/config/defaultInstanceType', Value: secret }] });
      }
      return Promise.resolve({ InstanceInformationList: [] });
    });

    const response = await handler(event(), context);
    const serialized = response.body;
    const report = JSON.parse(serialized);
    const budget = report.checks.find((check: { id: string }) => check.id === 'budget');

    expect(response.statusCode).toBe(200);
    expect(budget.status).toBe('warning');
    expect(budget.message).toBe('Unable to verify optional budget configuration.');
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toMatch(/SecretAccessKey|bearer|STACK|Value/);
  });
});
