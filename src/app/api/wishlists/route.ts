import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/server/supabaseAdmin';
import { hasEnoughInventory } from '@/lib/cardInventory';
import { isPurchaseOptionSoldOut } from '@/lib/purchaseOptions';
import { parseStrictWishlistQuantity, getWishlistQuantityError } from '@/lib/wishlistLimits';
import { groupWishlistRequestItems, validateRequestedOptionQuantity, normalizeRequestPurchaseOptionId, type NormalizedWishlistRequestItem } from './wishlistRequestUtils';

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
  unlimited_inventory: boolean | null;
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
  status: string | null;
};

function toText(value: unknown) {
  return String(value ?? '').trim();
}

function toMoney(value: unknown) {
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : 0;
}

function isPersistentOptionId(value: string) {
  return value.length > 0 && !value.startsWith('fallback-');
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function getExistingWishlist(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  checkoutRequestId: string,
) {
  const { data, error } = await supabaseAdmin
    .from('wishlists')
    .select('id, total_price')
    .eq('checkout_request_id', checkoutRequestId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as {
      user_ig_handle?: unknown;
      items?: unknown;
      checkout_request_id?: unknown;
    } | null;
    const handle = toText(body?.user_ig_handle);
    const checkoutRequestId = toText(body?.checkout_request_id);
    const submittedItems = Array.isArray(body?.items) ? body.items as SubmittedItem[] : [];

    if (!handle || handle.length > 100) {
      return NextResponse.json({ error: 'Enter a valid Instagram handle.' }, { status: 400 });
    }
    if (submittedItems.length === 0 || submittedItems.length > 100) {
      return NextResponse.json({ error: 'Your wishlist is empty or too large.' }, { status: 400 });
    }
    if (!isUuid(checkoutRequestId)) {
      return NextResponse.json({ error: 'Invalid checkout request.' }, { status: 400 });
    }

    const parsedItems = submittedItems.map(item => ({
      cardId: toText(item.card_id),
      purchaseOptionId: normalizeRequestPurchaseOptionId(item.purchase_option_id),
      quantity: parseStrictWishlistQuantity(item.quantity),
    }));
    
    if (parsedItems.some(item => item.quantity === null)) {
      return NextResponse.json({ error: 'Each wishlist quantity must be a positive whole number.' }, { status: 400 });
    }
    
    if (parsedItems.some(item => !item.cardId)) {
      return NextResponse.json({ error: 'One or more wishlist items are missing a card.' }, { status: 400 });
    }

    const groupedItems = groupWishlistRequestItems(parsedItems as NormalizedWishlistRequestItem[]);
    
    const quantityError = getWishlistQuantityError(groupedItems);
    if (quantityError) {
      return NextResponse.json({ error: quantityError }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const existingWishlist = await getExistingWishlist(supabaseAdmin, checkoutRequestId);
    if (existingWishlist) {
      return NextResponse.json({
        success: true,
        reused: true,
        wishlist_id: existingWishlist.id,
        total_price: toMoney(existingWishlist.total_price),
      });
    }
    const cardIds = [...new Set(groupedItems.map(item => item.cardId))];
    const { data: cardData, error: cardsError } = await supabaseAdmin
      .from('cards')
      .select('id, title, price, image_url, group_name, album_era, inventory_count, unlimited_inventory, availability_status')
      .in('id', cardIds);
    if (cardsError) throw cardsError;

    const cardsById = new Map((cardData ?? [] as CardRow[]).map(card => [card.id, card as CardRow]));
    if (cardsById.size !== cardIds.length) {
      return NextResponse.json({ error: 'One or more selected cards are no longer available.' }, { status: 409 });
    }

    const optionIds = [...new Set(groupedItems
      .map(item => item.purchaseOptionId)
      .filter(isPersistentOptionId))];
    const optionsById = new Map<string, PurchaseOptionRow>();
    if (optionIds.length > 0) {
      const { data: optionData, error: optionsError } = await supabaseAdmin
        .from('card_purchase_options')
        .select('id, card_id, label, price, min_quantity, max_quantity, is_active, status')
        .in('id', optionIds);
      if (optionsError) throw optionsError;
      for (const option of (optionData ?? []) as PurchaseOptionRow[]) {
        optionsById.set(option.id, option);
      }
    }

    const quantitiesByCard = new Map<string, number>();
    const rows: Record<string, unknown>[] = [];
    for (const item of groupedItems) {
      const card = cardsById.get(item.cardId)!;
      if (card.availability_status !== 'available') {
        return NextResponse.json({ error: `“${card.title || 'This card'}” is currently unavailable and cannot be added to a wishlist.` }, { status: 409 });
      }

      const nextCardQuantity = (quantitiesByCard.get(card.id) ?? 0) + item.quantity;
      if (!hasEnoughInventory(card, nextCardQuantity)) {
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
      if (option && isPurchaseOptionSoldOut({ status: option.status })) {
        return NextResponse.json({ error: `The selected purchase option for “${card.title || 'this card'}” is sold out.` }, { status: 409 });
      }

      const minQuantity = Math.max(1, Math.floor(Number(option?.min_quantity) || 1));
      const maxQuantity = option?.max_quantity == null
        ? null
        : Math.max(minQuantity, Math.floor(Number(option.max_quantity) || minQuantity));
        
      if (!validateRequestedOptionQuantity({ quantity: item.quantity, minQuantity, maxQuantity })) {
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
      .insert({
        user_ig_handle: handle,
        total_price: totalPrice,
        status: 'pending',
        checkout_request_id: checkoutRequestId,
      })
      .select('id')
      .single();
    if (wishlistError || !wishlist?.id) {
      if (wishlistError?.code === '23505') {
        const concurrentWishlist = await getExistingWishlist(supabaseAdmin, checkoutRequestId);
        if (concurrentWishlist) {
          return NextResponse.json({
            success: true,
            reused: true,
            wishlist_id: concurrentWishlist.id,
            total_price: toMoney(concurrentWishlist.total_price),
          });
        }
      }
      throw wishlistError || new Error('Could not create wishlist.');
    }

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
