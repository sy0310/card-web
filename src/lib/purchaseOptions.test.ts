import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFallbackPurchaseOption,
  getAvailablePurchaseOptions,
  getCustomerPurchaseOptions,
  normalizePurchaseOption,
  normalizePurchaseOptionStatus,
} from './purchaseOptions.ts';

test('purchase option availability: accepts the unified three states and defaults unknown values to available', () => {
  assert.equal(normalizePurchaseOptionStatus('pending'), 'pending');
  assert.equal(normalizePurchaseOptionStatus(' ARCHIVED '), 'archived');
  assert.equal(normalizePurchaseOptionStatus(undefined), 'available');
  assert.equal(normalizePurchaseOptionStatus('anything else'), 'available');
});

test('purchase option availability: old rows without status retain the previous available behavior', () => {
  const oldOption = normalizePurchaseOption({
    id: 'single',
    card_id: 'card-1',
    label: 'Single',
    price: 8,
    min_quantity: 1,
    max_quantity: null,
    is_default: true,
    is_active: true,
    sort_order: 0,
  });

  assert.equal(oldOption.status, 'available');
  assert.equal(createFallbackPurchaseOption({ id: 'card-1', price: 8 }).status, 'available');
});

test('purchase option availability: migrates active=false and sold_out rows in memory for compatibility', () => {
  const single = normalizePurchaseOption({ id: 'single', status: 'available' });
  const whole = normalizePurchaseOption({ id: 'whole', status: 'sold_out' as never });
  const set = normalizePurchaseOption({ id: 'set', status: 'available', is_active: false });

  assert.equal(single.status, 'available');
  assert.equal(whole.status, 'pending');
  assert.equal(set.status, 'archived');
});

test('customer purchase options show pending, hide archived, and only expose available choices for purchase', () => {
  const card = {
    id: 'card-1',
    price: 8,
    purchase_options: [
      normalizePurchaseOption({ id: 'single', label: 'Single', status: 'available', sort_order: 0 }),
      normalizePurchaseOption({ id: 'whole', label: 'Whole', status: 'pending', sort_order: 1 }),
      normalizePurchaseOption({ id: 'set', label: 'Set', status: 'archived', sort_order: 2 }),
    ],
  };

  assert.deepEqual(getCustomerPurchaseOptions(card).map(option => option.id), ['single', 'whole']);
  assert.deepEqual(getAvailablePurchaseOptions(card).map(option => option.id), ['single']);
});
