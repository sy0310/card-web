'use client';

import { useEffect, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { useWishlist } from '@/context/WishlistContext';
import { supabase } from '@/lib/supabase';
import WishlistReceipt from './WishlistReceipt';
import { waitForImages } from './checkoutImageUtils';
import {
  formatCheckoutError,
} from './checkoutUtils';
import { getWishlistQuantityError } from '@/lib/wishlistLimits';
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

export default function CheckoutModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const { items, totalPrice, clearWishlist } = useWishlist();
  const safeItems = Array.isArray(items) ? items : [];
  const safeTotalPrice = Number.isFinite(Number(totalPrice)) ? Number(totalPrice) : 0;
  const [igHandle, setIgHandle] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1); // 1: Input, 2: Preview & Download
  const [generatedImg, setGeneratedImg] = useState<string | null>(null);
  const [settings, setSettings] = useState({
    site_title: 'K-POP CARD',
    official_ig_handle: '@official_account',
    checkout_intro: 'Enter your Instagram handle so we can track your request.',
    wishlist_footer_note: 'Please DM this image to complete your purchase.'
  });
  const summaryRef = useRef<HTMLDivElement>(null);
  const checkoutRequestRef = useRef<{ fingerprint: string; id: string; storageKey: string } | null>(null);

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

  const handleGenerate = async () => {
    if (!igHandle) return alert('Please enter your Instagram handle');
    if (safeItems.length === 0) {
      alert('Wishlist is empty');
      return;
    }
    
    const quantityError = getWishlistQuantityError(
      safeItems.map(item => ({ quantity: Number(item.quantity) }))
    );
    if (quantityError) {
      alert(quantityError);
      return;
    }
    
    setLoading(true);

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
      if (!orderResponse.ok || orderData?.error) {
        throw new Error(orderData?.error || `Creating wishlist failed (status ${orderResponse.status}).`);
      }

      // 3. Generate Image
      if (summaryRef.current) {
        try {
          const imageReport = await waitForImages(summaryRef.current);
          if (imageReport.failed > 0) {
            console.warn('Some receipt images failed to load before export:', imageReport);
          }

          const dataUrl = await toPng(summaryRef.current, {
            cacheBust: true,
            includeQueryParams: true,
            quality: 1,
          });
          setGeneratedImg(dataUrl);
          setStep(2);
        } catch (error: unknown) {
          throw new Error(`Generating receipt image failed: ${formatCheckoutError(error)}`);
        }
      }
    } catch (error: unknown) {
      console.error('Checkout failed:', error);
      alert('Error processing request: ' + formatCheckoutError(error));
    } finally {
      setLoading(false);
    }
  };

  const downloadImage = () => {
    if (!generatedImg) return;
    const link = document.createElement('a');
    link.download = `wishlist-${igHandle}-receipt.png`;
    link.href = generatedImg;
    link.click();
  };

  if (!isOpen) return null;

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
                onChange={(e) => setIgHandle(e.target.value)}
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
            <h3>Image Generated!</h3>
            <p>Download the receipt and DM it to {settings.official_ig_handle}.</p>
            
            {generatedImg && <img src={generatedImg} alt="Wishlist Summary" className={styles.previewImg} />}
            
            <div className={styles.btnGroup}>
              <button className={styles.mainBtn} onClick={downloadImage}>
                Download Customer Receipt
              </button>
              <button className={styles.secondaryBtn} onClick={() => {
                if (checkoutRequestRef.current?.storageKey) {
                  window.sessionStorage.removeItem(checkoutRequestRef.current.storageKey);
                }
                checkoutRequestRef.current = null;
                clearWishlist();
                onClose();
              }}>
                Done (Clear Wishlist)
              </button>
            </div>
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
