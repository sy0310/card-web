'use client';

import { useWishlist } from '@/context/WishlistContext';
import styles from './WishlistDrawer.module.css';
import { useState } from 'react';
import CheckoutModal from './CheckoutModal';

export default function WishlistDrawer({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const { items, removeFromWishlist, totalPrice } = useWishlist();
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
          {items.length === 0 ? (
            <div className={styles.empty}>
              <p>Your wishlist is empty</p>
              <span>Add some cards to get started!</span>
            </div>
          ) : (
            items.map(item => (
              <div key={item.id} className={styles.item}>
                <img src={item.image_url} alt="" className={styles.itemImg} />
                <div className={styles.itemInfo}>
                  <h4>{item.title}</h4>
                  <p>{item.group_name}</p>
                  <span className={styles.itemPrice}>${item.price}</span>
                </div>
                <button 
                  onClick={() => removeFromWishlist(item.id)}
                  className={styles.removeBtn}
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>

        {items.length > 0 && (
          <footer className={styles.footer}>
            <div className={styles.total}>
              <span>Total Estimation</span>
              <span className={styles.totalAmount}>${totalPrice}</span>
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
