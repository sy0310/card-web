import { NextRequest, NextResponse } from 'next/server';
import { isImageContentType, parseImageProxyTarget } from './imageProxyUtils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const parsed = parseImageProxyTarget(request.nextUrl.searchParams.get('url'));

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }

  try {
    const upstream = await fetch(parsed.url, {
      cache: 'no-store',
      headers: {
        accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
      },
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Could not load image: ${upstream.status}` },
        { status: 502 },
      );
    }

    const contentType = upstream.headers.get('content-type');
    if (!isImageContentType(contentType)) {
      return NextResponse.json({ error: 'The requested URL did not return an image.' }, { status: 415 });
    }

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'content-type': contentType || 'image/jpeg',
        'cache-control': 'no-store, max-age=0',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Could not load image.' }, { status: 502 });
  }
}
