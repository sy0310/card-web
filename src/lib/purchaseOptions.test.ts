import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFallbackPurchaseOption,
  isPurchaseOptionSoldOut,
  normalizePurchaseOption,
  normalizePurchaseOptionStatus,
} from './purchaseOptions.ts';

test('purchase option availability: recognizes sold-out options and defaults unknown values to available', () => {
  assert.equal(normalizePurchaseOptionStatus('sold_out'), 'sold_out');
  assert.equal(normalizePurchaseOptionStatus(' SOLD_OUT '), 'sold_out');
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
  assert.equal(isPurchaseOptionSoldOut(oldOption), false);
  assert.equal(createFallbackPurchaseOption({ id: 'card-1', price: 8 }).status, 'available');
});

test('purchase option availability: marks only the selected option sold out', () => {
  const single = normalizePurchaseOption({ id: 'single', status: 'available' });
  const whole = normalizePurchaseOption({ id: 'whole', status: 'sold_out' });
  const set = normalizePurchaseOption({ id: 'set', status: 'available' });

  assert.equal(isPurchaseOptionSoldOut(single), false);
  assert.equal(isPurchaseOptionSoldOut(whole), true);
  assert.equal(isPurchaseOptionSoldOut(set), false);
});
