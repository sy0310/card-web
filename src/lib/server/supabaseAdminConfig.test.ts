import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatSupabaseAdminWriteError,
  getSupabaseJwtRole,
  getSupabaseServiceRoleKeyError,
} from './supabaseAdminConfig.ts';

function jwtWithRole(role: string) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role }))
    .toString('base64url');

  return `${header}.${payload}.signature`;
}

test('getSupabaseJwtRole reads the role claim from jwt-shaped keys', () => {
  assert.equal(getSupabaseJwtRole(jwtWithRole('service_role')), 'service_role');
  assert.equal(getSupabaseJwtRole(jwtWithRole('anon')), 'anon');
  assert.equal(getSupabaseJwtRole('sb_secret_non_jwt_key'), null);
});

test('getSupabaseServiceRoleKeyError rejects missing anon and non-service role keys', () => {
  const anonKey = jwtWithRole('anon');

  assert.match(
    getSupabaseServiceRoleKeyError('', anonKey) ?? '',
    /not configured/,
  );
  assert.match(
    getSupabaseServiceRoleKeyError(anonKey, anonKey) ?? '',
    /matches NEXT_PUBLIC_SUPABASE_ANON_KEY/,
  );
  assert.match(
    getSupabaseServiceRoleKeyError(jwtWithRole('authenticated'), anonKey) ?? '',
    /role "authenticated"/,
  );
  assert.equal(
    getSupabaseServiceRoleKeyError(` ${jwtWithRole('service_role')} `, anonKey),
    null,
  );
});

test('formatSupabaseAdminWriteError makes RLS failures actionable', () => {
  assert.match(
    formatSupabaseAdminWriteError({
      message: 'new row violates row-level security policy',
    }),
    /SUPABASE_SERVICE_ROLE_KEY/,
  );
  assert.equal(
    formatSupabaseAdminWriteError({ message: 'Bucket not found' }),
    'Bucket not found',
  );
});
