import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReceiptImageSrc,
  waitForImages,
} from './checkoutImageUtils.ts';

class FakeImage extends EventTarget {
  complete: boolean;
  naturalWidth: number;
  decodeCalls = 0;

  constructor({ complete = false, naturalWidth = 0 } = {}) {
    super();
    this.complete = complete;
    this.naturalWidth = naturalWidth;
  }

  async decode() {
    this.decodeCalls += 1;
  }
}

const rootWithImages = (images: FakeImage[]) => ({
  querySelectorAll: (selector: string) => {
    assert.equal(selector, 'img');
    return images;
  },
});

const flushMicrotasks = () => new Promise(resolve => setTimeout(resolve, 0));

test('buildReceiptImageSrc proxies remote images with an encoded source and cache key', () => {
  const source = 'https://project.supabase.co/storage/v1/object/public/cards/a b.jpg?download=1';

  assert.equal(
    buildReceiptImageSrc(source, 'receipt-1'),
    '/api/image-proxy?url=https%3A%2F%2Fproject.supabase.co%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fcards%2Fa+b.jpg%3Fdownload%3D1&v=receipt-1',
  );
});

test('buildReceiptImageSrc keeps data and local images direct', () => {
  assert.equal(buildReceiptImageSrc('data:image/png;base64,abc', 'receipt-1'), 'data:image/png;base64,abc');
  assert.equal(buildReceiptImageSrc('/local-card.jpg', 'receipt-1'), '/local-card.jpg?v=receipt-1');
});

test('waitForImages waits for pending images before resolving', async () => {
  const pending = new FakeImage();
  const resultPromise = waitForImages(rootWithImages([pending]) as unknown as ParentNode);
  let isResolved = false;
  resultPromise.then(() => {
    isResolved = true;
  });

  await flushMicrotasks();
  assert.equal(isResolved, false);

  pending.complete = true;
  pending.naturalWidth = 320;
  pending.dispatchEvent(new Event('load'));

  assert.deepEqual(await resultPromise, {
    total: 1,
    loaded: 1,
    failed: 0,
  });
  assert.equal(pending.decodeCalls, 1);
});

test('waitForImages records broken images without hanging the export', async () => {
  const broken = new FakeImage();
  const resultPromise = waitForImages(rootWithImages([broken]) as unknown as ParentNode);

  broken.complete = true;
  broken.naturalWidth = 0;
  broken.dispatchEvent(new Event('error'));

  assert.deepEqual(await resultPromise, {
    total: 1,
    loaded: 0,
    failed: 1,
  });
});
