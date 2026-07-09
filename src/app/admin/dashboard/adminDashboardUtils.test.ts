import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCardPatch,
  buildCardUpdatePayload,
  buildPurchaseOptionPayloads,
  buildSettingsRows,
  buildWishlistItemInsertRows,
  calculateWishlistTotal,
  createPurchaseOptionDrafts,
  createWishlistItemsDraft,
  formatAdminError,
  getCardDraftErrors,
  getPurchaseOptionDraftErrors,
  isMissingColumnError,
  normalizePurchaseOptionDrafts,
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

test('createPurchaseOptionDrafts creates a default Single option when none exist', () => {
  const drafts = createPurchaseOptionDrafts([], '8.5');

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].label, 'Single');
  assert.equal(drafts[0].price, '8.5');
  assert.equal(drafts[0].min_quantity, '1');
  assert.equal(drafts[0].max_quantity, '');
  assert.equal(drafts[0].is_default, true);
  assert.equal(drafts[0].is_active, true);
  assert.equal(drafts[0].sort_order, '0');
});

test('normalizePurchaseOptionDrafts keeps only the first default option', () => {
  const drafts = normalizePurchaseOptionDrafts([
    {
      key: 'row-1',
      label: 'Single',
      price: '10',
      min_quantity: '1',
      max_quantity: '',
      is_default: true,
      is_active: true,
      sort_order: '0',
    },
    {
      key: 'row-2',
      label: 'Set',
      price: '18',
      min_quantity: '2',
      max_quantity: '',
      is_default: true,
      is_active: true,
      sort_order: '1',
    },
  ], '10');

  assert.deepEqual(drafts.map(draft => draft.is_default), [true, false]);
});

test('getPurchaseOptionDraftErrors flags max quantity below min quantity', () => {
  assert.deepEqual(
    getPurchaseOptionDraftErrors([
      {
        key: 'row-1',
        label: 'Bundle',
        price: '20',
        min_quantity: '3',
        max_quantity: '2',
        is_default: true,
        is_active: true,
        sort_order: '0',
      },
    ]),
    ['Purchase option 1: max quantity must be blank or greater than or equal to min quantity.'],
  );
});

test('buildPurchaseOptionPayloads emits numeric prices and nullable max quantities', () => {
  assert.deepEqual(
    buildPurchaseOptionPayloads('card-1', [
      {
        key: 'row-1',
        id: 'option-1',
        label: ' Single ',
        price: '12.349',
        min_quantity: '1',
        max_quantity: '',
        is_default: true,
        is_active: true,
        sort_order: 'not-a-number',
      },
      {
        key: 'row-2',
        label: 'Set',
        price: '20',
        min_quantity: '2',
        max_quantity: '5',
        is_default: false,
        is_active: false,
        sort_order: '4',
      },
    ], '9'),
    [
      {
        id: 'option-1',
        card_id: 'card-1',
        label: 'Single',
        price: 12.35,
        min_quantity: 1,
        max_quantity: null,
        is_default: true,
        is_active: true,
        sort_order: 0,
      },
      {
        id: undefined,
        card_id: 'card-1',
        label: 'Set',
        price: 20,
        min_quantity: 2,
        max_quantity: 5,
        is_default: false,
        is_active: false,
        sort_order: 1,
      },
    ],
  );
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

test('createWishlistItemsDraft groups repeated wishlist rows into quantities', () => {
  assert.deepEqual(
    createWishlistItemsDraft([
      { card_id: 'card-1' },
      { card_id: 'card-2' },
      { card_id: 'card-1' },
      { card_id: '' },
    ]),
    [
      { key: 'card-1', card_id: 'card-1', quantity: '2' },
      { key: 'card-2', card_id: 'card-2', quantity: '1' },
    ],
  );
});

test('calculateWishlistTotal and buildWishlistItemInsertRows use edited quantities', () => {
  const items = [
    { key: 'row-1', card_id: 'card-1', quantity: '2.9' },
    { key: 'row-2', card_id: 'card-2', quantity: 'bad' },
  ];
  const cardsById = new Map([
    ['card-1', { id: 'card-1', price: 12.345 }],
    ['card-2', { id: 'card-2', price: '5' }],
  ]);

  assert.equal(calculateWishlistTotal(items, cardsById), 29.7);
  assert.deepEqual(buildWishlistItemInsertRows('wishlist-1', items), [
    { wishlist_id: 'wishlist-1', card_id: 'card-1' },
    { wishlist_id: 'wishlist-1', card_id: 'card-1' },
    { wishlist_id: 'wishlist-1', card_id: 'card-2' },
  ]);
});

test('formatAdminError surfaces Supabase object details instead of object placeholders', () => {
  assert.equal(
    formatAdminError({
      message: "Could not find the 'notes' column of 'wishlists' in the schema cache",
      details: 'The column was not found.',
      hint: 'Refresh schema cache.',
      code: 'PGRST204',
    }),
    "Could not find the 'notes' column of 'wishlists' in the schema cache The column was not found. Refresh schema cache. Code: PGRST204",
  );
});

test('isMissingColumnError detects schema cache column drift', () => {
  assert.equal(
    isMissingColumnError(
      {
        message: "Could not find the 'notes' column of 'wishlists' in the schema cache",
        code: 'PGRST204',
      },
      'notes',
    ),
    true,
  );
  assert.equal(isMissingColumnError({ message: 'row-level security denied access' }, 'notes'), false);
});
