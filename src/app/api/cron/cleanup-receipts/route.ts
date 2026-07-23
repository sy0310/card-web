import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/server/supabaseAdmin';
import { isValidReceiptStoragePath } from '@/app/api/wishlists/receiptApiUtils';
import {
  validateCronAuthHeader,
  filterEligibleExpiredReceipts,
  MAX_CLEANUP_BATCH_SIZE,
} from './cleanupUtils';
import {
  calculateNextRetryDate,
  isObjectNotFoundError,
  QueueTaskRecord,
} from './cleanupQueueUtils';

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
    let totalDeleted = 0;
    let totalFailed = 0;

    // --- PART 1: Process Expired Receipt Records ---
    const { data: rawExpiredRecords } = await supabaseAdmin
      .from('wishlists')
      .select('id, receipt_storage_path, receipt_expires_at')
      .not('receipt_storage_path', 'is', null)
      .lt('receipt_expires_at', nowIso)
      .limit(MAX_CLEANUP_BATCH_SIZE);

    const eligibleExpired = filterEligibleExpiredReceipts((rawExpiredRecords ?? []) as WishlistCleanupRow[], now);
    totalSelected += eligibleExpired.length;

    for (const record of eligibleExpired) {
      const storagePath = record.receipt_storage_path!;
      if (!isValidReceiptStoragePath(storagePath)) {
        totalFailed += 1;
        continue;
      }

      // 1. Enqueue expired task
      await supabaseAdmin
        .from('receipt_file_cleanup_queue')
        .upsert({
          storage_path: storagePath,
          wishlist_id: record.id,
          reason: 'expired_receipt',
          delete_after: nowIso,
          updated_at: nowIso,
        });

      // 2. Attempt physical deletion from Storage
      const { data: removedFiles, error: storageError } = await supabaseAdmin.storage
        .from('wishlist-receipts')
        .remove([storagePath]);

      const isNotFound = storageError && isObjectNotFoundError(storageError);
      const isRemoved = (removedFiles ?? []).some(f => f.name === storagePath);

      if (!storageError || isNotFound || isRemoved) {
        // Physical removal succeeded or file was already missing
        // ONLY clear receipt_storage_path; Strictly PRESERVE receipt_expires_at
        const { error: dbUpdateError } = await supabaseAdmin
          .from('wishlists')
          .update({ receipt_storage_path: null })
          .eq('id', record.id)
          .eq('receipt_storage_path', storagePath)
          .eq('receipt_expires_at', record.receipt_expires_at!);

        if (!dbUpdateError) {
          totalDeleted += 1;
          // Delete queue entry after successful processing
          void supabaseAdmin
            .from('receipt_file_cleanup_queue')
            .delete()
            .eq('storage_path', storagePath);
        } else {
          totalFailed += 1;
        }
      } else {
        totalFailed += 1;
        // Keep DB path and update queue backoff
        const nextRetry = calculateNextRetryDate(1, now).toISOString();
        void supabaseAdmin
          .from('receipt_file_cleanup_queue')
          .update({
            attempt_count: 1,
            last_error: storageError?.message || 'Storage removal error',
            delete_after: nextRetry,
            updated_at: nowIso,
          })
          .eq('storage_path', storagePath);
      }
    }

    // --- PART 2: Process Cleanup Queue Due Tasks (delete_after <= now) ---
    const remainingBatchSize = Math.max(0, MAX_CLEANUP_BATCH_SIZE - totalSelected);
    if (remainingBatchSize > 0) {
      const { data: queueTasks } = await supabaseAdmin
        .from('receipt_file_cleanup_queue')
        .select('storage_path, wishlist_id, reason, delete_after, attempt_count, last_error')
        .lte('delete_after', nowIso)
        .limit(remainingBatchSize);

      const tasks = (queueTasks ?? []) as QueueTaskRecord[];
      totalSelected += tasks.length;

      for (const task of tasks) {
        const path = task.storage_path;

        // Path format validation
        if (!isValidReceiptStoragePath(path)) {
          const nextAttempt = task.attempt_count + 1;
          const nextRetry = calculateNextRetryDate(nextAttempt, now).toISOString();
          await supabaseAdmin
            .from('receipt_file_cleanup_queue')
            .update({
              attempt_count: nextAttempt,
              last_error: 'Invalid storage path format',
              delete_after: nextRetry,
              updated_at: nowIso,
            })
            .eq('storage_path', path);
          totalFailed += 1;
          continue;
        }

        // CRITICAL PROTECTION: Check if path is currently referenced by ANY Wishlist
        const { data: refWishlist } = await supabaseAdmin
          .from('wishlists')
          .select('id')
          .eq('receipt_storage_path', path)
          .maybeSingle();

        if (refWishlist) {
          // File is currently active and referenced -> NEVER delete physical file! Remove queue entry.
          await supabaseAdmin
            .from('receipt_file_cleanup_queue')
            .delete()
            .eq('storage_path', path);
          totalDeleted += 1;
          continue;
        }

        // File is unreferenced (orphaned) -> Attempt physical deletion
        const { data: removedFiles, error: removeErr } = await supabaseAdmin.storage
          .from('wishlist-receipts')
          .remove([path]);

        const isNotFound = removeErr && isObjectNotFoundError(removeErr);
        const isRemoved = (removedFiles ?? []).some(f => f.name === path);

        if (!removeErr || isNotFound || isRemoved) {
          // Deletion succeeded or file is already gone -> remove queue entry
          await supabaseAdmin
            .from('receipt_file_cleanup_queue')
            .delete()
            .eq('storage_path', path);
          totalDeleted += 1;
        } else {
          // Deletion failed -> increment attempt count and set backoff
          const nextAttempt = task.attempt_count + 1;
          const nextRetry = calculateNextRetryDate(nextAttempt, now).toISOString();
          await supabaseAdmin
            .from('receipt_file_cleanup_queue')
            .update({
              attempt_count: nextAttempt,
              last_error: removeErr?.message || 'Storage removal failed',
              delete_after: nextRetry,
              updated_at: nowIso,
            })
            .eq('storage_path', path);
          totalFailed += 1;
        }
      }
    }

    return NextResponse.json({
      success: true,
      selected: totalSelected,
      deleted: totalDeleted,
      failed: totalFailed,
    });
  } catch (error: unknown) {
    console.error('Unexpected error during receipt cleanup cron:', error);
    return NextResponse.json({ error: 'Internal server error during cleanup.' }, { status: 500 });
  }
}
