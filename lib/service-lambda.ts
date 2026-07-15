import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import { Construct } from 'constructs';

export interface ServiceLambdaProps
  extends Omit<lambda.FunctionProps, 'code' | 'handler' | 'runtime'> {
  /** Directory name under dist/lambda/ containing the bundled handler. */
  serviceDir: string;
  handler?: string;
  runtime?: lambda.Runtime;
}

/**
 * A NyroForge service Lambda: Node 20, `index.handler`, one-month log
 * retention, code from `dist/lambda/<serviceDir>` (built by
 * scripts/build-lambdas.js). Stacks supply everything else — environment,
 * role, vpc, timeout, memory — through props, which override these defaults.
 */
export class ServiceLambda extends lambda.Function {
  constructor(scope: Construct, id: string, props: ServiceLambdaProps) {
    const { serviceDir, handler, runtime, ...rest } = props;
    super(scope, id, {
      runtime: runtime ?? lambda.Runtime.NODEJS_20_X,
      handler: handler ?? 'index.handler',
      logRetention: logs.RetentionDays.ONE_MONTH,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '..', 'dist', 'lambda', serviceDir)
      ),
      ...rest,
    });
  }
}
