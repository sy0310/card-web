import { NextResponse } from 'next/server';
import {
  authenticateAdminRequest,
  formatSupabaseAdminWriteError,
} from '@/lib/server/supabaseAdmin';
import {
  getInstagramSettingsStatus,
  getStoredInstagramSettings,
  normalizeInstagramSettingsPatch,
} from '@/lib/server/instagramSettings';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const auth = await authenticateAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const stored = await getStoredInstagramSettings(auth.supabaseAdmin);
    return NextResponse.json({ status: getInstagramSettingsStatus(stored) });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: `Could not load Instagram settings: ${formatSupabaseAdminWriteError(error as { message?: string })}` },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await authenticateAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const patch = normalizeInstagramSettingsPatch(body);
    const existing = await getStoredInstagramSettings(auth.supabaseAdmin);
    const row = {
      session_id: patch.session_id ?? existing?.session_id ?? null,
      settings_json: patch.settings_json ?? existing?.settings_json ?? null,
      proxy: patch.proxy ?? existing?.proxy ?? null,
      updated_at: new Date().toISOString(),
      updated_by: auth.user.id,
    };

    const query = existing
      ? auth.supabaseAdmin.from('instagram_settings').update(row).eq('id', existing.id).select('id, session_id, settings_json, proxy, updated_at, updated_by').single()
      : auth.supabaseAdmin.from('instagram_settings').insert(row).select('id, session_id, settings_json, proxy, updated_at, updated_by').single();
    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({
      success: true,
      status: getInstagramSettingsStatus(data),
    });
  } catch (error: unknown) {
    const message = error instanceof Error
      ? error.message
      : formatSupabaseAdminWriteError(error as { message?: string });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
