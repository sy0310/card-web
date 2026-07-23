import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/server/supabaseAdmin';
import { isUuid, isValidReceiptStoragePath } from '@/app/api/wishlists/receiptApiUtils';

export const runtime = 'nodejs';

type DownloadReceiptContext = {
  params: Promise<{
    token: string;
  }>;
};

export async function GET(request: Request, context: DownloadReceiptContext) {
  try {
    const { token } = await context.params;

    if (!isUuid(token)) {
      return NextResponse.json({ error: 'Receipt not found.' }, { status: 404 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data: wishlist, error: queryError } = await supabaseAdmin
      .from('wishlists')
      .select('id, receipt_storage_path')
      .eq('receipt_token', token)
      .maybeSingle();

    if (queryError || !wishlist || !wishlist.receipt_storage_path) {
      return NextResponse.json({ error: 'Receipt not found.' }, { status: 404 });
    }

    // Strict path validation to prevent downloading arbitrary storage paths
    if (!isValidReceiptStoragePath(wishlist.receipt_storage_path)) {
      return NextResponse.json({ error: 'Invalid receipt storage path.' }, { status: 404 });
    }

    const { data: fileBlob, error: downloadError } = await supabaseAdmin.storage
      .from('wishlist-receipts')
      .download(wishlist.receipt_storage_path);

    if (downloadError || !fileBlob) {
      console.error('Supabase Storage download error:', downloadError);
      return NextResponse.json({ error: 'Receipt file not found.' }, { status: 404 });
    }

    const arrayBuffer = await fileBlob.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': 'attachment; filename="wishlist-receipt.png"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: unknown) {
    console.error('Unexpected error in receipt download API:', error);
    return NextResponse.json({ error: 'Internal server error downloading receipt.' }, { status: 500 });
  }
}
