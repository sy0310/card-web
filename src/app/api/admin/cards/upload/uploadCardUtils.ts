export type NormalizedCardUploadFields = {
  title: string;
  price: number;
  group_name: string;
  album_era: string;
  pob_name: string;
  inventory_count: number;
  source: string;
  syncToIg: boolean;
  igCaption: string;
};

type NormalizeResult =
  | {
      ok: true;
      value: NormalizedCardUploadFields;
    }
  | {
      ok: false;
      error: string;
    };

type UploadFieldValue = FormDataEntryValue | string | boolean | null | undefined;

const imageExtensions = new Set(['avif', 'gif', 'heic', 'jpeg', 'jpg', 'png', 'webp']);

function trimValue(value: UploadFieldValue) {
  return typeof value === 'string' ? value.trim() : '';
}

function titleFromFallback(fallbackTitle: string) {
  return fallbackTitle.trim().replace(/\.[^/.]+$/, '');
}

function parseMoney(value: string) {
  if (!value) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100) / 100;
}

function parseInventoryCount(value: string) {
  if (!value) return 1;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(0, Math.floor(parsed));
}

function parseBoolean(value: UploadFieldValue) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function normalizeImageExtension(fileName: string) {
  const rawExtension = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? fileName;
  const cleaned = rawExtension.replace(/[^a-z0-9]/g, '');

  if (cleaned.includes('jpeg') || cleaned.includes('jpg')) return 'jpg';
  for (const extension of imageExtensions) {
    if (cleaned === extension || cleaned.includes(extension)) {
      return extension === 'jpeg' ? 'jpg' : extension;
    }
  }

  return 'jpg';
}

export function normalizeCardUploadFields(
  fields: Record<string, UploadFieldValue>,
  fallbackTitle = '',
): NormalizeResult {
  const title = trimValue(fields.title) || titleFromFallback(fallbackTitle);
  if (!title) {
    return { ok: false, error: 'Title is required.' };
  }

  const syncToIg = parseBoolean(fields.syncToIg);
  const igCaption = trimValue(fields.igCaption);
  if (syncToIg && !igCaption) {
    return { ok: false, error: 'Instagram caption is required when sync is enabled.' };
  }

  return {
    ok: true,
    value: {
      title,
      price: parseMoney(trimValue(fields.price)),
      group_name: trimValue(fields.group_name),
      album_era: trimValue(fields.album_era),
      pob_name: trimValue(fields.pob_name),
      inventory_count: parseInventoryCount(trimValue(fields.inventory_count)),
      source: trimValue(fields.source) || 'manual',
      syncToIg,
      igCaption,
    },
  };
}

export function buildCardImagePath(fileName: string, id = crypto.randomUUID()) {
  return `card-images/${id}.${normalizeImageExtension(fileName)}`;
}
