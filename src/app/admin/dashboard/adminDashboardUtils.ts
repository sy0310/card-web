import { MAX_UNITS_PER_ITEM } from '@/lib/wishlistLimits';

export type CardEditDraft = {
  title: string;
  description: string;
  price: string;
  image_url: string;
  group_name: string;
  member_name: string;
  album_era: string;
  rarity: string;
  inventory_count: string;
  unlimited_inventory: boolean;
  original_ig_url: string;
  source: string;
  availability_status: string;
  pob_name?: string;
};

export type CardUpdatePayload = {
  title: string;
  description: string;
  price: number;
  image_url: string;
  group_name: string;
  member_name: string;
  album_era: string;
  rarity: string;
  inventory_count: number;
  unlimited_inventory: boolean;
  original_ig_url: string;
  source: string;
  availability_status: CardAvailabilityStatus;
  pob_name?: string;
};

export type CardAvailabilityStatus = 'available' | 'pending' | 'archived';

export type PurchaseOptionDraft = {
  key: string;
  id?: string;
  label: string;
  price: string;
  min_quantity: string;
  max_quantity: string;
  is_default: boolean;
  is_active: boolean;
  sort_order: string;
};

export type PurchaseOptionPayload = {
  id?: string;
  card_id?: string;
  label: string;
  price: number;
  min_quantity: number;
  max_quantity: number | null;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
};

export type AdminSettings = {
  site_title: string;
  official_ig_handle: string;
  checkout_intro: string;
  wishlist_footer_note: string;
  low_stock_threshold: string;
};

export type WishlistDraftItem = {
  key: string;
  card_id: string;
  purchase_option_id?: string | null;
  option_label_snapshot?: string;
  unit_price_snapshot?: number | null;
  card_title_snapshot?: string;
  group_name_snapshot?: string;
  album_era_snapshot?: string;
  image_url_snapshot?: string;
  quantity: string;
};

export type WishlistCardSummary = {
  id: string;
  title?: string;
  price?: number | string;
  image_url?: string;
  group_name?: string;
  album_era?: string;
  purchase_options?: PurchaseOptionPayload[];
};

export type AdminPurchaseOptionCard = {
  id: string;
  price: number | string;
  purchase_options?: PurchaseOptionPayload[];
};

export type WishlistStoredItem = {
  card_id?: string | null;
  purchase_option_id?: string | null;
  option_label_snapshot?: string | null;
  unit_price_snapshot?: number | string | null;
  card_title_snapshot?: string | null;
  group_name_snapshot?: string | null;
  album_era_snapshot?: string | null;
  image_url_snapshot?: string | null;
  cards?: WishlistCardSummary | null;
};

type ErrorLikeRecord = {
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  code?: unknown;
};

export const defaultAdminSettings: AdminSettings = {
  site_title: 'K-POP CARD',
  official_ig_handle: '@official_account',
  checkout_intro: 'Enter your Instagram handle so we can track your request.',
  wishlist_footer_note: 'Please DM this image to complete your purchase.',
  low_stock_threshold: '2',
};

const settingKeys: (keyof AdminSettings)[] = [
  'site_title',
  'official_ig_handle',
  'checkout_intro',
  'wishlist_footer_note',
  'low_stock_threshold',
];

const trimValue = (value: unknown) => String(value ?? '').trim();

export function normalizeCardAvailabilityStatus(value: unknown): CardAvailabilityStatus {
  const status = trimValue(value).toLowerCase();
  return status === 'pending' || status === 'archived' ? status : 'available';
}

const parseMoney = (value: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100) / 100;
};

const createFallbackAdminPurchaseOption = (card: AdminPurchaseOptionCard): PurchaseOptionPayload => ({
  id: `fallback-${card.id}`,
  card_id: card.id,
  label: 'Single',
  price: parseMoney(String(card.price)),
  min_quantity: 1,
  max_quantity: null,
  is_default: true,
  is_active: true,
  sort_order: 0,
});

const sortAdminPurchaseOptions = (options: PurchaseOptionPayload[]) => [...options].sort((a, b) => {
  const aSort = Number(a.sort_order);
  const bSort = Number(b.sort_order);
  return (Number.isFinite(aSort) ? aSort : 0) - (Number.isFinite(bSort) ? bSort : 0);
});

