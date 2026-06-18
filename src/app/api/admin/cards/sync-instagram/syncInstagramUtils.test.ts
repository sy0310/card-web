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
