import { supabase } from '@/lib/supabase';

/**
 * Always pulls the current Supabase session instead of relying on a token
 * captured in React state at page-load time. supabase-js keeps the session
 * fresh (it silently refreshes the access token before it expires), so this
 * is cheap and guarantees we send a token that is still valid.
 */
export async function getFreshAdminAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new Error(`Could not refresh admin session: ${error.message}`);
  }
  const token = data.session?.access_token;
  if (!token) {
    throw new Error('Admin session expired. Please sign in again.');
  }
  return token;
}

/**
 * Same as fetchJsonWithRetry, but automatically attaches a freshly-fetched
 * Supabase access token as the Authorization header. Use this for every
 * /api/admin/... request instead of manually reading session.access_token.
 */
export async function fetchAdminJsonWithRetry<T>(
  input: string,
  init: RequestInit = {},
  retries = 1,
): Promise<{ response: Response; data: T }> {
  const token = await getFreshAdminAccessToken();
  return fetchJsonWithRetry<T>(
    input,
    {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    },
    retries,
  );
}

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