export function getAdminPurchaseOptions(card: AdminPurchaseOptionCard): PurchaseOptionPayload[] {
  const options = sortAdminPurchaseOptions(card.purchase_options ?? []);
  return options.length > 0 ? options : [createFallbackAdminPurchaseOption(card)];
}

export function getActiveAdminPurchaseOptions(
  card: AdminPurchaseOptionCard,
  selectedOptionId?: string | null,
): PurchaseOptionPayload[] {
  const options = getAdminPurchaseOptions(card).filter(option => (
    option.is_active || option.id === selectedOptionId
  ));

  return options.length > 0 ? options : [createFallbackAdminPurchaseOption(card)];
}

export function getDefaultAdminPurchaseOption(card: AdminPurchaseOptionCard) {
  const options = getActiveAdminPurchaseOptions(card);
  return options.find(option => option.is_default && option.is_active)
    ?? options.find(option => option.is_active)
    ?? options[0];
}

export function getSelectedAdminPurchaseOption(
  card: AdminPurchaseOptionCard,
  selectedOptionId?: string | null,
) {
  const options = getActiveAdminPurchaseOptions(card, selectedOptionId);
  return options.find(option => option.id === selectedOptionId)
    ?? getDefaultAdminPurchaseOption(card);
}

const parseCount = (value: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
};

const createDraftKey = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const parseMinimumQuantity = (value: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.floor(parsed));
};

const parseSortOrder = (value: string, index: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return index;
  return Math.floor(parsed);
};

const parseMaximumQuantity = (value: string, minQuantity: number) => {
  const rawValue = trimValue(value);
  if (!rawValue) return null;

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return minQuantity;

  return Math.max(minQuantity, Math.floor(parsed));
};

const isValidPurchaseOptionDraft = (draft: PurchaseOptionDraft) => {
  const price = Number(draft.price);
  const minQuantity = Number(draft.min_quantity);
  const maxValue = trimValue(draft.max_quantity);
  const maxQuantity = Number(maxValue);

  return (
    Boolean(draft.label.trim()) &&
    Number.isFinite(price) &&
    price >= 0 &&
    Number.isFinite(minQuantity) &&
    minQuantity >= 1 &&
    (
      !maxValue ||
      (Number.isFinite(maxQuantity) && maxQuantity >= minQuantity)
    )
  );
};

export function createPurchaseOptionDrafts(
  options: Partial<PurchaseOptionPayload>[] = [],
  fallbackPrice: string | number = 0,
): PurchaseOptionDraft[] {
  if (options.length === 0) {
    return normalizePurchaseOptionDrafts([
      {
        key: createDraftKey(),
        label: 'Single',
        price: String(parseMoney(String(fallbackPrice))),
        min_quantity: '1',
        max_quantity: '',
        is_default: true,
        is_active: true,
        sort_order: '0',
      },
    ], fallbackPrice);
  }

  const sortedOptions = [...options].sort((a, b) => {
    const aSort = Number(a.sort_order ?? 0);
    const bSort = Number(b.sort_order ?? 0);
    return (Number.isFinite(aSort) ? aSort : 0) - (Number.isFinite(bSort) ? bSort : 0);
  });

  return normalizePurchaseOptionDrafts(
    sortedOptions.map((option, index) => ({
      key: trimValue(option.id) || createDraftKey(),
      id: trimValue(option.id) || undefined,
      label: trimValue(option.label || (index === 0 ? 'Single' : `Option ${index + 1}`)),
      price: trimValue(option.price ?? fallbackPrice),
      min_quantity: trimValue(option.min_quantity ?? 1),
      max_quantity: option.max_quantity == null ? '' : trimValue(option.max_quantity),
      is_default: Boolean(option.is_default),
      is_active: option.is_active !== false,
      sort_order: trimValue(option.sort_order ?? index),
    })),
    fallbackPrice,
  );
}

