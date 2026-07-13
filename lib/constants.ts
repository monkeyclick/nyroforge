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
