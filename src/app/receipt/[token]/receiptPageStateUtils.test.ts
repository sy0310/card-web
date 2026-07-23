import assert from 'node:assert/strict';
import test from 'node:test';
import { getReceiptPageState } from './receiptPageStateUtils';

test('getReceiptPageState determines exact receipt states across 6 scenarios', () => {
  const now = new Date('2026-07-23T12:00:00Z');
  const validVersionedPath = 'e8bbafe5-1c1f-4f79-8f18-ea4eff76068f/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d.png';
  const invalidPath = 'other-folder/receipt.png';

  const futureDate = new Date('2026-08-01T00:00:00Z').toISOString();
  const pastDate = new Date('2026-07-01T00:00:00Z').toISOString();

  // Scenario 1: Path exists and not expired -> available
  assert.strictEqual(
    getReceiptPageState({ storagePath: validVersionedPath, expiresAt: futureDate, now }),
    'available',
  );

  // Scenario 2: Path exists but expired (Cron hasn't run yet) -> expired
  assert.strictEqual(
    getReceiptPageState({ storagePath: validVersionedPath, expiresAt: pastDate, now }),
    'expired',
  );

  // Scenario 3: Path is null but expired (Cron has deleted file) -> expired
  assert.strictEqual(
    getReceiptPageState({ storagePath: null, expiresAt: pastDate, now }),
    'expired',
  );

  // Scenario 4: Path is null and expiresAt is null (Never generated) -> unavailable
  assert.strictEqual(
    getReceiptPageState({ storagePath: null, expiresAt: null, now }),
    'unavailable',
  );

  // Scenario 5: Path is null but expiresAt is in the future (Data inconsistent) -> inconsistent
  assert.strictEqual(
    getReceiptPageState({ storagePath: null, expiresAt: futureDate, now }),
    'inconsistent',
  );

  // Scenario 6: Invalid storage path format -> unavailable
  assert.strictEqual(
    getReceiptPageState({ storagePath: invalidPath, expiresAt: futureDate, now }),
    'unavailable',
  );
});
