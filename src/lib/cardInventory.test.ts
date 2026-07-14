import { hasUnlimitedInventory, getFiniteInventoryCount, isCardSoldOut, hasEnoughInventory } from './cardInventory.ts';

describe('cardInventory helper', () => {
  it('handles unlimited_inventory = true with 0 inventory count', () => {
    const card = { unlimited_inventory: true, inventory_count: 0 };
    expect(hasUnlimitedInventory(card)).toBe(true);
    expect(isCardSoldOut(card)).toBe(false);
    expect(hasEnoughInventory(card, 100)).toBe(true);
  });

  it('treats missing unlimited_inventory as true', () => {
    const card = { inventory_count: 5 };
    expect(hasUnlimitedInventory(card)).toBe(true);
    expect(isCardSoldOut(card)).toBe(false);
    expect(hasEnoughInventory(card, 10)).toBe(true);
  });

  it('handles unlimited_inventory = false with 0 inventory count', () => {
    const card = { unlimited_inventory: false, inventory_count: 0 };
    expect(hasUnlimitedInventory(card)).toBe(false);
    expect(isCardSoldOut(card)).toBe(true);
    expect(hasEnoughInventory(card, 1)).toBe(false);
  });

  it('handles unlimited_inventory = false with 1 inventory count', () => {
    const card = { unlimited_inventory: false, inventory_count: 1 };
    expect(hasUnlimitedInventory(card)).toBe(false);
    expect(isCardSoldOut(card)).toBe(false);
    expect(hasEnoughInventory(card, 1)).toBe(true);
    expect(hasEnoughInventory(card, 2)).toBe(false);
  });

  it('handles invalid inventory_count gracefully', () => {
    const card = { unlimited_inventory: false, inventory_count: 'invalid' };
    expect(getFiniteInventoryCount(card)).toBe(0);
    expect(isCardSoldOut(card)).toBe(true);
    expect(hasEnoughInventory(card, 1)).toBe(false);
  });
});
