import { createClient } from '@supabase/supabase-js';

export function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin credentials are not configured.');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
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
