import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/server/supabaseAdmin';
import { isUuid } from '@/app/api/wishlists/receiptApiUtils';
import { validateReceiptDownloadEligibility } from './downloadApiUtils';

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
      .select('id, receipt_storage_path, receipt_expires_at')
      .eq('receipt_token', token)
      .maybeSingle();

    if (queryError) {
      console.error('Database query error downloading receipt:', queryError);
      return NextResponse.json({ error: 'Failed to query receipt.' }, { status: 500 });
    }

    // Eligibility check for expiration (returns 410 if expired, 404 if missing/invalid)
    const check = validateReceiptDownloadEligibility(wishlist);
    if (check.status !== 200) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const { data: fileBlob, error: downloadError } = await supabaseAdmin.storage
      .from('wishlist-receipts')
      .download(wishlist!.receipt_storage_path!);

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
