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
      const storagePath = record.receipt_storage_path!;
      if (!isValidReceiptStoragePath(storagePath)) {
        totalFailed += 1;
        continue;
      }

      // 1. Enqueue expired task
      const { error: upsertQueueErr } = await supabaseAdmin
        .from('receipt_file_cleanup_queue')
        .upsert({
          storage_path: storagePath,
          wishlist_id: record.id,
          reason: 'expired_receipt',
          delete_after: nowIso,
          updated_at: nowIso,
        });

      if (upsertQueueErr) {
        console.error(`Could not enqueue expired receipt for ${storagePath}:`, upsertQueueErr);
      }

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
          const { error: delQueueErr } = await supabaseAdmin
            .from('receipt_file_cleanup_queue')
            .delete()
            .eq('storage_path', storagePath);

          if (delQueueErr) {
            console.warn(`Could not delete queue entry for processed expired file ${storagePath}:`, delQueueErr);
          }
        } else {
          totalFailed += 1;
        }
      } else {
        totalFailed += 1;
        // Keep DB path and update queue backoff
        const nextRetry = calculateNextRetryDate(1, now).toISOString();
        const { error: updateRetryErr } = await supabaseAdmin
          .from('receipt_file_cleanup_queue')
          .update({
            attempt_count: 1,
            last_error: storageError?.message || 'Storage removal error',
            delete_after: nextRetry,
            updated_at: nowIso,
          })
          .eq('storage_path', storagePath);

        if (updateRetryErr) {
          console.error(`Could not update queue retry state for ${storagePath}:`, updateRetryErr);
        }
      }
    }

    // --- PART 2: Process Cleanup Queue Due Tasks (delete_after <= now) ---
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
        const path = task.storage_path;

        // Path format validation
        if (!isValidReceiptStoragePath(path)) {
          const nextAttempt = task.attempt_count + 1;
          const nextRetry = calculateNextRetryDate(nextAttempt, now).toISOString();
          const { error: invalidPathErr } = await supabaseAdmin
            .from('receipt_file_cleanup_queue')
            .update({
              attempt_count: nextAttempt,
              last_error: 'Invalid storage path format',
              delete_after: nextRetry,
              updated_at: nowIso,
            })
            .eq('storage_path', path);

          if (invalidPathErr) {
            console.error(`Could not update queue error for invalid path ${path}:`, invalidPathErr);
          }
          totalFailed += 1;
          continue;
        }

        // CRITICAL FAIL-CLOSED PROTECTION: Check if path is currently referenced by ANY Wishlist
        const { data: refWishlist, error: refQueryError } = await supabaseAdmin
          .from('wishlists')
          .select('id')
          .eq('receipt_storage_path', path)
          .maybeSingle();

        if (refQueryError) {
          // DB Reference Query Failed -> FAIL-CLOSED: DO NOT CALL Storage.remove! Schedule backoff retry instead.
          console.error(`Error checking wishlist reference for ${path}:`, refQueryError);
          const nextAttempt = task.attempt_count + 1;
          const nextRetry = calculateNextRetryDate(nextAttempt, now).toISOString();
          const { error: updateRetryErr } = await supabaseAdmin
            .from('receipt_file_cleanup_queue')
            .update({
              attempt_count: nextAttempt,
              last_error: refQueryError.message || 'Wishlist reference query failed',
              delete_after: nextRetry,
              updated_at: nowIso,
            })
            .eq('storage_path', path);

          if (updateRetryErr) {
            console.error(`Could not update retry state on ref query error for ${path}:`, updateRetryErr);
          }
          totalFailed += 1;
          continue; // ABSOLUTELY DO NOT DELETE FILE!
        }

        if (refWishlist) {
          // File is active -> DO NOT DELETE Storage file! Remove queue entry.
          const { error: delQueueErr } = await supabaseAdmin
            .from('receipt_file_cleanup_queue')
            .delete()
            .eq('storage_path', path);

          if (delQueueErr) {
            console.warn(`Could not remove queue task for active referenced file ${path}:`, delQueueErr);
          }
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
          const { error: delQueueErr } = await supabaseAdmin
            .from('receipt_file_cleanup_queue')
            .delete()
            .eq('storage_path', path);

          if (delQueueErr) {
            console.warn(`Could not delete queue entry for removed file ${path}:`, delQueueErr);
          }
          totalDeleted += 1;
        } else {
          // Deletion failed -> increment attempt count and set backoff
          const nextAttempt = task.attempt_count + 1;
          const nextRetry = calculateNextRetryDate(nextAttempt, now).toISOString();
          const { error: updateErr } = await supabaseAdmin
            .from('receipt_file_cleanup_queue')
            .update({
              attempt_count: nextAttempt,
              last_error: removeErr?.message || 'Storage removal failed',
              delete_after: nextRetry,
              updated_at: nowIso,
            })
            .eq('storage_path', path);

          if (updateErr) {
            console.error(`Could not update retry state for ${path}:`, updateErr);
          }
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
