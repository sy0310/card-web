import { NextRequest, NextResponse } from 'next/server';
import { readInstagramPublishServiceResponse } from '@/lib/server/instagramPublisher';
import { authenticateAdminRequest } from '@/lib/server/supabaseAdmin';
import {
  buildCardImagePath,
  normalizeCardUploadFields,
} from './uploadCardUtils';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAdminRequest(request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Image file is required.' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'Image file is empty.' }, { status: 400 });
    }
    if (file.type && !file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image uploads are supported.' }, { status: 400 });
    }

    const normalized = normalizeCardUploadFields(
      {
        title: formData.get('title'),
        price: formData.get('price'),
        group_name: formData.get('group_name'),
        album_era: formData.get('album_era'),
        pob_name: formData.get('pob_name'),
        inventory_count: formData.get('inventory_count'),
        source: formData.get('source'),
        syncToIg: formData.get('syncToIg'),
        igCaption: formData.get('igCaption'),
      },
      file.name,
    );

    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const cardFields = normalized.value;
    const filePath = buildCardImagePath(file.name);
    const imageBuffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await auth.supabaseAdmin.storage
      .from('cards')
      .upload(filePath, imageBuffer, {
        contentType: file.type || 'image/jpeg',
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: { publicUrl } } = auth.supabaseAdmin.storage
      .from('cards')
      .getPublicUrl(filePath);

    const { data: card, error: dbError } = await auth.supabaseAdmin
      .from('cards')
      .insert({
        title: cardFields.title,
        image_url: publicUrl,
        price: cardFields.price,
        group_name: cardFields.group_name,
        album_era: cardFields.album_era,
        pob_name: cardFields.pob_name,
        inventory_count: cardFields.inventory_count,
        source: cardFields.source,
      })
      .select('*')
      .single();

    if (dbError) {
      await auth.supabaseAdmin.storage.from('cards').remove([filePath]);
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    let instagram:
      | { success: true; url: string }
      | { success: false; error: string }
      | null = null;

    if (cardFields.syncToIg) {
      try {
        const origin = request.nextUrl.origin;
        const publishRes = await fetch(`${origin}/api/publish_ig`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            imageUrl: publicUrl,
            caption: cardFields.igCaption,
          }),
        });

        const result = await readInstagramPublishServiceResponse(publishRes);

        instagram = { success: true, url: result.url };

        const { error: updateError } = await auth.supabaseAdmin
          .from('cards')
          .update({ original_ig_url: result.url })
          .eq('id', card.id);

        if (updateError) {
          console.error('Failed to update card database with IG URL:', updateError.message);
        } else {
          card.original_ig_url = result.url;
        }
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        instagram = { success: false, error: errMsg };
      }
    }

    return NextResponse.json({
      success: true,
      card,
      publicUrl,
      instagram,
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg || 'Internal Server Error' }, { status: 500 });
  }
}
