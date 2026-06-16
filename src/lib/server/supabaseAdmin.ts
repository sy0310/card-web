import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { getSupabaseServiceRoleKeyError } from './supabaseAdminConfig';

export { formatSupabaseAdminWriteError } from './supabaseAdminConfig';

function trimEnvValue(value: string | undefined) {
  return value?.trim() ?? '';
}

export function createSupabaseAdminClient() {
  const supabaseUrl = trimEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = trimEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured.');
  }

  const serviceRoleKeyError = getSupabaseServiceRoleKeyError(serviceRoleKey);
  if (serviceRoleKeyError) {
    throw new Error(serviceRoleKeyError);
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  });
}

export async function authenticateAdminRequest(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return {
      ok: false as const,
      status: 401,
      error: 'Unauthorized: Missing Auth Header',
    };
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return {
      ok: false as const,
      status: 401,
      error: 'Unauthorized: Missing token',
    };
  }

  const supabaseAdmin = createSupabaseAdminClient();
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return {
      ok: false as const,
      status: 401,
      error: `Unauthorized: ${error?.message || 'Invalid token'}`,
    };
  }

  return {
    ok: true as const,
    supabaseAdmin,
    user,
  };
}
