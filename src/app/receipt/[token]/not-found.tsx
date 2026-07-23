import Link from 'next/link';
import styles from './receiptPage.module.css';

export default function ReceiptNotFound() {
  return (
    <div className={styles.pageWrapper}>
      <div className={styles.cardContainer}>
        <div className={styles.errorIcon}>⚠️</div>
        <h1 className={styles.title}>Receipt Unavailable</h1>
        <p className={styles.description}>
          This receipt link is invalid, expired, or the receipt has not been generated.
        </p>
        <Link href="/" className={styles.homeLink}>
          Back to Storefront
        </Link>
      </div>
    </div>
  );
}
