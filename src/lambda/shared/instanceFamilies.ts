import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';

// Default instance types for each family. Shared between instance-family-service
// (which lets admins pick allowed families) and config-service (which expands the
// admin's family selection into concrete instance types for the launch wizard) so
// the two never drift out of sync.
export const DEFAULT_INSTANCE_TYPES: Record<string, string[]> = {
  // GPU Instances
  'g5': ['g5.xlarge', 'g5.2xlarge', 'g5.4xlarge', 'g5.8xlarge', 'g5.12xlarge', 'g5.16xlarge', 'g5.24xlarge', 'g5.48xlarge'],
  'g6': ['g6.xlarge', 'g6.2xlarge', 'g6.4xlarge', 'g6.8xlarge', 'g6.12xlarge', 'g6.16xlarge', 'g6.24xlarge', 'g6.48xlarge'],
  'g4dn': ['g4dn.xlarge', 'g4dn.2xlarge', 'g4dn.4xlarge', 'g4dn.8xlarge', 'g4dn.12xlarge', 'g4dn.16xlarge'],
  'g4ad': ['g4ad.xlarge', 'g4ad.2xlarge', 'g4ad.4xlarge', 'g4ad.8xlarge', 'g4ad.16xlarge'],
  'p3': ['p3.2xlarge', 'p3.8xlarge', 'p3.16xlarge'],
  'p4d': ['p4d.24xlarge'],
  'p5': ['p5.48xlarge'],
  'inf1': ['inf1.xlarge', 'inf1.2xlarge', 'inf1.6xlarge', 'inf1.24xlarge'],
  'inf2': ['inf2.xlarge', 'inf2.8xlarge', 'inf2.24xlarge', 'inf2.48xlarge'],
  'trn1': ['trn1.2xlarge', 'trn1.32xlarge'],
  'dl1': ['dl1.24xlarge'],

  // Compute Optimized
  'c5': ['c5.large', 'c5.xlarge', 'c5.2xlarge', 'c5.4xlarge', 'c5.9xlarge', 'c5.12xlarge', 'c5.18xlarge', 'c5.24xlarge'],
  'c5a': ['c5a.large', 'c5a.xlarge', 'c5a.2xlarge', 'c5a.4xlarge', 'c5a.8xlarge', 'c5a.12xlarge', 'c5a.16xlarge', 'c5a.24xlarge'],
  'c5ad': ['c5ad.large', 'c5ad.xlarge', 'c5ad.2xlarge', 'c5ad.4xlarge', 'c5ad.8xlarge', 'c5ad.12xlarge', 'c5ad.16xlarge', 'c5ad.24xlarge'],
  'c5d': ['c5d.large', 'c5d.xlarge', 'c5d.2xlarge', 'c5d.4xlarge', 'c5d.9xlarge', 'c5d.12xlarge', 'c5d.18xlarge', 'c5d.24xlarge'],
  'c5n': ['c5n.large', 'c5n.xlarge', 'c5n.2xlarge', 'c5n.4xlarge', 'c5n.9xlarge', 'c5n.18xlarge'],
  'c6a': ['c6a.large', 'c6a.xlarge', 'c6a.2xlarge', 'c6a.4xlarge', 'c6a.8xlarge', 'c6a.12xlarge', 'c6a.16xlarge', 'c6a.24xlarge', 'c6a.32xlarge', 'c6a.48xlarge'],
  'c6i': ['c6i.large', 'c6i.xlarge', 'c6i.2xlarge', 'c6i.4xlarge', 'c6i.8xlarge', 'c6i.12xlarge', 'c6i.16xlarge', 'c6i.24xlarge', 'c6i.32xlarge'],
  'c6id': ['c6id.large', 'c6id.xlarge', 'c6id.2xlarge', 'c6id.4xlarge', 'c6id.8xlarge', 'c6id.12xlarge', 'c6id.16xlarge', 'c6id.24xlarge', 'c6id.32xlarge'],
  'c6in': ['c6in.large', 'c6in.xlarge', 'c6in.2xlarge', 'c6in.4xlarge', 'c6in.8xlarge', 'c6in.12xlarge', 'c6in.16xlarge', 'c6in.24xlarge', 'c6in.32xlarge'],
  'c7a': ['c7a.medium', 'c7a.large', 'c7a.xlarge', 'c7a.2xlarge', 'c7a.4xlarge', 'c7a.8xlarge', 'c7a.12xlarge', 'c7a.16xlarge', 'c7a.24xlarge', 'c7a.32xlarge', 'c7a.48xlarge'],
  'c7i': ['c7i.large', 'c7i.xlarge', 'c7i.2xlarge', 'c7i.4xlarge', 'c7i.8xlarge', 'c7i.12xlarge', 'c7i.16xlarge', 'c7i.24xlarge', 'c7i.48xlarge'],
  'c7i-flex': ['c7i-flex.large', 'c7i-flex.xlarge', 'c7i-flex.2xlarge', 'c7i-flex.4xlarge', 'c7i-flex.8xlarge'],
  'c7g': ['c7g.medium', 'c7g.large', 'c7g.xlarge', 'c7g.2xlarge', 'c7g.4xlarge', 'c7g.8xlarge', 'c7g.12xlarge', 'c7g.16xlarge'],
  'c7gd': ['c7gd.medium', 'c7gd.large', 'c7gd.xlarge', 'c7gd.2xlarge', 'c7gd.4xlarge', 'c7gd.8xlarge', 'c7gd.12xlarge', 'c7gd.16xlarge'],
  'c7gn': ['c7gn.medium', 'c7gn.large', 'c7gn.xlarge', 'c7gn.2xlarge', 'c7gn.4xlarge', 'c7gn.8xlarge', 'c7gn.12xlarge', 'c7gn.16xlarge'],

  // Memory Optimized
  'r5': ['r5.large', 'r5.xlarge', 'r5.2xlarge', 'r5.4xlarge', 'r5.8xlarge', 'r5.12xlarge', 'r5.16xlarge', 'r5.24xlarge'],
  'r5a': ['r5a.large', 'r5a.xlarge', 'r5a.2xlarge', 'r5a.4xlarge', 'r5a.8xlarge', 'r5a.12xlarge', 'r5a.16xlarge', 'r5a.24xlarge'],
  'r5ad': ['r5ad.large', 'r5ad.xlarge', 'r5ad.2xlarge', 'r5ad.4xlarge', 'r5ad.8xlarge', 'r5ad.12xlarge', 'r5ad.16xlarge', 'r5ad.24xlarge'],
  'r5b': ['r5b.large', 'r5b.xlarge', 'r5b.2xlarge', 'r5b.4xlarge', 'r5b.8xlarge', 'r5b.12xlarge', 'r5b.16xlarge', 'r5b.24xlarge'],
  'r5d': ['r5d.large', 'r5d.xlarge', 'r5d.2xlarge', 'r5d.4xlarge', 'r5d.8xlarge', 'r5d.12xlarge', 'r5d.16xlarge', 'r5d.24xlarge'],
  'r5dn': ['r5dn.large', 'r5dn.xlarge', 'r5dn.2xlarge', 'r5dn.4xlarge', 'r5dn.8xlarge', 'r5dn.12xlarge', 'r5dn.16xlarge', 'r5dn.24xlarge'],
  'r5n': ['r5n.large', 'r5n.xlarge', 'r5n.2xlarge', 'r5n.4xlarge', 'r5n.8xlarge', 'r5n.12xlarge', 'r5n.16xlarge', 'r5n.24xlarge'],
  'r6a': ['r6a.large', 'r6a.xlarge', 'r6a.2xlarge', 'r6a.4xlarge', 'r6a.8xlarge', 'r6a.12xlarge', 'r6a.16xlarge', 'r6a.24xlarge', 'r6a.32xlarge', 'r6a.48xlarge'],
  'r6i': ['r6i.large', 'r6i.xlarge', 'r6i.2xlarge', 'r6i.4xlarge', 'r6i.8xlarge', 'r6i.12xlarge', 'r6i.16xlarge', 'r6i.24xlarge', 'r6i.32xlarge'],
  'r6id': ['r6id.large', 'r6id.xlarge', 'r6id.2xlarge', 'r6id.4xlarge', 'r6id.8xlarge', 'r6id.12xlarge', 'r6id.16xlarge', 'r6id.24xlarge', 'r6id.32xlarge'],
  'r6in': ['r6in.large', 'r6in.xlarge', 'r6in.2xlarge', 'r6in.4xlarge', 'r6in.8xlarge', 'r6in.12xlarge', 'r6in.16xlarge', 'r6in.24xlarge', 'r6in.32xlarge'],
  'r6idn': ['r6idn.large', 'r6idn.xlarge', 'r6idn.2xlarge', 'r6idn.4xlarge', 'r6idn.8xlarge', 'r6idn.12xlarge', 'r6idn.16xlarge', 'r6idn.24xlarge', 'r6idn.32xlarge'],
  'r7a': ['r7a.medium', 'r7a.large', 'r7a.xlarge', 'r7a.2xlarge', 'r7a.4xlarge', 'r7a.8xlarge', 'r7a.12xlarge', 'r7a.16xlarge', 'r7a.24xlarge', 'r7a.32xlarge', 'r7a.48xlarge'],
  'r7i': ['r7i.large', 'r7i.xlarge', 'r7i.2xlarge', 'r7i.4xlarge', 'r7i.8xlarge', 'r7i.12xlarge', 'r7i.16xlarge', 'r7i.24xlarge', 'r7i.48xlarge'],
  'r7iz': ['r7iz.large', 'r7iz.xlarge', 'r7iz.2xlarge', 'r7iz.4xlarge', 'r7iz.8xlarge', 'r7iz.12xlarge', 'r7iz.16xlarge', 'r7iz.32xlarge'],
  'r7g': ['r7g.medium', 'r7g.large', 'r7g.xlarge', 'r7g.2xlarge', 'r7g.4xlarge', 'r7g.8xlarge', 'r7g.12xlarge', 'r7g.16xlarge'],
  'r7gd': ['r7gd.medium', 'r7gd.large', 'r7gd.xlarge', 'r7gd.2xlarge', 'r7gd.4xlarge', 'r7gd.8xlarge', 'r7gd.12xlarge', 'r7gd.16xlarge'],
  'x1': ['x1.16xlarge', 'x1.32xlarge'],
  'x1e': ['x1e.xlarge', 'x1e.2xlarge', 'x1e.4xlarge', 'x1e.8xlarge', 'x1e.16xlarge', 'x1e.32xlarge'],
  'x2idn': ['x2idn.16xlarge', 'x2idn.24xlarge', 'x2idn.32xlarge'],
  'x2iedn': ['x2iedn.xlarge', 'x2iedn.2xlarge', 'x2iedn.4xlarge', 'x2iedn.8xlarge', 'x2iedn.16xlarge', 'x2iedn.24xlarge', 'x2iedn.32xlarge'],
  'x2iezn': ['x2iezn.2xlarge', 'x2iezn.4xlarge', 'x2iezn.6xlarge', 'x2iezn.8xlarge', 'x2iezn.12xlarge'],
  'z1d': ['z1d.large', 'z1d.xlarge', 'z1d.2xlarge', 'z1d.3xlarge', 'z1d.6xlarge', 'z1d.12xlarge'],

  // Storage Optimized
  'd2': ['d2.xlarge', 'd2.2xlarge', 'd2.4xlarge', 'd2.8xlarge'],
  'd3': ['d3.xlarge', 'd3.2xlarge', 'd3.4xlarge', 'd3.8xlarge'],
  'd3en': ['d3en.xlarge', 'd3en.2xlarge', 'd3en.4xlarge', 'd3en.6xlarge', 'd3en.8xlarge', 'd3en.12xlarge'],
  'h1': ['h1.2xlarge', 'h1.4xlarge', 'h1.8xlarge', 'h1.16xlarge'],
  'i3': ['i3.large', 'i3.xlarge', 'i3.2xlarge', 'i3.4xlarge', 'i3.8xlarge', 'i3.16xlarge'],
  'i3en': ['i3en.large', 'i3en.xlarge', 'i3en.2xlarge', 'i3en.3xlarge', 'i3en.6xlarge', 'i3en.12xlarge', 'i3en.24xlarge'],
  'i4i': ['i4i.large', 'i4i.xlarge', 'i4i.2xlarge', 'i4i.4xlarge', 'i4i.8xlarge', 'i4i.16xlarge', 'i4i.32xlarge'],
  'i4g': ['i4g.large', 'i4g.xlarge', 'i4g.2xlarge', 'i4g.4xlarge', 'i4g.8xlarge', 'i4g.16xlarge'],
  'im4gn': ['im4gn.large', 'im4gn.xlarge', 'im4gn.2xlarge', 'im4gn.4xlarge', 'im4gn.8xlarge', 'im4gn.16xlarge'],
  'is4gen': ['is4gen.medium', 'is4gen.large', 'is4gen.xlarge', 'is4gen.2xlarge', 'is4gen.4xlarge', 'is4gen.8xlarge'],

  // General Purpose
  'm5': ['m5.large', 'm5.xlarge', 'm5.2xlarge', 'm5.4xlarge', 'm5.8xlarge', 'm5.12xlarge', 'm5.16xlarge', 'm5.24xlarge'],
  'm5a': ['m5a.large', 'm5a.xlarge', 'm5a.2xlarge', 'm5a.4xlarge', 'm5a.8xlarge', 'm5a.12xlarge', 'm5a.16xlarge', 'm5a.24xlarge'],
  'm5ad': ['m5ad.large', 'm5ad.xlarge', 'm5ad.2xlarge', 'm5ad.4xlarge', 'm5ad.8xlarge', 'm5ad.12xlarge', 'm5ad.16xlarge', 'm5ad.24xlarge'],
  'm5d': ['m5d.large', 'm5d.xlarge', 'm5d.2xlarge', 'm5d.4xlarge', 'm5d.8xlarge', 'm5d.12xlarge', 'm5d.16xlarge', 'm5d.24xlarge'],
  'm5dn': ['m5dn.large', 'm5dn.xlarge', 'm5dn.2xlarge', 'm5dn.4xlarge', 'm5dn.8xlarge', 'm5dn.12xlarge', 'm5dn.16xlarge', 'm5dn.24xlarge'],
  'm5n': ['m5n.large', 'm5n.xlarge', 'm5n.2xlarge', 'm5n.4xlarge', 'm5n.8xlarge', 'm5n.12xlarge', 'm5n.16xlarge', 'm5n.24xlarge'],
  'm5zn': ['m5zn.large', 'm5zn.xlarge', 'm5zn.2xlarge', 'm5zn.3xlarge', 'm5zn.6xlarge', 'm5zn.12xlarge'],
  'm6a': ['m6a.large', 'm6a.xlarge', 'm6a.2xlarge', 'm6a.4xlarge', 'm6a.8xlarge', 'm6a.12xlarge', 'm6a.16xlarge', 'm6a.24xlarge', 'm6a.32xlarge', 'm6a.48xlarge'],
  'm6i': ['m6i.large', 'm6i.xlarge', 'm6i.2xlarge', 'm6i.4xlarge', 'm6i.8xlarge', 'm6i.12xlarge', 'm6i.16xlarge', 'm6i.24xlarge', 'm6i.32xlarge'],
  'm6id': ['m6id.large', 'm6id.xlarge', 'm6id.2xlarge', 'm6id.4xlarge', 'm6id.8xlarge', 'm6id.12xlarge', 'm6id.16xlarge', 'm6id.24xlarge', 'm6id.32xlarge'],
  'm6in': ['m6in.large', 'm6in.xlarge', 'm6in.2xlarge', 'm6in.4xlarge', 'm6in.8xlarge', 'm6in.12xlarge', 'm6in.16xlarge', 'm6in.24xlarge', 'm6in.32xlarge'],
  'm6idn': ['m6idn.large', 'm6idn.xlarge', 'm6idn.2xlarge', 'm6idn.4xlarge', 'm6idn.8xlarge', 'm6idn.12xlarge', 'm6idn.16xlarge', 'm6idn.24xlarge', 'm6idn.32xlarge'],
  'm7a': ['m7a.medium', 'm7a.large', 'm7a.xlarge', 'm7a.2xlarge', 'm7a.4xlarge', 'm7a.8xlarge', 'm7a.12xlarge', 'm7a.16xlarge', 'm7a.24xlarge', 'm7a.32xlarge', 'm7a.48xlarge'],
  'm7i': ['m7i.large', 'm7i.xlarge', 'm7i.2xlarge', 'm7i.4xlarge', 'm7i.8xlarge', 'm7i.12xlarge', 'm7i.16xlarge', 'm7i.24xlarge', 'm7i.48xlarge'],
  'm7i-flex': ['m7i-flex.large', 'm7i-flex.xlarge', 'm7i-flex.2xlarge', 'm7i-flex.4xlarge', 'm7i-flex.8xlarge'],
  'm7g': ['m7g.medium', 'm7g.large', 'm7g.xlarge', 'm7g.2xlarge', 'm7g.4xlarge', 'm7g.8xlarge', 'm7g.12xlarge', 'm7g.16xlarge'],
  'm7gd': ['m7gd.medium', 'm7gd.large', 'm7gd.xlarge', 'm7gd.2xlarge', 'm7gd.4xlarge', 'm7gd.8xlarge', 'm7gd.12xlarge', 'm7gd.16xlarge'],
  'mac1': ['mac1.metal'],
  'mac2': ['mac2.metal'],
  'mac2-m2pro': ['mac2-m2pro.metal'],

  // Burstable
  't2': ['t2.nano', 't2.micro', 't2.small', 't2.medium', 't2.large', 't2.xlarge', 't2.2xlarge'],
  't3': ['t3.nano', 't3.micro', 't3.small', 't3.medium', 't3.large', 't3.xlarge', 't3.2xlarge'],
  't3a': ['t3a.nano', 't3a.micro', 't3a.small', 't3a.medium', 't3a.large', 't3a.xlarge', 't3a.2xlarge'],
  't4g': ['t4g.nano', 't4g.micro', 't4g.small', 't4g.medium', 't4g.large', 't4g.xlarge', 't4g.2xlarge'],

  // High Memory
  'u-3tb1': ['u-3tb1.56xlarge'],
  'u-6tb1': ['u-6tb1.56xlarge', 'u-6tb1.112xlarge'],
  'u-9tb1': ['u-9tb1.112xlarge'],
  'u-12tb1': ['u-12tb1.112xlarge'],
  'u-18tb1': ['u-18tb1.112xlarge'],
  'u-24tb1': ['u-24tb1.112xlarge'],
};

