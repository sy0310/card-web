'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import styles from './BulkUpload.module.css';

export default function BulkUpload({ onComplete }: { onComplete: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [commonMetadata, setCommonMetadata] = useState({
    price: '',
    group_name: '',
    album_era: '',
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);

    try {
      for (const file of files) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const filePath = `card-images/${fileName}`;

        // 1. Upload to Storage
        const { error: uploadError } = await supabase.storage
          .from('cards')
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        // 2. Get Public URL
        const { data: { publicUrl } } = supabase.storage
          .from('cards')
          .getPublicUrl(filePath);

        // 3. Insert into Database
        const { error: dbError } = await supabase.from('cards').insert({
          title: file.name.replace(/\.[^/.]+$/, ""), // Use filename as title
          image_url: publicUrl,
          price: parseFloat(commonMetadata.price) || 0,
          group_name: commonMetadata.group_name,
          album_era: commonMetadata.album_era,
          inventory_count: 1,
        });

        if (dbError) throw dbError;
      }

      setFiles([]);
      onComplete();
      alert('Upload successful!');
    } catch (error: any) {
      alert('Error uploading: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={`${styles.container} glass`}>
      <h3>Bulk Upload Cards</h3>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        Tip: All selected images will share the price and group information below.
      </p>

      <div className={styles.formGrid}>
        <div className={styles.inputGroup}>
          <label>Common Price</label>
          <input
            type="number"
            value={commonMetadata.price}
            onChange={(e) => setCommonMetadata({ ...commonMetadata, price: e.target.value })}
            placeholder="0.00"
          />
        </div>
        <div className={styles.inputGroup}>
          <label>Group Name</label>
          <input
            type="text"
            value={commonMetadata.group_name}
            onChange={(e) => setCommonMetadata({ ...commonMetadata, group_name: e.target.value })}
            placeholder="e.g. NewJeans"
          />
        </div>
        <div className={styles.inputGroup}>
          <label>Album / Era</label>
          <input
            type="text"
            value={commonMetadata.album_era}
            onChange={(e) => setCommonMetadata({ ...commonMetadata, album_era: e.target.value })}
            placeholder="e.g. Get Up"
          />
        </div>
      </div>

      <div className={styles.dropzone}>
        <input
          type="file"
          multiple
          accept="image/*"
          onChange={handleFileChange}
          id="file-input"
          className={styles.fileInput}
        />
        <label htmlFor="file-input">
          {files.length > 0 
            ? `${files.length} files selected` 
            : 'Drag & Drop or Click to Select Images'}
        </label>
      </div>

      <button 
        onClick={handleUpload} 
        className={styles.uploadBtn}
        disabled={uploading || files.length === 0}
      >
        {uploading ? 'Uploading...' : `Upload ${files.length} Cards`}
      </button>
    </div>
  );
}
