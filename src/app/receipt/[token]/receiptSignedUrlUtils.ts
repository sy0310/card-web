export function getReceiptSignedUrlTtlSeconds(
  expiresAt: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!expiresAt || typeof expiresAt !== 'string') {
    return null;
  }

  const expiresAtMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresAtMs)) {
    return null;
  }

  const remainingSeconds = Math.floor((expiresAtMs - now.getTime()) / 1000);
  if (remainingSeconds <= 0) {
    return null;
  }

  return Math.max(1, Math.min(3600, remainingSeconds));
}