export function normalizePurchaseOptionDrafts(
  drafts: PurchaseOptionDraft[],
  fallbackPrice: string | number = 0,
): PurchaseOptionDraft[] {
  const normalizedDrafts = drafts.length > 0
    ? drafts.map((draft, index) => ({
        ...draft,
        key: trimValue(draft.key) || createDraftKey(),
        id: trimValue(draft.id) || undefined,
        label: trimValue(draft.label),
        price: trimValue(draft.price || fallbackPrice),
        min_quantity: trimValue(draft.min_quantity || 1),
        max_quantity: trimValue(draft.max_quantity),
        sort_order: String(parseSortOrder(draft.sort_order, index)),
        is_default: Boolean(draft.is_default),
        is_active: Boolean(draft.is_active),
      }))
    : createPurchaseOptionDrafts([], fallbackPrice);

  const firstDefaultIndex = normalizedDrafts.findIndex(draft => draft.is_default);
  const fallbackDefaultIndex = normalizedDrafts.findIndex(isValidPurchaseOptionDraft);
  const defaultIndex = firstDefaultIndex >= 0
    ? firstDefaultIndex
    : Math.max(0, fallbackDefaultIndex);

  return normalizedDrafts.map((draft, index) => ({
    ...draft,
    is_default: index === defaultIndex,
    sort_order: String(index),
  }));
}

export function getPurchaseOptionDraftErrors(drafts: PurchaseOptionDraft[]) {
  const errors: string[] = [];

  drafts.forEach((draft, index) => {
    const rowLabel = `Purchase option ${index + 1}`;
    const price = Number(draft.price);
    const minQuantity = Number(draft.min_quantity);
    const maxValue = trimValue(draft.max_quantity);
    const maxQuantity = Number(maxValue);

    if (!draft.label.trim()) errors.push(`${rowLabel}: label is required.`);
    if (!Number.isFinite(price) || price < 0) {
      errors.push(`${rowLabel}: price must be a valid number greater than or equal to 0.`);
    }
    if (!Number.isFinite(minQuantity) || minQuantity < 1) {
      errors.push(`${rowLabel}: min quantity must be at least 1.`);
    }
    if (Number.isFinite(minQuantity) && minQuantity > MAX_UNITS_PER_ITEM) {
      errors.push(`${rowLabel}: min quantity cannot exceed ${MAX_UNITS_PER_ITEM}.`);
    }
    if (maxValue && (!Number.isFinite(maxQuantity) || maxQuantity < minQuantity)) {
      errors.push(`${rowLabel}: max quantity must be blank or greater than or equal to min quantity.`);
    }
    if (maxValue && Number.isFinite(maxQuantity) && maxQuantity > MAX_UNITS_PER_ITEM) {
      errors.push(`${rowLabel}: max quantity cannot exceed ${MAX_UNITS_PER_ITEM}.`);
    }
  });

  return errors;
}

export function buildPurchaseOptionPayloads(
  cardId: string,
  drafts: PurchaseOptionDraft[],
  fallbackPrice: string | number = 0,
): PurchaseOptionPayload[] {
  return normalizePurchaseOptionDrafts(drafts, fallbackPrice).map((draft, index) => {
    const minQuantity = parseMinimumQuantity(draft.min_quantity);

    return {
      id: draft.id,
      card_id: cardId,
      label: trimValue(draft.label) || 'Single',
      price: parseMoney(trimValue(draft.price || fallbackPrice)),
      min_quantity: minQuantity,
      max_quantity: parseMaximumQuantity(draft.max_quantity, minQuantity),
      is_default: draft.is_default,
      is_active: draft.is_active,
      sort_order: index,
    };
  });
}

export function normalizeInstagramUrl(value: unknown) {
  const rawValue = trimValue(value);
  if (!rawValue) return '';

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(rawValue)
    ? rawValue
    : `https://${rawValue}`;

  try {
    const url = new URL(withProtocol);
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'instagram.com' || hostname.endsWith('.instagram.com')) {
      url.protocol = 'https:';
      url.hostname = 'www.instagram.com';
      url.hash = '';
      return url.toString();
    }
  } catch {
    return rawValue;
  }

  return rawValue;
}

export function createCardDraft(card: Partial<CardUpdatePayload>): CardEditDraft {
  return {
    title: trimValue(card.title),
    description: trimValue(card.description),
    price: trimValue(card.price),
    image_url: trimValue(card.image_url),
    group_name: trimValue(card.group_name),
    member_name: trimValue(card.member_name),
    album_era: trimValue(card.album_era),
    rarity: trimValue(card.rarity),
    inventory_count: trimValue(card.inventory_count),
    unlimited_inventory: card.unlimited_inventory !== false,
    original_ig_url: trimValue(card.original_ig_url),
    source: trimValue(card.source || 'manual'),
    availability_status: normalizeCardAvailabilityStatus(card.availability_status),
    pob_name: trimValue(card.pob_name),
  };
}

