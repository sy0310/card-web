import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseInstagramPublishResult,
  readInstagramPublishServiceResponse,
} from './instagramPublisher.ts';

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

test('readInstagramPublishServiceResponse rejects HTML responses with status context', async () => {
  const response = new Response('<!DOCTYPE html><title>Not Found</title>', {
    status: 404,
    headers: {
      'content-type': 'text/html; charset=utf-8',
    },
  });

  await assert.rejects(
    readInstagramPublishServiceResponse(response),
    /Instagram publish service returned non-JSON response \(status 404, content-type text\/html; charset=utf-8\): <!DOCTYPE html>/,
  );
});

test('readInstagramPublishServiceResponse returns successful JSON payloads', async () => {
  const response = Response.json({
    success: true,
    media_code: 'ABC123',
    pk: '42',
    url: 'https://www.instagram.com/p/ABC123/',
  });

  const result = await readInstagramPublishServiceResponse(response);

  assert.deepEqual(result, {
    success: true,
    media_code: 'ABC123',
    pk: '42',
    url: 'https://www.instagram.com/p/ABC123/',
  });
});
