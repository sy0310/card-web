import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateAdminRequest,
  formatSupabaseAdminWriteError,
} from '@/lib/server/supabaseAdmin';
import { buildCardImagePath } from '../upload/uploadCardUtils';
import { parseInstagramCaption, parseInstagramMediaInput } from './syncInstagramUtils';

export const runtime = 'nodejs';

type InstagramFetchResult = {
  success?: boolean;
  caption?: string;
  imageUrl?: string;
  error?: string;
  code?: string;
  retryable?: boolean;
  detail?: string;
};

function formatInstagramFetchError(fetchResult: InstagramFetchResult) {
  if (fetchResult.error) return fetchResult.error;

  if (fetchResult.code === 'instagram_lookup_blocked') {
    return 'Instagram refused the lookup. Refresh the Instagram session and check the configured proxy.';
  }

  if (fetchResult.code === 'instagram_session_missing') {
    return 'Instagram session is not configured. Add a session_id or saved Instagram settings before syncing.';
  }

  return 'Failed to fetch post details from Instagram.';
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAdminRequest(request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { url } = await request.json();
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'Instagram URL is required.' }, { status: 400 });
    }

    const mediaRef = parseInstagramMediaInput(url);
    if (!mediaRef) {
      return NextResponse.json(
        { error: 'Invalid Instagram URL. Paste a /p/, /reel/, /tv/ link, or a shortcode.' },
        { status: 400 },
      );
    }

    const { mediaCode } = mediaRef;
    const standardIgUrl = mediaRef.originalUrl;

    // Check if duplicate
    const { data: existing, error: queryError } = await auth.supabaseAdmin
      .from('cards')
      .select('id')
      .in('original_ig_url', mediaRef.duplicateUrls)
      .maybeSingle();

    if (queryError) {
      return NextResponse.json({ error: queryError.message }, { status: 500 });
    }
    if (existing) {
      return NextResponse.json({ error: 'This card has already been synced from Instagram.' }, { status: 400 });
    }

    // Call /api/fetch_ig Python serverless API
    const origin = request.nextUrl.origin;
    const fetchRes = await fetch(`${origin}/api/fetch_ig`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ mediaCode }),
    });

    const bodyText = await fetchRes.text();
    let fetchResult: InstagramFetchResult;
    try {
      fetchResult = JSON.parse(bodyText);
    } catch {
      console.warn('Instagram sync service returned non-JSON response', {
        status: fetchRes.status,
        body: bodyText.slice(0, 500),
      });
      return NextResponse.json({ 
        error: `Instagram sync service returned an unexpected response (status ${fetchRes.status}).`,
      }, { status: 500 });
    }

    if (!fetchRes.ok || fetchResult.error || !fetchResult.imageUrl) {
      const status = fetchRes.status >= 400 && fetchRes.status < 600 ? fetchRes.status : 500;
      if (fetchResult.detail) {
        console.warn('Instagram sync lookup failed', {
          mediaCode,
          code: fetchResult.code,
          detail: fetchResult.detail,
        });
      }
      return NextResponse.json({
        error: formatInstagramFetchError(fetchResult),
        code: fetchResult.code,
        retryable: fetchResult.retryable,
      }, { status });
    }

    const { caption, imageUrl } = fetchResult;

    // Parse caption
    const metadata = parseInstagramCaption(caption || '');

    // Download image from imageUrl
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return NextResponse.json({ error: `Failed to download Instagram image: ${imageResponse.statusText}` }, { status: 500 });
    }

    const fileType = imageResponse.headers.get('content-type') || 'image/jpeg';
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

    // Upload to Supabase Storage
    const filePath = buildCardImagePath(`${mediaCode}.jpg`);
    const { error: uploadError } = await auth.supabaseAdmin.storage
      .from('cards')
      .upload(filePath, imageBuffer, {
        contentType: fileType,
        upsert: true,
    });

    if (uploadError) {
      return NextResponse.json(
        { error: `Storage upload failed: ${formatSupabaseAdminWriteError(uploadError)}` },
        { status: 500 },
      );
    }

    // Get public URL
    const { data: { publicUrl } } = auth.supabaseAdmin.storage
      .from('cards')
      .getPublicUrl(filePath);

    // Insert to DB
    const { data: card, error: dbError } = await auth.supabaseAdmin
      .from('cards')
      .insert({
        title: metadata.title,
        description: caption,
        price: metadata.price,
        group_name: metadata.group,
        album_era: metadata.album_era,
        pob_name: metadata.pob_name,
        image_url: publicUrl,
        source: 'instagram',
        original_ig_url: standardIgUrl,
        inventory_count: 1,
      })
      .select('*')
      .single();

    if (dbError) {
      // Cleanup uploaded file
      await auth.supabaseAdmin.storage.from('cards').remove([filePath]);
      return NextResponse.json(
        { error: formatSupabaseAdminWriteError(dbError) },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      card,
    });
  } catch (err: unknown) {
    console.error('Instagram sync route failed', err);
    return NextResponse.json({ error: 'Instagram sync failed. Please try again.' }, { status: 500 });
  }
}
