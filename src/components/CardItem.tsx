'use client';

import { useWishlist } from '@/context/WishlistContext';
import styles from './CardItem.module.css';

type CardProps = {
  card: {
    id: string;
    title: string;
    price: number;
    image_url: string;
    group_name: string;
    inventory_count: number;
    rarity?: string;
    pob_name?: string;
  };
};

export default function CardItem({ card }: CardProps) {
  const { addToWishlist, items } = useWishlist();
  const isInWishlist = items.some(item => item.id === card.id);
  const isSoldOut = card.inventory_count <= 0;

  return (
    <div className={`${styles.card} glass fade-in`}>
      <div className={styles.imageContainer}>
        <img src={card.image_url} alt={card.title} className={styles.image} />
        {isSoldOut && (
          <div className={styles.soldOutOverlay}>
            <span>SOLD OUT</span>
          </div>
        )}
        {card.rarity && <span className={styles.rarityBadge}>{card.rarity}</span>}
      </div>
      
      <div className={styles.info}>
        <p className={styles.group}>{card.group_name}</p>
        <h3 className={styles.title}>{card.title}</h3>
        {card.pob_name && (
          <div className={styles.pobBadge}>
            POB: {card.pob_name}
          </div>
        )}
        
        <div className={styles.footer}>
          <span className={styles.price}>${card.price}</span>
          <button 
            className={styles.addBtn}
            onClick={() => addToWishlist(card)}
            disabled={isSoldOut || isInWishlist}
          >
            {isSoldOut ? 'Sold Out' : isInWishlist ? 'In Wishlist' : 'Add to Wishlist'}
          </button>
        </div>
      </div>
    </div>
  );
}
