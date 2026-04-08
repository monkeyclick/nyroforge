import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export class WorkstationWebsiteStack extends cdk.Stack {
  public readonly websiteUrl: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Build frontend before deployment (uncomment when ready)
    // this.buildFrontend();

    // Create S3 bucket for static website hosting
    const websiteBucket = new s3.Bucket(this, 'WorkstationWebsiteBucket', {
      bucketName: `workstation-ui-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
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
      sources: [s3deploy.Source.asset('frontend/out')],
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
      exportName: 'WorkstationWebsiteUrl',
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront Distribution ID for the website',
    });
  }

  private buildFrontend(): void {
    console.log('========================================');
    console.log('Building Next.js Frontend');
    console.log('========================================');

    const frontendDir = path.join(__dirname, '..', 'frontend');
    const outDir = path.join(frontendDir, 'out');

    // Check if frontend directory exists
    if (!fs.existsSync(frontendDir)) {
      throw new Error(`Frontend directory not found: ${frontendDir}`);
    }

    // Check if out directory already exists (skip build if present)
    if (fs.existsSync(outDir)) {
      console.log('✓ Frontend already built (out directory exists)');
      console.log('  To rebuild, run: rm -rf frontend/out && cdk deploy');
      return;
    }

    try {
      // Install dependencies if node_modules doesn't exist
      const nodeModulesDir = path.join(frontendDir, 'node_modules');
      if (!fs.existsSync(nodeModulesDir)) {
        console.log('Installing frontend dependencies...');
        execSync('npm ci', {
          cwd: frontendDir,
          stdio: 'inherit',
        });
      }

      // Build Next.js
      console.log('Building Next.js application...');
      execSync('npm run build', {
        cwd: frontendDir,
        stdio: 'inherit',
      });

      // Verify build output
      if (!fs.existsSync(outDir)) {
        throw new Error('Build failed - out directory not created');
      }

      console.log('✓ Frontend build successful!');
      console.log('========================================');
    } catch (error) {
      console.error('✗ Frontend build failed:', error);
      throw new Error(`Failed to build Next.js frontend: ${error}`);
    }
  }
}