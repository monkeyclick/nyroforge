import {
  AttributeValue,
  DynamoDBClient,
  QueryCommand,
  QueryCommandInput,
  ScanCommand,
  ScanCommandInput,
} from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand as DocQueryCommand,
  QueryCommandInput as DocQueryCommandInput,
  ScanCommand as DocScanCommand,
  ScanCommandInput as DocScanCommandInput,
} from '@aws-sdk/lib-dynamodb';

/**
 * Paginated DynamoDB read helpers.
 *
 * A single Scan/Query call returns at most 1 MB of data (before filtering).
 * Callers that don't follow LastEvaluatedKey silently operate on a partial
 * result set once a table grows past that — e.g. auto-termination never
 * seeing expired workstations beyond the first page. These helpers exhaust
 * every page; MAX_PAGES is only a runaway guard.
 */
const MAX_PAGES = 100;

/** Scan every page, returning unmarshalled items (plain DynamoDBClient). */
export async function scanAllItems(
  client: DynamoDBClient,
  input: ScanCommandInput
): Promise<Record<string, any>[]> {
  const items: Record<string, any>[] = [];
  let lastKey: Record<string, AttributeValue> | undefined;
  let pages = 0;
  do {
    const result = await client.send(
      new ScanCommand({ ...input, ExclusiveStartKey: lastKey })
    );
    for (const item of result.Items || []) {
      items.push(unmarshall(item));
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey && ++pages < MAX_PAGES);
  return items;
}

/** Query every page, returning unmarshalled items (plain DynamoDBClient). */
export async function queryAllItems(
  client: DynamoDBClient,
  input: QueryCommandInput
): Promise<Record<string, any>[]> {
  const items: Record<string, any>[] = [];
  let lastKey: Record<string, AttributeValue> | undefined;
  let pages = 0;
  do {
    const result = await client.send(
      new QueryCommand({ ...input, ExclusiveStartKey: lastKey })
    );
    for (const item of result.Items || []) {
      items.push(unmarshall(item));
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey && ++pages < MAX_PAGES);
  return items;
}

/** Scan every page via the document client. */
export async function docScanAll(
  doc: DynamoDBDocumentClient,
  input: DocScanCommandInput
): Promise<Record<string, any>[]> {
  const items: Record<string, any>[] = [];
  let lastKey: Record<string, any> | undefined;
  let pages = 0;
  do {
    const result = await doc.send(
      new DocScanCommand({ ...input, ExclusiveStartKey: lastKey })
    );
    items.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey && ++pages < MAX_PAGES);
  return items;
}

/** Query every page via the document client. */
export async function docQueryAll(
  doc: DynamoDBDocumentClient,
  input: DocQueryCommandInput
): Promise<Record<string, any>[]> {
  const items: Record<string, any>[] = [];
  let lastKey: Record<string, any> | undefined;
  let pages = 0;
  do {
    const result = await doc.send(
      new DocQueryCommand({ ...input, ExclusiveStartKey: lastKey })
    );
    items.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey && ++pages < MAX_PAGES);
  return items;
}
