import { isValidReceiptStoragePath } from '@/app/api/wishlists/receiptApiUtils';

export type DownloadValidationResult =
  | { status: 200 }
  | { status: 404; error: string }
  | { status: 410; error: string };

export function validateReceiptDownloadEligibility(
  wishlist: {
    receipt_storage_path: string | null;
    receipt_expires_at: string | null;
  } | null,
  now: Date = new Date(),
): DownloadValidationResult {
  if (!wishlist || !wishlist.receipt_storage_path) {
    return { status: 404, error: 'Receipt not found.' };
  }

  if (!isValidReceiptStoragePath(wishlist.receipt_storage_path)) {
    return { status: 404, error: 'Invalid receipt storage path.' };
  }

  if (!wishlist.receipt_expires_at) {
    return { status: 404, error: 'Receipt not available.' };
  }

  const expiresAt = new Date(wishlist.receipt_expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
    return { status: 410, error: 'Receipt expired.' };
  }

  return { status: 200 };
}
