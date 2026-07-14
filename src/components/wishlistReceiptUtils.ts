import type { ReceiptLineItem } from './WishlistReceipt';

export function expandReceiptLineItems(
  items: ReceiptLineItem[],
): ReceiptLineItem[] {
  return items.flatMap(item => {
    const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));

    return Array.from({ length: quantity }, (_, index) => ({
      ...item,
      id: `${item.id}:unit-${index + 1}`,
      quantity: 1,
    }));
  });
}
