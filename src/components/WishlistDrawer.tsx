'use client';

import { useWishlist } from '@/context/WishlistContext';
import styles from './WishlistDrawer.module.css';
import { useState } from 'react';
import CheckoutModal from './CheckoutModal';

export default function WishlistDrawer({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const { items, removeFromWishlist, updateQuantity, totalPrice } = useWishlist();
  const safeItems = Array.isArray(items) ? items : [];
  const safeTotalPrice = Number.isFinite(Number(totalPrice)) ? Number(totalPrice) : 0;
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <CheckoutModal 
        isOpen={isCheckoutOpen} 
        onClose={() => {
          setIsCheckoutOpen(false);
          onClose();
        }} 
      />
      <div className={`${styles.drawer} glass`} onClick={e => e.stopPropagation()}>
        <header className={styles.header}>
          <h2>Your Wishlist</h2>
          <button onClick={onClose} className={styles.closeBtn}>×</button>
        </header>

        <div className={styles.itemsList}>
          {safeItems.length === 0 ? (
            <div className={styles.empty}>
              <p>Your wishlist is empty</p>
              <span>Add some cards to get started!</span>
            </div>
          ) : (
            safeItems.map(item => {
              if (!item || !item.id) return null;
              const itemPrice = Number.isFinite(Number(item.unit_price))
                ? Number(item.unit_price)
                : Number(item.price) || 0;
              const itemQuantity = Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 1;
              const minQuantity = Math.max(1, Math.floor(Number(item.min_quantity) || 1));
              const maxQuantity = item.max_quantity == null
                ? null
                : Math.max(minQuantity, Math.floor(Number(item.max_quantity) || minQuantity));
              const lineTotal = itemPrice * itemQuantity;
              return (
                <div key={item.id} className={styles.item}>
                  <img src={item.image_url || ''} alt={item.title || ''} className={styles.itemImg} />
                  <div className={styles.itemInfo}>
                    <h4>{item.title || 'Untitled'}</h4>
                    <p>{[item.group_name, item.option_label].filter(Boolean).join(' · ')}</p>
                    <div className={styles.priceAndQty}>
                      <div className={styles.itemPriceGroup}>
                        <span className={styles.itemPrice}>${itemPrice.toFixed(2)} × {itemQuantity}</span>
                        <strong className={styles.lineTotal}>${lineTotal.toFixed(2)}</strong>
                      </div>
                      <div className={styles.qtyControl}>
                        <button
                          onClick={() => updateQuantity(item.id, itemQuantity - 1)}
                          disabled={itemQuantity <= minQuantity}
                        >
                          -
                        </button>
                        <span>{itemQuantity}</span>
                        <button
                          onClick={() => updateQuantity(item.id, itemQuantity + 1)}
                          disabled={maxQuantity != null && itemQuantity >= maxQuantity}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={() => removeFromWishlist(item.id)}
                    className={styles.removeBtn}
                  >
                    Remove
                  </button>
                </div>
              );
            })
          )}
        </div>

        {safeItems.length > 0 && (
          <footer className={styles.footer}>
            <div className={styles.total}>
              <span>Total Estimation</span>
              <span className={styles.totalAmount}>${safeTotalPrice.toFixed(2)}</span>
            </div>
            <button 
              className={styles.checkoutBtn}
              onClick={() => setIsCheckoutOpen(true)}
            >
              Generate Request Image
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