export function expandFamiliesToTypes(families: string[]): string[] {
  const types: string[] = [];
  for (const family of families) {
    const familyTypes = DEFAULT_INSTANCE_TYPES[family];
    if (familyTypes) {
      types.push(...familyTypes);
    }
  }
  return types;
}

export const ALLOWED_INSTANCE_TYPES_PARAM = '/workstation/config/allowedInstanceTypes';

// Used only if the SSM parameter is missing/unreadable (e.g. first boot, before
// any admin has saved a selection) — NOT a silent fallback for write failures,
// see saveAllowedInstanceFamilies below.
const FALLBACK_INSTANCE_TYPES = [
  'g4dn.xlarge', 'g4dn.2xlarge', 'g4dn.4xlarge',
  'g5.xlarge', 'g5.2xlarge', 'g5.4xlarge',
  'g6.xlarge', 'g6.2xlarge', 'g6.4xlarge',
];

/**
 * Single source of truth for reading the admin's allowed-instance-families
 * config and expanding it to concrete EC2 instance types. Every Lambda that
 * needs to know which instance types are allowed to launch MUST call this
 * instead of reimplementing its own SSM fetch + decode — four independent
 * copies of that logic is exactly what let the SSM parameter's format drift
 * out of sync with one of its consumers on 2026-07-23 (config-service and
 * instance-family-service were fixed to expect families; ec2-management was
 * missed and started rejecting every launch until it was caught and fixed
 * separately).
 */
