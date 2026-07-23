import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseAdminClient } from '@/lib/server/supabaseAdmin';
import { isUuid } from '@/app/api/wishlists/receiptApiUtils';
import { getReceiptPageState } from './receiptPageStateUtils';
import { getReceiptSignedUrlTtlSeconds } from './receiptSignedUrlUtils';
import ReceiptActions from '@/components/ReceiptActions';
import styles from './receiptPage.module.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ReceiptPageProps = {
  params: Promise<{
    token: string;
  }>;
};

export async function generateMetadata({ params }: ReceiptPageProps): Promise<Metadata> {
  const { token } = await params;
  return {
    title: isUuid(token) ? 'Wishlist Customer Receipt' : 'Receipt Not Found',
    description: 'View, save, and download your wishlist receipt image.',
  };
}

export default async function ReceiptPage({ params }: ReceiptPageProps) {
  const { token } = await params;

  if (!isUuid(token)) {
    notFound();
  }

  let wishlistRecord: {
    user_ig_handle: string | null;
    total_price: number | string | null;
    receipt_storage_path: string | null;
    receipt_generated_at: string | null;
    receipt_expires_at: string | null;
  } | null = null;

  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from('wishlists')
      .select('user_ig_handle, total_price, receipt_storage_path, receipt_generated_at, receipt_expires_at')
      .eq('receipt_token', token)
      .maybeSingle();

    if (error) {
      console.error('Error querying wishlist by receipt token:', error);
    }
    wishlistRecord = data;
  } catch (err) {
    console.error('Unexpected error fetching wishlist receipt:', err);
  }

  // 1. Token invalid or record does not exist -> 404 Not Found
  if (!wishlistRecord) {
    notFound();
  }

  const now = new Date();

  const state = getReceiptPageState({
    storagePath: wishlistRecord.receipt_storage_path,
    expiresAt: wishlistRecord.receipt_expires_at,
    now,
  });

  // 2. Receipt Expired state
  if (state === 'expired') {
    return (
      <main className={styles.pageWrapper}>
        <div className={styles.cardContainer}>
          <div className={styles.errorIcon}>⏳</div>
          <h1 className={styles.title}>Receipt Expired</h1>
          <p className={styles.description}>
            This receipt image was available for 30 days. Please contact the seller if you need another copy.
          </p>
          <Link href="/" className={styles.homeLink}>
            Back to Storefront
          </Link>
        </div>
      </main>
    );
  }

  // 3. Receipt Never Generated or Invalid Path -> 404 Not Found
  if (state === 'unavailable') {
    notFound();
  }

  // 4. Data Inconsistency state
  if (state === 'inconsistent') {
    console.error(`Inconsistent receipt data for token ${token}: storagePath is null but expiresAt is in the future.`);
    return (
      <main className={styles.pageWrapper}>
        <div className={styles.cardContainer}>
          <div className={styles.errorIcon}>⚠️</div>
          <h1 className={styles.title}>Receipt Temporarily Unavailable</h1>
          <p className={styles.description}>
            The receipt image is currently undergoing maintenance. Please try again later.
          </p>
          <Link href="/" className={styles.homeLink}>
            Back to Storefront
          </Link>
        </div>
      </main>
    );
  }

  const signedUrlTtlSeconds = getReceiptSignedUrlTtlSeconds(
    wishlistRecord.receipt_expires_at,
    now,
  );

  if (!signedUrlTtlSeconds) {
    return (
      <main className={styles.pageWrapper}>
        <div className={styles.cardContainer}>
          <div className={styles.errorIcon}>⏳</div>
          <h1 className={styles.title}>Receipt Expired</h1>
          <p className={styles.description}>
            This receipt image was available for 30 days. Please contact the seller if you need another copy.
          </p>
          <Link href="/" className={styles.homeLink}>
            Back to Storefront
          </Link>
        </div>
      </main>
    );
  }

  // 5. Available State: Generate signed URL for private storage file with calculated TTL
  let signedUrl: string | null = null;
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const { data: signedData, error: signedError } = await supabaseAdmin.storage
      .from('wishlist-receipts')
      .createSignedUrl(wishlistRecord.receipt_storage_path!, signedUrlTtlSeconds);

    if (signedError || !signedData?.signedUrl) {
      console.error('Error generating signed URL for receipt:', signedError);
    } else {
      signedUrl = signedData.signedUrl;
    }
  } catch (err) {
    console.error('Unexpected error generating signed URL:', err);
  }

  if (!signedUrl) {
    return (
      <main className={styles.pageWrapper}>
        <div className={styles.cardContainer}>
          <div className={styles.errorIcon}>⚠️</div>
          <h1 className={styles.title}>Receipt Temporarily Unavailable</h1>
          <p className={styles.description}>
            We could not generate the preview image at this moment. You can still download it directly below.
          </p>
          <ReceiptActions token={token} />
        </div>
      </main>
    );
  }

  const handle = wishlistRecord.user_ig_handle ? `@${wishlistRecord.user_ig_handle.replace(/^@/, '')}` : 'Customer';
  const generatedTime = wishlistRecord.receipt_generated_at
    ? new Date(wishlistRecord.receipt_generated_at).toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '';

  return (
    <main className={styles.pageWrapper}>
      <div className={styles.cardContainer}>
        <div className={styles.badge}>Receipt Ready</div>
        <h1 className={styles.title}>Customer Receipt</h1>
        <p className={styles.subtext}>
          Receipt for <span className={styles.igHandle}>{handle}</span>
          {generatedTime ? ` • ${generatedTime}` : ''}
        </p>

        {/* Use standard <img> to avoid Next Image domain config expansions for private signed URLs */}
        <div className={styles.imageContainer}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={signedUrl}
            alt={`Wishlist receipt for ${handle}`}
            className={styles.receiptImage}
          />
        </div>

        <ReceiptActions token={token} />

        <div className={styles.instagramNotice}>
          <p className={styles.noticeHeading}>Opened inside Instagram?</p>
          <p className={styles.noticeBody}>
            Tap the <strong>•••</strong> menu at the top right and choose <strong>“Open in browser”</strong> if downloading or saving is unavailable.
          </p>
        </div>
      </div>
    </main>
  );
}
