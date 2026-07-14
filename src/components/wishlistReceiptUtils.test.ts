import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateReceiptTotal,
  compactReceiptLineItems,
  expandReceiptLineItems,
  getReceiptImageCacheKey,
} from './wishlistReceiptUtils.ts';
import type { ReceiptLineItem } from './WishlistReceipt.tsx';

function item(overrides: Partial<ReceiptLineItem> = {}): ReceiptLineItem {
  return {
    id: 'item-1',
    card_id: 'card-1',
    purchase_option_id: 'option-1',
    title: 'Card 1',
    price: 10,
    unit_price: 10,
    image_url: 'image-1',
    group_name: 'Group',
    album_era: 'Era',
    option_label: 'Single',
    quantity: 1,
    ...overrides,
  };
}

test('wishlistReceiptUtils: packing quantity 1 returns one unit', () => {
  const expanded = expandReceiptLineItems([item()]);

  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].id, 'item-1:unit-1');
  assert.equal(expanded[0].quantity, 1);
  assert.equal(expanded[0].copy_number, 1);
  assert.equal(expanded[0].copy_count, 1);
});

test('wishlistReceiptUtils: packing expands quantity 2 into unique copies', () => {
  const expanded = expandReceiptLineItems([item({ id: 'item-2', quantity: 2 })]);

  assert.equal(expanded.length, 2);
  assert.equal(expanded[0].id, 'item-2:unit-1');
  assert.equal(expanded[1].id, 'item-2:unit-2');
  assert.deepEqual(expanded.map(line => line.quantity), [1, 1]);
  assert.deepEqual(expanded.map(line => line.copy_number), [1, 2]);
});

test('wishlistReceiptUtils: expanded copies share one image cache key', () => {
  const expanded = expandReceiptLineItems([item({ quantity: 2 })]);

  assert.equal(
    getReceiptImageCacheKey(expanded[0], 'receipt-1', 'packing'),
    getReceiptImageCacheKey(expanded[1], 'receipt-1', 'packing'),
  );
});

test('wishlistReceiptUtils: copy number and expanded id do not affect image cache key', () => {
  const first = item({ id: 'line-a', quantity: 1 });
  const second = item({ id: 'line-b', quantity: 1, copy_number: 2, copy_count: 2 });

  assert.equal(
    getReceiptImageCacheKey(first, 'receipt-1', 'packing'),
    getReceiptImageCacheKey(second, 'receipt-1', 'packing'),
  );
});

test('wishlistReceiptUtils: different card ids use different image cache keys', () => {
  assert.notEqual(
    getReceiptImageCacheKey(item({ card_id: 'card-a' }), 'receipt-1', 'packing'),
    getReceiptImageCacheKey(item({ card_id: 'card-b' }), 'receipt-1', 'packing'),
  );
});

test('wishlistReceiptUtils: missing card id falls back to image url identity', () => {
  assert.equal(
    getReceiptImageCacheKey(item({ id: 'copy-a', card_id: null }), 'receipt-1', 'packing'),
    getReceiptImageCacheKey(item({ id: 'copy-b', card_id: null }), 'receipt-1', 'packing'),
  );
  assert.notEqual(
    getReceiptImageCacheKey(item({ card_id: null, image_url: 'image-a' }), 'receipt-1', 'packing'),
    getReceiptImageCacheKey(item({ card_id: null, image_url: 'image-b' }), 'receipt-1', 'packing'),
  );
});

test('wishlistReceiptUtils: compact and packing use different image cache modes', () => {
  const line = item();

  assert.notEqual(
    getReceiptImageCacheKey(line, 'receipt-1', 'compact'),
    getReceiptImageCacheKey(line, 'receipt-1', 'packing'),
  );
});

test('wishlistReceiptUtils: expanded items preserve snapshots', () => {
  const expanded = expandReceiptLineItems([item({
    title: 'Card 3',
    price: 20,
    unit_price: 20,
    image_url: 'url',
    option_label: 'Option 1',
    group_name: 'Group 3',
    album_era: 'Era 3',
    quantity: 2,
  })]);

  assert.equal(expanded[0].title, 'Card 3');
  assert.equal(expanded[0].price, 20);
  assert.equal(expanded[0].image_url, 'url');
  assert.equal(expanded[0].option_label, 'Option 1');
  assert.equal(expanded[0].album_era, 'Era 3');
});

