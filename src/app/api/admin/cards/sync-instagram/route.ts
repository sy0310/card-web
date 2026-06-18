import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateAdminRequest,
  formatSupabaseAdminWriteError,
} from '@/lib/server/supabaseAdmin';
import { buildCardImagePath } from '../upload/uploadCardUtils';
import { parseInstagramMediaInput } from './syncInstagramUtils';

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

const GROUP_MAP: Record<string, string> = {
  'svt': 'Seventeen',
  'seventeen': 'Seventeen',
  '82major': '82major',
  '82m': '82major',
  'p1h': 'P1Harmony',
  'p1harmony': 'P1Harmony',
  'zb1': 'ZEROBASEONE',
  'zerobaseone': 'ZEROBASEONE',
  'lsf': 'LE SSERAFIM',
  'lesserafim': 'LE SSERAFIM',
  'adt': '&Team',
  '&team': '&Team',
  'amp': 'Ampers&one',
  'ampers&one': 'Ampers&one',
  'nct': 'NCT',
  'nctw': 'NCT Wish',
  'crv': 'CRAVITY',
  'cravity': 'CRAVITY',
  'bnd': 'BOYNEXTDOOR',
  'boynextdoor': 'BOYNEXTDOOR',
  'kfl': 'Kickflip',
  'kickflip': 'Kickflip',
  'cye': 'CYE',
  'ahf': 'ahof',
  'ahof': 'ahof',
  'xahf': 'ahof',
  'xlov': 'xlov',
  'nua': 'NouerA',
  'nouera': 'NouerA',
  'atz': 'Ateez',
  'ateez': 'Ateez',
  'cyn': 'Yena',
  'yena': 'Yena',
  'adp': 'Allday project',
  'allday': 'Allday project',
  'kik': 'kiiikiii',
  'kiiikiii': 'kiiikiii',
  'ehp': 'Enhypen',
  'enhypen': 'Enhypen',
  'xik': 'Xikers',
  'xikers': 'Xikers',
  'tws': 'TWS',
  'illit': 'Illit',
  'aespa': 'aespa',
  'h2h': 'aespa',
  'txt': 'TXT',
  'itzy': 'Itzy',
  'gmmtv': 'GMMTV',
  'evnne': 'Evnne',
  'rescene': 'RESCENE',
  'qwer': 'QWER',
  'kep1er': 'Kep1er',
  'kiss of life': 'Kiss of Life',
  'gidle': '(G)I-DLE',
  'i-dle': '(G)I-DLE',
  'exo': 'EXO',
  'kai': 'EXO',
  'chanyeol': 'EXO',
  'baekhyun': 'EXO',
  'riiz': 'Riize',
  'riize': 'Riize',
  'stray': 'Stray Kids',
  'skz': 'Stray Kids'
};

function parseInstagramCaption(caption: string) {
  const lines = caption.split(/\r?\n/);
  const firstLine = lines[0]?.trim() || '';
  
  let price = 0;
  let group = '';
  let album_era = '';

  // 1. Extract Price (handles "$35 set", "$24", etc.)
  const priceMatch = caption.match(/\$(\d+)(?:\s+set)?/i);
  if (priceMatch) {
    price = parseFloat(priceMatch[1]);
  }

  // 2. Parse Group, Album & Title
  if (firstLine.startsWith('#')) {
    const tokens = firstLine.split(/\s+/).filter(Boolean);
    const firstToken = tokens[0]; // e.g. "#meguronua"
    
    let rawTag = firstToken.substring(1).toLowerCase(); // remove '#'
    if (rawTag.startsWith('megurop')) {
      rawTag = rawTag.substring(7);
    } else if (rawTag.startsWith('megurox')) {
      rawTag = rawTag.substring(7);
    } else if (rawTag.startsWith('meguro')) {
      rawTag = rawTag.substring(6);
    }
    
    if (GROUP_MAP[rawTag]) {
      group = GROUP_MAP[rawTag];
    }
    
    if (!group) {
      for (const token of tokens) {
        const cleanedToken = token.replace(/[^a-zA-Z0-9&]/g, '').toLowerCase();
        if (GROUP_MAP[cleanedToken]) {
          group = GROUP_MAP[cleanedToken];
          break;
        }
      }
    }
    
    if (!group && tokens.length >= 2) {
      group = tokens[1];
    }
    
    const groupLower = group.toLowerCase();
    const groupWords = groupLower.split(/\s+/);
    
    const remainingTokens = tokens.slice(1).filter(t => {
      const cleanedT = t.toLowerCase().replace(/[^a-zA-Z0-9&]/g, '');
      if (t === firstToken) return false;
      if (cleanedT === rawTag) return false;
      if (groupWords.includes(cleanedT)) return false;
      return true;
    });

    if (remainingTokens.length >= 1) {
      album_era = remainingTokens[0];
    }
  }

  // 3. Extract Title (strip first token if starts with #)
  let title = firstLine;
  if (firstLine.startsWith('#')) {
    const tokens = firstLine.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
      title = tokens.slice(1).join(' ');
    }
  }
  title = title.substring(0, 80).trim() || 'Instagram Post';

  return { title, price, group, album_era };
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