export function getCardDraftErrors(draft: CardEditDraft) {
  const errors: string[] = [];
  const price = Number(draft.price);
  const inventory = Number(draft.inventory_count);

  if (!draft.title.trim()) errors.push('Title is required.');
  if (!Number.isFinite(price) || price < 0) errors.push('Price must be a valid number.');
  if (!Number.isFinite(inventory)) errors.push('Inventory must be a valid number.');

  return errors;
}

export function buildCardUpdatePayload(draft: CardEditDraft): CardUpdatePayload {
  return {
    title: trimValue(draft.title),
    description: trimValue(draft.description),
    price: parseMoney(draft.price),
    image_url: trimValue(draft.image_url),
    group_name: trimValue(draft.group_name),
    member_name: trimValue(draft.member_name),
    album_era: trimValue(draft.album_era),
    rarity: trimValue(draft.rarity),
    inventory_count: parseCount(draft.inventory_count),
    unlimited_inventory: draft.unlimited_inventory !== false,
    original_ig_url: normalizeInstagramUrl(draft.original_ig_url),
    source: trimValue(draft.source || 'manual'),
    availability_status: normalizeCardAvailabilityStatus(draft.availability_status),
    pob_name: trimValue(draft.pob_name),
  };
}

export function applyCardPatch<T extends { id: string }>(
  cards: T[],
  cardId: string,
  patch: Partial<T>,
) {
  return cards.map(card => (card.id === cardId ? { ...card, ...patch } : card));
}

