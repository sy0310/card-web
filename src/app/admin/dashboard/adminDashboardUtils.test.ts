import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCardPatch,
  buildCardUpdatePayload,
  buildSettingsRows,
  getCardDraftErrors,
  normalizeInstagramUrl,
  normalizeAdminSettings,
} from './adminDashboardUtils.ts';

test('buildCardUpdatePayload trims text fields and coerces numeric values', () => {
  const payload = buildCardUpdatePayload({
    title: '  Yeonjun selfie card  ',
    description: '  signed back  ',
    price: '12.349',
    image_url: ' https://cdn.example.com/card.jpg ',
    group_name: ' TXT ',
    member_name: ' Yeonjun ',
    album_era: ' minisode ',
    rarity: ' Rare ',
    inventory_count: '-7',
    original_ig_url: ' ',
    source: ' instagram ',
  });

  assert.deepEqual(payload, {
    title: 'Yeonjun selfie card',
    description: 'signed back',
    price: 12.35,
    image_url: 'https://cdn.example.com/card.jpg',
    group_name: 'TXT',
    member_name: 'Yeonjun',
    album_era: 'minisode',
    rarity: 'Rare',
    inventory_count: 0,
    original_ig_url: '',
    source: 'instagram',
    pob_name: '',
  });
});

test('getCardDraftErrors flags missing required card fields', () => {
  assert.deepEqual(
    getCardDraftErrors({
      title: ' ',
      description: '',
      price: 'free',
      image_url: '',
      group_name: '',
      member_name: '',
      album_era: '',
      rarity: '',
      inventory_count: '2',
      original_ig_url: '',
      source: '',
    }),
    ['Title is required.', 'Price must be a valid number.'],
  );
});

test('applyCardPatch updates one card without mutating the original list', () => {
  const cards = [
    { id: 'card-1', title: 'Old title', price: 4 },
    { id: 'card-2', title: 'Keep me', price: 5 },
  ];

  const updated = applyCardPatch(cards, 'card-1', { title: 'New title', price: 6 });

  assert.deepEqual(updated, [
    { id: 'card-1', title: 'New title', price: 6 },
    { id: 'card-2', title: 'Keep me', price: 5 },
  ]);
  assert.deepEqual(cards[0], { id: 'card-1', title: 'Old title', price: 4 });
});

test('normalizeAdminSettings keeps settings usable for storefront copy', () => {
  assert.deepEqual(
    normalizeAdminSettings({
      site_title: ' ',
      official_ig_handle: 'official_shop',
      checkout_intro: '  DM us after downloading.  ',
      wishlist_footer_note: '',
      low_stock_threshold: '4.8',
    }),
    {
      site_title: 'K-POP CARD',
      official_ig_handle: '@official_shop',
      checkout_intro: 'DM us after downloading.',
      wishlist_footer_note: 'Please DM this image to complete your purchase.',
      low_stock_threshold: '4',
    },
  );
});

test('buildSettingsRows returns normalized key-value rows for upsert', () => {
  assert.deepEqual(
    buildSettingsRows({
      site_title: ' Idol Shelf ',
      official_ig_handle: '@idol_shop',
      checkout_intro: 'Download then DM.',
      wishlist_footer_note: 'Thanks for shopping.',
      low_stock_threshold: '3',
    }),
    [
      { key: 'site_title', value: 'Idol Shelf' },
      { key: 'official_ig_handle', value: '@idol_shop' },
      { key: 'checkout_intro', value: 'Download then DM.' },
      { key: 'wishlist_footer_note', value: 'Thanks for shopping.' },
      { key: 'low_stock_threshold', value: '3' },
    ],
  );
});

test('normalizeInstagramUrl accepts pasted Instagram links without a scheme', () => {
  assert.equal(
    normalizeInstagramUrl(' instagram.com/p/ABC123/?igsh=share#caption '),
    'https://www.instagram.com/p/ABC123/?igsh=share',
  );
  assert.equal(
    normalizeInstagramUrl('https://www.instagram.com/reel/XYZ789/'),
    'https://www.instagram.com/reel/XYZ789/',
  );
  assert.equal(normalizeInstagramUrl(''), '');
});
