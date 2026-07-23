export function toAbsoluteUrl(urlPath: string, origin: string): string {
  const cleanPath = urlPath.trim();
  const cleanOrigin = origin.trim();
  if (!cleanPath) return cleanOrigin;
  return new URL(cleanPath, cleanOrigin).toString();
}

export function canShareFile(file: File): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return false;
  }
  if (typeof navigator.canShare !== 'function') {
    return false;
  }
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: string }).name;
  return name === 'AbortError';
}

export function buildReceiptFilename(userIgHandle: string): string {
  const handle = userIgHandle.trim().replace(/^@/, '').replace(/[^a-zA-Z0-9_-]/g, '') || 'user';
  return `wishlist-${handle}-receipt.png`;
}

export function downloadReceiptBlob(blob: Blob, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = downloadUrl;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(downloadUrl);
  }, 1000);
}
