export type ImageWaitReport = {
  total: number;
  loaded: number;
  failed: number;
};

type ImageWaitStatus = 'loaded' | 'failed';

const DIRECT_IMAGE_PROTOCOLS = /^(data|blob):/i;

export function buildReceiptImageSrc(imageUrl: string, cacheKey: string | number = Date.now()) {
  const src = imageUrl.trim();
  const version = String(cacheKey);

  if (!src) return '';
  if (DIRECT_IMAGE_PROTOCOLS.test(src)) return src;
  if (src.startsWith('/')) return appendSearchParam(src, 'v', version);

  const params = new URLSearchParams({
    url: src,
    v: version,
  });

  return `/api/image-proxy?${params.toString()}`;
}

export async function waitForImages(root: ParentNode, timeoutMs = 8000): Promise<ImageWaitReport> {
  const images = Array.from(root.querySelectorAll('img'));
  const statuses = await Promise.all(images.map(image => waitForImage(image, timeoutMs)));

  return {
    total: statuses.length,
    loaded: statuses.filter(status => status === 'loaded').length,
    failed: statuses.filter(status => status === 'failed').length,
  };
}

function appendSearchParam(url: string, key: string, value: string) {
  const hashIndex = url.indexOf('#');
  const hasHash = hashIndex >= 0;
  const pathAndSearch = hasHash ? url.slice(0, hashIndex) : url;
  const hash = hasHash ? url.slice(hashIndex) : '';
  const separator = pathAndSearch.includes('?') ? '&' : '?';

  return `${pathAndSearch}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}${hash}`;
}

function waitForImage(image: HTMLImageElement, timeoutMs: number): Promise<ImageWaitStatus> {
  if (image.complete) return getImageStatus(image);

  return new Promise(resolve => {
    const cleanup = () => {
      image.removeEventListener('load', finish);
      image.removeEventListener('error', finish);
      clearTimeout(timeoutId);
    };

    const finish = () => {
      cleanup();
      void getImageStatus(image).then(resolve);
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(image.naturalWidth > 0 ? 'loaded' : 'failed');
    }, timeoutMs);

    image.addEventListener('load', finish, { once: true });
    image.addEventListener('error', finish, { once: true });
  });
}

async function getImageStatus(image: HTMLImageElement): Promise<ImageWaitStatus> {
  if (image.naturalWidth <= 0) return 'failed';

  if (typeof image.decode === 'function') {
    try {
      await image.decode();
    } catch {
      return image.naturalWidth > 0 ? 'loaded' : 'failed';
    }
  }

  return 'loaded';
}
