import { isValidReceiptStoragePath } from '@/app/api/wishlists/receiptApiUtils';
import {
  calculateNextRetryDate,
  getInitialCleanupDeleteAfter,
  QueueTaskRecord,
  ReceiptQueueReason,
} from './cleanupQueueUtils';

export type OperationResult =
  | { ok: true }
  | { ok: false; error: string };

export type StorageRemovalResult =
  | { ok: true; state: 'deleted' | 'already_missing' }
  | { ok: false; error: string };

export type WishlistExpiredRecord = {
  id: string;
  receipt_storage_path: string;
  receipt_expires_at: string;
};

export type QueueUpsertParams = {
  storagePath: string;
  wishlistId: string | null;
  reason: ReceiptQueueReason;
  deleteAfterIso: string;
  nowIso: string;
  attemptCount?: number;
  lastError?: string | null;
};

export type QueueEnsureRetryParams = {
  storagePath: string;
  wishlistId: string | null;
  reason: ReceiptQueueReason;
  attemptCount: number;
  errorMessage: string;
  deleteAfterIso: string;
  nowIso: string;
};

export type ProcessExpiredReceiptDeps = {
  queueUpsert: (params: QueueUpsertParams) => Promise<OperationResult>;
  clearWishlistStoragePath: (params: {
    wishlistId: string;
    expectedStoragePath: string;
    expectedExpiresAt: string;
  }) => Promise<OperationResult>;
  removeStorageFile: (storagePath: string) => Promise<StorageRemovalResult>;
  queueDelete: (storagePath: string) => Promise<OperationResult>;
  queueEnsureRetry: (params: QueueEnsureRetryParams) => Promise<OperationResult>;
};

export type ProcessCleanupQueueTaskDeps = {
  findWishlistReference: (
    storagePath: string,
  ) => Promise<{ ok: true; isReferenced: boolean } | { ok: false; error: string }>;
  removeStorageFile: (storagePath: string) => Promise<StorageRemovalResult>;
  queueDelete: (storagePath: string) => Promise<OperationResult>;
  queueEnsureRetry: (params: QueueEnsureRetryParams) => Promise<OperationResult>;
};

export type ProcessExpiredResult = {
  storageDeleted: boolean;
  storageAlreadyMissing: boolean;
  queueCompleted: boolean;
  failed: boolean;
};

export type ProcessQueueTaskResult = {
  storageDeleted: boolean;
  storageAlreadyMissing: boolean;
  queueCompleted: boolean;
  skippedReferenced: boolean;
  failed: boolean;
};

/**
 * Processes a single expired wishlist receipt record.
 * Order: 1. queueUpsert (fallback +1h) -> 2. clearWishlistStoragePath -> 3. removeStorageFile -> 4. queueDelete (or queueEnsureRetry)
 */
export async function processExpiredReceipt(
  record: WishlistExpiredRecord,
  now: Date,
  deps: ProcessExpiredReceiptDeps,
): Promise<ProcessExpiredResult> {
  const storagePath = record.receipt_storage_path;
  if (!isValidReceiptStoragePath(storagePath)) {
    return { storageDeleted: false, storageAlreadyMissing: false, queueCompleted: false, failed: true };
  }

  const nowIso = now.toISOString();
  const initialDeleteAfterIso = getInitialCleanupDeleteAfter(now).toISOString();

  // Step 1: Enqueue expired task with +1h fallback delay
  const queueResult = await deps.queueUpsert({
    storagePath,
    wishlistId: record.id,
    reason: 'expired_receipt',
    deleteAfterIso: initialDeleteAfterIso,
    nowIso,
    attemptCount: 0,
    lastError: null,
  });

  if (!queueResult.ok) {
    console.error(`Could not enqueue expired receipt for ${storagePath}:`, queueResult.error);
    // CRITICAL FAIL-CLOSED: Queue insertion failed! MUST NOT clear wishlist storage path or remove storage file.
    return { storageDeleted: false, storageAlreadyMissing: false, queueCompleted: false, failed: true };
  }

  // Step 2: Clear wishlist storage path (with OCC conditions) BEFORE deleting Storage
  const clearResult = await deps.clearWishlistStoragePath({
    wishlistId: record.id,
    expectedStoragePath: storagePath,
    expectedExpiresAt: record.receipt_expires_at,
  });

  if (!clearResult.ok) {
    console.error(`Could not clear wishlist receipt_storage_path for ${record.id}:`, clearResult.error);
    // CRITICAL FAIL-CLOSED: Wishlist path was not unlinked! MUST NOT remove storage file.
    return { storageDeleted: false, storageAlreadyMissing: false, queueCompleted: false, failed: true };
  }

  // Step 3: Remove file from Storage (now that DB no longer references it)
  const removeResult = await deps.removeStorageFile(storagePath);

  if (!removeResult.ok) {
    console.error(`Storage removal failed for ${storagePath}:`, removeResult.error);
    // DB path is already cleared, but Storage file removal failed. Ensure retry task exists in queue via upsert.
    const nextRetryIso = calculateNextRetryDate(1, now).toISOString();
    const retryResult = await deps.queueEnsureRetry({
      storagePath,
      wishlistId: record.id,
      reason: 'expired_receipt',
      attemptCount: 1,
      errorMessage: removeResult.error,
      deleteAfterIso: nextRetryIso,
      nowIso,
    });

    if (!retryResult.ok) {
      console.error(`CRITICAL: Could not persist receipt cleanup retry task for ${storagePath}:`, retryResult.error);
    }
    return { storageDeleted: false, storageAlreadyMissing: false, queueCompleted: false, failed: true };
  }

  // Step 4: Delete queue task
  const queueDeleteResult = await deps.queueDelete(storagePath);
  if (!queueDeleteResult.ok) {
    console.warn(`Could not delete queue entry for processed expired file ${storagePath}:`, queueDeleteResult.error);
    return {
      storageDeleted: removeResult.state === 'deleted',
      storageAlreadyMissing: removeResult.state === 'already_missing',
      queueCompleted: false,
      failed: true,
    };
  }

  return {
    storageDeleted: removeResult.state === 'deleted',
    storageAlreadyMissing: removeResult.state === 'already_missing',
    queueCompleted: true,
    failed: false,
  };
}

