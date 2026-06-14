import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCardImagePath,
  normalizeCardUploadFields,
} from './uploadCardUtils.ts';

test('normalizeCardUploadFields trims metadata and coerces upload values', () => {
  const result = normalizeCardUploadFields(
    {
      title: '  mubeat monkey ver  ',
      price: '35.239',
      group_name: ' Ampers&one ',
      album_era: ' definition ',
      pob_name: ' mubeat ',
      inventory_count: '2.9',
      syncToIg: 'true',
      igCaption: '  #meguroamp available  ',
    },
    'fallback-title',
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, {
      title: 'mubeat monkey ver',
      price: 35.24,
      group_name: 'Ampers&one',
      album_era: 'definition',
      pob_name: 'mubeat',
      inventory_count: 2,
      source: 'manual',
      syncToIg: true,
      igCaption: '#meguroamp available',
    });
  }
});

test('normalizeCardUploadFields falls back to filename title and rejects missing captions for sync', () => {
  const result = normalizeCardUploadFields(
    {
      title: ' ',
      price: '',
      inventory_count: '',
      syncToIg: 'true',
      igCaption: ' ',
    },
    ' card-photo.jpg ',
  );

  assert.deepEqual(result, {
    ok: false,
    error: 'Instagram caption is required when sync is enabled.',
  });
});

test('buildCardImagePath preserves safe image extensions', () => {
  assert.equal(
    buildCardImagePath('Card.Front JPEG', 'fixed-id'),
    'card-images/fixed-id.jpg',
  );
  assert.equal(
    buildCardImagePath('scan.WEBP', 'fixed-id'),
    'card-images/fixed-id.webp',
  );
});
