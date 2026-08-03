import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { resourceName } from './constants';

/** Served only when `frontend/out` has not been built yet. */
const PLACEHOLDER_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>NyroForge — setup in progress</title>
  <style>
    body { margin:0; min-height:100vh; display:grid; place-items:center;
           font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
           background:#0f172a; color:#e2e8f0; }
    main { max-width:34rem; padding:2rem; text-align:center; }
    h1 { font-size:1.5rem; margin:0 0 .75rem; }
    p { color:#94a3b8; line-height:1.6; margin:0 0 1rem; }
    code { background:#1e293b; padding:.15rem .4rem; border-radius:.25rem;
           font-size:.875rem; color:#e2e8f0; }
  </style>
</head>
<body>
  <main>
    <h1>Infrastructure deployed — UI not built yet</h1>
    <p>
      The NyroForge backend is up, but the web interface has not been built and
      uploaded. The UI needs the API and Cognito values from this deployment
      compiled into it, so it is built after the stacks exist.
    </p>
    <p>Run <code>./scripts/deploy-frontend.sh</code> to finish setup.</p>
  </main>
</body>
</html>
`;

export class WorkstationWebsiteStack extends cdk.Stack {
  public readonly websiteUrl: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create S3 bucket for static website hosting
    const websiteBucket = new s3.Bucket(this, 'WorkstationWebsiteBucket', {
      // S3 bucket names must be lowercase, so the prefix is normalised.
      bucketName: resourceName('workstation-ui').toLowerCase() +
        `-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // Create Origin Access Identity for CloudFront
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'WorkstationOAI', {
      comment: 'Origin Access Identity for Workstation Management Website',
    });

    // Grant CloudFront access to S3 bucket
    websiteBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [websiteBucket.arnForObjects('*')],
      principals: [originAccessIdentity.grantPrincipal],
    }));

    // Create CloudFront distribution
    const distribution = new cloudfront.Distribution(this, 'WorkstationDistribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessIdentity(websiteBucket, {
          originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      errorResponses: [
        {
          httpStatus: 404,
          responsePagePath: '/index.html',
          responseHttpStatus: 200,
        },
        {
          httpStatus: 403,
          responsePagePath: '/index.html',
          responseHttpStatus: 200,
        },
      ],
    });

    // Deploy Next.js static export from frontend/out
    new s3deploy.BucketDeployment(this, 'WorkstationWebsiteDeploy', {
      sources: [s3deploy.Source.asset(this.resolveWebsiteAssetPath())],
      destinationBucket: websiteBucket,
      distribution,
      distributionPaths: ['/*'],
      memoryLimit: 512, // Increase memory for larger deployments
    });

    // Store website URL
    this.websiteUrl = `https://${distribution.distributionDomainName}`;

    // Output the website URL
    new cdk.CfnOutput(this, 'WebsiteUrl', {
      value: this.websiteUrl,
      description: 'Live URL for the Media Workstation Management System',
      exportName: resourceName('WorkstationWebsiteUrl'),
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront Distribution ID for the website',
    });

    // scripts/deploy-frontend.sh looks up the bucket and distribution by these
    // exact output keys so it can `s3 sync` a freshly built bundle and
    // invalidate the cache. They previously did not exist, so that script
    // always aborted with "Could not determine S3 bucket".
    new cdk.CfnOutput(this, 'WebsiteBucketName', {
      value: websiteBucket.bucketName,
      description: 'S3 bucket hosting the static site (used by deploy-frontend.sh)',
      exportName: resourceName('WorkstationWebsiteBucketName'),
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront Distribution ID (used by deploy-frontend.sh)',
      exportName: resourceName('WorkstationWebsiteDistributionId'),
    });
  }

  /**
   * Directory to upload to S3.
   *
   * Prefers the real Next.js static export at `frontend/out`. When that is
   * absent — a fresh clone, or any `cdk deploy` run before the UI has been
   * built — this used to be a hard `Source.asset('frontend/out')` reference,
   * so *synthesis* threw `Cannot find asset` and aborted `cdk deploy --all`
   * before a single stack was created. `frontend/out` is gitignored, so that
   * hit every new user while working fine for anyone with a stale local build.
   *
   * Instead, stage a placeholder page and warn. The deployment scripts build
   * the real bundle once the API and Cognito outputs exist (the bundle inlines
   * them at build time) and then redeploy this stack.
   */
  private resolveWebsiteAssetPath(): string {
    const builtDir = path.join(__dirname, '..', 'frontend', 'out');

    if (fs.existsSync(builtDir) && fs.readdirSync(builtDir).length > 0) {
      return builtDir;
    }

    // A fixed path (not mkdtemp) keeps the asset hash stable across synths, so
    // repeat deploys of an un-built site are no-ops instead of new assets.
    const placeholderDir = path.join(os.tmpdir(), 'nyroforge-website-placeholder');
    fs.mkdirSync(placeholderDir, { recursive: true });
    fs.writeFileSync(path.join(placeholderDir, 'index.html'), PLACEHOLDER_PAGE);

    cdk.Annotations.of(this).addWarning(
      'frontend/out is missing or empty — deploying a placeholder page. ' +
        'Build the UI with scripts/deploy-frontend.sh (it wires up the API and ' +
        'Cognito values first), then redeploy WorkstationWebsite.'
    );

    return placeholderDir;
  }

}