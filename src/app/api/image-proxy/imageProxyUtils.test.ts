import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isImageContentType,
  parseImageProxyTarget,
} from './imageProxyUtils.ts';

test('parseImageProxyTarget accepts Supabase storage URLs for the configured project', () => {
  const result = parseImageProxyTarget(
    'https://project.supabase.co/storage/v1/object/public/cards/card.jpg',
    'https://project.supabase.co',
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.url.hostname, 'project.supabase.co');
  }
});

test('parseImageProxyTarget rejects non-http URLs and unconfigured hosts', () => {
  assert.deepEqual(parseImageProxyTarget('file:///etc/passwd', 'https://project.supabase.co'), {
    ok: false,
    status: 400,
    error: 'Only http and https image URLs are supported.',
  });

  assert.deepEqual(parseImageProxyTarget('https://example.com/card.jpg', 'https://project.supabase.co'), {
    ok: false,
    status: 400,
    error: 'Image host is not allowed for receipt generation.',
  });
});

test('isImageContentType only accepts image responses', () => {
  assert.equal(isImageContentType('image/jpeg'), true);
  assert.equal(isImageContentType('image/webp; charset=binary'), true);
  assert.equal(isImageContentType('text/html'), false);
  assert.equal(isImageContentType(null), false);
});
