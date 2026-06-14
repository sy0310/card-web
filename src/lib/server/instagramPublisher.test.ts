import assert from 'node:assert/strict';
import test from 'node:test';
import { parseInstagramPublishResult } from './instagramPublisher.ts';

test('parseInstagramPublishResult extracts the RESULT_JSON line', () => {
  const result = parseInstagramPublishResult([
    'Logging in...',
    'RESULT_JSON:{"success":true,"media_code":"ABC123","pk":"42","url":"https://www.instagram.com/p/ABC123/"}',
    'done',
  ].join('\n'));

  assert.deepEqual(result, {
    success: true,
    media_code: 'ABC123',
    pk: '42',
    url: 'https://www.instagram.com/p/ABC123/',
  });
});

test('parseInstagramPublishResult returns null for missing or failed output', () => {
  assert.equal(parseInstagramPublishResult('no json here'), null);
  assert.equal(parseInstagramPublishResult('RESULT_JSON:{"success":false}'), null);
});
