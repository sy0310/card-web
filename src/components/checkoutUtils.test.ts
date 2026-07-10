import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWishlistItemInsertRows,
  formatCheckoutError,
} from './checkoutUtils.ts';

test('buildWishlistItemInsertRows omits synthetic fallback option ids', () => {
  assert.deepEqual(
    buildWishlistItemInsertRows('wishlist-1', [{
      id: 'card-1:fallback-card-1',
      card_id: 'card-1',
      purchase_option_id: 'fallback-card-1',
      option_label: 'Single',
      unit_price: 16,
      price: 16,
      title: 'Card 1',
      quantity: 1,
    }]),
    [{
      wishlist_id: 'wishlist-1',
      card_id: 'card-1',
      purchase_option_id: null,
      option_label_snapshot: 'Single',
      unit_price_snapshot: 16,
    }],
  );
});

test('buildWishlistItemInsertRows rejects a missing real card id', () => {
  assert.throws(
    () => buildWishlistItemInsertRows('wishlist-1', [{
      id: 'card-1:option-1',
      title: 'Card 1',
      quantity: 1,
    }]),
    /Wishlist item "Card 1" is missing card_id\./,
  );
});

test('formatCheckoutError includes Supabase error details and code', () => {
  assert.equal(
    formatCheckoutError({
      message: 'insert or update violates foreign key constraint',
      details: 'Key is not present in the referenced table.',
      hint: 'Check the purchase option id.',
      code: '23503',
    }),
    'insert or update violates foreign key constraint Key is not present in the referenced table. Check the purchase option id. Code: 23503',
  );
});
