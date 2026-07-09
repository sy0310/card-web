'use client';

import { useState } from 'react';
import { useWishlist } from '@/context/WishlistContext';
import {
  getActivePurchaseOptions,
  getDefaultPurchaseOption,
  type PurchaseOption,
} from '@/lib/purchaseOptions';
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
    purchase_options?: PurchaseOption[];
  };
};

export default function CardItem({ card }: CardProps) {
  const { addToWishlist } = useWishlist();
  const [showOptionPicker, setShowOptionPicker] = useState(false);

  if (!card || !card.id) return null;

  const inventoryCount = Number.isFinite(Number(card.inventory_count)) ? Number(card.inventory_count) : 0;
  const isSoldOut = inventoryCount <= 0;

  const title = card.title || 'Untitled';
  const imageUrl = card.image_url || '';
  const groupName = card.group_name || '';
  const rarity = card.rarity || '';
  const pobName = card.pob_name || '';
  const activeOptions = getActivePurchaseOptions(card);
  const defaultOption = getDefaultPurchaseOption(card);
  const displayPrice = Number.isFinite(Number(defaultOption.price)) ? Number(defaultOption.price) : 0;
  const hasMultipleOptions = activeOptions.length > 1;

  const addOptionToWishlist = (option: PurchaseOption) => {
    const unitPrice = Number.isFinite(Number(option.price)) ? Number(option.price) : 0;
    addToWishlist({
      id: `${card.id}:${option.id}`,
      card_id: card.id,
      purchase_option_id: option.id,
      option_label: option.label,
      unit_price: unitPrice,
      price: unitPrice,
      title,
      image_url: imageUrl,
      group_name: groupName,
      min_quantity: option.min_quantity,
      max_quantity: option.max_quantity,
    });
    setShowOptionPicker(false);
  };

  const handleAddClick = () => {
    if (isSoldOut) return;
    if (!hasMultipleOptions) {
      addOptionToWishlist(activeOptions[0]);
      return;
    }

    setShowOptionPicker(current => !current);
  };

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
          <span className={styles.price}>${displayPrice.toFixed(2)}</span>
          <button 
            className={styles.addBtn}
            onClick={handleAddClick}
            disabled={isSoldOut}
          >
            {isSoldOut ? 'Sold Out' : hasMultipleOptions ? 'Choose Option' : 'Add to Wishlist'}
          </button>
        </div>
        {showOptionPicker && !isSoldOut && (
          <div className={styles.optionPicker}>
            {activeOptions.map(option => (
              <button
                key={option.id}
                type="button"
                className={styles.optionBtn}
                onClick={() => addOptionToWishlist(option)}
              >
                <span>{option.label}</span>
                <strong>${Number(option.price || 0).toFixed(2)}</strong>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
