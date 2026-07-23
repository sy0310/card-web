import assert from 'node:assert/strict';
import test from 'node:test';
import {
  processExpiredReceipt,
  processCleanupQueueTask,
  ProcessExpiredReceiptDeps,
  ProcessCleanupQueueTaskDeps,
} from './cleanupOrchestration';
import { QueueTaskRecord, INITIAL_RECEIPT_CLEANUP_DELAY_MS } from './cleanupQueueUtils';

const validPath = '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png';
const wishlistId = '11111111-1111-4111-8111-111111111111';
const expiresAt = '2026-07-01T00:00:00.000Z';
const now = new Date('2026-07-23T12:00:00.000Z');

test('processExpiredReceipt: initial queueUpsert registers fallback task +1 hour in future', async () => {
  let capturedDeleteAfterIso = '';

  const deps: ProcessExpiredReceiptDeps = {
    queueUpsert: async (params) => {
      capturedDeleteAfterIso = params.deleteAfterIso;
      assert.strictEqual(params.reason, 'expired_receipt');
      assert.strictEqual(params.attemptCount, 0);
      assert.strictEqual(params.lastError, null);
      return { ok: true };
    },
    clearWishlistStoragePath: async () => ({ ok: true }),
    removeStorageFile: async () => ({ ok: true, state: 'deleted' }),
    queueDelete: async () => ({ ok: true }),
    queueEnsureRetry: async () => ({ ok: true }),
  };

  await processExpiredReceipt(
    { id: wishlistId, receipt_storage_path: validPath, receipt_expires_at: expiresAt },
    now,
    deps,
  );

  const delayMs = new Date(capturedDeleteAfterIso).getTime() - now.getTime();
  assert.strictEqual(delayMs, INITIAL_RECEIPT_CLEANUP_DELAY_MS);
});

test('processExpiredReceipt: queue upsert error triggers Fail-Closed (no DB clear, no Storage remove)', async () => {
  let dbClearCalled = false;
  let storageRemoveCalled = false;

  const deps: ProcessExpiredReceiptDeps = {
    queueUpsert: async () => ({ ok: false, error: 'Queue upsert DB error' }),
    clearWishlistStoragePath: async () => {
      dbClearCalled = true;
      return { ok: true };
    },
    removeStorageFile: async () => {
      storageRemoveCalled = true;
      return { ok: true, state: 'deleted' };
    },
    queueDelete: async () => ({ ok: true }),
    queueEnsureRetry: async () => ({ ok: true }),
  };

  const result = await processExpiredReceipt(
    { id: wishlistId, receipt_storage_path: validPath, receipt_expires_at: expiresAt },
    now,
    deps,
  );

  assert.strictEqual(result.failed, true);
  assert.strictEqual(result.storageDeleted, false);
  assert.strictEqual(result.queueCompleted, false);
  assert.strictEqual(dbClearCalled, false);
  assert.strictEqual(storageRemoveCalled, false);
});

test('processExpiredReceipt: clearWishlistStoragePath error triggers Fail-Closed (no Storage remove)', async () => {
  let storageRemoveCalled = false;

  const deps: ProcessExpiredReceiptDeps = {
    queueUpsert: async () => ({ ok: true }),
    clearWishlistStoragePath: async () => ({ ok: false, error: 'OCC update matched 0 rows' }),
    removeStorageFile: async () => {
      storageRemoveCalled = true;
      return { ok: true, state: 'deleted' };
    },
    queueDelete: async () => ({ ok: true }),
    queueEnsureRetry: async () => ({ ok: true }),
  };

  const result = await processExpiredReceipt(
    { id: wishlistId, receipt_storage_path: validPath, receipt_expires_at: expiresAt },
    now,
    deps,
  );

  assert.strictEqual(result.failed, true);
  assert.strictEqual(result.storageDeleted, false);
  assert.strictEqual(result.queueCompleted, false);
  assert.strictEqual(storageRemoveCalled, false);
});

