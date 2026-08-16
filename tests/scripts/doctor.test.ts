import { executeDoctor, type CommandRunner, type CommandSpec, type DoctorReport } from '../../scripts/doctor';

const outputs = JSON.stringify({
  WorkstationInfrastructure: {
    VpcId: 'vpc-123',
    UserPoolId: 'us-west-2_pool',
  },
  WorkstationApi: {
    ApiEndpoint: 'https://api.example.com/api/',
    AutoTerminationRuleArn: 'arn:aws:events:us-west-2:123456789012:rule/auto-stop',
  },
  WorkstationAdminApi: { AdminApiUrl: 'https://admin.example.com/prod/' },
  WorkstationWebsite: { WebsiteUrl: 'https://app.example.com' },
});

function successfulRunner(): jest.MockedFunction<CommandRunner> {
  return jest.fn(async ({ command, args }) => {
    const operation = `${command} ${args.slice(0, 2).join(' ')}`;
    const stdoutByOperation: Record<string, string> = {
      'node --version': 'v22.1.0',
      'npm --version': '10.8.0',
      'aws --version': 'aws-cli/2.17.0 Python/3.11',
      'aws configure get': 'us-west-2',
      'npx cdk': '2.117.0',
      'aws sts get-caller-identity': JSON.stringify({ Account: '123456789012', Arn: 'arn:aws:iam::123456789012:user/test', UserId: 'AIDAEXAMPLE' }),
      'aws ec2 describe-vpcs': JSON.stringify({ Vpcs: [{ VpcId: 'vpc-123', State: 'available' }] }),
      'aws ec2 describe-subnets': JSON.stringify({ Subnets: [{ SubnetId: 'subnet-1', AvailableIpAddressCount: 100 }] }),
      'aws service-quotas list-service-quotas': JSON.stringify({ Quotas: [{ QuotaName: 'Running On-Demand G and VT instances', Value: 16 }] }),
      'aws ec2 describe-instance-type-offerings': JSON.stringify({ InstanceTypeOfferings: [{ InstanceType: 'g4dn.xlarge' }] }),
      'aws cognito-idp describe-user-pool': JSON.stringify({ UserPool: { Id: 'us-west-2_pool', Status: 'Enabled' } }),
      'aws cognito-idp list-users-in-group': JSON.stringify({ Users: [{ Username: 'admin@example.com', Enabled: true }] }),
      'aws ec2 describe-images': JSON.stringify({ Images: [{ ImageId: 'ami-123', Name: 'Windows_Server-2022-English-Full-Base-2026.08.01' }] }),
      'aws ssm get-parameters': JSON.stringify({ Parameters: [{ Name: '/workstation/config/defaultInstanceType' }, { Name: '/workstation/config/allowedInstanceTypes' }, { Name: '/workstation/config/defaultAutoTerminateHours' }], InvalidParameters: [] }),
      'aws apigateway get-rest-apis': JSON.stringify({ items: [{ id: 'api-1', name: 'Workstation API' }, { id: 'api-2', name: 'Admin API' }] }),
      'aws budgets describe-budgets': JSON.stringify({ Budgets: [{ BudgetName: 'NyroForge monthly' }] }),
      'aws events describe-rule': JSON.stringify({ Name: 'auto-stop', State: 'ENABLED' }),
      'aws ec2 describe-security-groups': JSON.stringify({ SecurityGroups: [{ GroupId: 'sg-1', IpPermissions: [{ FromPort: 8443, ToPort: 8443, IpProtocol: 'tcp' }] }] }),
    };
    return { exitCode: 0, stdout: stdoutByOperation[operation] ?? '{}', stderr: '' };
  });
}

const deps = (runner: CommandRunner, file = outputs) => ({
  runner,
  readFile: async () => file,
  timeoutMs: 50,
});

function parseReport(stdout: string): DoctorReport {
  return JSON.parse(stdout) as DoctorReport;
}

