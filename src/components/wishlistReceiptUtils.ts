import type { ReceiptLineItem } from './WishlistReceipt';
import { MAX_TOTAL_UNITS, MAX_UNITS_PER_ITEM } from '@/lib/wishlistLimits';

export function expandReceiptLineItems(
  items: ReceiptLineItem[],
): ReceiptLineItem[] {
  const expanded: ReceiptLineItem[] = [];
  let remaining = MAX_TOTAL_UNITS;

  for (const item of items) {
    if (remaining <= 0) break;

    const rawQuantity = Number(item.quantity);
    const quantity = Number.isFinite(rawQuantity)
      ? Math.max(
          1,
          Math.min(MAX_UNITS_PER_ITEM, Math.floor(rawQuantity)),
        )
      : 1;

    const count = Math.min(quantity, remaining);

    for (let index = 0; index < count; index += 1) {
      expanded.push({
        ...item,
        id: `${item.id}:unit-${index + 1}`,
        quantity: 1,
      });
    }

    remaining -= count;
  }

  return expanded;
}
