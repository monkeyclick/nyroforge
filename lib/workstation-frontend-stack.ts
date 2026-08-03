import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface WorkstationFrontendStackProps extends cdk.StackProps {
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  api: apigateway.RestApi;
}

/**
 * Publishes the frontend's runtime configuration to Parameter Store.
 *
 * This stack used to also create an IAM role with the AdministratorAccess-Amplify
 * managed policy plus a hardcoded `{ appId: 'manual-deployment-required' }`
 * placeholder object. No Amplify app was ever created, nothing assumed the role,
 * and nothing read the placeholder — it was account-wide admin-adjacent IAM
 * surface and deploy time for no behaviour. The UI is hosted on S3 + CloudFront
 * by WorkstationWebsiteStack.
 */
export class WorkstationFrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WorkstationFrontendStackProps) {
    super(scope, id, props);

    // Store configuration in SSM for the frontend to use
    this.storeConfiguration(props);

    // Create outputs
    this.createOutputs();
  }

  private storeConfiguration(props: WorkstationFrontendStackProps): void {
    // Store frontend configuration in Parameter Store
    new ssm.StringParameter(this, 'FrontendConfig', {
      parameterName: '/workstation/frontend/config',
      stringValue: JSON.stringify({
        region: cdk.Stack.of(this).region,
        userPoolId: props.userPool.userPoolId,
        userPoolClientId: props.userPoolClient.userPoolClientId,
        apiEndpoint: props.api.url,
        apiStage: 'api',
      }),
      description: 'Frontend configuration parameters',
    });

    // Store Cognito configuration
    new ssm.StringParameter(this, 'AuthConfig', {
      parameterName: '/workstation/frontend/auth',
      stringValue: JSON.stringify({
        userPoolId: props.userPool.userPoolId,
        userPoolClientId: props.userPoolClient.userPoolClientId,
        region: cdk.Stack.of(this).region,
        authenticationFlowType: 'USER_SRP_AUTH',
        // Matches the pool's cognito.Mfa.OPTIONAL setting. This previously
        // advertised 'ON', so any consumer trusting it would expect MFA to be
        // mandatory when it is not.
        mfaConfiguration: 'OPTIONAL',
        mfaTypes: ['SMS_MFA', 'SOFTWARE_TOKEN_MFA'],
      }),
      description: 'Authentication configuration for frontend',
    });
  }

  private createOutputs(): void {
    new cdk.CfnOutput(this, 'FrontendDeploymentInstructions', {
      value: 'Build and publish the UI with: ./scripts/deploy-frontend.sh',
      description: 'How to deploy the web interface',
    });

    new cdk.CfnOutput(this, 'FrontendConfigPath', {
      value: '/workstation/frontend/config',
      description: 'SSM Parameter path for frontend configuration',
    });

    new cdk.CfnOutput(this, 'AuthConfigPath', {
      value: '/workstation/frontend/auth',
      description: 'SSM Parameter path for authentication configuration',
    });
  }
}
