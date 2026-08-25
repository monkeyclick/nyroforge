import { DescribeInstancesCommand, DescribeInstanceTypesCommand, EC2Client, Filter, Instance, InstanceTypeInfo as Ec2InstanceTypeInfo } from '@aws-sdk/client-ec2';

/**
 * Shared EC2 DescribeInstances helpers.
 *
 * A single DescribeInstances call returns at most one page of reservations;
 * callers that don't follow NextToken silently operate on a partial fleet.
 * Both helpers exhaust every page.
 */

/** Max instance IDs per filter chunk (stays within EC2 filter value limits). */
const CHUNK_SIZE = 150;

/**
 * Describe instances by ID without letting one stale ID poison the batch.
 * Using an instance-id filter (rather than InstanceIds) makes EC2 ignore
 * IDs that no longer exist instead of failing the whole call, and the
 * NextToken loop covers result sets beyond one page. IDs are chunked to
 * stay within filter value limits.
 */
export async function describeInstancesByIds(
  client: EC2Client,
  instanceIds: string[]
): Promise<Instance[]> {
  const instances: Instance[] = [];
  for (let i = 0; i < instanceIds.length; i += CHUNK_SIZE) {
    const chunk = instanceIds.slice(i, i + CHUNK_SIZE);
    let nextToken: string | undefined;
    do {
      const result = await client.send(new DescribeInstancesCommand({
        Filters: [{ Name: 'instance-id', Values: chunk }],
        NextToken: nextToken,
      }));
      instances.push(...(result.Reservations?.flatMap(r => r.Instances || []) || []));
      nextToken = result.NextToken;
    } while (nextToken);
  }
  return instances;
}

/**
 * Describe instances matching the given filters, following NextToken until
 * the result set is exhausted.
 */
export async function describeInstancesByFilters(
  client: EC2Client,
  filters: Filter[]
): Promise<Instance[]> {
  const instances: Instance[] = [];
  let nextToken: string | undefined;
  do {
    const result = await client.send(new DescribeInstancesCommand({
      Filters: filters,
      NextToken: nextToken,
    }));
    instances.push(...(result.Reservations?.flatMap(r => r.Instances || []) || []));
    nextToken = result.NextToken;
  } while (nextToken);
  return instances;
}

/** DescribeInstanceTypes rejects more than 100 values in a single filter. */
const INSTANCE_TYPES_CHUNK_SIZE = 100;

/**
 * Describe instance types by name without letting one unavailable type poison
 * the batch, and without hitting EC2's 100-item list limit. Uses an
 * `instance-type` filter (rather than the `InstanceTypes` list param) for the
 * same reason describeInstancesByIds uses an instance-id filter: the strict
 * list param throws InvalidInstanceType for the WHOLE call if any single
 * entry isn't sold in the caller's region (e.g. legacy families like `dl1`/
 * `p3` aren't offered everywhere) — a real failure hit expanding an
 * admin-selected family list that covers everything from GPU to burstable
 * families. The filter form just omits types that don't match instead.
 * Also chunked to stay under the 100-value filter limit, and follows
 * NextToken in case a chunk spans more than one page.
 */
export async function describeInstanceTypesBatched(
  client: EC2Client,
  instanceTypes: string[]
): Promise<Ec2InstanceTypeInfo[]> {
  const results: Ec2InstanceTypeInfo[] = [];
  for (let i = 0; i < instanceTypes.length; i += INSTANCE_TYPES_CHUNK_SIZE) {
    const chunk = instanceTypes.slice(i, i + INSTANCE_TYPES_CHUNK_SIZE);
    let nextToken: string | undefined;
    do {
      const result = await client.send(new DescribeInstanceTypesCommand({
        Filters: [{ Name: 'instance-type', Values: chunk }],
        NextToken: nextToken,
      }));
      results.push(...(result.InstanceTypes || []));
      nextToken = result.NextToken;
    } while (nextToken);
  }
  return results;
}
