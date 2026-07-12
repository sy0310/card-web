export const STOREFRONT_PAGE_SIZE = 40;

export function normalizeStorefrontSearch(value: string) {
  return String(value ?? '').replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function getStorefrontPageRange(offset: number, pageSize = STOREFRONT_PAGE_SIZE): [number, number] {
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
  const safePageSize = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : STOREFRONT_PAGE_SIZE;

  return [safeOffset, safeOffset + safePageSize - 1];
}

export function hasNextStorefrontPage(itemCount: number, pageSize = STOREFRONT_PAGE_SIZE) {
  return itemCount === pageSize;
}

export function mergeStorefrontPage<T extends { id: string }>(current: T[], next: T[]): T[] {
  const nextById = new Map(next.map(item => [item.id, item]));
  const currentIds = new Set(current.map(item => item.id));

  return [
    ...current.map(item => nextById.get(item.id) ?? item),
    ...next.filter(item => !currentIds.has(item.id)),
  ];
}
