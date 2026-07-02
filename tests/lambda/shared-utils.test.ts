import { APIGatewayProxyEvent } from 'aws-lambda';

import { getGroups, isAdmin, requireAdmin, ADMIN_GROUP } from '../../src/lambda/shared/auth';
import { corsHeaders, jsonResponse, errorResponse } from '../../src/lambda/shared/http';
import { generateSecurePassword } from '../../src/lambda/shared/password';
import { isValidCidr, isSafeObjectKey } from '../../src/lambda/shared/validation';

function eventWithGroups(groups: unknown): APIGatewayProxyEvent {
  return {
    requestContext: {
      authorizer: {
        claims: {
          sub: 'user-123',
          ...(groups !== undefined ? { 'cognito:groups': groups } : {}),
        },
      },
    },
  } as unknown as APIGatewayProxyEvent;
}

describe('shared/auth', () => {
  describe('getGroups', () => {
    it('parses an array claim', () => {
      expect(getGroups(eventWithGroups(['workstation-admin', 'users']))).toEqual([
        'workstation-admin',
        'users',
      ]);
    });

    it('parses a comma-joined string claim', () => {
      expect(getGroups(eventWithGroups('workstation-admin, users'))).toEqual([
        'workstation-admin',
        'users',
      ]);
    });

    it('parses a single string claim', () => {
      expect(getGroups(eventWithGroups('users'))).toEqual(['users']);
    });

    it('returns empty for missing claim', () => {
      expect(getGroups(eventWithGroups(undefined))).toEqual([]);
    });

    it('returns empty when authorizer claims are absent', () => {
      const event = { requestContext: {} } as unknown as APIGatewayProxyEvent;
      expect(getGroups(event)).toEqual([]);
    });
  });

  describe('isAdmin / requireAdmin', () => {
    it('accepts a member of the admin group', () => {
      const event = eventWithGroups([ADMIN_GROUP]);
      expect(isAdmin(event)).toBe(true);
      expect(requireAdmin(event)).toBeNull();
    });

    it('rejects a non-admin with 403', () => {
      const event = eventWithGroups(['users']);
      expect(isAdmin(event)).toBe(false);
      const denied = requireAdmin(event);
      expect(denied?.statusCode).toBe(403);
      expect(JSON.parse(denied!.body).error).toMatch(/admin/i);
    });

    it('rejects when no groups claim exists', () => {
      const denied = requireAdmin(eventWithGroups(undefined));
      expect(denied?.statusCode).toBe(403);
    });
  });
});

describe('shared/http', () => {
  it('corsHeaders uses FRONTEND_URL when set', () => {
    expect(corsHeaders()['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
  });

  it('jsonResponse serializes the body with CORS headers', () => {
    const res = jsonResponse(201, { ok: true });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(res.headers?.['Access-Control-Allow-Origin']).toBeDefined();
  });

  it('errorResponse returns only the public message', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const res = errorResponse(500, 'Internal server error', new Error('secret detail'));
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret detail');
    expect(JSON.parse(res.body)).toEqual({ error: 'Internal server error' });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('shared/password', () => {
  it('generates a password of the requested length', () => {
    expect(generateSecurePassword(16)).toHaveLength(16);
    expect(generateSecurePassword(24)).toHaveLength(24);
  });

  it('contains at least one of each character class', () => {
    for (let i = 0; i < 20; i++) {
      const pw = generateSecurePassword();
      expect(pw).toMatch(/[A-HJ-NP-Z]/);
      expect(pw).toMatch(/[a-hj-km-z]/);
      expect(pw).toMatch(/[2-9]/);
      expect(pw).toMatch(/[!@#$%^&*]/);
    }
  });

  it('only uses characters from the allowed charset', () => {
    const pw = generateSecurePassword(64);
    expect(pw).toMatch(/^[A-HJ-NP-Za-hj-km-z2-9!@#$%^&*]+$/);
  });
});

describe('shared/validation', () => {
  describe('isValidCidr', () => {
    it.each(['203.0.113.5/32', '10.0.0.0/8', '192.168.1.0/24', '0.0.0.0/0'])(
      'accepts well-formed CIDR %s',
      (cidr) => expect(isValidCidr(cidr)).toBe(true)
    );

    it.each([
      'not-a-cidr',
      '10.0.0.0',
      '256.0.0.1/24',
      '10.0.0.0/33',
      '10.0.0.0/-1',
      '10.0.0/24',
      '',
    ])('rejects malformed CIDR %s', (cidr) => expect(isValidCidr(cidr)).toBe(false));
  });

  describe('isSafeObjectKey', () => {
    it.each(['users/abc/file.txt', 'file.txt', 'a/b/c.d'])('accepts safe key %s', (key) =>
      expect(isSafeObjectKey(key)).toBe(true)
    );

    it.each(['../etc/passwd', 'users/../other/file', '/absolute/key', ''])(
      'rejects unsafe key %s',
      (key) => expect(isSafeObjectKey(key)).toBe(false)
    );
  });
});
