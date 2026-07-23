import assert from 'node:assert/strict';
import test from 'node:test';
import { getReceiptSignedUrlTtlSeconds } from './receiptSignedUrlUtils';

test('getReceiptSignedUrlTtlSeconds returns 3600 for remaining 2 hours', () => {
  const now = new Date('2026-07-23T12:00:00Z');
  const expiresAt = new Date('2026-07-23T14:00:00Z').toISOString();
  const ttl = getReceiptSignedUrlTtlSeconds(expiresAt, now);
  assert.strictEqual(ttl, 3600);
});

test('getReceiptSignedUrlTtlSeconds returns 1800 for remaining 30 minutes', () => {
  const now = new Date('2026-07-23T12:00:00Z');
  const expiresAt = new Date('2026-07-23T12:30:00Z').toISOString();
  const ttl = getReceiptSignedUrlTtlSeconds(expiresAt, now);
  assert.strictEqual(ttl, 1800);
});

test('getReceiptSignedUrlTtlSeconds returns 1 for remaining 1 second', () => {
  const now = new Date('2026-07-23T12:00:00Z');
  const expiresAt = new Date('2026-07-23T12:00:01Z').toISOString();
  const ttl = getReceiptSignedUrlTtlSeconds(expiresAt, now);
  assert.strictEqual(ttl, 1);
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
