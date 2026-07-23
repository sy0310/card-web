'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toBlob } from 'html-to-image';
import { useWishlist } from '@/context/WishlistContext';
import { supabase } from '@/lib/supabase';
import WishlistReceipt from './WishlistReceipt';
import { waitForImages } from './checkoutImageUtils';
import { formatCheckoutError } from './checkoutUtils';
import { getWishlistQuantityError } from '@/lib/wishlistLimits';
import {
  toAbsoluteUrl,
  canShareFile,
  isAbortError,
  buildReceiptFilename,
  downloadReceiptBlob,
} from './receiptUtils';
import styles from './CheckoutModal.module.css';

function createCheckoutRequestId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function hashCheckoutFingerprint(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getStoredCheckoutRequestId(fingerprint: string) {
  const storageKey = `kpop-card-checkout-${hashCheckoutFingerprint(fingerprint)}`;
  try {
    const existingId = window.sessionStorage.getItem(storageKey);
    if (existingId) return { id: existingId, storageKey };
    const id = createCheckoutRequestId();
    window.sessionStorage.setItem(storageKey, id);
    return { id, storageKey };
  } catch {
    return { id: createCheckoutRequestId(), storageKey: '' };
  }
}

export default function CheckoutModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { items, totalPrice, clearWishlist } = useWishlist();
  const safeItems = Array.isArray(items) ? items : [];
  const safeTotalPrice = Number.isFinite(Number(totalPrice)) ? Number(totalPrice) : 0;
  const [igHandle, setIgHandle] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1); // 1: Input, 2: Preview & Actions

  // Receipt image and upload state
  const [receiptBlob, setReceiptBlob] = useState<Blob | null>(null);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);
  const [createdWishlistId, setCreatedWishlistId] = useState<string | null>(null);
  const [receiptRelativeUrl, setReceiptRelativeUrl] = useState<string | null>(null);
  const [receiptUploadStatus, setReceiptUploadStatus] = useState<'idle' | 'uploading' | 'ready' | 'failed'>('idle');
  const [retryLoading, setRetryLoading] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [settings, setSettings] = useState({
    site_title: 'K-POP CARD',
    official_ig_handle: '@official_account',
    checkout_intro: 'Enter your Instagram handle so we can track your request.',
    wishlist_footer_note: 'Please DM this image to complete your purchase.',
  });
  const summaryRef = useRef<HTMLDivElement>(null);
  const checkoutRequestRef = useRef<{ fingerprint: string; id: string; storageKey: string } | null>(null);

  // Clean up ObjectURL on URL change or unmount
  useEffect(() => {
    return () => {
      if (receiptPreviewUrl) {
        URL.revokeObjectURL(receiptPreviewUrl);
      }
    };
  }, [receiptPreviewUrl]);

  useEffect(() => {
    let isMounted = true;

    void supabase
      .from('site_settings')
      .select('*')
      .then(({ data }) => {
        if (!isMounted || !Array.isArray(data)) return;
        const s = data.reduce<Record<string, string>>((acc, curr) => {
          if (curr && typeof curr.key === 'string' && typeof curr.value === 'string') {
            acc[curr.key] = curr.value;
          }
          return acc;
        }, {});
        setSettings(prev => ({ ...prev, ...s }));
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const uploadReceiptToServer = useCallback(
    async (wishlistId: string, blob: Blob, requestId: string) => {
      setReceiptUploadStatus('uploading');
      try {
        const formData = new FormData();
        const file = new File([blob], 'receipt.png', { type: 'image/png' });
        formData.append('file', file);
        formData.append('checkout_request_id', requestId);

        const response = await fetch(`/api/wishlists/${wishlistId}/receipt`, {
          method: 'POST',
          body: formData,
        });

        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.receipt_url) {
          throw new Error(data?.error || `Upload failed (status ${response.status})`);
        }

        setReceiptRelativeUrl(data.receipt_url);
        setReceiptUploadStatus('ready');
        return true;
      } catch (error: unknown) {
        console.warn('Receipt upload to storage failed (isolated error):', error);
        setReceiptUploadStatus('failed');
        return false;
      }
    },
    [],
  );

  const handleGenerate = async () => {
    if (!igHandle.trim()) return alert('Please enter your Instagram handle');
    if (safeItems.length === 0) {
      alert('Wishlist is empty');
      return;
    }

    const quantityError = getWishlistQuantityError(
      safeItems.map(item => ({ quantity: Number(item.quantity) })),
    );
    if (quantityError) {
      alert(quantityError);
      return;
    }

    setLoading(true);
    setActionError(null);

    try {
      const fingerprint = JSON.stringify({
        handle: igHandle.trim().toLowerCase(),
        items: safeItems.map(item => ({
          card_id: item.card_id,
          purchase_option_id: item.purchase_option_id,
          quantity: item.quantity,
        })),
      });

      if (checkoutRequestRef.current?.fingerprint !== fingerprint) {
        const request = getStoredCheckoutRequestId(fingerprint);
        checkoutRequestRef.current = {
          fingerprint,
          ...request,
        };
      }

      // Step 1: Create or reuse Wishlist
      const orderResponse = await fetch('/api/wishlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_ig_handle: igHandle,
          items: safeItems,
          checkout_request_id: checkoutRequestRef.current.id,
        }),
      });
      const orderData = await orderResponse.json().catch(() => null);
      if (!orderResponse.ok || !orderData?.wishlist_id) {
        throw new Error(orderData?.error || `Creating wishlist failed (status ${orderResponse.status}).`);
      }

      const wishlistId = String(orderData.wishlist_id);
      setCreatedWishlistId(wishlistId);

      // Step 2: Wait for images and generate PNG Blob
      if (!summaryRef.current) {
        throw new Error('Receipt DOM element not ready');
      }

      const imageReport = await waitForImages(summaryRef.current);
      if (imageReport.failed > 0) {
        console.warn('Some receipt images failed to load before export:', imageReport);
      }

      const blob = await toBlob(summaryRef.current, {
        cacheBust: true,
        includeQueryParams: true,
        quality: 1,
      });

      if (!blob) {
        throw new Error('Generating receipt image blob failed.');
      }

      // Revoke previous preview URL if exists
      if (receiptPreviewUrl) {
        URL.revokeObjectURL(receiptPreviewUrl);
      }

      const localPreviewUrl = URL.createObjectURL(blob);
      setReceiptBlob(blob);
      setReceiptPreviewUrl(localPreviewUrl);
      setStep(2);

      // Step 3: Background receipt upload (Does NOT break checkout if upload fails)
      void uploadReceiptToServer(wishlistId, blob, checkoutRequestRef.current.id);
    } catch (error: unknown) {
      console.error('Checkout failed:', error);
      alert('Error processing request: ' + formatCheckoutError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleRetryUpload = async () => {
    if (!createdWishlistId || !receiptBlob || !checkoutRequestRef.current?.id) return;
    setRetryLoading(true);
    setActionError(null);
    await uploadReceiptToServer(createdWishlistId, receiptBlob, checkoutRequestRef.current.id);
    setRetryLoading(false);
  };

  const handleShareReceipt = async () => {
    setActionError(null);
    if (!receiptBlob) return;

    const file = new File([receiptBlob], buildReceiptFilename(igHandle), { type: 'image/png' });

    if (canShareFile(file)) {
      try {
        await navigator.share({
          title: 'Wishlist Receipt',
          files: [file],
        });
        return;
      } catch (error: unknown) {
        if (isAbortError(error)) {
          return;
        }
        setActionError('The receipt could not be shared.');
        return;
      }
    }

    // Fallback if Web Share files is not supported
    downloadReceiptBlob(receiptBlob, buildReceiptFilename(igHandle));
  };

  const handleDownloadReceipt = () => {
    setActionError(null);
    if (!receiptBlob) return;
    downloadReceiptBlob(receiptBlob, buildReceiptFilename(igHandle));
  };

  const getAbsoluteReceiptUrl = () => {
    if (!receiptRelativeUrl || typeof window === 'undefined') return '';
    return toAbsoluteUrl(receiptRelativeUrl, window.location.origin);
  };

  const handleCopyLink = async () => {
    const absUrl = getAbsoluteReceiptUrl();
    if (!absUrl) return;
    try {
      await navigator.clipboard.writeText(absUrl);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2500);
    } catch {
      // Clipboard fallback is handled by displaying read-only input
      setCopySuccess(false);
    }
  };

  const handleOpenPage = () => {
    const absUrl = getAbsoluteReceiptUrl();
    if (!absUrl) return;
    window.open(absUrl, '_blank', 'noopener,noreferrer');
  };

  const handleDone = () => {
    if (checkoutRequestRef.current?.storageKey) {
      window.sessionStorage.removeItem(checkoutRequestRef.current.storageKey);
    }
    checkoutRequestRef.current = null;

    if (receiptPreviewUrl) {
      URL.revokeObjectURL(receiptPreviewUrl);
    }
    setReceiptBlob(null);
    setReceiptPreviewUrl(null);
    setCreatedWishlistId(null);
    setReceiptRelativeUrl(null);
    setReceiptUploadStatus('idle');
    setActionError(null);

    clearWishlist();
    onClose();
  };

  if (!isOpen) return null;

  const absoluteUrl = getAbsoluteReceiptUrl();

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`${styles.modal} glass`} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose}>×</button>

        {step === 1 ? (
          <div className={styles.step1}>
            <h3>Ready to Own Them?</h3>
            <p>{settings.checkout_intro}</p>

            <div className={styles.inputGroup}>
              <label>Instagram Handle</label>
              <input
                type="text"
                placeholder="@yourname"
                value={igHandle}
                onChange={e => setIgHandle(e.target.value)}
              />
            </div>

            <button
              className={styles.mainBtn}
              onClick={handleGenerate}
              disabled={loading || !igHandle}
            >
              {loading ? 'Processing...' : 'Generate Customer Receipt'}
            </button>
          </div>
        ) : (
          <div className={styles.step2}>
            <h3>Receipt Generated!</h3>
            <p>Save or share your receipt, then DM it to {settings.official_ig_handle}.</p>

            {receiptPreviewUrl && (
              <img src={receiptPreviewUrl} alt="Wishlist Summary" className={styles.previewImg} />
            )}

            {/* Local Save / Download actions (Always functional regardless of upload status) */}
            <div className={styles.primaryActionsGroup}>
              <button className={styles.shareBtn} onClick={handleShareReceipt}>
                Save / Share Receipt
              </button>

              <button className={styles.downloadBtn} onClick={handleDownloadReceipt}>
                Download Receipt
              </button>
            </div>

            {/* Server receipt link section */}
            <div className={styles.linkSection}>
              {receiptUploadStatus === 'uploading' && (
                <p className={styles.statusText}>Creating browser receipt link...</p>
              )}

              {receiptUploadStatus === 'ready' && absoluteUrl && (
                <div className={styles.linkGroup}>
                  <div className={styles.inputRow}>
                    <input
                      type="text"
                      readOnly
                      value={absoluteUrl}
                      className={styles.urlInput}
                      onClick={e => (e.target as HTMLInputElement).select()}
                    />
                    <button className={styles.copyBtn} onClick={handleCopyLink}>
                      {copySuccess ? 'Copied!' : 'Copy Link'}
                    </button>
                  </div>

                  <button className={styles.openBtn} onClick={handleOpenPage}>
                    Open Receipt Page
                  </button>

                  <p className={styles.igTip}>
                    Opened inside Instagram? Tap the <strong>•••</strong> menu and choose <strong>“Open in browser”</strong> if download is unavailable.
                  </p>
                </div>
              )}

              {receiptUploadStatus === 'failed' && (
                <div className={styles.failedBox}>
                  <p className={styles.failedText}>
                    Your wishlist was saved, but the browser receipt link could not be created. You can still save or download the image above.
                  </p>
                  <button
                    className={styles.retryBtn}
                    onClick={handleRetryUpload}
                    disabled={retryLoading}
                  >
                    {retryLoading ? 'Retrying...' : 'Retry Creating Link'}
                  </button>
                </div>
              )}
            </div>

            {actionError && <p className={styles.errorText}>{actionError}</p>}

            <button className={styles.doneBtn} onClick={handleDone}>
              Done (Clear Wishlist)
            </button>
          </div>
        )}

        {/* Hidden Summary Template for Image Generation */}
        <div style={{ position: 'absolute', left: '-9999px', top: '-9999px' }}>
          <div ref={summaryRef}>
            <WishlistReceipt
              settings={settings}
              userIgHandle={igHandle}
              items={safeItems}
              totalPrice={safeTotalPrice}
              mode="compact"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