test('processExpiredReceipt: Storage removal failure recovers deleted queue entry via queueEnsureRetry upsert Map', async () => {
  // Simulated stateful queue table Map
  const queueMap = new Map<string, { storage_path: string; wishlist_id: string | null; reason: string; attempt_count: number }>();

  const deps: ProcessExpiredReceiptDeps = {
    queueUpsert: async (params) => {
      queueMap.set(params.storagePath, {
        storage_path: params.storagePath,
        wishlist_id: params.wishlistId,
        reason: params.reason,
        attempt_count: params.attemptCount ?? 0,
      });
      return { ok: true };
    },
    clearWishlistStoragePath: async () => {
      // Simulate concurrent Cron B deleting the queue task after DB clear!
      queueMap.delete(validPath);
      assert.strictEqual(queueMap.has(validPath), false);
      return { ok: true };
    },
    removeStorageFile: async () => ({ ok: false, error: 'Network timeout' }),
    queueDelete: async (path) => {
      queueMap.delete(path);
      return { ok: true };
    },
    queueEnsureRetry: async (params) => {
      // Upsert recreates the task in queueMap!
      queueMap.set(params.storagePath, {
        storage_path: params.storagePath,
        wishlist_id: params.wishlistId,
        reason: params.reason,
        attempt_count: params.attemptCount,
      });
      return { ok: true };
    },
  };

  const result = await processExpiredReceipt(
    { id: wishlistId, receipt_storage_path: validPath, receipt_expires_at: expiresAt },
    now,
    deps,
  );

  assert.strictEqual(result.failed, true);
  assert.strictEqual(result.storageDeleted, false);
  assert.strictEqual(result.queueCompleted, false);
  // ASSERT task is recreated in queueMap!
  assert.strictEqual(queueMap.has(validPath), true);
  const task = queueMap.get(validPath)!;
  assert.strictEqual(task.wishlist_id, wishlistId);
  assert.strictEqual(task.reason, 'expired_receipt');
  assert.strictEqual(task.attempt_count, 1);
});

test('processExpiredReceipt: happy path with physically deleted file', async () => {
  let queueDeleteCalled = false;

  const deps: ProcessExpiredReceiptDeps = {
    queueUpsert: async () => ({ ok: true }),
    clearWishlistStoragePath: async () => ({ ok: true }),
    removeStorageFile: async () => ({ ok: true, state: 'deleted' }),
    queueDelete: async () => {
      queueDeleteCalled = true;
      return { ok: true };
    },
    queueEnsureRetry: async () => ({ ok: true }),
  };

  const result = await processExpiredReceipt(
    { id: wishlistId, receipt_storage_path: validPath, receipt_expires_at: expiresAt },
    now,
    deps,
  );

  assert.strictEqual(result.failed, false);
  assert.strictEqual(result.storageDeleted, true);
  assert.strictEqual(result.storageAlreadyMissing, false);
  assert.strictEqual(result.queueCompleted, true);
  assert.strictEqual(queueDeleteCalled, true);
});

test('processExpiredReceipt: happy path with already_missing file', async () => {
  const deps: ProcessExpiredReceiptDeps = {
    queueUpsert: async () => ({ ok: true }),
    clearWishlistStoragePath: async () => ({ ok: true }),
    removeStorageFile: async () => ({ ok: true, state: 'already_missing' }),
    queueDelete: async () => ({ ok: true }),
    queueEnsureRetry: async () => ({ ok: true }),
  };

  const result = await processExpiredReceipt(
    { id: wishlistId, receipt_storage_path: validPath, receipt_expires_at: expiresAt },
    now,
    deps,
  );

  assert.strictEqual(result.failed, false);
  assert.strictEqual(result.storageDeleted, false);
  assert.strictEqual(result.storageAlreadyMissing, true);
  assert.strictEqual(result.queueCompleted, true);
});

test('processCleanupQueueTask: reference query error triggers Fail-Closed (no Storage remove)', async () => {
  let storageRemoveCalled = false;

  const task: QueueTaskRecord = {
    storage_path: validPath,
    wishlist_id: null,
    reason: 'expired_receipt',
    delete_after: '2026-07-23T10:00:00.000Z',
    attempt_count: 0,
    last_error: null,
  };

  const deps: ProcessCleanupQueueTaskDeps = {
    findWishlistReference: async () => ({ ok: false, error: 'DB Connection Error' }),
    removeStorageFile: async () => {
      storageRemoveCalled = true;
      return { ok: true, state: 'deleted' };
    },
    queueDelete: async () => ({ ok: true }),
    queueEnsureRetry: async () => ({ ok: true }),
  };

  const result = await processCleanupQueueTask(task, now, deps);

  assert.strictEqual(result.failed, true);
  assert.strictEqual(result.storageDeleted, false);
  assert.strictEqual(storageRemoveCalled, false);
});

