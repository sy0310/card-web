import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_RECEIPT_SIZE_BYTES } from '@/lib/receiptConstants';
import {
  isUuid,
  isValidReceiptStoragePath,
  validateReceiptFileHeader,
  hasPngSignature,
} from './receiptApiUtils';

test('isUuid validates UUID format correctly', () => {
  assert.strictEqual(isUuid('e8bbafe5-1c1f-4f79-8f18-ea4eff76068f'), true);
  assert.strictEqual(isUuid('E8BBAFE5-1C1F-4F79-8F18-EA4EFF76068F'), true);
  assert.strictEqual(isUuid('invalid-uuid'), false);
  assert.strictEqual(isUuid(''), false);
  assert.strictEqual(isUuid(null), false);
  assert.strictEqual(isUuid(123), false);
});

test('isValidReceiptStoragePath restricts path pattern to {wishlistId}/{fileUuid}.png', () => {
  const wishlistId = 'e8bbafe5-1c1f-4f79-8f18-ea4eff76068f';
  const fileId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

  // Dual UUID versioned path passes
  assert.strictEqual(isValidReceiptStoragePath(`${wishlistId}/${fileId}.png`), true);

  // Legacy fixed path is rejected
  assert.strictEqual(isValidReceiptStoragePath(`${wishlistId}/receipt.png`), false);

  // Missing extension is rejected
  assert.strictEqual(isValidReceiptStoragePath(`${wishlistId}/${fileId}`), false);

  // Directory traversal is rejected
  assert.strictEqual(isValidReceiptStoragePath(`../${wishlistId}/${fileId}.png`), false);

  // Extra directories are rejected
  assert.strictEqual(isValidReceiptStoragePath(`wishlist-receipts/${wishlistId}/${fileId}.png`), false);

  assert.strictEqual(isValidReceiptStoragePath(''), false);
  assert.strictEqual(isValidReceiptStoragePath(null), false);
});

test('validateReceiptFileHeader validates File instances, mime types, and size boundaries', () => {
  assert.deepStrictEqual(
    validateReceiptFileHeader('not a file'),
    { valid: false, status: 400, error: 'A file must be provided.' }
  );

  const wrongTypeFile = new File([new Uint8Array(10)], 'test.jpg', { type: 'image/jpeg' });
  assert.deepStrictEqual(
    validateReceiptFileHeader(wrongTypeFile),
    { valid: false, status: 415, error: 'Only PNG images are allowed.' }
  );

  const emptyFile = new File([], 'test.png', { type: 'image/png' });
  assert.deepStrictEqual(
    validateReceiptFileHeader(emptyFile),
    { valid: false, status: 400, error: 'Uploaded file is empty.' }
  );

  const oversizedFile = new File([new Uint8Array(MAX_RECEIPT_SIZE_BYTES + 1)], 'test.png', { type: 'image/png' });
  assert.deepStrictEqual(
    validateReceiptFileHeader(oversizedFile),
    { valid: false, status: 413, error: 'File size exceeds maximum limit of 10 MB.' }
  );

  const validFile = new File([new Uint8Array(100)], 'test.png', { type: 'image/png' });
  assert.deepStrictEqual(validateReceiptFileHeader(validFile), { valid: true });
});

test('hasPngSignature checks for 8-byte PNG header magic numbers', () => {
  const validPngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  assert.strictEqual(hasPngSignature(validPngHeader), true);

  const tooShort = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  assert.strictEqual(hasPngSignature(tooShort), false);

  const invalidHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]);
  assert.strictEqual(hasPngSignature(invalidHeader), false);
});
