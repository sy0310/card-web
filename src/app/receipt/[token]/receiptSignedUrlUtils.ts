export const SIGNED_URL_EXPIRY_SAFETY_SECONDS = 5;

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
  const safeRemainingSeconds = remainingSeconds - SIGNED_URL_EXPIRY_SAFETY_SECONDS;

  if (safeRemainingSeconds <= 0) {
    return null;
  }

  return Math.min(3600, safeRemainingSeconds);
}
