type InstagramPathType = 'p' | 'reel' | 'tv';

const MEDIA_CODE_RE = /^[A-Za-z0-9_-]{5,}$/;
const INSTAGRAM_URL_RE = /(?:^|\/)(p|reel|tv)\/([A-Za-z0-9_-]+)/i;
const TITLE_STOP_RE = /\b(?:available|avaible|avail)\b|https?:\/\/|www\./i;

const GROUP_MAP: Record<string, string> = {
  'svt': 'Seventeen',
  'seventeen': 'Seventeen',
  '82major': '82major',
  '82m': '82major',
  'p1h': 'P1Harmony',
  'p1harmony': 'P1Harmony',
  'zb1': 'ZEROBASEONE',
  'zerobaseone': 'ZEROBASEONE',
  'lsf': 'LE SSERAFIM',
  'lesserafim': 'LE SSERAFIM',
  'adt': '&Team',
  '&team': '&Team',
  'amp': 'Ampers&one',
  'ampers&one': 'Ampers&one',
  'nct': 'NCT',
  'nctw': 'NCT Wish',
  'crv': 'CRAVITY',
  'cravity': 'CRAVITY',
  'bnd': 'BOYNEXTDOOR',
  'boynextdoor': 'BOYNEXTDOOR',
  'kfl': 'Kickflip',
  'kickflip': 'Kickflip',
  'cye': 'CYE',
  'ahf': 'ahof',
  'ahof': 'ahof',
  'xahf': 'ahof',
  'xlov': 'xlov',
  'nua': 'NouerA',
  'nouera': 'NouerA',
  'atz': 'Ateez',
  'ateez': 'Ateez',
  'cyn': 'Yena',
  'yena': 'Yena',
  'adp': 'Allday project',
  'allday': 'Allday project',
  'kik': 'kiiikiii',
  'kiiikiii': 'kiiikiii',
  'ehp': 'Enhypen',
  'enhypen': 'Enhypen',
  'xik': 'Xikers',
  'xikers': 'Xikers',
  'tws': 'TWS',
  'illit': 'Illit',
  'aespa': 'aespa',
  'h2h': 'aespa',
  'txt': 'TXT',
  'itzy': 'Itzy',
  'gmmtv': 'GMMTV',
  'evnne': 'Evnne',
  'rescene': 'RESCENE',
  'qwer': 'QWER',
  'kep1er': 'Kep1er',
  'kiss of life': 'Kiss of Life',
  'gidle': '(G)I-DLE',
  'i-dle': '(G)I-DLE',
  'exo': 'EXO',
  'kai': 'EXO',
  'chanyeol': 'EXO',
  'baekhyun': 'EXO',
  'riiz': 'Riize',
  'riize': 'Riize',
  'stray': 'Stray Kids',
  'skz': 'Stray Kids',
};

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

export function parseInstagramCaption(caption: string) {
  const lines = caption.split(/\r?\n/);
  const firstLine = lines.find(line => line.trim())?.trim() || '';

  let price = 0;
  let group = '';
  let album_era = '';
  let pob_name = '';

  const priceMatch = caption.match(/\$\s*(\d+(?:\.\d{1,2})?)(?:\s+set)?/i);
  if (priceMatch) {
    price = parseFloat(priceMatch[1]);
  }

  const tokens = firstLine.split(/\s+/).filter(Boolean);
  const firstToken = tokens[0] ?? '';
  let rawTag = '';

  if (firstToken.startsWith('#')) {
    rawTag = cleanMeguroTag(firstToken.substring(1).toLowerCase());
    group = GROUP_MAP[rawTag] ?? '';

    if (!group) {
      for (const token of tokens) {
        const cleanedToken = cleanGroupToken(token);
        if (GROUP_MAP[cleanedToken]) {
          group = GROUP_MAP[cleanedToken];
          break;
        }
      }
    }

    if (!group && tokens.length >= 2) {
      group = tokens[1];
    }

    const groupWords = group.toLowerCase().split(/\s+/).map(cleanGroupToken).filter(Boolean);
    const metadataTokens = tokens.slice(1).filter(token => {
      const cleanedToken = cleanGroupToken(token);
      if (cleanedToken === rawTag) return false;
      if (groupWords.includes(cleanedToken)) return false;
      return true;
    });
    const cleanMetadata = cleanCaptionMetadataText(metadataTokens.join(' '));
    const cleanMetadataTokens = cleanMetadata.split(/\s+/).filter(Boolean);
    album_era = cleanCaptionMetadataText(cleanMetadataTokens[0] ?? '');
    pob_name = cleanCaptionMetadataText(cleanMetadataTokens.slice(1).join(' '));
  }

  let title = firstLine;
  if (firstToken.startsWith('#') && tokens.length >= 2) {
    title = tokens.slice(1).join(' ');
  }
  title = cleanCaptionMetadataText(title, 80) || 'Instagram Post';

  return { title, price, group, album_era, pob_name };
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

function cleanMeguroTag(tag: string) {
  if (tag.startsWith('megurop')) return tag.substring(7);
  if (tag.startsWith('megurox')) return tag.substring(7);
  if (tag.startsWith('meguro')) return tag.substring(6);
  return tag;
}

function cleanGroupToken(token: string) {
  return token.replace(/[^a-zA-Z0-9&-]/g, '').toLowerCase();
}

function stripTrailingSalesText(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const match = normalized.match(TITLE_STOP_RE);
  if (!match || match.index === undefined) {
    return trimTrailingCaptionPunctuation(normalized);
  }

  return trimTrailingCaptionPunctuation(normalized.slice(0, match.index));
}

function cleanCaptionMetadataText(value: string, maxLength?: number) {
  const withoutSalesText = stripTrailingSalesText(value);
  const truncated = maxLength === undefined
    ? withoutSalesText
    : truncateCaptionText(withoutSalesText, maxLength);

  return trimTrailingCaptionPunctuation(removeUnbalancedTrailingParentheses(truncated));
}

function truncateCaptionText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;

  const candidate = value.slice(0, maxLength + 1);
  const lastWhitespace = candidate.lastIndexOf(' ');
  return lastWhitespace > 0 ? candidate.slice(0, lastWhitespace) : value.slice(0, maxLength);
}

function removeUnbalancedTrailingParentheses(value: string) {
  const openToClose: Record<string, string> = { '(': ')', '（': '）' };
  const closingParentheses = new Set(Object.values(openToClose));
  const stack: Array<{ character: string; index: number }> = [];
  const unmatchedClosingIndexes: number[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (openToClose[character]) {
      stack.push({ character, index });
      continue;
    }

    if (closingParentheses.has(character)) {
      const opening = stack.at(-1);
      if (opening && openToClose[opening.character] === character) {
        stack.pop();
      } else {
        unmatchedClosingIndexes.push(index);
      }
    }
  }

  if (stack.length > 0) {
    return value.slice(0, stack[0].index).trimEnd();
  }

  const trailingClosingIndex = unmatchedClosingIndexes.at(-1);
  if (trailingClosingIndex !== undefined && value.slice(trailingClosingIndex + 1).trim() === '') {
    return value.slice(0, trailingClosingIndex).trimEnd();
  }

  return value;
}

function trimTrailingCaptionPunctuation(value: string) {
  return value.replace(/\s+[.,;:!?-]+$/, '').trim();
}
