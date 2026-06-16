import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateAdminRequest,
  formatSupabaseAdminWriteError,
} from '@/lib/server/supabaseAdmin';
import { buildCardImagePath } from '../upload/uploadCardUtils';

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

    const filePath = buildCardImagePath(file.name);
    const imageBuffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await auth.supabaseAdmin.storage
      .from('cards')
      .upload(filePath, imageBuffer, {
        contentType: file.type || 'image/jpeg',
        upsert: false,
    });

    if (uploadError) {
      return NextResponse.json(
        { error: formatSupabaseAdminWriteError(uploadError) },
        { status: 500 },
      );
    }

    const { data: { publicUrl } } = auth.supabaseAdmin.storage
      .from('cards')
      .getPublicUrl(filePath);

    return NextResponse.json({
      success: true,
      publicUrl,
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg || 'Internal Server Error' }, { status: 500 });
  }
}