export function normalizeAdminSettings(settings: Partial<AdminSettings>): AdminSettings {
  const siteTitle = trimValue(settings.site_title) || defaultAdminSettings.site_title;
  const rawHandle = trimValue(settings.official_ig_handle)
    || defaultAdminSettings.official_ig_handle;
  const officialHandle = rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`;
  const checkoutIntro = trimValue(settings.checkout_intro)
    || defaultAdminSettings.checkout_intro;
  const wishlistFooter = trimValue(settings.wishlist_footer_note)
    || defaultAdminSettings.wishlist_footer_note;
  const threshold = Number(settings.low_stock_threshold);

  return {
    site_title: siteTitle,
    official_ig_handle: officialHandle,
    checkout_intro: checkoutIntro,
    wishlist_footer_note: wishlistFooter,
    low_stock_threshold: String(
      Number.isFinite(threshold) ? Math.max(0, Math.floor(threshold)) : 2,
    ),
  };
}

export function buildSettingsRows(settings: Partial<AdminSettings>) {
  const normalized = normalizeAdminSettings(settings);
  return settingKeys.map(key => ({ key, value: normalized[key] }));
}

export function parseWishlistQuantity(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.floor(parsed));
}

const getSnapshotPrice = (item: WishlistStoredItem, card?: WishlistCardSummary | null) => {
  const snapshotPrice = Number(item.unit_price_snapshot);
  if (Number.isFinite(snapshotPrice) && snapshotPrice >= 0) return parseMoney(String(snapshotPrice));

  const cardPrice = Number(card?.price);
  return Number.isFinite(cardPrice) && cardPrice >= 0 ? parseMoney(String(cardPrice)) : 0;
};

const getSelectedOptionPrice = (
  card: WishlistCardSummary | undefined,
  purchaseOptionId: string | null | undefined,
) => {
  if (!purchaseOptionId) return null;
  const option = card?.purchase_options?.find(candidate => candidate.id === purchaseOptionId);
  const optionPrice = Number(option?.price);
  return Number.isFinite(optionPrice) && optionPrice >= 0 ? parseMoney(String(optionPrice)) : null;
};

const getWishlistItemUnitPrice = (
  item: WishlistDraftItem,
  card?: WishlistCardSummary,
) => {
  const snapshotPrice = Number(item.unit_price_snapshot);
  if (Number.isFinite(snapshotPrice) && snapshotPrice >= 0) return parseMoney(String(snapshotPrice));

  const selectedOptionPrice = getSelectedOptionPrice(card, item.purchase_option_id);
  if (selectedOptionPrice != null) return selectedOptionPrice;

  const cardPrice = Number(card?.price);
  return Number.isFinite(cardPrice) && cardPrice >= 0 ? parseMoney(String(cardPrice)) : 0;
};

export function createWishlistItemsDraft(items: WishlistStoredItem[] = []): WishlistDraftItem[] {
  const groups = new Map<string, WishlistDraftItem>();
  for (const item of items) {
    const cardId = trimValue(item.card_id);
    if (!cardId) continue;

    const purchaseOptionId = trimValue(item.purchase_option_id) || null;
    const optionLabel = trimValue(item.option_label_snapshot) || 'Single';
    const unitPrice = getSnapshotPrice(item, item.cards);
    const key = `${cardId}:${purchaseOptionId || 'single'}:${unitPrice.toFixed(2)}:${optionLabel}`;
    const existing = groups.get(key);

    if (existing) {
      existing.quantity = String(parseWishlistQuantity(existing.quantity) + 1);
      continue;
    }

    const titleSnapshot = trimValue(item.card_title_snapshot) || trimValue(item.cards?.title);
    const groupSnapshot = trimValue(item.group_name_snapshot) || trimValue(item.cards?.group_name);
    const albumSnapshot = trimValue(item.album_era_snapshot) || trimValue(item.cards?.album_era);
    const imageSnapshot = trimValue(item.image_url_snapshot) || trimValue(item.cards?.image_url);

    groups.set(key, {
      key,
      card_id: cardId,
      purchase_option_id: purchaseOptionId,
      option_label_snapshot: optionLabel,
      unit_price_snapshot: unitPrice,
      ...(titleSnapshot ? { card_title_snapshot: titleSnapshot } : {}),
      ...(groupSnapshot ? { group_name_snapshot: groupSnapshot } : {}),
      ...(albumSnapshot ? { album_era_snapshot: albumSnapshot } : {}),
      ...(imageSnapshot ? { image_url_snapshot: imageSnapshot } : {}),
      quantity: '1',
    });
  }

  return Array.from(groups.values());
}

export function calculateWishlistTotal(
  items: WishlistDraftItem[],
  cardsById: ReadonlyMap<string, WishlistCardSummary>,
) {
  const total = items.reduce((sum, item) => {
    const card = cardsById.get(item.card_id);
    return sum + getWishlistItemUnitPrice(item, card) * parseWishlistQuantity(item.quantity);
  }, 0);

  return Math.round(total * 100) / 100;
}

export function buildWishlistItemInsertRows(
  wishlistId: string,
  items: WishlistDraftItem[],
  cardsById: ReadonlyMap<string, WishlistCardSummary> = new Map(),
) {
  return items.flatMap(item =>
    Array.from({ length: parseWishlistQuantity(item.quantity) }, () => {
      const card = cardsById.get(item.card_id);
      const unitPrice = getWishlistItemUnitPrice(item, card);
      const titleSnapshot = trimValue(item.card_title_snapshot) || trimValue(card?.title);
      const groupSnapshot = trimValue(item.group_name_snapshot) || trimValue(card?.group_name);
      const albumSnapshot = trimValue(item.album_era_snapshot) || trimValue(card?.album_era);
      const imageSnapshot = trimValue(item.image_url_snapshot) || trimValue(card?.image_url);
      return {
        wishlist_id: wishlistId,
        card_id: item.card_id,
        purchase_option_id: trimValue(item.purchase_option_id) || null,
        option_label_snapshot: trimValue(item.option_label_snapshot) || 'Single',
        unit_price_snapshot: unitPrice,
        ...(titleSnapshot ? { card_title_snapshot: titleSnapshot } : {}),
        ...(groupSnapshot ? { group_name_snapshot: groupSnapshot } : {}),
        ...(albumSnapshot ? { album_era_snapshot: albumSnapshot } : {}),
        ...(imageSnapshot ? { image_url_snapshot: imageSnapshot } : {}),
      };
    }),
  );
}

export function formatAdminError(error: unknown, fallback = 'Unknown error') {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'string') return error || fallback;

  if (error && typeof error === 'object') {
    const record = error as ErrorLikeRecord;
    const parts = [
      record.message,
      record.details,
      record.hint,
      record.code ? `Code: ${record.code}` : '',
    ]
      .map(value => String(value ?? '').trim())
      .filter(Boolean);

    if (parts.length > 0) return parts.join(' ');

    try {
      return JSON.stringify(error);
    } catch {
      return fallback;
    }
  }

  return String(error ?? fallback);
}

export function isMissingColumnError(error: unknown, columnName: string) {
  const message = formatAdminError(error).toLowerCase();
  const column = columnName.toLowerCase();

  return (
    message.includes(column) &&
    (
      message.includes('column') ||
      message.includes('schema cache') ||
      message.includes('pgrst204')
    )
  );
}
