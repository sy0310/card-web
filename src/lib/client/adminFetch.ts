export async function fetchJsonWithRetry<T>(
  input: string,
  init: RequestInit,
  retries = 1,
): Promise<{ response: Response; data: T }> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(input, {
        cache: 'no-store',
        ...init,
      });
      const data = await response.json().catch(() => ({})) as T;
      return { response, data };
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isTransientFetchError(error)) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  throw lastError;
}

export function formatAdminFetchError(error: unknown, action: string) {
  const message = error instanceof Error ? error.message : String(error);
  if (/load failed|failed to fetch|networkerror/i.test(message)) {
    return `${action} could not reach the server. Please refresh the page and try again.`;
  }
  return message;
}

function isTransientFetchError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /load failed|failed to fetch|networkerror/i.test(message);
}
