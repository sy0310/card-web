type InstagramPathType = 'p' | 'reel' | 'tv';

const MEDIA_CODE_RE = /^[A-Za-z0-9_-]{5,}$/;
const INSTAGRAM_URL_RE = /(?:^|\/)(p|reel|tv)\/([A-Za-z0-9_-]+)/i;

export function parseInstagramMediaInput(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const directCode = MEDIA_CODE_RE.test(trimmed) ? trimmed : '';
  if (directCode) {
    return buildInstagramMediaReference('p', directCode);
  }

  const pathInput = getInstagramPathInput(trimmed);
  if (!pathInput) return null;

  const match = pathInput.match(INSTAGRAM_URL_RE);
  if (!match) return null;

  return buildInstagramMediaReference(match[1].toLowerCase() as InstagramPathType, match[2]);
}

function getInstagramPathInput(input: string) {
  if (input.startsWith('/')) return input;

  const looksLikeUrl = /^[a-z][a-z\d+.-]*:\/\//i.test(input) || /^[\w.-]+\//.test(input);
  if (!looksLikeUrl) return input;

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  try {
    const url = new URL(withProtocol);
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'instagram.com' || hostname.endsWith('.instagram.com')) {
      return url.pathname;
    }
  } catch {
    return input;
  }

  return '';
}

function buildInstagramMediaReference(pathType: InstagramPathType, mediaCode: string) {
  const originalUrl = `https://www.instagram.com/${pathType}/${mediaCode}/`;
  return {
    mediaCode,
    originalUrl,
    duplicateUrls: [
      `https://www.instagram.com/p/${mediaCode}/`,
      `https://www.instagram.com/reel/${mediaCode}/`,
      `https://www.instagram.com/tv/${mediaCode}/`,
    ],
  };
}
