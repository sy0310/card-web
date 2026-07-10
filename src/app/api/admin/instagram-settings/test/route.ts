import { NextResponse } from 'next/server';
import { authenticateAdminRequest } from '@/lib/server/supabaseAdmin';
import { getInstagramFetchInternalSecret } from '@/lib/server/instagramSettings';

export const runtime = 'nodejs';

type InstagramConnectionResult = {
  success?: boolean;
  username?: string | null;
  error?: string;
  code?: string;
  retryable?: boolean;
};

export async function POST(request: Request) {
  const auth = await authenticateAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const origin = new URL(request.url).origin;
    const fetchResponse = await fetch(`${origin}/api/fetch_ig`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Instagram-Internal-Secret': getInstagramFetchInternalSecret(),
      },
      body: JSON.stringify({ action: 'testConnection' }),
      cache: 'no-store',
    });
    const result = await fetchResponse.json() as InstagramConnectionResult;

    if (!fetchResponse.ok || !result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Instagram connection failed.',
          code: result.code,
          retryable: result.retryable,
        },
        { status: fetchResponse.status || 502 },
      );
    }

    return NextResponse.json({
      success: true,
      username: result.username || null,
    });
  } catch (error: unknown) {
    console.error('Instagram connection test failed:', error);
    return NextResponse.json(
      { success: false, error: 'Instagram connection test could not reach the sync service.' },
      { status: 502 },
    );
  }
}
