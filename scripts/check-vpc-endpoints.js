#!/usr/bin/env node
'use strict';

/**
 * Pre-synthesis VPC endpoint check.
 *
 * Queries DescribeVpcEndpoints for the configured VPC, identifies which service
 * endpoints already exist outside of this CloudFormation stack, and writes the
 * result to cdk.context.json under the key "nyroforge:vpc-endpoints".
 *
 * WorkstationInfrastructureStack reads that context key and skips creating any
 * endpoint already present — preventing "route table already has a route" and
 * duplicate-interface-endpoint errors when deploying into a pre-existing VPC.
 *
 * Invoked automatically by the cdk.json "app" command before every
 * cdk synth / cdk deploy / cdk diff.
 *
 * Environment variables:
 *   SKIP_VPC_CHECK=true   — Skip the AWS call entirely (useful in offline CI).
 *   AWS_DEFAULT_REGION    — Override the region for the EC2 API call.
 *   CDK_DEFAULT_REGION    — Fallback region if AWS_DEFAULT_REGION is unset.
 */

const { EC2Client, DescribeVpcEndpointsCommand } = require('@aws-sdk/client-ec2');
const fs = require('fs');
const path = require('path');

const CONTEXT_KEY  = 'nyroforge:vpc-endpoints';
const CONTEXT_FILE = path.join(__dirname, '..', 'cdk.context.json');
const STACK_NAME   = 'WorkstationInfrastructure';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readContextFile() {
  try {
    return JSON.parse(fs.readFileSync(CONTEXT_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeContextFile(ctx) {
  fs.writeFileSync(CONTEXT_FILE, JSON.stringify(ctx, null, 2) + '\n');
}

/**
 * Extract the VPC ID from cdk.context.json (stored by Vpc.fromLookup) or
 * by scanning the infrastructure stack source for the literal vpcId string.
 */
function discoverVpcId(ctx) {
  // 1. CDK vpc-provider key written by ec2.Vpc.fromLookup()
  for (const key of Object.keys(ctx)) {
    if (key.startsWith('vpc-provider:') && key.includes('filter.vpc-id=')) {
      const m = key.match(/filter\.vpc-id=([^:]+)/);
      if (m) return m[1];
    }
  }

  // 2. Literal vpcId in the stack source
  try {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'workstation-infrastructure-stack.ts'),
      'utf8'
    );
    const m = src.match(/vpcId:\s*['"]([^'"]+)['"]/);
    if (m) return m[1];
  } catch {}

  return null;
}

/**
 * Derive the region from context file or environment.
 */
function discoverRegion(ctx) {
  // Pull from an existing vpc-provider context key
  for (const key of Object.keys(ctx)) {
    if (key.startsWith('vpc-provider:') && key.includes('region=')) {
      const m = key.match(/region=([^:]+)/);
      if (m) return m[1];
    }
  }
  return process.env.CDK_DEFAULT_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-2';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (process.env.SKIP_VPC_CHECK === 'true') {
    console.log('[vpc-check] Skipping (SKIP_VPC_CHECK=true)');
    return;
  }

  const ctx   = readContextFile();
  const vpcId = discoverVpcId(ctx);

  if (!vpcId) {
    console.log('[vpc-check] No VPC ID found in context or stack source — skipping endpoint pre-check');
    return;
  }

  const region = discoverRegion(ctx);
  console.log(`[vpc-check] Scanning endpoints in ${vpcId} (${region})...`);

  let discovered;
  try {
    const client = new EC2Client({ region });
    const resp   = await client.send(new DescribeVpcEndpointsCommand({
      Filters: [
        { Name: 'vpc-id',                 Values: [vpcId] },
        { Name: 'vpc-endpoint-state',     Values: ['available', 'pending'] },
      ],
    }));

    // Only record endpoints that are NOT already managed by our CDK stack.
    // Interface/gateway endpoints created by CDK will have the
    // aws:cloudformation:stack-name tag pointing at STACK_NAME.
    // We must not mark those as "pre-existing" — CDK needs to keep owning them.
    discovered = (resp.VpcEndpoints || [])
      .filter(ep => {
        const stackTag = (ep.Tags || []).find(t => t.Key === 'aws:cloudformation:stack-name');
        return !stackTag || stackTag.Value !== STACK_NAME;
      })
      .map(ep => {
        // com.amazonaws.us-west-2.ssmmessages → ssmmessages
        const parts = (ep.ServiceName || '').split('.');
        return parts[parts.length - 1];
      })
      .filter(Boolean);

    if (discovered.length === 0) {
      console.log('[vpc-check] No pre-existing (non-CDK) endpoints found — all endpoints will be created');
    } else {
      console.log(`[vpc-check] Pre-existing endpoints (will be skipped): ${discovered.join(', ')}`);
    }

    // Write to context so the CDK stack can read it during synthesis
    ctx[CONTEXT_KEY] = discovered;
    writeContextFile(ctx);

  } catch (err) {
    // Don't block synthesis — keep whatever context was there before
    console.log(`[vpc-check] AWS call failed (${err.message}); using cached context`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[vpc-check] Unexpected error:', err.message);
    process.exit(0); // Never block CDK
  });
