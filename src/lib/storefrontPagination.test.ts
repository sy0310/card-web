import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getStorefrontPageRange,
  hasNextStorefrontPage,
  mergeStorefrontPage,
  STOREFRONT_PAGE_SIZE,
} from './storefrontPagination.ts';

test('storefront pagination requests a bounded first page and the next contiguous page', () => {
  assert.equal(STOREFRONT_PAGE_SIZE, 40);
  assert.deepEqual(getStorefrontPageRange(0), [0, 39]);
  assert.deepEqual(getStorefrontPageRange(40), [40, 79]);
});

test('storefront pagination only exposes Load More after a full page', () => {
  assert.equal(hasNextStorefrontPage(40), true);
  assert.equal(hasNextStorefrontPage(39), false);
  assert.equal(hasNextStorefrontPage(0), false);
});

test('storefront pagination does not duplicate cards when a page is retried', () => {
  assert.deepEqual(
    mergeStorefrontPage(
      [{ id: 'card-1', title: 'Existing' }],
      [
        { id: 'card-1', title: 'Updated' },
        { id: 'card-2', title: 'New' },
      ],
    ),
    [
      { id: 'card-1', title: 'Updated' },
      { id: 'card-2', title: 'New' },
    ],
  );
});
