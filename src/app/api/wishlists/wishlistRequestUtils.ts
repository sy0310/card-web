export type NormalizedWishlistRequestItem = {
  cardId: string;
  purchaseOptionId: string;
  quantity: number;
};

export function groupWishlistRequestItems(
  items: NormalizedWishlistRequestItem[],
) {
  const grouped = new Map<
    string,
    NormalizedWishlistRequestItem
  >();

  for (const item of items) {
    const key = `${item.cardId}:${item.purchaseOptionId || 'single'}`;

    const existing = grouped.get(key);

    if (existing) {
      existing.quantity += item.quantity;
    } else {
      grouped.set(key, { ...item });
    }
  }

  return Array.from(grouped.values());
}

export function validateRequestedOptionQuantity({
  quantity,
  minQuantity,
  maxQuantity,
}: {
  quantity: number;
  minQuantity: number;
  maxQuantity: number | null;
}) {
  return (
    quantity >= minQuantity &&
    (maxQuantity == null || quantity <= maxQuantity)
  );
}
