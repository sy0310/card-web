import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStorefrontSearchFilter,
  createStorefrontRequestTracker,
  getStorefrontLoadErrorMessage,
  getStorefrontSearchTerms,
  getStorefrontPageRange,
  hasNextStorefrontPage,
  mergeStorefrontPage,
  normalizeStorefrontSearch,
  STOREFRONT_PAGE_SIZE,
} from './storefrontPagination.ts';

test('storefront pagination requests a bounded first page and the next contiguous page', () => {
  assert.equal(STOREFRONT_PAGE_SIZE, 40);
  assert.deepEqual(getStorefrontPageRange(0), [0, 39]);
  assert.deepEqual(getStorefrontPageRange(40), [40, 79]);
});

test('storefront search preserves the entered text while normalizing whitespace', () => {
  assert.equal(normalizeStorefrontSearch('  (G)I-DLE,  '), '(G)I-DLE,');
});

test('storefront search turns punctuation-delimited text into safe matching terms', () => {
  assert.deepEqual(getStorefrontSearchTerms('ampers R2'), ['ampers', 'R2']);
  assert.deepEqual(getStorefrontSearchTerms('(G)I-DLE'), ['G', 'I-DLE']);
  assert.deepEqual(getStorefrontSearchTerms('benefit, special'), ['benefit', 'special']);
});

test('storefront search requires every term to match a title or group', () => {
  assert.equal(
    buildStorefrontSearchFilter(['ampers', 'R2']),
    'and(or(title.ilike.*ampers*,group_name.ilike.*ampers*),or(title.ilike.*R2*,group_name.ilike.*R2*))',
  );
});

test('the latest storefront request supersedes prior requests', () => {
  const tracker = createStorefrontRequestTracker();
  const allCardsRequest = tracker.begin();
  const searchRequest = tracker.begin();

  assert.equal(tracker.isCurrent(allCardsRequest), false);
  assert.equal(tracker.isCurrent(searchRequest), true);
});

test('a current storefront timeout reports a retryable error instead of an empty result', () => {
  assert.equal(
    getStorefrontLoadErrorMessage({
      isCurrent: true,
      isMounted: true,
      didTimeout: true,
      wasAborted: true,
    }),
    'Loading cards timed out. Please try again.',
  );
});

test('a request cancelled for a newer storefront filter remains silent', () => {
  assert.equal(
    getStorefrontLoadErrorMessage({
      isCurrent: false,
      isMounted: true,
      didTimeout: false,
      wasAborted: true,
    }),
    null,
  );
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
