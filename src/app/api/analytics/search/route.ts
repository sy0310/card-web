import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/server/supabaseAdmin';
import {
  buildStorefrontSearchFilter,
  getStorefrontSearchTerms,
} from '@/lib/storefrontPagination';

export const runtime = 'nodejs';

function sanitizeText(value: unknown, maxLength: number) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function getFiveMinuteBucket(date = new Date()) {
  return new Date(Math.floor(date.getTime() / 300_000) * 300_000).toISOString();
}

function getClientFingerprint(request: NextRequest, anonymousSessionId: string) {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const source = forwardedFor || request.headers.get('x-real-ip') || `session:${anonymousSessionId}`;
  const salt = process.env.ANALYTICS_FINGERPRINT_SALT || 'kpop-card-search-analytics';
  return createHash('sha256').update(`${salt}:${source}`).digest('hex');
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const query = sanitizeText(body?.query, 100).toLowerCase();
    const category = sanitizeText(body?.category, 100) || null;
    const anonymousSessionId = sanitizeText(body?.anonymous_session_id, 100);

    if (query.length < 2) return NextResponse.json({ success: true });
    if (!isUuid(anonymousSessionId)) {
      return NextResponse.json({ error: 'Invalid anonymous session.' }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const clientFingerprint = getClientFingerprint(request, anonymousSessionId);
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { count: recentEventCount, error: rateLimitError } = await supabaseAdmin
      .from('storefront_search_events')
      .select('id', { count: 'exact', head: true })
      .eq('client_fingerprint', clientFingerprint)
      .gte('created_at', oneMinuteAgo);
    if (rateLimitError) throw rateLimitError;
    if ((recentEventCount ?? 0) >= 30) {
      return NextResponse.json({ success: true, rate_limited: true });
    }

    let cardsQuery = supabaseAdmin
      .from('cards')
      .select('id', { count: 'exact', head: true })
      .neq('availability_status', 'archived');
    if (category) cardsQuery = cardsQuery.eq('group_name', category);
    const searchFilter = buildStorefrontSearchFilter(getStorefrontSearchTerms(query));
    if (searchFilter) cardsQuery = cardsQuery.or(searchFilter);
    const { count: resultCount, error: resultCountError } = await cardsQuery;
    if (resultCountError) throw resultCountError;

    const { error } = await supabaseAdmin
      .from('storefront_search_events')
      .insert({
        normalized_query: query,
        category,
        result_count: Math.max(0, resultCount ?? 0),
        anonymous_session_id: anonymousSessionId,
        dedupe_bucket: getFiveMinuteBucket(),
        client_fingerprint: clientFingerprint,
      });
    if (error && error.code !== '23505') throw error;

    return NextResponse.json({ success: true, deduplicated: error?.code === '23505' });
  } catch (error) {
    console.warn('Could not record storefront search event:', error);
    return NextResponse.json({ success: false }, { status: 202 });
  }
}
