import assert from 'node:assert/strict';
import test from 'node:test';
import {
  groupWishlistRequestItems,
  validateRequestedOptionQuantity,
  normalizeRequestPurchaseOptionId,
} from './wishlistRequestUtils';
import type { NormalizedWishlistRequestItem } from './wishlistRequestUtils';

test('normalizeRequestPurchaseOptionId normalizes empty, single, and fallback IDs to empty string', () => {
  assert.equal(normalizeRequestPurchaseOptionId(null), '');
  assert.equal(normalizeRequestPurchaseOptionId(undefined), '');
  assert.equal(normalizeRequestPurchaseOptionId(''), '');
  assert.equal(normalizeRequestPurchaseOptionId('  '), '');
  assert.equal(normalizeRequestPurchaseOptionId('single'), '');
  assert.equal(normalizeRequestPurchaseOptionId('SINGLE'), '');
  assert.equal(normalizeRequestPurchaseOptionId('fallback-card-1'), '');
});

test('normalizeRequestPurchaseOptionId preserves valid UUIDs', () => {
  assert.equal(normalizeRequestPurchaseOptionId('123e4567-e89b-12d3-a456-426614174000'), '123e4567-e89b-12d3-a456-426614174000');
  assert.equal(normalizeRequestPurchaseOptionId(' option-123 '), 'option-123');
});

test('groupWishlistRequestItems: single then empty string merges to empty string', () => {
  // Simulating the flow where route.ts normalizes first before grouping
  const items: NormalizedWishlistRequestItem[] = [
    { cardId: 'card-1', purchaseOptionId: normalizeRequestPurchaseOptionId('single'), quantity: 1 },
    { cardId: 'card-1', purchaseOptionId: normalizeRequestPurchaseOptionId(''), quantity: 2 },
  ];
  const grouped = groupWishlistRequestItems(items);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].purchaseOptionId, '');
  assert.equal(grouped[0].quantity, 3);
});

test('groupWishlistRequestItems: empty string then single merges to empty string', () => {
  const items: NormalizedWishlistRequestItem[] = [
    { cardId: 'card-2', purchaseOptionId: normalizeRequestPurchaseOptionId(''), quantity: 4 },
    { cardId: 'card-2', purchaseOptionId: normalizeRequestPurchaseOptionId('single'), quantity: 1 },
  ];
  const grouped = groupWishlistRequestItems(items);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].purchaseOptionId, '');
  assert.equal(grouped[0].quantity, 5);
});

test('groupWishlistRequestItems: fallback-card-1 merges with empty string', () => {
  const items: NormalizedWishlistRequestItem[] = [
    { cardId: 'card-3', purchaseOptionId: normalizeRequestPurchaseOptionId('fallback-card-3'), quantity: 2 },
    { cardId: 'card-3', purchaseOptionId: normalizeRequestPurchaseOptionId(''), quantity: 3 },
  ];
  const grouped = groupWishlistRequestItems(items);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].purchaseOptionId, '');
  assert.equal(grouped[0].quantity, 5);
});

test('groupWishlistRequestItems: real UUIDs do not merge with empty string', () => {
  const items: NormalizedWishlistRequestItem[] = [
    { cardId: 'card-4', purchaseOptionId: normalizeRequestPurchaseOptionId('1234'), quantity: 1 },
    { cardId: 'card-4', purchaseOptionId: normalizeRequestPurchaseOptionId(''), quantity: 1 },
  ];
  const grouped = groupWishlistRequestItems(items);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].purchaseOptionId, '1234');
  assert.equal(grouped[1].purchaseOptionId, '');
});

test('groupWishlistRequestItems: two different UUIDs do not merge', () => {
  const items: NormalizedWishlistRequestItem[] = [
    { cardId: 'card-5', purchaseOptionId: normalizeRequestPurchaseOptionId('uuid-1'), quantity: 1 },
    { cardId: 'card-5', purchaseOptionId: normalizeRequestPurchaseOptionId('uuid-2'), quantity: 1 },
  ];
  const grouped = groupWishlistRequestItems(items);
  assert.equal(grouped.length, 2);
});

test('validateRequestedOptionQuantity validates correctly', () => {
  assert.equal(validateRequestedOptionQuantity({ quantity: 2, minQuantity: 1, maxQuantity: 5 }), true);
  assert.equal(validateRequestedOptionQuantity({ quantity: 6, minQuantity: 1, maxQuantity: 5 }), false);
  assert.equal(validateRequestedOptionQuantity({ quantity: 0, minQuantity: 1, maxQuantity: 5 }), false);
  assert.equal(validateRequestedOptionQuantity({ quantity: 10, minQuantity: 1, maxQuantity: null }), true);
});
