import assert from 'node:assert/strict';
import test from 'node:test';
import { hasUnlimitedInventory, getFiniteInventoryCount, isCardSoldOut, hasEnoughInventory } from './cardInventory.ts';

test('cardInventory helper: handles unlimited_inventory = true with 0 inventory count', () => {
  const card = { unlimited_inventory: true, inventory_count: 0 };
  assert.equal(hasUnlimitedInventory(card), true);
  assert.equal(isCardSoldOut(card), false);
  assert.equal(hasEnoughInventory(card, 100), true);
});

test('cardInventory helper: treats missing unlimited_inventory as true', () => {
  const card = { inventory_count: 5 };
  assert.equal(hasUnlimitedInventory(card), true);
  assert.equal(isCardSoldOut(card), false);
  assert.equal(hasEnoughInventory(card, 10), true);
});

test('cardInventory helper: handles unlimited_inventory = false with 0 inventory count', () => {
  const card = { unlimited_inventory: false, inventory_count: 0 };
  assert.equal(hasUnlimitedInventory(card), false);
  assert.equal(isCardSoldOut(card), true);
  assert.equal(hasEnoughInventory(card, 1), false);
});

test('cardInventory helper: handles unlimited_inventory = false with 1 inventory count', () => {
  const card = { unlimited_inventory: false, inventory_count: 1 };
  assert.equal(hasUnlimitedInventory(card), false);
  assert.equal(isCardSoldOut(card), false);
  assert.equal(hasEnoughInventory(card, 1), true);
  assert.equal(hasEnoughInventory(card, 2), false);
});

test('cardInventory helper: handles invalid inventory_count gracefully', () => {
  const card = { unlimited_inventory: false, inventory_count: 'invalid' };
  assert.equal(getFiniteInventoryCount(card), 0);
  assert.equal(isCardSoldOut(card), true);
  assert.equal(hasEnoughInventory(card, 1), false);
});
