import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseStrictWishlistQuantity,
  getWishlistTotalUnits,
  getWishlistQuantityError,
  MAX_UNITS_PER_ITEM,
  MAX_TOTAL_UNITS,
} from './wishlistLimits';

test('parseStrictWishlistQuantity parses valid quantities', () => {
  assert.equal(parseStrictWishlistQuantity(1), 1);
  assert.equal(parseStrictWishlistQuantity(100), 100);
  assert.equal(parseStrictWishlistQuantity('1'), 1);
  assert.equal(parseStrictWishlistQuantity('100'), 100);
});

test('parseStrictWishlistQuantity rejects invalid quantities', () => {
  assert.equal(parseStrictWishlistQuantity(true), null);
  assert.equal(parseStrictWishlistQuantity(false), null);
  assert.equal(parseStrictWishlistQuantity(null), null);
  assert.equal(parseStrictWishlistQuantity(undefined), null);
  assert.equal(parseStrictWishlistQuantity([]), null);
  assert.equal(parseStrictWishlistQuantity([1]), null);
  assert.equal(parseStrictWishlistQuantity({}), null);
  assert.equal(parseStrictWishlistQuantity(''), null);
  assert.equal(parseStrictWishlistQuantity(' '), null);
  assert.equal(parseStrictWishlistQuantity('1.5'), null);
  assert.equal(parseStrictWishlistQuantity('01'), null);
  assert.equal(parseStrictWishlistQuantity('+1'), null);
  assert.equal(parseStrictWishlistQuantity('-1'), null);
  assert.equal(parseStrictWishlistQuantity(0), null);
  assert.equal(parseStrictWishlistQuantity(1.5), null);
  assert.equal(parseStrictWishlistQuantity(NaN), null);
  assert.equal(parseStrictWishlistQuantity(Infinity), null);
});

test('getWishlistTotalUnits calculates correct total', () => {
  assert.equal(getWishlistTotalUnits([{ quantity: 1 }, { quantity: 2 }]), 3);
  assert.equal(getWishlistTotalUnits([]), 0);
});

test('getWishlistQuantityError allows valid items', () => {
  assert.equal(getWishlistQuantityError([{ quantity: 1 }]), '');
  assert.equal(getWishlistQuantityError([{ quantity: MAX_UNITS_PER_ITEM }]), '');
});

test('getWishlistQuantityError rejects item > MAX_UNITS_PER_ITEM', () => {
  assert.ok(getWishlistQuantityError([{ quantity: MAX_UNITS_PER_ITEM + 1 }]));
});

test('getWishlistQuantityError rejects total > MAX_TOTAL_UNITS', () => {
  assert.ok(getWishlistQuantityError([
    { quantity: MAX_TOTAL_UNITS - 1 },
    { quantity: 2 }
  ]));
});

test('getWishlistQuantityError rejects invalid items', () => {
  assert.ok(getWishlistQuantityError([{ quantity: 0 }]));
  assert.ok(getWishlistQuantityError([{ quantity: 1.5 }]));
  assert.ok(getWishlistQuantityError([{ quantity: NaN }]));
});
