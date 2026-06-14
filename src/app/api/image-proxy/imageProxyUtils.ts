type ImageProxyTargetResult =
  | {
      ok: true;
      url: URL;
    }
  | {
      ok: false;
      status: 400;
      error: string;
    };

export function parseImageProxyTarget(
  rawTarget: string | null,
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
): ImageProxyTargetResult {
  if (!rawTarget?.trim()) {
    return {
      ok: false,
      status: 400,
      error: 'Missing image url.',
    };
  }

  let url: URL;
  try {
    url = new URL(rawTarget);
  } catch {
    return {
      ok: false,
      status: 400,
      error: 'Invalid image url.',
    };
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return {
      ok: false,
      status: 400,
      error: 'Only http and https image URLs are supported.',
    };
  }

  if (!isAllowedSupabaseStorageUrl(url, supabaseUrl)) {
    return {
      ok: false,
      status: 400,
      error: 'Image host is not allowed for receipt generation.',
    };
  }

  return { ok: true, url };
}

export function isImageContentType(contentType: string | null) {
  return contentType?.toLowerCase().split(';')[0].trim().startsWith('image/') ?? false;
}

function isAllowedSupabaseStorageUrl(url: URL, supabaseUrl?: string) {
  if (!supabaseUrl) return false;

  try {
    const configured = new URL(supabaseUrl);
    return (
      url.hostname === configured.hostname &&
      url.pathname.startsWith('/storage/v1/object/')
    );
  } catch {
    return false;
  }
}
