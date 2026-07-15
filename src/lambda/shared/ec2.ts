import { DescribeInstancesCommand, EC2Client, Filter, Instance } from '@aws-sdk/client-ec2';

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
