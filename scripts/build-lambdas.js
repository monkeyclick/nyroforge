const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const lambdaFunctions = [
  'ec2-management',
  'status-monitor',
  'cost-analytics',
  'config-service',
  'credentials-service',
  'user-profile-service',
  'user-management-service',
  'group-management-service',
  'security-group-service',
  'cognito-admin-service',
  'ami-validation-service',
  'instance-type-service',
  'bootstrap-config-service',
  'analytics-service',
  'user-attribute-change-processor',
  'group-membership-reconciliation',
  'group-package-service',
  'storage-service',
  'ec2-discovery-service',
  'instance-family-service'
];

const buildLambda = async (functionName) => {
  const entryPoint = `src/lambda/${functionName}/index.ts`;
  const outDir = `dist/lambda/${functionName}`;
  
  // Ensure output directory exists
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  try {
    await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      outfile: `${outDir}/index.js`,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      external: ['@aws-sdk/*'],
      minify: true,
      sourcemap: true,
      keepNames: true,
    });
    
    console.log(`✅ Built ${functionName} successfully`);
  } catch (error) {
    console.error(`❌ Failed to build ${functionName}:`, error);
    process.exit(1);
  }
};

const buildAll = async () => {
  console.log('🔨 Building Lambda functions...');
  
  for (const functionName of lambdaFunctions) {
    await buildLambda(functionName);
  }
  
  console.log('🎉 All Lambda functions built successfully!');
};

buildAll().catch(console.error);