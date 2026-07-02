import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse } from './http';

export const ADMIN_GROUP = 'workstation-admin';

/**
 * Extract Cognito group memberships from the API Gateway authorizer claims.
 * The Cognito authorizer has already verified the token, so the claims can be
 * trusted directly. Depending on the token/authorizer version the
 * `cognito:groups` claim arrives as an array, a comma-joined string, or a
 * single group name — handle all three (mirrors cognito-admin-service).
 */
export function getGroups(event: APIGatewayProxyEvent): string[] {
  const claims = event.requestContext?.authorizer?.claims;
  const groups = claims?.['cognito:groups'];
  if (!groups) {
    return [];
  }
  if (Array.isArray(groups)) {
    return groups.map((g) => String(g).trim()).filter(Boolean);
  }
  return String(groups)
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);
}

export function isAdmin(event: APIGatewayProxyEvent): boolean {
  return getGroups(event).includes(ADMIN_GROUP);
}

/**
 * Returns a 403 response if the caller is not in the admin group, or null if
 * the request may proceed. Usage:
 *
 *   const denied = requireAdmin(event);
 *   if (denied) return denied;
 */
export function requireAdmin(event: APIGatewayProxyEvent): APIGatewayProxyResult | null {
  if (isAdmin(event)) {
    return null;
  }
  return errorResponse(403, 'Forbidden: admin access required');
}
