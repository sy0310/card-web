import { MAX_RECEIPT_SIZE_BYTES, PNG_SIGNATURE } from '@/lib/receiptConstants';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECEIPT_STORAGE_PATH_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/i;

export function isUuid(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return UUID_REGEX.test(value.trim());
}

export function isValidReceiptStoragePath(path: unknown): boolean {
  if (typeof path !== 'string') return false;
  return RECEIPT_STORAGE_PATH_REGEX.test(path.trim());
}

export type FileHeaderValidationResult =
  | { valid: true }
  | { valid: false; status: number; error: string };

export function validateReceiptFileHeader(file: unknown): FileHeaderValidationResult {
  if (!(file instanceof File)) {
    return { valid: false, status: 400, error: 'A file must be provided.' };
  }

  if (file.type !== 'image/png') {
    return { valid: false, status: 415, error: 'Only PNG images are allowed.' };
  }

  if (file.size <= 0) {
    return { valid: false, status: 400, error: 'Uploaded file is empty.' };
  }

  if (file.size > MAX_RECEIPT_SIZE_BYTES) {
    return { valid: false, status: 413, error: 'File size exceeds maximum limit of 10 MB.' };
  }

  return { valid: true };
}

export function hasPngSignature(buffer: Uint8Array): boolean {
  if (buffer.length < PNG_SIGNATURE.length) {
    return false;
  }

  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (buffer[index] !== PNG_SIGNATURE[index]) {
      return false;
    }
  }

  return true;
}
