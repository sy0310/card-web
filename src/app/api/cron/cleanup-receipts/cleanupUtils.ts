export const MAX_CLEANUP_BATCH_SIZE = 100;

export function validateCronAuthHeader(
  authorizationHeader: string | null | undefined,
  cronSecret: string | undefined,
): boolean {
  const secret = cronSecret?.trim();
  if (!secret) return false;
  if (!authorizationHeader) return false;
  return authorizationHeader.trim() === `Bearer ${secret}`;
}

export type ReceiptCleanupRecord = {
  id: string;
  receipt_storage_path: string | null;
  receipt_expires_at: string | null;
};

export function filterEligibleExpiredReceipts<T extends ReceiptCleanupRecord>(
  records: T[],
  now: Date = new Date(),
): T[] {
  if (!Array.isArray(records)) return [];

  return records.filter(record => {
    if (!record.receipt_storage_path || typeof record.receipt_storage_path !== 'string') {
      return false;
    }
    if (!record.receipt_expires_at || typeof record.receipt_expires_at !== 'string') {
      return false;
    }
    const expiresDate = new Date(record.receipt_expires_at);
    if (Number.isNaN(expiresDate.getTime())) {
      return false;
    }
    return expiresDate.getTime() < now.getTime();
  });
}
