import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateNextRetryDate,
  isObjectNotFoundError,
} from './cleanupQueueUtils';

test('calculateNextRetryDate applies exponential backoff delays', () => {
  const now = new Date('2026-07-23T12:00:00Z');

  // Attempt 1 -> +1 hour
  const retry1 = calculateNextRetryDate(1, now);
  assert.strictEqual(retry1.toISOString(), '2026-07-23T13:00:00.000Z');

  // Attempt 2 -> +6 hours
  const retry2 = calculateNextRetryDate(2, now);
  assert.strictEqual(retry2.toISOString(), '2026-07-23T18:00:00.000Z');

  // Attempt 3+ -> +24 hours
  const retry3 = calculateNextRetryDate(3, now);
  assert.strictEqual(retry3.toISOString(), '2026-07-24T12:00:00.000Z');
});

test('isObjectNotFoundError detects 404 and object not found errors', () => {
  assert.strictEqual(isObjectNotFoundError({ message: 'Object not found' }), true);
  assert.strictEqual(isObjectNotFoundError({ error: 'not_found' }), true);
  assert.strictEqual(isObjectNotFoundError('404 Not Found'), true);
  assert.strictEqual(isObjectNotFoundError({ message: 'Permission denied' }), false);
  assert.strictEqual(isObjectNotFoundError(null), false);
});
