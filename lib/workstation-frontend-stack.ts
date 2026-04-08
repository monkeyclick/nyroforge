import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface WorkstationFrontendStackProps extends cdk.StackProps {
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  api: apigateway.RestApi;
}

export class WorkstationFrontendStack extends cdk.Stack {
  public readonly amplifyApp: any;

  constructor(scope: Construct, id: string, props: WorkstationFrontendStackProps) {
    super(scope, id, props);

    // Create Amplify app
    this.createAmplifyApp(props);

    // Store configuration in SSM for the frontend to use
    this.storeConfiguration(props);

    // Create outputs
    this.createOutputs();
  }

  private createAmplifyApp(props: WorkstationFrontendStackProps): void {
    // Create IAM role for Amplify (for future manual deployment)
    const amplifyRole = new iam.Role(this, 'AmplifyRole', {
      assumedBy: new iam.ServicePrincipal('amplify.amazonaws.com'),
      description: 'IAM role for Amplify deployment',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess-Amplify'),
      ],
    });

    // Store role for manual Amplify app creation later
    new cdk.CfnOutput(this, 'AmplifyRoleArn', {
      value: amplifyRole.roleArn,
      description: 'IAM Role ARN for manual Amplify app creation',
      exportName: 'WorkstationAmplifyRoleArn',
    });

    // Amplify App is configured for manual deployment via CLI/Console
    // This placeholder is provided for stack output compatibility
    (this as any).amplifyApp = {
      appId: 'manual-deployment-required',
      defaultDomain: 'amplifyapp.com',
    };
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
        mfaConfiguration: 'ON',
        mfaTypes: ['SMS_MFA', 'SOFTWARE_TOKEN_MFA'],
      }),
      description: 'Authentication configuration for frontend',
    });
  }

  private createOutputs(): void {
    new cdk.CfnOutput(this, 'FrontendDeploymentInstructions', {
      value: 'Frontend configuration stored in SSM. Deploy manually using: cd frontend && npm run build',
      description: 'Instructions for manual frontend deployment',
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