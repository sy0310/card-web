import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateCronAuthHeader,
  filterEligibleExpiredReceipts,
  ReceiptCleanupRecord,
  MAX_CLEANUP_BATCH_SIZE,
} from './cleanupUtils';

test('validateCronAuthHeader checks Bearer token matches CRON_SECRET strictly', () => {
  const secret = 'super-secret-cron-key-123';

  assert.strictEqual(validateCronAuthHeader('Bearer super-secret-cron-key-123', secret), true);
  assert.strictEqual(validateCronAuthHeader('Bearer wrong-key', secret), false);
  assert.strictEqual(validateCronAuthHeader(null, secret), false);
  assert.strictEqual(validateCronAuthHeader('Bearer ', secret), false);

  // Rejects public access when CRON_SECRET is missing or empty
  assert.strictEqual(validateCronAuthHeader('Bearer secret', undefined), false);
  assert.strictEqual(validateCronAuthHeader('Bearer secret', ''), false);
});

test('filterEligibleExpiredReceipts selects only expired records with valid storage paths', () => {
  const now = new Date('2026-07-23T12:00:00Z');
  const pastDate = new Date('2026-07-01T00:00:00Z').toISOString();
  const futureDate = new Date('2026-08-01T00:00:00Z').toISOString();

  const records: ReceiptCleanupRecord[] = [
    { id: '1', receipt_storage_path: '11111111-1111-4111-8111-111111111111/receipt.png', receipt_expires_at: pastDate },
    { id: '2', receipt_storage_path: '22222222-2222-4222-8222-222222222222/receipt.png', receipt_expires_at: futureDate },
    { id: '3', receipt_storage_path: null, receipt_expires_at: pastDate },
    { id: '4', receipt_storage_path: '44444444-4444-4444-8444-444444444444/receipt.png', receipt_expires_at: null },
  ];

  const eligible = filterEligibleExpiredReceipts(records, now);

  assert.strictEqual(eligible.length, 1);
  assert.strictEqual(eligible[0].id, '1');
});

test('MAX_CLEANUP_BATCH_SIZE is capped at 100', () => {
  assert.strictEqual(MAX_CLEANUP_BATCH_SIZE, 100);
});
