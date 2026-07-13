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
import styles from './CheckoutModal.module.css';

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
    setLoading(true);

    try {
      const orderResponse = await fetch('/api/wishlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_ig_handle: igHandle, items: safeItems }),
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
    link.download = `wishlist-${igHandle}.png`;
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
              {loading ? 'Processing...' : 'Generate Wishlist Image'}
            </button>
          </div>
        ) : (
          <div className={styles.step2}>
            <h3>Image Generated!</h3>
            <p>Download the receipt and DM it to {settings.official_ig_handle}.</p>
            
            {generatedImg && <img src={generatedImg} alt="Wishlist Summary" className={styles.previewImg} />}
            
            <div className={styles.btnGroup}>
              <button className={styles.mainBtn} onClick={downloadImage}>
                Download Image
              </button>
              <button className={styles.secondaryBtn} onClick={() => {
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
            />
          </div>
        </div>
      </div>
    </div>
  );
}
