import assert from 'node:assert/strict';
import test from 'node:test';
import { parseInstagramCaption, parseInstagramMediaInput } from './syncInstagramUtils.ts';

test('parseInstagramMediaInput accepts post, reel, tv and shortcode inputs', () => {
  assert.deepEqual(parseInstagramMediaInput('https://www.instagram.com/p/ABC123_def/?igsh=share'), {
    mediaCode: 'ABC123_def',
    originalUrl: 'https://www.instagram.com/p/ABC123_def/',
    duplicateUrls: [
      'https://www.instagram.com/p/ABC123_def/',
      'https://www.instagram.com/reel/ABC123_def/',
      'https://www.instagram.com/tv/ABC123_def/',
    ],
  });

  assert.equal(
    parseInstagramMediaInput('https://instagram.com/reel/XYZ789/')?.originalUrl,
    'https://www.instagram.com/reel/XYZ789/',
  );
  assert.equal(
    parseInstagramMediaInput('https://www.instagram.com/tv/TV987/')?.originalUrl,
    'https://www.instagram.com/tv/TV987/',
  );
  assert.equal(
    parseInstagramMediaInput(' SHORT123 ')?.originalUrl,
    'https://www.instagram.com/p/SHORT123/',
  );
});

test('parseInstagramMediaInput rejects unrelated URLs', () => {
  assert.equal(parseInstagramMediaInput('https://example.com/p/ABC123/'), null);
  assert.equal(parseInstagramMediaInput(''), null);
});

test('parseInstagramCaption strips availability links and extracts POB metadata', () => {
  assert.deepEqual(
    parseInstagramCaption(`#meguroriiz riize ll makestar kaohsiung photo event finger toy ver available on https://megu.example/card
$18
shipping later`),
    {
      title: 'riize ll makestar kaohsiung photo event finger toy ver',
      price: 18,
      group: 'Riize',
      album_era: 'll',
      pob_name: 'makestar kaohsiung photo event finger toy ver',
    },
  );
});

test('parseInstagramCaption also strips misspelled availability labels', () => {
  assert.equal(
    parseInstagramCaption('#meguroriize riize ll makestar avaible on https://example.com').title,
    'riize ll makestar',
  );
});

test('parseInstagramCaption removes dangling trailing parentheses from title and POB metadata', () => {
  assert.deepEqual(
    parseInstagramCaption('#meguroamp ampers&one definition minirecord doctor ver (\n$16'),
    {
      title: 'ampers&one definition minirecord doctor ver',
      price: 16,
      group: 'Ampers&one',
      album_era: 'definition',
      pob_name: 'minirecord doctor ver',
    },
  );

  assert.equal(
    parseInstagramCaption('#meguroamp ampers&one definition minirecord doctor ver （').pob_name,
    'minirecord doctor ver',
  );
});

test('parseInstagramCaption preserves balanced parentheses and does not truncate inside them', () => {
  assert.deepEqual(
    parseInstagramCaption('#megurogidle (G)I-DLE 2 photobook benefit (set ver)\n$20'),
    {
      title: '(G)I-DLE 2 photobook benefit (set ver)',
      price: 20,
      group: '(G)I-DLE',
      album_era: '2',
      pob_name: 'photobook benefit (set ver)',
    },
  );

  const longCaption = `#meguroamp ampers&one ${'a'.repeat(64)} (special version)`;
  const parsed = parseInstagramCaption(longCaption);
  assert.ok(parsed.title.length <= 80);
  assert.equal(parsed.title.endsWith('('), false);
  assert.equal(parsed.title.endsWith('（'), false);
});
