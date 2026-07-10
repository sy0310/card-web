import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateAdminRequest,
  formatSupabaseAdminWriteError,
} from '@/lib/server/supabaseAdmin';
import { getInstagramFetchInternalSecret } from '@/lib/server/instagramSettings';
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

type SyncLogStatus = 'running' | 'success' | 'failed';

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, ' ').slice(0, 1000) || 'Instagram sync failed.';
}

async function createSyncLog(supabaseAdmin: ReturnType<typeof import('@/lib/server/supabaseAdmin').createSupabaseAdminClient>) {
  const { data, error } = await supabaseAdmin
    .from('instagram_sync_logs')
    .insert({ status: 'running', message: 'Instagram sync started.', started_at: new Date().toISOString() })
    .select('id')
    .single();

  if (error) {
    console.warn('Could not create Instagram sync log. Run the Instagram management migration.', error.message);
    return null;
  }

  return data?.id ?? null;
}

async function updateSyncLog(
  supabaseAdmin: ReturnType<typeof import('@/lib/server/supabaseAdmin').createSupabaseAdminClient>,
  id: string | null,
  status: SyncLogStatus,
  message: string,
  postsFound?: number,
) {
  if (!id) return;

  const { error } = await supabaseAdmin
    .from('instagram_sync_logs')
    .update({
      status,
      message: message.replace(/[\r\n]+/g, ' ').slice(0, 1000),
      posts_found: postsFound ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    console.warn('Could not update Instagram sync log:', error.message);
  }
}

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
  let syncLogId: string | null = null;
  let supabaseAdmin: ReturnType<typeof import('@/lib/server/supabaseAdmin').createSupabaseAdminClient> | null = null;

  try {
    const auth = await authenticateAdminRequest(request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    supabaseAdmin = auth.supabaseAdmin;

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
    syncLogId = await createSyncLog(auth.supabaseAdmin);

    const fail = async (payload: Record<string, unknown>, status: number) => {
      await updateSyncLog(
        auth.supabaseAdmin,
        syncLogId,
        'failed',
        typeof payload.error === 'string' ? payload.error : 'Instagram sync failed.',
      );
      return NextResponse.json(payload, { status });
    };

    // Check if duplicate
    const { data: existing, error: queryError } = await auth.supabaseAdmin
      .from('cards')
      .select('id')
      .in('original_ig_url', mediaRef.duplicateUrls)
      .maybeSingle();

    if (queryError) {
      return fail({ error: queryError.message }, 500);
    }
    if (existing) {
      return fail({ error: 'This card has already been synced from Instagram.' }, 400);
    }

    // Call /api/fetch_ig Python serverless API
    const origin = request.nextUrl.origin;
    const fetchRes = await fetch(`${origin}/api/fetch_ig`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Instagram-Internal-Secret': getInstagramFetchInternalSecret(),
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
      return fail({
        error: `Instagram sync service returned an unexpected response (status ${fetchRes.status}).`,
      }, 500);
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
      return fail({
        error: formatInstagramFetchError(fetchResult),
        code: fetchResult.code,
        retryable: fetchResult.retryable,
      }, status);
    }

    const { caption, imageUrl } = fetchResult;

    // Parse caption
    const metadata = parseInstagramCaption(caption || '');

    // Download image from imageUrl
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return fail({ error: `Failed to download Instagram image: ${imageResponse.statusText}` }, 500);
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
      return fail(
        { error: `Storage upload failed: ${formatSupabaseAdminWriteError(uploadError)}` },
        500,
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
      return fail(
        { error: formatSupabaseAdminWriteError(dbError) },
        500,
      );
    }

    await updateSyncLog(auth.supabaseAdmin, syncLogId, 'success', 'Instagram sync completed.', 1);

    return NextResponse.json({
      success: true,
      card,
    });
  } catch (err: unknown) {
    if (supabaseAdmin) {
      await updateSyncLog(supabaseAdmin, syncLogId, 'failed', errorMessage(err));
    }
    console.error('Instagram sync route failed', err);
    return NextResponse.json({ error: 'Instagram sync failed. Please try again.' }, { status: 500 });
  }
}
