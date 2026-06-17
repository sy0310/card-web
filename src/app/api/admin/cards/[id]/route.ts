import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateAdminRequest,
  formatSupabaseAdminWriteError,
} from '@/lib/server/supabaseAdmin';
import {
  type CardEditDraft,
  buildCardUpdatePayload,
  getCardDraftErrors,
} from '@/app/admin/dashboard/adminDashboardUtils';

export const runtime = 'nodejs';

type CardRouteContext = {
  params: Promise<{ id: string }>;
};

function readText(value: unknown) {
  return String(value ?? '').trim();
}

function buildDraftFromBody(body: Record<string, unknown>): CardEditDraft {
  return {
    title: readText(body.title),
    description: readText(body.description),
    price: readText(body.price),
    image_url: readText(body.image_url),
    group_name: readText(body.group_name),
    member_name: readText(body.member_name),
    album_era: readText(body.album_era),
    rarity: readText(body.rarity),
    inventory_count: readText(body.inventory_count),
    original_ig_url: readText(body.original_ig_url),
    source: readText(body.source || 'manual'),
    pob_name: readText(body.pob_name),
  };
}

export async function PATCH(request: NextRequest, context: CardRouteContext) {
  try {
    const auth = await authenticateAdminRequest(request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'Card id is required.' }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Card payload must be a JSON object.' }, { status: 400 });
    }

    const draft = buildDraftFromBody(body as Record<string, unknown>);
    const errors = getCardDraftErrors(draft);
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join(' ') }, { status: 400 });
    }

    const payload = buildCardUpdatePayload(draft);
    const { data: card, error } = await auth.supabaseAdmin
      .from('cards')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json(
        { error: formatSupabaseAdminWriteError(error) },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      card,
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg || 'Internal Server Error' }, { status: 500 });
  }
}
