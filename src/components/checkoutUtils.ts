type CheckoutWishlistItem = {
  id?: string;
  card_id?: string;
  purchase_option_id?: string | null;
  option_label?: string;
  unit_price?: number;
  price?: number;
  title?: string;
  quantity?: number;
};

type CheckoutErrorLike = {
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  code?: unknown;
};

export function formatCheckoutError(error: unknown, fallback = 'Unknown error') {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'string') return error || fallback;

  if (error && typeof error === 'object') {
    const record = error as CheckoutErrorLike;
    const parts = [
      record.message,
      record.details,
      record.hint,
      record.code ? `Code: ${record.code}` : '',
    ]
      .map(value => String(value ?? '').trim())
      .filter(Boolean);

    if (parts.length > 0) return parts.join(' ');

    try {
      return JSON.stringify(error) || fallback;
    } catch {
      return fallback;
    }
  }

  return String(error ?? fallback);
}

function getPersistentPurchaseOptionId(purchaseOptionId: unknown) {
  const value = String(purchaseOptionId ?? '').trim();
  return value && !value.startsWith('fallback-') ? value : null;
}

export function buildWishlistItemInsertRows(
  wishlistId: string,
  items: CheckoutWishlistItem[],
) {
  const normalizedWishlistId = wishlistId.trim();
  if (!normalizedWishlistId) throw new Error('The created wishlist is missing an id.');

  return items.flatMap(item => {
    const cardId = String(item?.card_id ?? '').trim();
    if (!cardId) {
      throw new Error(`Wishlist item "${item?.title || 'Untitled'}" is missing card_id.`);
    }

    const rawUnitPrice = Number.isFinite(Number(item.unit_price))
      ? Number(item.unit_price)
      : Number(item.price);
    const unitPrice = Number.isFinite(rawUnitPrice) && rawUnitPrice >= 0 ? rawUnitPrice : 0;
    const rawQuantity = Number(item.quantity);
    const quantity = Number.isFinite(rawQuantity) ? Math.max(1, Math.floor(rawQuantity)) : 1;
    const purchaseOptionId = getPersistentPurchaseOptionId(item.purchase_option_id);
    const optionLabel = String(item.option_label ?? '').trim() || 'Single';

    return Array.from({ length: quantity }, () => ({
      wishlist_id: normalizedWishlistId,
      card_id: cardId,
      purchase_option_id: purchaseOptionId,
      option_label_snapshot: optionLabel,
      unit_price_snapshot: unitPrice,
    }));
  });
}