/**
 * Processes a single cleanup queue task.
 * Path format validation -> Ref query (limit 1) -> If active: queueDelete -> If unreferenced: removeStorageFile -> queueDelete
 * Retry uses queueEnsureRetry to preserve task metadata (wishlist_id & reason).
 */
export async function processCleanupQueueTask(
  task: QueueTaskRecord,
  now: Date,
  deps: ProcessCleanupQueueTaskDeps,
): Promise<ProcessQueueTaskResult> {
  const path = task.storage_path;
  const nowIso = now.toISOString();

  // Path format validation
  if (!isValidReceiptStoragePath(path)) {
    const nextAttempt = task.attempt_count + 1;
    const nextRetryIso = calculateNextRetryDate(nextAttempt, now).toISOString();
    const retryResult = await deps.queueEnsureRetry({
      storagePath: path,
      wishlistId: task.wishlist_id,
      reason: task.reason,
      attemptCount: nextAttempt,
      errorMessage: 'Invalid storage path format',
      deleteAfterIso: nextRetryIso,
      nowIso,
    });
    if (!retryResult.ok) {
      console.error(`Could not ensure retry queue error for invalid path ${path}:`, retryResult.error);
    }
    return { storageDeleted: false, storageAlreadyMissing: false, queueCompleted: false, skippedReferenced: false, failed: true };
  }

  // CRITICAL FAIL-CLOSED PROTECTION: Check if path is currently referenced by ANY Wishlist
  const refResult = await deps.findWishlistReference(path);

  if (!refResult.ok) {
    console.error(`Error checking wishlist reference for ${path}:`, refResult.error);
    const nextAttempt = task.attempt_count + 1;
    const nextRetryIso = calculateNextRetryDate(nextAttempt, now).toISOString();
    const retryResult = await deps.queueEnsureRetry({
      storagePath: path,
      wishlistId: task.wishlist_id,
      reason: task.reason,
      attemptCount: nextAttempt,
      errorMessage: refResult.error,
      deleteAfterIso: nextRetryIso,
      nowIso,
    });
    if (!retryResult.ok) {
      console.error(`Could not ensure retry state on ref query error for ${path}:`, retryResult.error);
    }
    return { storageDeleted: false, storageAlreadyMissing: false, queueCompleted: false, skippedReferenced: false, failed: true };
  }

  if (refResult.isReferenced) {
    // File is active -> DO NOT DELETE Storage file! Remove queue entry.
    const queueDeleteResult = await deps.queueDelete(path);
    if (!queueDeleteResult.ok) {
      console.warn(`Could not remove queue task for active referenced file ${path}:`, queueDeleteResult.error);
      return { storageDeleted: false, storageAlreadyMissing: false, queueCompleted: false, skippedReferenced: true, failed: true };
    }
    return { storageDeleted: false, storageAlreadyMissing: false, queueCompleted: true, skippedReferenced: true, failed: false };
  }

  // File is unreferenced (orphaned) -> Attempt physical deletion
  const removeResult = await deps.removeStorageFile(path);

  if (!removeResult.ok) {
    const nextAttempt = task.attempt_count + 1;
    const nextRetryIso = calculateNextRetryDate(nextAttempt, now).toISOString();
    const retryResult = await deps.queueEnsureRetry({
      storagePath: path,
      wishlistId: task.wishlist_id,
      reason: task.reason,
      attemptCount: nextAttempt,
      errorMessage: removeResult.error,
      deleteAfterIso: nextRetryIso,
      nowIso,
    });
    if (!retryResult.ok) {
      console.error(`Could not ensure retry state for ${path}:`, retryResult.error);
    }
    return { storageDeleted: false, storageAlreadyMissing: false, queueCompleted: false, skippedReferenced: false, failed: true };
  }

  // Deletion succeeded or file is already gone -> remove queue entry
  const queueDeleteResult = await deps.queueDelete(path);
  if (!queueDeleteResult.ok) {
    console.warn(`Could not delete queue entry for removed file ${path}:`, queueDeleteResult.error);
    return {
      storageDeleted: removeResult.state === 'deleted',
      storageAlreadyMissing: removeResult.state === 'already_missing',
      queueCompleted: false,
      skippedReferenced: false,
      failed: true,
    };
  }

  return {
    storageDeleted: removeResult.state === 'deleted',
    storageAlreadyMissing: removeResult.state === 'already_missing',
    queueCompleted: true,
    skippedReferenced: false,
    failed: false,
  };
}
