import type { ReceiptLineItem } from './WishlistReceipt';
import { MAX_TOTAL_UNITS, MAX_UNITS_PER_ITEM } from '@/lib/wishlistLimits';

export function normalizeReceiptQuantity(value: unknown) {
  const rawQuantity = Number(value);

  if (!Number.isFinite(rawQuantity)) return 1;

  return Math.max(
    1,
    Math.min(MAX_UNITS_PER_ITEM, Math.floor(rawQuantity)),
  );
}

export function getReceiptUnitPrice(item: Pick<ReceiptLineItem, 'price' | 'unit_price'>) {
  const unitPrice = Number(item.unit_price);
  if (item.unit_price != null && Number.isFinite(unitPrice)) {
    return unitPrice;
  }

  const price = Number(item.price);
  return Number.isFinite(price) ? price : 0;
}

function getReceiptPriceCents(value: number) {
  return Math.round(value * 100);
}

export function calculateReceiptTotal(items: ReceiptLineItem[]) {
  const totalCents = items.reduce(
    (total, item) => total
      + getReceiptPriceCents(getReceiptUnitPrice(item))
      * normalizeReceiptQuantity(item.quantity),
    0,
  );

  return totalCents / 100;
}

export function getCompactReceiptKey(item: ReceiptLineItem) {
  const cardIdentity = item.card_id
    || JSON.stringify({
      title: item.title,
      image_url: item.image_url || '',
      group_name: item.group_name || '',
      album_era: item.album_era || '',
    });

  const optionIdentity = item.purchase_option_id
    || item.option_label
    || '';

  const unitPrice = getReceiptUnitPrice(item);

  return JSON.stringify({
    cardIdentity,
    optionIdentity,
    unitPrice,
    title: item.title,
    image_url: item.image_url || '',
    group_name: item.group_name || '',
    album_era: item.album_era || '',
  });
}

export function compactReceiptLineItems(
  items: ReceiptLineItem[],
): ReceiptLineItem[] {
  const grouped = new Map<string, ReceiptLineItem>();

  for (const item of items) {
    const quantity = normalizeReceiptQuantity(item.quantity);
    const key = getCompactReceiptKey(item);
    const existing = grouped.get(key);

    if (existing) {
      existing.quantity += quantity;
      continue;
    }

    grouped.set(key, {
      ...item,
      quantity,
    });
  }

  return Array.from(grouped.values());
}

export function expandReceiptLineItems(
  items: ReceiptLineItem[],
): ReceiptLineItem[] {
  const expanded: ReceiptLineItem[] = [];
  let remaining = MAX_TOTAL_UNITS;
  const usedIds = new Set<string>();

  for (const [itemIndex, item] of items.entries()) {
    if (remaining <= 0) break;

    const quantity = normalizeReceiptQuantity(item.quantity);

    const count = Math.min(quantity, remaining);

    for (let index = 0; index < count; index += 1) {
      const baseId = `${item.id}:unit-${index + 1}`;
      let expandedId = baseId;
      let duplicateIndex = 1;
      while (usedIds.has(expandedId)) {
        expandedId = `${baseId}:line-${itemIndex + 1}-${duplicateIndex}`;
        duplicateIndex += 1;
      }
      usedIds.add(expandedId);

      expanded.push({
        ...item,
        id: expandedId,
        quantity: 1,
        copy_number: index + 1,
        copy_count: count,
      });
    }

    remaining -= count;
  }

  return expanded;
}
