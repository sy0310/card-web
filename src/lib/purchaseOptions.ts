import {
  normalizeAvailabilityStatus,
  type AvailabilityStatus,
} from './availability';

export type PurchaseOptionStatus = AvailabilityStatus;

export type PurchaseOption = {
  id: string;
  card_id: string;
  label: string;
  price: number;
  min_quantity: number;
  max_quantity: number | null;
  is_default: boolean;
  // Kept only for reading historical rows. Availability status is the sole
  // customer-facing and purchasing state.
  is_active?: boolean;
  sort_order: number;
  status: PurchaseOptionStatus;
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

export function normalizePurchaseOptionStatus(value: unknown): PurchaseOptionStatus {
  return normalizeAvailabilityStatus(value);
}

export function createFallbackPurchaseOption(card: CardWithPurchaseOptions): PurchaseOption {
  return {
    id: `fallback-${card.id}`,
    card_id: card.id,
    label: 'Single',
    price: toMoney(card.price),
    min_quantity: 1,
    max_quantity: null,
    is_default: true,
    sort_order: 0,
    status: 'available',
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
    sort_order: toSortOrder(row.sort_order),
    // This mirrors the data migration for deployments where a historical row
    // is read before it has been rewritten.
    status: row.is_active === false
      ? 'archived'
      : String(row.status ?? '').trim().toLowerCase() === 'sold_out'
        ? 'pending'
        : normalizePurchaseOptionStatus(row.status),
  };
}

export function getCustomerPurchaseOptions(card: CardWithPurchaseOptions): PurchaseOption[] {
  const storedOptions = card.purchase_options ?? [];
  if (storedOptions.length === 0) return [createFallbackPurchaseOption(card)];

  return storedOptions
    .map(option => normalizePurchaseOption(option))
    .filter(option => option.status !== 'archived')
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function getAvailablePurchaseOptions(card: CardWithPurchaseOptions): PurchaseOption[] {
  return getCustomerPurchaseOptions(card).filter(option => option.status === 'available');
}

export function getDefaultPurchaseOption(card: CardWithPurchaseOptions): PurchaseOption | undefined {
  const options = getCustomerPurchaseOptions(card);
  return options.find(option => option.is_default && option.status === 'available')
    ?? options.find(option => option.status === 'available')
    ?? options[0];
}
