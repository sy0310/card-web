import assert from 'node:assert/strict';
import test from 'node:test';
import {
  groupWishlistRequestItems,
  validateRequestedOptionQuantity,
} from './wishlistRequestUtils';
import type { NormalizedWishlistRequestItem } from './wishlistRequestUtils';

test('groupWishlistRequestItems merges same card and option', () => {
  const items: NormalizedWishlistRequestItem[] = [
    { cardId: 'A', purchaseOptionId: 'X', quantity: 2 },
    { cardId: 'A', purchaseOptionId: 'X', quantity: 2 },
  ];
  const grouped = groupWishlistRequestItems(items);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].cardId, 'A');
  assert.equal(grouped[0].purchaseOptionId, 'X');
  assert.equal(grouped[0].quantity, 4);
});

test('groupWishlistRequestItems does not merge different options', () => {
  const items: NormalizedWishlistRequestItem[] = [
    { cardId: 'A', purchaseOptionId: 'X', quantity: 2 },
    { cardId: 'A', purchaseOptionId: 'Y', quantity: 2 },
  ];
  const grouped = groupWishlistRequestItems(items);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].purchaseOptionId, 'X');
  assert.equal(grouped[1].purchaseOptionId, 'Y');
});

test('groupWishlistRequestItems does not mutate input array', () => {
  const items: NormalizedWishlistRequestItem[] = [
    { cardId: 'A', purchaseOptionId: 'X', quantity: 2 },
  ];
  const grouped = groupWishlistRequestItems(items);
  assert.notEqual(items, grouped);
  assert.notEqual(items[0], grouped[0]);
  items[0].quantity = 99;
  assert.equal(grouped[0].quantity, 2);
});

test('groupWishlistRequestItems treats empty option and "single" fallback consistently', () => {
  const items: NormalizedWishlistRequestItem[] = [
    { cardId: 'A', purchaseOptionId: '', quantity: 1 },
    { cardId: 'A', purchaseOptionId: 'single', quantity: 1 },
  ];
  const grouped = groupWishlistRequestItems(items);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].quantity, 2);
  assert.equal(grouped[0].purchaseOptionId, '');
});

test('groupWishlistRequestItems maintains first appearance order', () => {
  const items: NormalizedWishlistRequestItem[] = [
    { cardId: 'A', purchaseOptionId: 'X', quantity: 1 },
    { cardId: 'B', purchaseOptionId: 'Y', quantity: 2 },
    { cardId: 'A', purchaseOptionId: 'X', quantity: 3 },
  ];
  const grouped = groupWishlistRequestItems(items);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].cardId, 'A');
  assert.equal(grouped[0].quantity, 4);
  assert.equal(grouped[1].cardId, 'B');
});

test('validateRequestedOptionQuantity validates correctly', () => {
  assert.equal(validateRequestedOptionQuantity({ quantity: 100, minQuantity: 1, maxQuantity: null }), true);
  assert.equal(validateRequestedOptionQuantity({ quantity: 1, minQuantity: 2, maxQuantity: 5 }), false);
  assert.equal(validateRequestedOptionQuantity({ quantity: 3, minQuantity: 1, maxQuantity: 2 }), false);
  assert.equal(validateRequestedOptionQuantity({ quantity: 4, minQuantity: 1, maxQuantity: 2 }), false);
});
