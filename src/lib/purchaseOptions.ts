export type PurchaseOption = {
  id: string;
  card_id: string;
  label: string;
  price: number;
  min_quantity: number;
  max_quantity: number | null;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
};

export type CardWithPurchaseOptions = {
  id: string;
  price: number;
  purchase_options?: PurchaseOption[];
};

const toMoney = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100) / 100;
};

const toQuantity = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
};

const toSortOrder = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.floor(parsed);
};

export function createFallbackPurchaseOption(card: CardWithPurchaseOptions): PurchaseOption {
  return {
    id: `fallback-${card.id}`,
    card_id: card.id,
    label: 'Single',
    price: toMoney(card.price),
    min_quantity: 1,
    max_quantity: null,
    is_default: true,
    is_active: true,
    sort_order: 0,
  };
}

export function normalizePurchaseOption(row: Partial<PurchaseOption>): PurchaseOption {
  const minQuantity = toQuantity(row.min_quantity, 1);
  const maxValue = row.max_quantity == null ? null : toQuantity(row.max_quantity, minQuantity);

  return {
    id: String(row.id ?? ''),
    card_id: String(row.card_id ?? ''),
    label: String(row.label ?? 'Single').trim() || 'Single',
    price: toMoney(row.price),
    min_quantity: minQuantity,
    max_quantity: maxValue,
    is_default: Boolean(row.is_default),
    is_active: row.is_active !== false,
    sort_order: toSortOrder(row.sort_order),
  };
}

export function getActivePurchaseOptions(card: CardWithPurchaseOptions): PurchaseOption[] {
  const options = (card.purchase_options ?? [])
    .filter(option => option.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);

  return options.length > 0 ? options : [createFallbackPurchaseOption(card)];
}

export function getDefaultPurchaseOption(card: CardWithPurchaseOptions): PurchaseOption {
  const options = getActivePurchaseOptions(card);
  return options.find(option => option.is_default) ?? options[0];
}
