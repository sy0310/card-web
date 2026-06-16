const serviceRoleMisconfigurationHelp =
  'Set SUPABASE_SERVICE_ROLE_KEY to the Supabase service_role key in your deployment environment, then redeploy.';

function trimEnvValue(value: string | undefined) {
  return value?.trim() ?? '';
}

export function getSupabaseJwtRole(key: string) {
  const payloadSegment = key.trim().split('.')[1];
  if (!payloadSegment) return null;

  try {
    const paddedPayload = payloadSegment.padEnd(
      Math.ceil(payloadSegment.length / 4) * 4,
      '=',
    );
    const decoded = JSON.parse(
      Buffer.from(
        paddedPayload.replace(/-/g, '+').replace(/_/g, '/'),
        'base64',
      ).toString('utf8'),
    ) as { role?: unknown };

    return typeof decoded.role === 'string' ? decoded.role : null;
  } catch {
    return null;
  }
}

export function getSupabaseServiceRoleKeyError(
  serviceRoleKey: string | undefined,
  anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
) {
  const trimmedServiceRoleKey = trimEnvValue(serviceRoleKey);
  const trimmedAnonKey = trimEnvValue(anonKey);

  if (!trimmedServiceRoleKey) {
    return `Supabase admin credentials are not configured. ${serviceRoleMisconfigurationHelp}`;
  }

  if (trimmedAnonKey && trimmedServiceRoleKey === trimmedAnonKey) {
    return `SUPABASE_SERVICE_ROLE_KEY matches NEXT_PUBLIC_SUPABASE_ANON_KEY. ${serviceRoleMisconfigurationHelp}`;
  }

  const keyRole = getSupabaseJwtRole(trimmedServiceRoleKey);
  if (keyRole && keyRole !== 'service_role') {
    return `SUPABASE_SERVICE_ROLE_KEY has role "${keyRole}", not "service_role". ${serviceRoleMisconfigurationHelp}`;
  }

  return null;
}

export function formatSupabaseAdminWriteError(error: { message?: string }) {
  const message = error.message || 'Unknown Supabase write error';
  if (/row-level security|violates.*security policy/i.test(message)) {
    return `Supabase admin write was blocked by row-level security. ${serviceRoleMisconfigurationHelp}`;
  }

  return message;
}
