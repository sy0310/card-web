'use client';

import { useEffect, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { useWishlist } from '@/context/WishlistContext';
import { supabase } from '@/lib/supabase';
import styles from './CheckoutModal.module.css';

export default function CheckoutModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const { items, totalPrice, clearWishlist } = useWishlist();
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
        if (!isMounted || !data) return;
        const s = data.reduce<Record<string, string>>((acc, curr) => ({ ...acc, [curr.key]: curr.value }), {});
        setSettings(prev => ({ ...prev, ...s }));
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleGenerate = async () => {
    if (!igHandle) return alert('Please enter your Instagram handle');
    setLoading(true);

    try {
      // 1. Log to Database
      const { data: wishlistData, error: wishlistError } = await supabase
        .from('wishlists')
        .insert({
          user_ig_handle: igHandle,
          total_price: totalPrice,
          status: 'pending'
        })
        .select()
        .single();

      if (wishlistError) throw wishlistError;

      // 2. Log Items
      const wishlistItems = items.map(item => ({
        wishlist_id: wishlistData.id,
        card_id: item.id
      }));

      const { error: itemsError } = await supabase
        .from('wishlist_items')
        .insert(wishlistItems);

      if (itemsError) throw itemsError;

      // 3. Generate Image
      if (summaryRef.current) {
        // Give time for the hidden summary to render
        const dataUrl = await toPng(summaryRef.current, { cacheBust: true, quality: 1 });
        setGeneratedImg(dataUrl);
        setStep(2);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Error processing request: ' + message);
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
            <p>{settings.wishlist_footer_note} Send it to {settings.official_ig_handle}.</p>
            
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
          <div ref={summaryRef} className={styles.summaryTemplate}>
            <div className={styles.summaryHeader}>
              <h1>{settings.site_title}</h1>
              <p>WISHLIST REQUEST</p>
            </div>

            <div className={styles.summaryInstruction}>
              <h3>Instructions</h3>
              <p>
                {settings.wishlist_footer_note}
              </p>
            </div>
            
            <div className={styles.summaryUser}>
              <span>Instagram:</span>
              <strong>{igHandle}</strong>
            </div>

            <div className={styles.summaryItems}>
              {items.map(item => (
                <div key={item.id} className={styles.summaryItem}>
                  <img src={item.image_url} alt="" />
                  <div className={styles.summaryItemInfo}>
                    <h4>{item.title}</h4>
                    <p>{item.group_name} {item.quantity > 1 ? ` (x${item.quantity})` : ''}</p>
                  </div>
                  <div className={styles.summaryItemPrice}>
                    ${(Number(item.price) * item.quantity).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.summaryFooter}>
              <div className={styles.summaryTotal}>
                <span>TOTAL ESTIMATED</span>
                <h2>${Number(totalPrice).toFixed(2)}</h2>
              </div>
              <p style={{ color: '#9ca3af', fontSize: '12px', marginTop: '10px' }}>{settings.wishlist_footer_note}</p>
              <p style={{ color: '#c0a0ff', fontSize: '13px', fontWeight: 'bold', margin: '5px 0 0' }}>{settings.official_ig_handle}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
