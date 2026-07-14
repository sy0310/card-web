import { buildReceiptImageSrc } from './checkoutImageUtils';
import { expandReceiptLineItems } from './wishlistReceiptUtils';
import styles from './CheckoutModal.module.css';

export type ReceiptSettings = {
  site_title: string;
  official_ig_handle: string;
  wishlist_footer_note: string;
};

export type ReceiptLineItem = {
  id: string;
  title: string;
  price: number;
  unit_price?: number;
  option_label?: string;
  image_url: string;
  group_name?: string;
  quantity: number;
};

type WishlistReceiptProps = {
  settings: ReceiptSettings;
  userIgHandle: string;
  items: ReceiptLineItem[];
  totalPrice: number;
  cacheKey?: string | number;
};

export default function WishlistReceipt({
  settings,
  userIgHandle,
  items,
  totalPrice,
  cacheKey = 'receipt',
}: WishlistReceiptProps) {
  const safeItems = expandReceiptLineItems(Array.isArray(items) ? items : []);
  const safeTotalPrice = Number.isFinite(Number(totalPrice)) ? Number(totalPrice) : 0;

  return (
    <div className={styles.summaryTemplate}>
      <div className={styles.summaryHeader}>
        <h1>{settings?.site_title || 'K-POP CARD'}</h1>
        <p>WISHLIST REQUEST</p>
      </div>

      <div className={styles.summaryUser}>
        <span>Instagram:</span>
        <strong>{userIgHandle || ''}</strong>
      </div>

      <div className={styles.summaryItems}>
        {safeItems.map(item => {
          if (!item || !item.id) return null;
          const imageUrl = item.image_url || '';
          const title = item.title || 'Untitled';
          const groupName = item.group_name || '';
          const quantity = Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 1;
          const price = Number.isFinite(Number(item.unit_price))
            ? Number(item.unit_price)
            : Number.isFinite(Number(item.price)) ? Number(item.price) : 0;
          const optionLabel = item.option_label || '';
          return (
            <div key={item.id} className={styles.summaryItem}>
              <div className={styles.summaryThumb}>
                <img
                  src={buildReceiptImageSrc(imageUrl, `${cacheKey}-${item.id}-${quantity}`)}
                  alt={title}
                  loading="eager"
                  decoding="sync"
                />
              </div>
              <div className={styles.summaryItemInfo}>
                <h4>{title}</h4>
                <p>{[groupName, optionLabel].filter(Boolean).join(' · ')}</p>
              </div>
              <div className={styles.summaryItemPrice}>
                ${price.toFixed(2)}
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.summaryFooter}>
        <div className={styles.summaryTotal}>
          <span>TOTAL ESTIMATED</span>
          <h2>${safeTotalPrice.toFixed(2)}</h2>
        </div>
        <div className={styles.summaryNextStep}>
          <span>Next step</span>
          <p>{settings?.wishlist_footer_note || ''}</p>
          <strong>{settings?.official_ig_handle || ''}</strong>
        </div>
      </div>
    </div>
  );
}
