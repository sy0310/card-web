export const STOREFRONT_PAGE_SIZE = 40;

export function normalizeStorefrontSearch(value: string) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function getStorefrontSearchTerms(value: string) {
  return normalizeStorefrontSearch(value).match(/[\p{L}\p{N}&-]+/gu) ?? [];
}

export function buildStorefrontSearchFilter(terms: string[]) {
  const safeTerms = terms.filter(term => /^[\p{L}\p{N}&-]+$/u.test(term));
  const termClauses = safeTerms.map(
    term => `or(title.ilike.*${term}*,group_name.ilike.*${term}*)`,
  );

  if (termClauses.length === 0) return '';
  if (termClauses.length === 1) return termClauses[0];

  return `and(${termClauses.join(',')})`;
}

export function createStorefrontRequestTracker() {
  let currentRequestId = 0;

  return {
    begin() {
      currentRequestId += 1;
      return currentRequestId;
    },
    isCurrent(requestId: number) {
      return currentRequestId === requestId;
    },
  };
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
