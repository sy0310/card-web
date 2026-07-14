export type CardInventoryState = {
  inventory_count?: number | string | null;
  unlimited_inventory?: boolean | null;
};

export function hasUnlimitedInventory(card: CardInventoryState) {
  return card.unlimited_inventory !== false;
}

export function getFiniteInventoryCount(card: CardInventoryState) {
  const value = Math.floor(Number(card.inventory_count) || 0);
  return Math.max(0, value);
}

export function isCardSoldOut(card: CardInventoryState) {
  return !hasUnlimitedInventory(card) && getFiniteInventoryCount(card) <= 0;
}

export function hasEnoughInventory(
  card: CardInventoryState,
  requestedQuantity: number,
) {
  if (hasUnlimitedInventory(card)) return true;

  const quantity = Math.max(1, Math.floor(Number(requestedQuantity) || 1));

  return quantity <= getFiniteInventoryCount(card);
}
