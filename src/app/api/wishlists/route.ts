import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/server/supabaseAdmin';

export const runtime = 'nodejs';

type SubmittedItem = {
  card_id?: unknown;
  purchase_option_id?: unknown;
  quantity?: unknown;
};

type CardRow = {
  id: string;
  title: string | null;
  price: number | string | null;
  image_url: string | null;
  group_name: string | null;
  album_era: string | null;
  inventory_count: number | string | null;
  availability_status: string | null;
};

type PurchaseOptionRow = {
  id: string;
  card_id: string;
  label: string | null;
  price: number | string | null;
  min_quantity: number | string | null;
  max_quantity: number | string | null;
  is_active: boolean | null;
};

function toText(value: unknown) {
  return String(value ?? '').trim();
}

function toQuantity(value: unknown) {
  const quantity = Math.floor(Number(value));
  return Number.isFinite(quantity) ? Math.max(1, quantity) : 1;
}

function toMoney(value: unknown) {
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : 0;
}

function isPersistentOptionId(value: string) {
  return value.length > 0 && !value.startsWith('fallback-');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as {
      user_ig_handle?: unknown;
      items?: unknown;
    } | null;
    const handle = toText(body?.user_ig_handle);
    const submittedItems = Array.isArray(body?.items) ? body.items as SubmittedItem[] : [];

    if (!handle || handle.length > 100) {
      return NextResponse.json({ error: 'Enter a valid Instagram handle.' }, { status: 400 });
    }
    if (submittedItems.length === 0 || submittedItems.length > 100) {
      return NextResponse.json({ error: 'Your wishlist is empty or too large.' }, { status: 400 });
    }

    const normalizedItems = submittedItems.map(item => ({
      cardId: toText(item.card_id),
      purchaseOptionId: toText(item.purchase_option_id),
      quantity: toQuantity(item.quantity),
    }));
    if (normalizedItems.some(item => !item.cardId)) {
      return NextResponse.json({ error: 'One or more wishlist items are missing a card.' }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const cardIds = [...new Set(normalizedItems.map(item => item.cardId))];
    const { data: cardData, error: cardsError } = await supabaseAdmin
      .from('cards')
      .select('id, title, price, image_url, group_name, album_era, inventory_count, availability_status')
      .in('id', cardIds);
    if (cardsError) throw cardsError;

    const cardsById = new Map((cardData ?? [] as CardRow[]).map(card => [card.id, card as CardRow]));
    if (cardsById.size !== cardIds.length) {
      return NextResponse.json({ error: 'One or more selected cards are no longer available.' }, { status: 409 });
    }

    const optionIds = [...new Set(normalizedItems
      .map(item => item.purchaseOptionId)
      .filter(isPersistentOptionId))];
    const optionsById = new Map<string, PurchaseOptionRow>();
    if (optionIds.length > 0) {
      const { data: optionData, error: optionsError } = await supabaseAdmin
        .from('card_purchase_options')
        .select('id, card_id, label, price, min_quantity, max_quantity, is_active')
        .in('id', optionIds);
      if (optionsError) throw optionsError;
      for (const option of (optionData ?? []) as PurchaseOptionRow[]) {
        optionsById.set(option.id, option);
      }
    }

    const quantitiesByCard = new Map<string, number>();
    const rows: Record<string, unknown>[] = [];
    for (const item of normalizedItems) {
      const card = cardsById.get(item.cardId)!;
      if (card.availability_status !== 'available') {
        return NextResponse.json({ error: `“${card.title || 'This card'}” is currently pending and cannot be added to a wishlist.` }, { status: 409 });
      }

      const nextCardQuantity = (quantitiesByCard.get(card.id) ?? 0) + item.quantity;
      const stock = Math.max(0, Math.floor(Number(card.inventory_count) || 0));
      if (stock <= 0 || nextCardQuantity > stock) {
        return NextResponse.json({ error: `“${card.title || 'This card'}” no longer has enough stock.` }, { status: 409 });
      }
      quantitiesByCard.set(card.id, nextCardQuantity);

      const option = isPersistentOptionId(item.purchaseOptionId)
        ? optionsById.get(item.purchaseOptionId)
        : null;
      if (isPersistentOptionId(item.purchaseOptionId) && (
        !option || option.card_id !== card.id || !option.is_active
      )) {
        return NextResponse.json({ error: `The selected purchase option for “${card.title || 'this card'}” is no longer available.` }, { status: 409 });
      }

      const minQuantity = Math.max(1, Math.floor(Number(option?.min_quantity) || 1));
      const maxQuantity = option?.max_quantity == null
        ? null
        : Math.max(minQuantity, Math.floor(Number(option.max_quantity) || minQuantity));
      if (item.quantity < minQuantity || (maxQuantity != null && item.quantity > maxQuantity)) {
        return NextResponse.json({ error: `The requested quantity for “${card.title || 'this card'}” is no longer valid.` }, { status: 409 });
      }

      const unitPrice = toMoney(option?.price ?? card.price);
      const optionLabel = toText(option?.label) || 'Single';
      for (let index = 0; index < item.quantity; index += 1) {
        rows.push({
          card_id: card.id,
          purchase_option_id: option?.id ?? null,
          option_label_snapshot: optionLabel,
          unit_price_snapshot: unitPrice,
          card_title_snapshot: card.title || 'Untitled card',
          group_name_snapshot: card.group_name || '',
          album_era_snapshot: card.album_era || '',
          image_url_snapshot: card.image_url || '',
        });
      }
    }

    const totalPrice = Math.round(rows.reduce(
      (sum, row) => sum + toMoney(row.unit_price_snapshot),
      0,
    ) * 100) / 100;
    const { data: wishlist, error: wishlistError } = await supabaseAdmin
      .from('wishlists')
      .insert({ user_ig_handle: handle, total_price: totalPrice, status: 'pending' })
      .select('id')
      .single();
    if (wishlistError || !wishlist?.id) throw wishlistError || new Error('Could not create wishlist.');

    const { error: itemsError } = await supabaseAdmin
      .from('wishlist_items')
      .insert(rows.map(row => ({ ...row, wishlist_id: wishlist.id })));
    if (itemsError) {
      const { error: cleanupError } = await supabaseAdmin.from('wishlists').delete().eq('id', wishlist.id);
      if (cleanupError) console.error('Could not remove incomplete wishlist:', cleanupError);
      throw itemsError;
    }

    return NextResponse.json({ success: true, wishlist_id: wishlist.id, total_price: totalPrice });
  } catch (error: unknown) {
    console.error('Could not create wishlist:', error);
    return NextResponse.json({ error: 'Could not create your wishlist. Please try again.' }, { status: 500 });
  }
}