test('processCleanupQueueTask: retry preserves original wishlist_id and reason metadata', async () => {
  let capturedWishlistId: string | null = 'INITIAL';
  let capturedReason = '';

  const task: QueueTaskRecord = {
    storage_path: validPath,
    wishlist_id: null,
    reason: 'compensation_failed',
    delete_after: '2026-07-23T10:00:00.000Z',
    attempt_count: 2,
    last_error: null,
  };

  const deps: ProcessCleanupQueueTaskDeps = {
    findWishlistReference: async () => ({ ok: true, isReferenced: false }),
    removeStorageFile: async () => ({ ok: false, error: 'Storage timeout' }),
    queueDelete: async () => ({ ok: true }),
    queueEnsureRetry: async (params) => {
      capturedWishlistId = params.wishlistId;
      capturedReason = params.reason;
      assert.strictEqual(params.attemptCount, 3);
      return { ok: true };
    },
  };

  const result = await processCleanupQueueTask(task, now, deps);

  assert.strictEqual(result.failed, true);
  assert.strictEqual(capturedWishlistId, null);
  assert.strictEqual(capturedReason, 'compensation_failed');
});

test('processCleanupQueueTask: active referenced file only deletes queue task (no Storage remove)', async () => {
  let storageRemoveCalled = false;
  let queueDeleteCalled = false;

  const task: QueueTaskRecord = {
    storage_path: validPath,
    wishlist_id: wishlistId,
    reason: 'replaced_receipt',
    delete_after: '2026-07-23T10:00:00.000Z',
    attempt_count: 0,
    last_error: null,
  };

  const deps: ProcessCleanupQueueTaskDeps = {
    findWishlistReference: async () => ({ ok: true, isReferenced: true }),
    removeStorageFile: async () => {
      storageRemoveCalled = true;
      return { ok: true, state: 'deleted' };
    },
    queueDelete: async () => {
      queueDeleteCalled = true;
      return { ok: true };
    },
    queueEnsureRetry: async () => ({ ok: true }),
  };

  const result = await processCleanupQueueTask(task, now, deps);

  assert.strictEqual(result.failed, false);
  assert.strictEqual(result.skippedReferenced, true);
  assert.strictEqual(result.queueCompleted, true);
  assert.strictEqual(result.storageDeleted, false);
  assert.strictEqual(storageRemoveCalled, false);
  assert.strictEqual(queueDeleteCalled, true);
});

test('processCleanupQueueTask: unreferenced orphan file deleted from Storage and queue completed', async () => {
  let storageRemoveCalled = false;
  let queueDeleteCalled = false;

  const task: QueueTaskRecord = {
    storage_path: validPath,
    wishlist_id: null,
    reason: 'uncommitted_upload',
    delete_after: '2026-07-23T10:00:00.000Z',
    attempt_count: 1,
    last_error: null,
  };

  const deps: ProcessCleanupQueueTaskDeps = {
    findWishlistReference: async () => ({ ok: true, isReferenced: false }),
    removeStorageFile: async () => {
      storageRemoveCalled = true;
      return { ok: true, state: 'deleted' };
    },
    queueDelete: async () => {
      queueDeleteCalled = true;
      return { ok: true };
    },
    queueEnsureRetry: async () => ({ ok: true }),
  };

  const result = await processCleanupQueueTask(task, now, deps);

  assert.strictEqual(result.failed, false);
  assert.strictEqual(result.skippedReferenced, false);
  assert.strictEqual(result.storageDeleted, true);
  assert.strictEqual(result.queueCompleted, true);
  assert.strictEqual(storageRemoveCalled, true);
  assert.strictEqual(queueDeleteCalled, true);
});
