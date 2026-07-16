import { NextRequest, NextResponse } from 'next/server';
import { MAX_UNITS_PER_ITEM } from '@/lib/wishlistLimits';
import {
  availabilityStatusOptions,
  type AvailabilityStatus,
} from '@/lib/availability';
import {
  authenticateAdminRequest,
  formatSupabaseAdminWriteError,
} from '@/lib/server/supabaseAdmin';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

type SubmittedOption = {
  label?: unknown;
  price?: unknown;
  min_quantity?: unknown;
  max_quantity?: unknown;
  is_default?: unknown;
  sort_order?: unknown;
  status?: unknown;
};

const availabilityValues = new Set(availabilityStatusOptions.map(option => option.value));

function toMoney(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
}

function toQuantity(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.floor(number)) : fallback;
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateAdminRequest(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { id: cardId } = await context.params;
    const body = await request.json().catch(() => null) as { options?: unknown } | null;
    const submittedOptions = Array.isArray(body?.options) ? body.options as SubmittedOption[] : null;
    if (!cardId || !submittedOptions || submittedOptions.length === 0 || submittedOptions.length > 100) {
      return NextResponse.json({ error: 'Provide between 1 and 100 purchase options.' }, { status: 400 });
    }

    let defaultAssigned = false;
    const options = submittedOptions.map((option, index) => {
      const label = String(option.label ?? '').trim();
      const price = toMoney(option.price);
      const minQuantity = toQuantity(option.min_quantity, 1);
      const rawMaxQuantity = option.max_quantity == null || String(option.max_quantity).trim() === ''
        ? null
        : toQuantity(option.max_quantity, minQuantity);
      const status = String(option.status ?? '').trim().toLowerCase() as AvailabilityStatus;

      if (!label || price === null || minQuantity > MAX_UNITS_PER_ITEM
        || (rawMaxQuantity !== null && (rawMaxQuantity < minQuantity || rawMaxQuantity > MAX_UNITS_PER_ITEM))
        || !availabilityValues.has(status)) {
        throw new Error(`Purchase option ${index + 1} is invalid.`);
      }

      const isDefault = !defaultAssigned && option.is_default === true && status === 'available';
      defaultAssigned ||= isDefault;
      return {
        card_id: cardId,
        label,
        price,
        min_quantity: minQuantity,
        max_quantity: rawMaxQuantity,
        is_default: isDefault,
        // Legacy compatibility only; all customer behavior uses status.
        is_active: true,
        sort_order: index,
        status,
      };
    });

    const { error: deleteError } = await auth.supabaseAdmin
      .from('card_purchase_options')
      .delete()
      .eq('card_id', cardId);
    if (deleteError) throw deleteError;

    const { data, error: insertError } = await auth.supabaseAdmin
      .from('card_purchase_options')
      .insert(options)
      .select('*');
    if (insertError) throw insertError;

    return NextResponse.json({ success: true, options: data ?? [] });
  } catch (error: unknown) {
    const message = error instanceof Error
      ? error.message
      : error && typeof error === 'object'
        ? formatSupabaseAdminWriteError(error as { message?: string })
        : 'Could not save purchase options.';
    return NextResponse.json({ error: message || 'Could not save purchase options.' }, { status: 400 });
  }
}
