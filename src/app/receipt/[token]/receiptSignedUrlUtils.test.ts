import assert from 'node:assert/strict';
import test from 'node:test';
import { getReceiptSignedUrlTtlSeconds } from './receiptSignedUrlUtils';

test('getReceiptSignedUrlTtlSeconds returns 3600 for remaining 2 hours', () => {
  const now = new Date('2026-07-23T12:00:00Z');
  const expiresAt = new Date('2026-07-23T14:00:00Z').toISOString();
  const ttl = getReceiptSignedUrlTtlSeconds(expiresAt, now);
  assert.strictEqual(ttl, 3600);
});

test('getReceiptSignedUrlTtlSeconds deducts 5s safety margin for remaining 30 minutes (returns 1795)', () => {
  const now = new Date('2026-07-23T12:00:00Z');
  const expiresAt = new Date('2026-07-23T12:30:00Z').toISOString();
  const ttl = getReceiptSignedUrlTtlSeconds(expiresAt, now);
  assert.strictEqual(ttl, 1795);
});

test('getReceiptSignedUrlTtlSeconds returns 5 for remaining 10 seconds', () => {
  const now = new Date('2026-07-23T12:00:00Z');
  const expiresAt = new Date('2026-07-23T12:00:10Z').toISOString();
  const ttl = getReceiptSignedUrlTtlSeconds(expiresAt, now);
  assert.strictEqual(ttl, 5);
});

test('getReceiptSignedUrlTtlSeconds returns null for remaining 5 seconds or less', () => {
  const now = new Date('2026-07-23T12:00:00Z');
  const expires5s = new Date('2026-07-23T12:00:05Z').toISOString();
  const expires1s = new Date('2026-07-23T12:00:01Z').toISOString();

  assert.strictEqual(getReceiptSignedUrlTtlSeconds(expires5s, now), null);
  assert.strictEqual(getReceiptSignedUrlTtlSeconds(expires1s, now), null);
});

test('getReceiptSignedUrlTtlSeconds returns null for expired receipt', () => {
  const now = new Date('2026-07-23T12:00:00Z');
  const expiresAt = new Date('2026-07-23T11:59:59Z').toISOString();
  const ttl = getReceiptSignedUrlTtlSeconds(expiresAt, now);
  assert.strictEqual(ttl, null);
});

test('getReceiptSignedUrlTtlSeconds returns null for invalid date string or null', () => {
  const now = new Date('2026-07-23T12:00:00Z');
  assert.strictEqual(getReceiptSignedUrlTtlSeconds('invalid-date', now), null);
  assert.strictEqual(getReceiptSignedUrlTtlSeconds(null, now), null);
  assert.strictEqual(getReceiptSignedUrlTtlSeconds(undefined, now), null);
});
