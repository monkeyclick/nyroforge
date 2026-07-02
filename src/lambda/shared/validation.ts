/**
 * Validate an IPv4 CIDR block (e.g. "203.0.113.5/32").
 */
export function isValidCidr(cidr: string): boolean {
  if (typeof cidr !== 'string') {
    return false;
  }
  const match = cidr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
  if (!match) {
    return false;
  }
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((o) => o > 255)) {
    return false;
  }
  const mask = Number(match[5]);
  return mask >= 0 && mask <= 32;
}

/**
 * Validate an S3 object key (or prefix) supplied by a caller: non-empty,
 * no leading slash, and no `..` path-traversal segments.
 */
export function isSafeObjectKey(key: string): boolean {
  if (typeof key !== 'string' || key.length === 0 || key.length > 1024) {
    return false;
  }
  if (key.startsWith('/')) {
    return false;
  }
  return !key.split('/').includes('..');
}
