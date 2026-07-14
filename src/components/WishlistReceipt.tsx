import { buildReceiptImageSrc } from './checkoutImageUtils';
import {
  calculateReceiptTotal,
  compactReceiptLineItems,
  expandReceiptLineItems,
  getReceiptImageCacheKey,
  getReceiptUnitPrice,
  normalizeReceiptQuantity,
} from './wishlistReceiptUtils';
import styles from './CheckoutModal.module.css';

export type ReceiptSettings = {
  site_title: string;
  official_ig_handle: string;
  wishlist_footer_note: string;
};

export type ReceiptLineItem = {
  id: string;
  card_id?: string | null;
  purchase_option_id?: string | null;
  title: string;
  price: number;
  unit_price?: number | null;
  option_label?: string | null;
  image_url?: string | null;
  group_name?: string | null;
  album_era?: string | null;
  quantity: number;
  copy_number?: number;
  copy_count?: number;
};

export type WishlistReceiptMode = 'compact' | 'packing';

type WishlistReceiptProps = {
  settings: ReceiptSettings;
  userIgHandle: string;
  items: ReceiptLineItem[];
  totalPrice: number;
  cacheKey?: string | number;
  mode?: WishlistReceiptMode;
};

function formatMoney(value: number) {
  const cents = Math.round((Number.isFinite(value) ? value : 0) * 100);
  return `$${(cents / 100).toFixed(2)}`;
}

export default function WishlistReceipt({
  settings,
  userIgHandle,
  items,
  totalPrice,
  cacheKey = 'receipt',
  mode = 'compact',
}: WishlistReceiptProps) {
  const sourceItems = Array.isArray(items) ? items : [];
  const isPacking = mode === 'packing';
  const displayItems = isPacking
    ? expandReceiptLineItems(sourceItems)
    : compactReceiptLineItems(sourceItems);
  const renderedItemCount = displayItems.length;
  const safeTotalPrice = Number.isFinite(Number(totalPrice))
    ? Number(totalPrice)
    : calculateReceiptTotal(sourceItems);

  return (
    <div
      className={`${styles.summaryTemplate} ${isPacking ? styles.summaryTemplatePacking : ''}`}
      data-mode={mode}
      data-rendered-item-count={renderedItemCount}
    >
      <div className={styles.summaryHeader}>
        <h1>{settings?.site_title || 'K-POP CARD'}</h1>
        <p>{isPacking ? 'PACKING LIST' : 'CUSTOMER RECEIPT'}</p>
      </div>

      <div className={styles.summaryUser}>
        <span>Instagram:</span>
        <strong>{userIgHandle || ''}</strong>
      </div>

      <div className={styles.summaryItems}>
        {displayItems.map(item => {
          if (!item || !item.id) return null;
          const imageUrl = item.image_url || '';
          const title = item.title || 'Untitled';
          const groupName = item.group_name || '';
          const albumEra = item.album_era || '';
          const quantity = normalizeReceiptQuantity(item.quantity);
          const unitPrice = getReceiptUnitPrice(item);
          const optionLabel = item.option_label || '';
          const itemMeta = [groupName, albumEra, optionLabel].filter(Boolean).join(' · ');
          const copyNumber = item.copy_number || 1;
          const copyCount = item.copy_count || 1;
          return (
            <div key={item.id} className={styles.summaryItem}>
              {isPacking && <span className={styles.packingCheckbox} aria-hidden="true">□</span>}
              <div className={styles.summaryThumb}>
                <img
                  src={buildReceiptImageSrc(
                    imageUrl,
                    getReceiptImageCacheKey(item, cacheKey, mode),
                  )}
                  alt={title}
                  loading="eager"
                  decoding="sync"
                />
              </div>
              <div className={styles.summaryItemInfo}>
                <h4>{title}</h4>
                <p>{itemMeta}</p>
                {isPacking && (
                  <span className={styles.packingCopy}>Copy {copyNumber} of {copyCount}</span>
                )}
              </div>
              {isPacking ? (
                <div className={styles.summaryPackingMeta}>PICK</div>
              ) : (
                <div className={styles.summaryItemPrice}>
                  <span className={styles.summaryItemUnitPrice}>
                    {formatMoney(unitPrice)}
                    {quantity > 1 && (
                      <span className={styles.summaryItemQuantity}> × {quantity}</span>
                    )}
                  </span>
                  <strong className={styles.summaryItemLineTotal}>
                    {formatMoney(unitPrice * quantity)}
                  </strong>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.summaryFooter}>
        <div className={styles.summaryTotal}>
          <span>{isPacking ? 'ORDER TOTAL' : 'TOTAL ESTIMATED'}</span>
          <h2>{formatMoney(safeTotalPrice)}</h2>
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
