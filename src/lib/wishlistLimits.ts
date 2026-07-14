export const MAX_UNITS_PER_ITEM = 100;
export const MAX_TOTAL_UNITS = 100;

export function parseStrictWishlistQuantity(
  value: unknown,
) {
  if (
    typeof value !== 'number'
    && typeof value !== 'string'
  ) {
    return null;
  }

  if (
    typeof value === 'string'
    && !/^[1-9]\d*$/.test(value.trim())
  ) {
    return null;
  }

  const quantity = Number(value);

  if (
    !Number.isFinite(quantity)
    || !Number.isInteger(quantity)
    || quantity < 1
  ) {
    return null;
  }

  return quantity;
}

export function getWishlistTotalUnits(
  items: Array<{ quantity: number }>,
) {
  return items.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
}

export function getWishlistQuantityError(
  items: Array<{ quantity: number }>,
) {
  for (const item of items) {
    if (
      !Number.isInteger(item.quantity)
      || item.quantity < 1
    ) {
      return 'Each wishlist quantity must be a positive whole number.';
    }

    if (item.quantity > MAX_UNITS_PER_ITEM) {
      return `A single wishlist item cannot exceed ${MAX_UNITS_PER_ITEM} units.`;
    }
  }

  if (getWishlistTotalUnits(items) > MAX_TOTAL_UNITS) {
    return `A wishlist cannot contain more than ${MAX_TOTAL_UNITS} cards.`;
  }

  return '';
}
