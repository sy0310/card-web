import assert from 'node:assert/strict';
import test from 'node:test';
import {
  simulateConcurrentUpload,
  simulateCronRaceCondition,
  WishlistDbState,
  MockStorageState,
} from './receiptConcurrencyUtils';

test('Concurrent upload: Second request fails OCC update and rolls back its new file', () => {
  const dbState: WishlistDbState = {
    id: 'w1',
    checkout_request_id: 'req-1',
    receipt_token: 'tok-1',
    receipt_storage_path: 'w1/old.png',
    receipt_expires_at: '2026-07-01T00:00:00Z',
  };

  const storage: MockStorageState = {
    files: new Set(['w1/old.png']),
    removedLog: [],
  };

  // Both requests read old state 'w1/old.png'
  const readPath = dbState.receipt_storage_path;
  const readExpiresAt = dbState.receipt_expires_at;

  const req1Result = simulateConcurrentUpload({
    dbState,
    storage,
    newStoragePath: 'w1/new1.png',
    newExpiresAt: '2026-08-01T00:00:00Z',
    readPath,
    readExpiresAt,
  });

  assert.deepStrictEqual(req1Result, { success: true });
  assert.strictEqual(dbState.receipt_storage_path, 'w1/new1.png');
  assert.strictEqual(storage.files.has('w1/old.png'), false); // Old file removed
  assert.strictEqual(storage.files.has('w1/new1.png'), true);

  // Request 2 attempts update with stale read state
  const req2Result = simulateConcurrentUpload({
    dbState,
    storage,
    newStoragePath: 'w1/new2.png',
    newExpiresAt: '2026-08-01T00:00:00Z',
    readPath,
    readExpiresAt,
  });

  assert.deepStrictEqual(req2Result, {
    success: false,
    status: 409,
    rolledBackFile: 'w1/new2.png',
  });
  assert.strictEqual(dbState.receipt_storage_path, 'w1/new1.png'); // DB pointer remains on req1
  assert.strictEqual(storage.files.has('w1/new2.png'), false); // Orphaned file rolled back
});

test('Cron and re-upload race condition: Cron does not clear DB pointer if re-uploaded to path B', () => {
  const cronTargetRecord = {
    id: 'w2',
    path: 'w2/pathA.png',
    expiresAt: '2026-07-01T00:00:00Z',
  };

  const dbState: WishlistDbState = {
    id: 'w2',
    checkout_request_id: 'req-2',
    receipt_token: 'tok-2',
    receipt_storage_path: 'w2/pathA.png',
    receipt_expires_at: '2026-07-01T00:00:00Z',
  };

  const storage: MockStorageState = {
    files: new Set(['w2/pathA.png']),
    removedLog: [],
  };

  // User re-uploads to path B before Cron DB update runs
  const uploadResult = simulateConcurrentUpload({
    dbState,
    storage,
    newStoragePath: 'w2/pathB.png',
    newExpiresAt: '2026-08-20T00:00:00Z',
    readPath: 'w2/pathA.png',
    readExpiresAt: '2026-07-01T00:00:00Z',
  });

  assert.deepStrictEqual(uploadResult, { success: true });
  assert.strictEqual(dbState.receipt_storage_path, 'w2/pathB.png');

  // Cron attempts conditional update matching pathA
  const cronResult = simulateCronRaceCondition({
    dbState,
    storage,
    cronTargetRecord,
  });

  assert.strictEqual(cronResult.cronDbUpdated, false);
  assert.strictEqual(dbState.receipt_storage_path, 'w2/pathB.png'); // Path B preserved!
});
