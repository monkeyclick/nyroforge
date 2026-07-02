import { APIGatewayProxyResult } from 'aws-lambda';

/**
 * Standard CORS headers shared by every Lambda-proxied response.
 * `FRONTEND_URL` is injected by the API stacks when a frontend origin is
 * configured; otherwise we fall back to `*` (matches historical behavior).
 */
export function corsHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  };
}

export function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(body)
  };
}

/**
 * Client-safe error response. The underlying error (if provided) is logged
 * server-side only — never echo `error.message` back to the caller.
 */
export function errorResponse(
  statusCode: number,
  publicMessage: string,
  error?: unknown
): APIGatewayProxyResult {
  if (error !== undefined) {
    console.error(publicMessage, error);
  }
  return jsonResponse(statusCode, { error: publicMessage });
}
