import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/server/supabaseAdmin';
import {
  isUuid,
  validateReceiptFileHeader,
  hasPngSignature,
} from '../../receiptApiUtils';

export const runtime = 'nodejs';

type UploadReceiptContext = {
  params: Promise<{
    wishlistId: string;
  }>;
};

export async function POST(request: Request, context: UploadReceiptContext) {
  try {
    const { wishlistId } = await context.params;
    if (!isUuid(wishlistId)) {
      return NextResponse.json({ error: 'Invalid wishlist ID.' }, { status: 400 });
    }

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ error: 'Invalid form data.' }, { status: 400 });
    }

    const file = formData.get('file');
    const checkoutRequestId = String(formData.get('checkout_request_id') ?? '').trim();

    if (!isUuid(checkoutRequestId)) {
      return NextResponse.json({ error: 'Invalid checkout request ID.' }, { status: 400 });
    }

    // First-layer validation: File instance, content type header, non-zero size, size <= 10MB
    const headerCheck = validateReceiptFileHeader(file);
    if (!headerCheck.valid) {
      return NextResponse.json({ error: headerCheck.error }, { status: headerCheck.status });
    }

    const validFile = file as File;

    // Database verification: Read existing record state before upload
    const supabaseAdmin = createSupabaseAdminClient();
    const { data: wishlist, error: queryError } = await supabaseAdmin
      .from('wishlists')
      .select('id, checkout_request_id, receipt_token, receipt_storage_path, receipt_expires_at')
      .eq('id', wishlistId)
      .maybeSingle();

    if (queryError) {
      console.error('Database query error when checking wishlist:', queryError);
      return NextResponse.json({ error: 'Failed to verify wishlist.' }, { status: 500 });
    }

    if (!wishlist) {
      return NextResponse.json({ error: 'Wishlist not found.' }, { status: 404 });
    }

    if (wishlist.checkout_request_id !== checkoutRequestId) {
      return NextResponse.json({ error: 'Unauthorized receipt upload request.' }, { status: 403 });
    }

    // Capture previous state for optimistic concurrency control
    const previousStoragePath = wishlist.receipt_storage_path;
    const previousExpiresAt = wishlist.receipt_expires_at;

    // Read bytes into memory after size and authorization checks
    const arrayBuffer = await validFile.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Second-layer validation: Validate PNG 8-byte magic header signature
    if (!hasPngSignature(bytes)) {
      return NextResponse.json({ error: 'The uploaded file is not a valid PNG image.' }, { status: 415 });
    }

    // Generate unique random file ID for versioned storage path ({wishlistId}/{receiptFileId}.png)
    const receiptFileId = crypto.randomUUID();
    const newStoragePath = `${wishlistId}/${receiptFileId}.png`;
    const fileBody = Buffer.from(arrayBuffer);
    const initialDeleteAfter = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour buffer

    // 1. Pre-register uncommitted upload task in cleanup queue before physical Storage upload
    try {
      await supabaseAdmin
        .from('receipt_file_cleanup_queue')
        .upsert({
          storage_path: newStoragePath,
          wishlist_id: wishlistId,
          reason: 'uncommitted_upload',
          delete_after: initialDeleteAfter,
          attempt_count: 0,
          last_error: null,
          updated_at: new Date().toISOString(),
        });
    } catch (err: unknown) {
      console.warn('Could not pre-register cleanup queue task:', err);
    }

    // 2. Upload new file to Storage (upsert: false because path is unique)
    const { error: uploadError } = await supabaseAdmin.storage
      .from('wishlist-receipts')
      .upload(newStoragePath, fileBody, {
        contentType: 'image/png',
        upsert: false,
      });

    if (uploadError) {
      console.error('Supabase Storage upload error:', uploadError);
      // Remove queue task if upload itself failed
      void supabaseAdmin
        .from('receipt_file_cleanup_queue')
        .delete()
        .eq('storage_path', newStoragePath);
      return NextResponse.json({ error: 'Could not upload receipt image to storage.' }, { status: 500 });
    }

    // 3. Register previous path in cleanup queue if replacing an old receipt
    if (previousStoragePath && previousStoragePath !== newStoragePath) {
      void supabaseAdmin
        .from('receipt_file_cleanup_queue')
        .upsert({
          storage_path: previousStoragePath,
          wishlist_id: wishlistId,
          reason: 'replaced_receipt',
          delete_after: initialDeleteAfter,
          updated_at: new Date().toISOString(),
        });
    }

    // Calculate 30-day expiration date
    const generatedAt = new Date();
    const expiresAt = new Date(generatedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

    // 4. Optimistic Concurrency Control DB Update
    let updateQuery = supabaseAdmin
      .from('wishlists')
      .update({
        receipt_storage_path: newStoragePath,
        receipt_generated_at: generatedAt.toISOString(),
        receipt_expires_at: expiresAt.toISOString(),
      })
      .eq('id', wishlistId)
      .eq('checkout_request_id', checkoutRequestId);

    if (previousStoragePath !== null && previousStoragePath !== undefined) {
      updateQuery = updateQuery.eq('receipt_storage_path', previousStoragePath);
    } else {
      updateQuery = updateQuery.is('receipt_storage_path', null);
    }

    if (previousExpiresAt !== null && previousExpiresAt !== undefined) {
      updateQuery = updateQuery.eq('receipt_expires_at', previousExpiresAt);
    } else {
      updateQuery = updateQuery.is('receipt_expires_at', null);
    }

    const { data: updatedWishlist, error: updateError } = await updateQuery
      .select('receipt_token')
      .maybeSingle();

    // 5. Compensation Rollback & Queue Update: If DB update failed/conflicted
    if (updateError || !updatedWishlist?.receipt_token) {
      console.warn('Optimistic concurrency update failed. Rolling back uploaded file:', newStoragePath);

      // Clean up previous storage path queue registration since old path is still current
      if (previousStoragePath) {
        void supabaseAdmin
          .from('receipt_file_cleanup_queue')
          .delete()
          .eq('storage_path', previousStoragePath);
      }

      // Try physical compensation removal
      const { error: removeError } = await supabaseAdmin.storage
        .from('wishlist-receipts')
        .remove([newStoragePath]);

      if (!removeError) {
        // Remove queue entry if compensation succeeded
        void supabaseAdmin
          .from('receipt_file_cleanup_queue')
          .delete()
          .eq('storage_path', newStoragePath);
      } else {
        // Mark as compensation_failed for immediate Cron retry if physical removal failed
        void supabaseAdmin
          .from('receipt_file_cleanup_queue')
          .update({
            reason: 'compensation_failed',
            delete_after: new Date().toISOString(),
            last_error: removeError.message || 'Compensation removal failed',
            updated_at: new Date().toISOString(),
          })
          .eq('storage_path', newStoragePath);
      }

      return NextResponse.json(
        { error: 'Concurrent upload detected. Please try again.' },
        { status: 409 },
      );
    }

    // 6. DB update succeeded: Unbind newStoragePath from cleanup queue
    void supabaseAdmin
      .from('receipt_file_cleanup_queue')
      .delete()
      .eq('storage_path', newStoragePath);

    // 7. Cleanup previous file after DB successfully points to newStoragePath
    if (previousStoragePath && previousStoragePath !== newStoragePath) {
      void supabaseAdmin.storage
        .from('wishlist-receipts')
        .remove([previousStoragePath])
        .then(({ error: oldRemoveError }) => {
          if (!oldRemoveError) {
            void supabaseAdmin
              .from('receipt_file_cleanup_queue')
              .delete()
              .eq('storage_path', previousStoragePath);
          } else {
            console.warn(`Could not remove old receipt file ${previousStoragePath}, queue will retry:`, oldRemoveError);
          }
        });
    }

    return NextResponse.json({
      success: true,
      receipt_url: `/receipt/${updatedWishlist.receipt_token}`,
    });
  } catch (error: unknown) {
    console.error('Unexpected error in receipt upload API:', error);
    return NextResponse.json({ error: 'Internal server error processing receipt.' }, { status: 500 });
  }
}
