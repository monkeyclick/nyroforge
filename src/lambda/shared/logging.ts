import { APIGatewayProxyEvent } from 'aws-lambda';

/**
 * Safe request logging for Lambda handlers.
 *
 * Handlers previously logged the entire API Gateway event with
 * `console.log('Event:', JSON.stringify(event, null, 2))`, which writes the
 * caller's bearer token (event.headers.Authorization) — and, for handlers that
 * accept credentials, plaintext passwords in event.body — to CloudWatch on
 * every invocation. Use `logEvent(event)` instead: it emits the fields useful
 * for debugging (method, path, params, caller identity, source IP) while
 * redacting secrets.
 */

const SENSITIVE_HEADER_KEYS = new Set([
  'authorization',
  'cookie',
  'x-api-key',
  'x-amz-security-token',
]);

const SENSITIVE_BODY_KEYS = new Set([
  'password',
  'temporarypassword',
  'newpassword',
  'currentpassword',
  'oldpassword',
  'confirmpassword',
  'secret',
  'secretaccesskey',
  'accesskey',
  'accesskeyid',
  'token',
  'sessiontoken',
  'privatekey',
]);

const REDACTED = '[REDACTED]';

function redactHeaders(headers: APIGatewayProxyEvent['headers']): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_HEADER_KEYS.has(key.toLowerCase()) ? REDACTED : String(value ?? '');
  }
  return out;
}

function redactBody(body: string | null): unknown {
  if (!body) return body;
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const clone: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
      for (const key of Object.keys(clone)) {
        if (SENSITIVE_BODY_KEYS.has(key.toLowerCase())) {
          clone[key] = REDACTED;
        }
      }
      return clone;
    }
    // Arrays / primitives: don't risk leaking; only log the type.
    return Array.isArray(parsed) ? `[array:${parsed.length}]` : parsed;
  } catch {
    // Not JSON — could be form-encoded credentials; never echo it verbatim.
    return '[unparsed-body-omitted]';
  }
}

/** Build a redacted, log-safe view of an API Gateway proxy event. */
export function redactEvent(event: APIGatewayProxyEvent): Record<string, unknown> {
  const rc = event.requestContext as APIGatewayProxyEvent['requestContext'] | undefined;
  const claims = rc?.authorizer?.claims as Record<string, unknown> | undefined;
  return {
    httpMethod: event.httpMethod,
    path: event.path,
    resource: event.resource,
    pathParameters: event.pathParameters,
    queryStringParameters: event.queryStringParameters,
    headers: redactHeaders(event.headers),
    body: redactBody(event.body),
    requestContext: rc
      ? {
          requestId: rc.requestId,
          sourceIp: rc.identity?.sourceIp,
          caller: claims
            ? {
                sub: claims.sub,
                email: claims.email,
                'cognito:groups': claims['cognito:groups'],
              }
            : undefined,
        }
      : undefined,
  };
}

/** Log a redacted view of the event. Drop-in replacement for the old event log. */
export function logEvent(event: APIGatewayProxyEvent, label = 'Event'): void {
  console.log(label, JSON.stringify(redactEvent(event)));
}
