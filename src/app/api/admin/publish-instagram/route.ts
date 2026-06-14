import { NextRequest, NextResponse } from 'next/server';
import { readInstagramPublishServiceResponse } from '@/lib/server/instagramPublisher';
import { authenticateAdminRequest } from '@/lib/server/supabaseAdmin';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAdminRequest(request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { imageUrl, caption, cardId } = await request.json();
    if (!imageUrl || !caption) {
      return NextResponse.json({ error: 'Missing imageUrl or caption' }, { status: 400 });
    }

    const origin = request.nextUrl.origin;
    const publishRes = await fetch(`${origin}/api/publish_ig`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ imageUrl, caption }),
    });

    const result = await readInstagramPublishServiceResponse(publishRes);

    if (cardId) {
      const { error: dbError } = await auth.supabaseAdmin
        .from('cards')
        .update({ original_ig_url: result.url })
        .eq('id', cardId);
      if (dbError) {
        console.error('Failed to update card database with IG URL:', dbError.message);
      }
    }

    return NextResponse.json({ success: true, url: result.url });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errMsg || 'Internal Server Error' }, { status: 500 });
  }
}
