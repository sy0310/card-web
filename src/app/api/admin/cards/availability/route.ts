import { NextRequest, NextResponse } from 'next/server';
import { authenticateAdminRequest, formatSupabaseAdminWriteError } from '@/lib/server/supabaseAdmin';

export const runtime = 'nodejs';

const validStatuses = new Set(['available', 'pending', 'archived']);

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAdminRequest(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await request.json().catch(() => null) as { card_ids?: unknown; availability_status?: unknown } | null;
    const cardIds = Array.isArray(body?.card_ids)
      ? [...new Set(body!.card_ids.map(value => String(value ?? '').trim()).filter(Boolean))]
      : [];
    const status = String(body?.availability_status ?? '').trim().toLowerCase();
    if (cardIds.length === 0 || cardIds.length > 500) {
      return NextResponse.json({ error: 'Select between 1 and 500 cards.' }, { status: 400 });
    }
    if (!validStatuses.has(status)) {
      return NextResponse.json({ error: 'Availability status must be available, pending, or archived.' }, { status: 400 });
    }

    const { data, error } = await auth.supabaseAdmin
      .from('cards')
      .update({ availability_status: status })
      .in('id', cardIds)
      .select('id, availability_status');
    if (error) {
      return NextResponse.json({ error: formatSupabaseAdminWriteError(error) }, { status: 500 });
    }

    return NextResponse.json({ success: true, cards: data ?? [] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || 'Could not update card availability.' }, { status: 500 });
  }
}
