export type ReceiptQueueReason =
  | 'uncommitted_upload'
  | 'replaced_receipt'
  | 'compensation_failed'
  | 'expired_receipt';

export type QueueTaskRecord = {
  storage_path: string;
  wishlist_id: string | null;
  reason: ReceiptQueueReason;
  delete_after: string;
  attempt_count: number;
  last_error: string | null;
};

export const INITIAL_RECEIPT_CLEANUP_DELAY_MS = 60 * 60 * 1000;

export function getInitialCleanupDeleteAfter(now: Date = new Date()): Date {
  return new Date(now.getTime() + INITIAL_RECEIPT_CLEANUP_DELAY_MS);
}

export function calculateNextRetryDate(attemptCount: number, now: Date = new Date()): Date {
  const currentMs = now.getTime();
  let delayMs: number;

  if (attemptCount <= 1) {
    delayMs = 60 * 60 * 1000; // 1 hour
  } else if (attemptCount === 2) {
    delayMs = 6 * 60 * 60 * 1000; // 6 hours
  } else {
    delayMs = 24 * 60 * 60 * 1000; // 24 hours
  }

  return new Date(currentMs + delayMs);
}

export function isObjectNotFoundError(error: unknown): boolean {
  if (!error) return false;
  const message = typeof error === 'string'
    ? error
    : (error as { message?: string; error?: string }).message || (error as { error?: string }).error || '';
  return /not_found|object not found|404/i.test(message);
}
