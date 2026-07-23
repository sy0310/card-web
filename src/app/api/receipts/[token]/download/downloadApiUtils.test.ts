import assert from 'node:assert/strict';
import test from 'node:test';
import { validateReceiptDownloadEligibility } from './downloadApiUtils';

test('validateReceiptDownloadEligibility validates download eligibility and returns correct HTTP status codes', () => {
  const now = new Date('2026-07-23T12:00:00Z');
  const validPath = 'e8bbafe5-1c1f-4f79-8f18-ea4eff76068f/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d.png';

  const futureDate = new Date('2026-08-01T00:00:00Z').toISOString();
  const pastDate = new Date('2026-07-01T00:00:00Z').toISOString();

  // Valid non-expired receipt -> 200
  assert.deepStrictEqual(
    validateReceiptDownloadEligibility(
      { receipt_storage_path: validPath, receipt_expires_at: futureDate },
      now,
    ),
    { status: 200 },
  );

  // Expired receipt -> 410 Gone
  assert.deepStrictEqual(
    validateReceiptDownloadEligibility(
      { receipt_storage_path: validPath, receipt_expires_at: pastDate },
      now,
    ),
    { status: 410, error: 'Receipt expired.' },
  );

  // Missing expiresAt -> 404
  assert.deepStrictEqual(
    validateReceiptDownloadEligibility(
      { receipt_storage_path: validPath, receipt_expires_at: null },
      now,
    ),
    { status: 404, error: 'Receipt not available.' },
  );

  // Invalid path format -> 404
  assert.deepStrictEqual(
    validateReceiptDownloadEligibility(
      { receipt_storage_path: 'invalid/path.png', receipt_expires_at: futureDate },
      now,
    ),
    { status: 404, error: 'Invalid receipt storage path.' },
  );

  // Null wishlist -> 404
  assert.deepStrictEqual(
    validateReceiptDownloadEligibility(null, now),
    { status: 404, error: 'Receipt not found.' },
  );
});
