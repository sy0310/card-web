import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/server/supabaseAdmin';
import {
  validateCronAuthHeader,
  filterEligibleExpiredReceipts,
  MAX_CLEANUP_BATCH_SIZE,
} from './cleanupUtils';
import {
  isObjectNotFoundError,
  QueueTaskRecord,
} from './cleanupQueueUtils';
import {
  processExpiredReceipt,
  processCleanupQueueTask,
  ProcessExpiredReceiptDeps,
  ProcessCleanupQueueTaskDeps,
} from './cleanupOrchestration';

export const runtime = 'nodejs';

type WishlistCleanupRow = {
  id: string;
  receipt_storage_path: string | null;
  receipt_expires_at: string | null;
};

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!validateCronAuthHeader(authHeader, process.env.CRON_SECRET)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const now = new Date();
    const nowIso = now.toISOString();

    let totalSelected = 0;
    let storageDeleted = 0;
    let storageAlreadyMissing = 0;
    let queueCompleted = 0;
    let skippedReferenced = 0;
    let totalFailed = 0;

    const expiredDeps: ProcessExpiredReceiptDeps = {
      queueUpsert: async (params) => {
        const { error } = await supabaseAdmin
          .from('receipt_file_cleanup_queue')
          .upsert(
            {
              storage_path: params.storagePath,
              wishlist_id: params.wishlistId,
              reason: params.reason,
              delete_after: params.deleteAfterIso,
              attempt_count: params.attemptCount ?? 0,
              last_error: params.lastError ?? null,
              updated_at: params.nowIso,
            },
            {
              onConflict: 'storage_path',
              ignoreDuplicates: false,
            },
          );
        return error ? { ok: false, error: error.message } : { ok: true };
      },
      clearWishlistStoragePath: async ({ wishlistId, expectedStoragePath, expectedExpiresAt }) => {
        const { data, error } = await supabaseAdmin
          .from('wishlists')
          .update({ receipt_storage_path: null })
          .eq('id', wishlistId)
          .eq('receipt_storage_path', expectedStoragePath)
          .eq('receipt_expires_at', expectedExpiresAt)
          .select('id');

        if (error) {
          return { ok: false, error: error.message };
        }
        if (!data || data.length === 0) {
          return { ok: false, error: 'OCC update matched 0 rows' };
        }
        return { ok: true };
      },
      removeStorageFile: async (storagePath) => {
        const { data: removedFiles, error } = await supabaseAdmin.storage
          .from('wishlist-receipts')
          .remove([storagePath]);

        const isNotFound = error && isObjectNotFoundError(error);
        const isRemoved = (removedFiles ?? []).some(f => f.name === storagePath);

        if (!error || isNotFound || isRemoved) {
          return {
            ok: true,
            state: isNotFound ? 'already_missing' : 'deleted',
          };
        }
        return { ok: false, error: error?.message || 'Storage removal error' };
      },
      queueDelete: async (storagePath) => {
        const { error } = await supabaseAdmin
          .from('receipt_file_cleanup_queue')
          .delete()
          .eq('storage_path', storagePath);
        return error ? { ok: false, error: error.message } : { ok: true };
      },
      queueEnsureRetry: async (params) => {
        const { error } = await supabaseAdmin
          .from('receipt_file_cleanup_queue')
          .upsert(
            {
              storage_path: params.storagePath,
              wishlist_id: params.wishlistId,
              reason: params.reason,
              attempt_count: params.attemptCount,
              last_error: params.errorMessage,
              delete_after: params.deleteAfterIso,
              updated_at: params.nowIso,
            },
            {
              onConflict: 'storage_path',
              ignoreDuplicates: false,
            },
          );
        return error ? { ok: false, error: error.message } : { ok: true };
      },
    };

    const queueDeps: ProcessCleanupQueueTaskDeps = {
      findWishlistReference: async (storagePath) => {
        const { data, error } = await supabaseAdmin
          .from('wishlists')
          .select('id')
          .eq('receipt_storage_path', storagePath)
          .limit(1)
          .maybeSingle();

        if (error) {
          return { ok: false, error: error.message };
        }
        return { ok: true, isReferenced: !!data };
      },
      removeStorageFile: expiredDeps.removeStorageFile,
      queueDelete: expiredDeps.queueDelete,
      queueEnsureRetry: expiredDeps.queueEnsureRetry,
    };

    // --- PART 1: Process Expired Receipt Records ---
    const { data: rawExpiredRecords, error: expiredQueryError } = await supabaseAdmin
      .from('wishlists')
      .select('id, receipt_storage_path, receipt_expires_at')
      .not('receipt_storage_path', 'is', null)
      .lt('receipt_expires_at', nowIso)
      .limit(MAX_CLEANUP_BATCH_SIZE);

    if (expiredQueryError) {
      console.error('Database query error fetching expired wishlists:', expiredQueryError);
      return NextResponse.json({ error: 'Database query failed.' }, { status: 500 });
    }

    const eligibleExpired = filterEligibleExpiredReceipts((rawExpiredRecords ?? []) as WishlistCleanupRow[], now);
    totalSelected += eligibleExpired.length;

    for (const record of eligibleExpired) {
      const res = await processExpiredReceipt(
        {
          id: record.id,
          receipt_storage_path: record.receipt_storage_path!,
          receipt_expires_at: record.receipt_expires_at!,
        },
        now,
        expiredDeps,
      );

      if (res.storageDeleted) storageDeleted += 1;
      if (res.storageAlreadyMissing) storageAlreadyMissing += 1;
      if (res.queueCompleted) queueCompleted += 1;
      if (res.failed) totalFailed += 1;
    }

    // --- PART 2: Process Cleanup Queue Due Tasks (delete_after <= now) ---
    // Newly registered expired-receipt fallback tasks use a future delete_after (now + 1h), so they cannot be selected again during this run.
    const remainingBatchSize = Math.max(0, MAX_CLEANUP_BATCH_SIZE - totalSelected);
    if (remainingBatchSize > 0) {
      const { data: queueTasks, error: queueQueryError } = await supabaseAdmin
        .from('receipt_file_cleanup_queue')
        .select('storage_path, wishlist_id, reason, delete_after, attempt_count, last_error')
        .lte('delete_after', nowIso)
        .limit(remainingBatchSize);

      if (queueQueryError) {
        console.error('Database query error fetching cleanup queue tasks:', queueQueryError);
        return NextResponse.json({ error: 'Database query failed.' }, { status: 500 });
      }

      const tasks = (queueTasks ?? []) as QueueTaskRecord[];
      totalSelected += tasks.length;

      for (const task of tasks) {
        const res = await processCleanupQueueTask(task, now, queueDeps);

        if (res.storageDeleted) storageDeleted += 1;
        if (res.storageAlreadyMissing) storageAlreadyMissing += 1;
        if (res.queueCompleted) queueCompleted += 1;
        if (res.skippedReferenced) skippedReferenced += 1;
        if (res.failed) totalFailed += 1;
      }
    }

    return NextResponse.json({
      success: true,
      selected: totalSelected,
      storage_deleted: storageDeleted,
      storage_already_missing: storageAlreadyMissing,
      queue_completed: queueCompleted,
      skipped_referenced: skippedReferenced,
      failed: totalFailed,
      // "deleted" represents files that reached a non-existent state in Storage (either physically deleted or already missing)
      deleted: storageDeleted + storageAlreadyMissing,
    });
  } catch (error: unknown) {
    console.error('Unexpected error during receipt cleanup cron:', error);
    return NextResponse.json({ error: 'Internal server error during cleanup.' }, { status: 500 });
  }
}