describe('NyroForge deployment doctor', () => {
  test('returns 0 with pass results for a healthy configured deployment', async () => {
    const result = await executeDoctor(['--json', '--region', 'us-west-2', '--outputs', 'test-outputs.json'], deps(successfulRunner()));
    const report = parseReport(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(report.summary.fail).toBe(0);
    expect(report.results.map(check => check.category)).toEqual(expect.arrayContaining([
      'local', 'identity', 'network', 'gpu', 'cognito', 'ami', 'ssm', 'application', 'cost-controls', 'remote-access',
    ]));
    expect(report.results.every(check => ['pass', 'warning', 'fail', 'skipped'].includes(check.status))).toBe(true);
  });

  test('returns 1 when a required check fails', async () => {
    const runner = successfulRunner();
    runner.mockImplementation(async spec => {
      if (spec.command === 'aws' && spec.args[0] === 'sts') {
        return { exitCode: 255, stdout: '', stderr: 'expired credentials' };
      }
      return successfulRunner()(spec);
    });

    const result = await executeDoctor(['--json', '--region', 'us-west-2'], deps(runner));
    const report = parseReport(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(report.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'identity', required: true, status: 'fail' }),
    ]));
  });

  test('missing optional deployment outputs produce warnings rather than a crash', async () => {
    const result = await executeDoctor(['--json', '--region', 'us-west-2'], deps(successfulRunner(), Promise.reject(new Error('ENOENT')) as never));
    const report = parseReport(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(report.summary.warning).toBeGreaterThan(0);
    expect(report.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'warning', required: false }),
      expect.objectContaining({ status: 'skipped' }),
    ]));
  });

  test('times out a hanging injected command and redacts sensitive error output', async () => {
    const runner: CommandRunner = jest.fn(async ({ command, args }) => {
      if (command === 'aws' && args[0] === 'sts') {
        await new Promise(() => undefined);
      }
      if (command === 'aws' && args[0] === '--version') {
        return { exitCode: 255, stdout: '', stderr: 'password=hunter2 AKIA1234567890ABCDEF token=super-secret' };
      }
      return { exitCode: 0, stdout: command === 'node' ? 'v22.0.0' : command === 'npm' ? '10.0.0' : command === 'npx' ? '2.117.0' : '{}', stderr: '' };
    });

    const result = await executeDoctor(['--json', '--region', 'us-west-2'], deps(runner));
    const serialized = result.stdout + result.stderr;

    expect(result.exitCode).toBe(1);
    expect(parseReport(result.stdout).results).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'identity', status: 'fail', message: expect.stringContaining('timed out') }),
    ]));
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('AKIA1234567890ABCDEF');
    expect(serialized).not.toContain('super-secret');
  });

  test.each([
    [['--region'], 'requires a value'],
    [['--unknown'], 'Unknown option'],
    [['--region', 'not a region'], 'Invalid AWS region'],
  ])('returns 2 for invalid arguments: %p', async (argv, expectedError) => {
    const runner = successfulRunner();
    const result = await executeDoctor(argv, deps(runner));

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(expectedError);
    expect(runner).not.toHaveBeenCalled();
  });

  test('--json emits only parseable JSON and forwards region/profile to AWS', async () => {
    const runner = successfulRunner();
    const result = await executeDoctor(['--json', '--region=eu-west-1', '--profile', 'sandbox'], deps(runner));

    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(result.stdout).not.toContain(String.fromCharCode(27));
    const awsCalls = runner.mock.calls.map(([spec]) => spec).filter(spec => spec.command === 'aws' && spec.args[0] !== '--version');
    expect(awsCalls.length).toBeGreaterThan(0);
    expect(awsCalls.every(spec => spec.args.includes('--region') && spec.args.includes('eu-west-1') && spec.args.includes('--profile') && spec.args.includes('sandbox'))).toBe(true);
  });

  test('resolves the AWS CLI default region and only invokes read-only AWS operations', async () => {
    const runner = successfulRunner();
    const result = await executeDoctor(['--json'], deps(runner));
    const report = parseReport(result.stdout);
    const allowedOperations = new Set([
      '--version', 'configure:get', 'sts:get-caller-identity', 'ec2:describe-vpcs', 'ec2:describe-subnets',
      'service-quotas:list-service-quotas', 'ec2:describe-instance-type-offerings', 'cognito-idp:describe-user-pool',
      'cognito-idp:list-users-in-group', 'ec2:describe-images', 'ssm:get-parameters', 'apigateway:get-rest-apis',
      'budgets:describe-budgets', 'events:describe-rule', 'ec2:describe-security-groups',
    ]);
    const awsCalls: CommandSpec[] = runner.mock.calls.map(([spec]: [CommandSpec]) => spec).filter((spec: CommandSpec) => spec.command === 'aws');
    const operations = awsCalls.map((spec: CommandSpec) => spec.args[0] === '--version' ? '--version' : `${spec.args[0]}:${spec.args[1]}`);

    expect(result.exitCode).toBe(0);
    expect(report.region).toBe('us-west-2');
    expect(operations.every((operation: string) => allowedOperations.has(operation))).toBe(true);
    expect(awsCalls.every((spec: CommandSpec) => spec.timeoutMs === 50)).toBe(true);
  });

  test('--help returns usage without running commands', async () => {
    const runner = successfulRunner();
    const result = await executeDoctor(['--help'], deps(runner));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: npm run doctor -- [options]');
    expect(result.stdout).toContain('--outputs');
    expect(runner).not.toHaveBeenCalled();
  });
});
