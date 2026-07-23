import assert from 'node:assert/strict';
import test from 'node:test';
import {
  simulateUploadOrchestration,
  simulateCronQueryOrchestration,
} from './uploadOrchestrationUtils';

test('Upload: Pre-register cleanup queue error triggers Fail-Closed (Storage upload calls = 0)', () => {
  const result = simulateUploadOrchestration({
    queueInsertError: { message: 'DB connection error' },
    occUpdateSuccess: true,
    hasPreviousPath: false,
    newStoragePath: 'w1/f1.png',
  });

  assert.strictEqual(result.status, 500);
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.log.storageUploads.length, 0); // Storage upload NEVER called!
});

test('Upload: Previous path queue insert error rolls back newly uploaded file', () => {
  const result = simulateUploadOrchestration({
    uploadError: null,
    oldQueueError: { message: 'Queue table error' },
    occUpdateSuccess: true,
    hasPreviousPath: true,
    previousPath: 'w1/old.png',
    newStoragePath: 'w1/f2.png',
  });

  assert.strictEqual(result.status, 500);
  assert.strictEqual(result.success, false);
  assert.ok(result.log.storageUploads.includes('w1/f2.png'));
  assert.ok(result.log.storageRemovals.includes('w1/f2.png')); // Compensation rollback triggered
});

test('Upload: Stage B unbind error does not fail response if DB update succeeded', () => {
  const result = simulateUploadOrchestration({
    uploadError: null,
    oldQueueError: null,
    occUpdateSuccess: true,
    unbindError: { message: 'Queue delete timeout' },
    hasPreviousPath: true,
    previousPath: 'w1/old.png',
    newStoragePath: 'w1/f3.png',
  });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.success, true); // Returns 200 Success!
});

test('Cron: DB reference query error triggers Fail-Closed (Storage remove calls = 0)', () => {
  const result = simulateCronQueryOrchestration({
    refQueryError: { message: 'Reference query timeout' },
    isReferenced: false,

  });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.storageRemoveCalls, 0); // ABSOLUTELY 0 calls to Storage.remove
});

test('Cron: Expired wishlist or queue query error returns 500', () => {
  const result = simulateCronQueryOrchestration({
    expiredQueryError: { message: 'Query failed' },
    isReferenced: false,

  });

  assert.strictEqual(result.status, 500);
  assert.strictEqual(result.storageRemoveCalls, 0);
});

test('Cron: Active referenced file is protected from Storage removal', () => {
  const result = simulateCronQueryOrchestration({
    isReferenced: true,

  });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.storageRemoveCalls, 0); // Protected!
  assert.strictEqual(result.queueTaskRemoved, true);
});
