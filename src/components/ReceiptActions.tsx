'use client';

import { useEffect, useState } from 'react';
import { canShareFile, isAbortError, downloadReceiptBlob } from './receiptUtils';
import styles from './ReceiptActions.module.css';

export default function ReceiptActions({ token }: { token: string }) {
  const downloadUrl = `/api/receipts/${token}/download`;
  const [file, setFile] = useState<File | null>(null);
  const [preloadStatus, setPreloadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [shareError, setShareError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let isMounted = true;

    async function preloadReceiptFile() {
      setPreloadStatus('loading');
      setShareError(null);

      try {
        const response = await fetch(downloadUrl, {
          cache: 'no-store',
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch receipt file (status ${response.status}).`);
        }

        const rawContentType = response.headers.get('content-type') || '';
        const contentType = rawContentType.split(';')[0].trim().toLowerCase();

        if (contentType !== 'image/png') {
          throw new Error('Receipt response was not a PNG image.');
        }

        const blob = await response.blob();
        if (blob.size === 0) {
          throw new Error('Receipt image was empty.');
        }

        const receiptFile = new File([blob], 'wishlist-receipt.png', { type: 'image/png' });

        if (isMounted) {
          setFile(receiptFile);
          setPreloadStatus('ready');
        }
      } catch (error: unknown) {
        if (isAbortError(error) || controller.signal.aborted) return;
        console.warn('Could not preload receipt file for sharing:', error);
        if (isMounted) {
          setPreloadStatus('error');
        }
      }
    }

    void preloadReceiptFile();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [downloadUrl, reloadKey]);

  const handleShare = async () => {
    setShareError(null);
    if (!file || preloadStatus !== 'ready') return;

    if (canShareFile(file)) {
      try {
        await navigator.share({
          title: 'Wishlist Receipt',
          files: [file],
        });
        return;
      } catch (error: unknown) {
        if (isAbortError(error)) {
          return;
        }
        setShareError('Sharing receipt failed. Try downloading instead.');
        return;
      }
    }

    // Fallback: If Web Share file sharing is not supported, trigger download
    downloadReceiptBlob(file, 'wishlist-receipt.png');
  };

  return (
    <div className={styles.container}>
      <div className={styles.buttonGroup}>
        <button
          className={styles.shareBtn}
          onClick={handleShare}
          disabled={preloadStatus !== 'ready'}
        >
          {preloadStatus === 'loading'
            ? 'Preparing Share...'
            : 'Save / Share Receipt'}
        </button>

        <a className={styles.downloadBtn} href={downloadUrl}>
          Download Receipt
        </a>
      </div>

      {shareError && <p className={styles.errorMessage}>{shareError}</p>}
      {preloadStatus === 'error' && (
        <div className={styles.errorContainer}>
          <p className={styles.hintMessage}>
            Direct system file share preloading failed. You can retry preparing or use the Download button above.
          </p>
          <button
            className={styles.retryShareBtn}
            onClick={() => setReloadKey(prev => prev + 1)}
          >
            Retry Preparing Share
          </button>
        </div>
      )}
    </div>
  );
}
