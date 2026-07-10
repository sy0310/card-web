import { NextResponse } from 'next/server';
import {
  authenticateAdminRequest,
  formatSupabaseAdminWriteError,
} from '@/lib/server/supabaseAdmin';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const auth = await authenticateAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { data, error } = await auth.supabaseAdmin
      .from('instagram_sync_logs')
      .select('id, status, message, posts_found, created_at, started_at, finished_at')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;
    return NextResponse.json({ logs: data ?? [] });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: `Could not load Instagram sync history: ${formatSupabaseAdminWriteError(error as { message?: string })}` },
      { status: 500 },
    );
  }
}
