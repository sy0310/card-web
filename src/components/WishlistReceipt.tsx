import { buildReceiptImageSrc } from './checkoutImageUtils';
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
  return (
    <div className={styles.summaryTemplate}>
      <div className={styles.summaryHeader}>
        <h1>{settings.site_title}</h1>
        <p>WISHLIST REQUEST</p>
      </div>

      <div className={styles.summaryUser}>
        <span>Instagram:</span>
        <strong>{userIgHandle}</strong>
      </div>

      <div className={styles.summaryItems}>
        {items.map(item => (
          <div key={item.id} className={styles.summaryItem}>
            <div className={styles.summaryThumb}>
              <img
                src={buildReceiptImageSrc(item.image_url, `${cacheKey}-${item.id}-${item.quantity}`)}
                alt={item.title}
                loading="eager"
                decoding="sync"
              />
            </div>
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
        <div className={styles.summaryNextStep}>
          <span>Next step</span>
          <p>{settings.wishlist_footer_note}</p>
          <strong>{settings.official_ig_handle}</strong>
        </div>
      </div>
    </div>
  );
}
