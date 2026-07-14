import assert from 'node:assert/strict';
import test from 'node:test';
import { expandReceiptLineItems } from './wishlistReceiptUtils.ts';
import type { ReceiptLineItem } from './WishlistReceipt.tsx';

test('wishlistReceiptUtils: returns single item for quantity 1', () => {
  const items: ReceiptLineItem[] = [{ id: 'item-1', title: 'Card 1', price: 10, unit_price: 10, quantity: 1, image_url: '', option_label: 'Single', group_name: 'Group' }];
  const expanded = expandReceiptLineItems(items);
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].id, 'item-1:unit-1');
  assert.equal(expanded[0].quantity, 1);
});

test('wishlistReceiptUtils: returns multiple items for quantity > 1', () => {
  const items: ReceiptLineItem[] = [{ id: 'item-2', title: 'Card 2', price: 15, unit_price: 15, quantity: 2, image_url: '', option_label: 'Single', group_name: 'Group' }];
  const expanded = expandReceiptLineItems(items);
  assert.equal(expanded.length, 2);
  assert.equal(expanded[0].id, 'item-2:unit-1');
  assert.equal(expanded[1].id, 'item-2:unit-2');
  assert.equal(expanded[0].quantity, 1);
  assert.equal(expanded[1].quantity, 1);
});

test('wishlistReceiptUtils: preserves original item properties', () => {
  const items: ReceiptLineItem[] = [{ id: 'item-3', title: 'Card 3', price: 20, unit_price: 20, quantity: 2, image_url: 'url', option_label: 'Option 1', group_name: 'Group' }];
  const expanded = expandReceiptLineItems(items);
  assert.equal(expanded[0].title, 'Card 3');
  assert.equal(expanded[0].price, 20);
  assert.equal(expanded[0].image_url, 'url');
  assert.equal(expanded[0].option_label, 'Option 1');
});

test('wishlistReceiptUtils: does not merge different items', () => {
  const items: ReceiptLineItem[] = [
    { id: 'item-4', title: 'Card 4', price: 10, unit_price: 10, quantity: 2, image_url: '', option_label: 'Single', group_name: 'Group' },
    { id: 'item-5', title: 'Card 5', price: 15, unit_price: 15, quantity: 1, image_url: '', option_label: 'Single', group_name: 'Group' },
  ];
  const expanded = expandReceiptLineItems(items);
  assert.equal(expanded.length, 3);
  assert.equal(expanded[0].id, 'item-4:unit-1');
  assert.equal(expanded[1].id, 'item-4:unit-2');
  assert.equal(expanded[2].id, 'item-5:unit-1');
});

test('wishlistReceiptUtils: truncates extreme quantity at MAX_TOTAL_UNITS', () => {
  const items: ReceiptLineItem[] = [{ id: 'item-6', title: 'Card 6', price: 10, unit_price: 10, quantity: 999999, image_url: '', option_label: 'Single', group_name: 'Group' }];
  const expanded = expandReceiptLineItems(items);
  assert.equal(expanded.length, 100);
});

test('wishlistReceiptUtils: combined sum truncates at MAX_TOTAL_UNITS', () => {
  const items: ReceiptLineItem[] = [
    { id: 'item-7', title: 'Card 7', price: 10, unit_price: 10, quantity: 60, image_url: '', option_label: 'Single', group_name: 'Group' },
    { id: 'item-8', title: 'Card 8', price: 10, unit_price: 10, quantity: 50, image_url: '', option_label: 'Single', group_name: 'Group' },
  ];
  const expanded = expandReceiptLineItems(items);
  assert.equal(expanded.length, 100);
});