export async function getAllowedInstanceTypes(ssmClient: SSMClient): Promise<string[]> {
  try {
    const result = await ssmClient.send(new GetParameterCommand({ Name: ALLOWED_INSTANCE_TYPES_PARAM }));
    const allowedFamilies: string[] = JSON.parse(result.Parameter?.Value || '[]');
    return expandFamiliesToTypes(allowedFamilies);
  } catch (error) {
    console.warn('Could not fetch allowed instance families from SSM, using defaults:', error);
    return FALLBACK_INSTANCE_TYPES;
  }
}

/**
 * Publishes the admin's allowed families to SSM for launch-time consumers
 * (config-service, ec2-management) to read via getAllowedInstanceTypes above.
 * Unlike a bare PutParameterCommand, this does NOT swallow failures — a
 * caller that ignores a thrown error here would silently tell the admin
 * "saved" while the launch wizard keeps serving the previous config, which is
 * exactly the bug that shipped undetected for 7 weeks (2026-06-01 to
 * 2026-07-23): a Standard-tier SSM parameter caps at 4096 chars, and this
 * used to be written as the fully-expanded instance-type list (500+ entries
 * once more than a handful of families were allowed) instead of the compact
 * family list, so PutParameter threw and the catch block around it hid it.
 */
export async function saveAllowedInstanceFamilies(ssmClient: SSMClient, allowedFamilies: string[]): Promise<void> {
  await ssmClient.send(new PutParameterCommand({
    Name: ALLOWED_INSTANCE_TYPES_PARAM,
    Value: JSON.stringify(allowedFamilies),
    Type: 'String',
    Overwrite: true,
    Description: 'List of allowed EC2 instance families for workstation deployments',
  }));
}
