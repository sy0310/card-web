import assert from 'node:assert/strict';
import test from 'node:test';
import {
  toAbsoluteUrl,
  buildReceiptFilename,
  isAbortError,
} from './receiptUtils';

test('toAbsoluteUrl converts path and origin into absolute URL string', () => {
  assert.strictEqual(
    toAbsoluteUrl('/receipt/e8bbafe5-1c1f-4f79-8f18-ea4eff76068f', 'https://example.com'),
    'https://example.com/receipt/e8bbafe5-1c1f-4f79-8f18-ea4eff76068f'
  );
  assert.strictEqual(
    toAbsoluteUrl('receipt/test', 'https://example.com/'),
    'https://example.com/receipt/test'
  );
});

test('buildReceiptFilename sanitizes handles and produces correct PNG filenames', () => {
  assert.strictEqual(buildReceiptFilename('@official_account'), 'wishlist-official_account-receipt.png');
  assert.strictEqual(buildReceiptFilename('  @my.name!  '), 'wishlist-myname-receipt.png');
  assert.strictEqual(buildReceiptFilename(''), 'wishlist-user-receipt.png');
});

test('isAbortError detects DOMException AbortError', () => {
  const abortError = new Error('User cancelled share');
  abortError.name = 'AbortError';
  assert.strictEqual(isAbortError(abortError), true);

  const regularError = new Error('Network failed');
  assert.strictEqual(isAbortError(regularError), false);
  assert.strictEqual(isAbortError(null), false);
});
