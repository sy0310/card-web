'use client';

import { useWishlist } from '@/context/WishlistContext';
import styles from './CardItem.module.css';

type CardProps = {
  card?: {
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

  if (!card || !card.id) return null;

  const isInWishlist = Array.isArray(items) ? items.some(item => item && item.id === card.id) : false;
  const inventoryCount = Number.isFinite(Number(card.inventory_count)) ? Number(card.inventory_count) : 0;
  const isSoldOut = inventoryCount <= 0;

  const title = card.title || 'Untitled';
  const imageUrl = card.image_url || '';
  const groupName = card.group_name || '';
  const rarity = card.rarity || '';
  const pobName = card.pob_name || '';
  const price = Number.isFinite(Number(card.price)) ? Number(card.price) : 0;

  return (
    <div className={`${styles.card} glass fade-in`}>
      <div className={styles.imageContainer}>
        <img src={imageUrl} alt={title} className={styles.image} />
        {isSoldOut && (
          <div className={styles.soldOutOverlay}>
            <span>SOLD OUT</span>
          </div>
        )}
        {rarity && <span className={styles.rarityBadge}>{rarity}</span>}
      </div>
      
      <div className={styles.info}>
        <p className={styles.group}>{groupName}</p>
        <h3 className={styles.title}>{title}</h3>
        {pobName && (
          <div className={styles.pobBadge}>
            POB: {pobName}
          </div>
        )}
        
        <div className={styles.footer}>
          <span className={styles.price}>${price.toFixed(2)}</span>
          <button 
            className={styles.addBtn}
            onClick={() => addToWishlist({
              id: card.id,
              title,
              price,
              image_url: imageUrl,
              group_name: groupName,
            })}
            disabled={isSoldOut || isInWishlist}
          >
            {isSoldOut ? 'Sold Out' : isInWishlist ? 'In Wishlist' : 'Add to Wishlist'}
          </button>
        </div>
      </div>
    </div>
  );
}
