import { isValidReceiptStoragePath } from '@/app/api/wishlists/receiptApiUtils';

export type ReceiptPageState = 'available' | 'expired' | 'unavailable' | 'inconsistent';

export function getReceiptPageState(params: {
  storagePath: string | null;
  expiresAt: string | null;
  now?: Date;
}): ReceiptPageState {
  const { storagePath, expiresAt, now = new Date() } = params;

  // 1. Expired state check: If receipt_expires_at has passed, it's expired regardless of storage path
  if (expiresAt !== null && typeof expiresAt === 'string') {
    const expiresDate = new Date(expiresAt);
    if (!Number.isNaN(expiresDate.getTime()) && expiresDate.getTime() <= now.getTime()) {
      return 'expired';
    }
  }

  // 2. Never generated receipt (both storage path and expiration date are null)
  if (!storagePath && !expiresAt) {
    return 'unavailable';
  }

  // 3. Inconsistent state: Storage path is null, but expiration date is in the future
  if (!storagePath && expiresAt !== null && typeof expiresAt === 'string') {
    const expiresDate = new Date(expiresAt);
    if (!Number.isNaN(expiresDate.getTime()) && expiresDate.getTime() > now.getTime()) {
      return 'inconsistent';
    }
  }

  // 4. Invalid storage path pattern
  if (storagePath && !isValidReceiptStoragePath(storagePath)) {
    return 'unavailable';
  }

  // 5. Valid available receipt
  if (storagePath && expiresAt !== null && typeof expiresAt === 'string') {
    const expiresDate = new Date(expiresAt);
    if (!Number.isNaN(expiresDate.getTime()) && expiresDate.getTime() > now.getTime()) {
      return 'available';
    }
  }

  return 'unavailable';
}
