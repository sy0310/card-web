import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/server/supabaseAdmin';

export const runtime = 'nodejs';

function sanitizeText(value: unknown, maxLength: number) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const query = sanitizeText(body?.query, 100).toLowerCase();
    const category = sanitizeText(body?.category, 100) || null;
    const anonymousSessionId = sanitizeText(body?.anonymous_session_id, 100) || null;
    const resultCount = Math.max(0, Math.floor(Number(body?.result_count) || 0));

    if (query.length < 2) return NextResponse.json({ success: true });

    const { error } = await createSupabaseAdminClient()
      .from('storefront_search_events')
      .insert({
        normalized_query: query,
        category,
        result_count: resultCount,
        anonymous_session_id: anonymousSessionId,
      });
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.warn('Could not record storefront search event:', error);
    return NextResponse.json({ success: false }, { status: 202 });
  }
}