test('wishlistReceiptUtils: compact quantity 2 returns one line with quantity 2', () => {
  const compact = compactReceiptLineItems([item({ quantity: 2 })]);

  assert.equal(compact.length, 1);
  assert.equal(compact[0].quantity, 2);
});

test('wishlistReceiptUtils: compact does not mutate input items', () => {
  const original = [item({ quantity: 2 })];
  const snapshot = structuredClone(original);

  compactReceiptLineItems(original);

  assert.deepEqual(original, snapshot);
});

test('wishlistReceiptUtils: compact merges matching card, option, and price', () => {
  const compact = compactReceiptLineItems([
    item({ id: 'first', quantity: 2 }),
    item({ id: 'second', quantity: 3 }),
  ]);

  assert.equal(compact.length, 1);
  assert.equal(compact[0].quantity, 5);
  assert.equal(compact[0].id, 'first');
});

test('wishlistReceiptUtils: compact keeps first appearance order', () => {
  const compact = compactReceiptLineItems([
    item({ id: 'card-a', card_id: 'a', title: 'A' }),
    item({ id: 'card-b', card_id: 'b', title: 'B' }),
    item({ id: 'card-a-copy', card_id: 'a', title: 'A', quantity: 2 }),
  ]);

  assert.deepEqual(compact.map(line => line.id), ['card-a', 'card-b']);
  assert.deepEqual(compact.map(line => line.quantity), [3, 1]);
});

test('wishlistReceiptUtils: compact does not merge different purchase options', () => {
  const compact = compactReceiptLineItems([
    item({ id: 'single', purchase_option_id: 'single', option_label: 'Single' }),
    item({ id: 'signed', purchase_option_id: 'signed', option_label: 'Signed' }),
  ]);

  assert.equal(compact.length, 2);
});

test('wishlistReceiptUtils: compact does not merge same option text at different prices', () => {
  const compact = compactReceiptLineItems([
    item({ id: 'cheap', unit_price: 10, price: 10 }),
    item({ id: 'expensive', unit_price: 12, price: 12 }),
  ]);

  assert.equal(compact.length, 2);
});

test('wishlistReceiptUtils: compact does not merge same title with different card ids', () => {
  const compact = compactReceiptLineItems([
    item({ id: 'card-a', card_id: 'a' }),
    item({ id: 'card-b', card_id: 'b' }),
  ]);

  assert.equal(compact.length, 2);
});

test('wishlistReceiptUtils: snapshot identity is used when card id is missing', () => {
  const compact = compactReceiptLineItems([
    item({ id: 'snapshot-a', card_id: null }),
    item({ id: 'snapshot-a-copy', card_id: null, quantity: 2 }),
    item({ id: 'different-image', card_id: null, image_url: 'other-image' }),
  ]);

  assert.equal(compact.length, 2);
  assert.equal(compact[0].quantity, 3);
});

test('wishlistReceiptUtils: compact preserves snapshot fields from first line', () => {
  const compact = compactReceiptLineItems([item({ quantity: 2 })]);

  assert.equal(compact[0].image_url, 'image-1');
  assert.equal(compact[0].option_label, 'Single');
  assert.equal(compact[0].group_name, 'Group');
  assert.equal(compact[0].album_era, 'Era');
  assert.equal(compact[0].unit_price, 10);
});

test('wishlistReceiptUtils: compact and packing preserve total for valid orders', () => {
  const original = [
    item({ id: 'item-a', quantity: 2, unit_price: 5.01, price: 5.01 }),
    item({
      id: 'item-b',
      card_id: 'card-2',
      purchase_option_id: 'option-2',
      quantity: 3,
      unit_price: 7.99,
      price: 7.99,
    }),
  ];

  assert.equal(
    calculateReceiptTotal(original),
    calculateReceiptTotal(compactReceiptLineItems(original)),
  );
  assert.equal(
    calculateReceiptTotal(original),
    calculateReceiptTotal(expandReceiptLineItems(original)),
  );
});

test('wishlistReceiptUtils: packing keeps the defensive 100-unit limit', () => {
  const expanded = expandReceiptLineItems([item({ quantity: 999999 })]);

  assert.equal(expanded.length, 100);
});

test('wishlistReceiptUtils: packing truncates combined units only as a defensive limit', () => {
  const expanded = expandReceiptLineItems([
    item({ id: 'item-7', quantity: 60 }),
    item({ id: 'item-8', card_id: 'card-8', quantity: 50 }),
  ]);

  assert.equal(expanded.length, 100);
});
