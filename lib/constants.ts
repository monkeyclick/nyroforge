/**
 * Shared infrastructure constants.
 *
 * Single source of truth for values that MUST agree across stacks and runtime
 * code. Drift here previously broke IAM tag-condition scoping (admin policies
 * used 'NyroForge' while resources were tagged 'MediaWorkstationAutomation',
 * so every tag-scoped mutation was silently denied).
 */

/**
 * Value of the `Project` cost-allocation tag applied to every taggable resource
 * (see bin/app.ts stack-wide tags and the EC2 TagSpecifications in the
 * ec2-management and security-group-service Lambdas). IAM policies that scope by
 * `aws:ResourceTag/Project` / `aws:RequestTag/Project` MUST use this exact value.
 */
export const PROJECT_TAG = 'MediaWorkstationAutomation';

/**
 * Optional prefix applied to every globally-named resource — DynamoDB tables,
 * the website bucket, the Cognito pool, EventBridge rules and CloudFormation
 * export names.
 *
 * Defaults to empty, so an existing deployment keeps the exact names it already
 * has and nothing is replaced. Set `NYROFORGE_RESOURCE_PREFIX` to deploy a
 * second, isolated environment into the same account and region: without it,
 * every one of these names is a hardcoded literal, so the second deployment
 * fails with "Table already exists" / "BucketAlreadyExists" partway through and
 * leaves a half-created stack behind.
 *
 * Pair it with `STACK_PREFIX` (see bin/app.ts) so the CloudFormation stacks are
 * distinct too.
 */
export const RESOURCE_PREFIX = process.env.NYROFORGE_RESOURCE_PREFIX ?? '';

/**
 * Applies RESOURCE_PREFIX to a resource name.
 *
 * `resourceName('EnhancedUsers')` → `EnhancedUsers` by default, or
 * `staging-EnhancedUsers` when NYROFORGE_RESOURCE_PREFIX=staging-.
 */
export function resourceName(base: string): string {
  return `${RESOURCE_PREFIX}${base}`;
}
