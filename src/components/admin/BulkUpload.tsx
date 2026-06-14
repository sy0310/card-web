'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import styles from './BulkUpload.module.css';

export default function BulkUpload({ onComplete }: { onComplete: () => void }) {
  const [activeTab, setActiveTab] = useState<'bulk' | 'single'>('bulk');
  const [uploading, setUploading] = useState(false);

  // Bulk Upload states
  const [files, setFiles] = useState<File[]>([]);
  const [commonMetadata, setCommonMetadata] = useState({
    price: '',
    group_name: '',
    album_era: '',
  });

  // Single Upload & Sync states
  const [singleData, setSingleData] = useState({
    title: '',
    price: '',
    group_name: '',
    album_era: '',
    pob_name: '',
    inventory_count: '1',
    syncToIg: false,
    igCaption: '',
  });
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [singleFilePreview, setSingleFilePreview] = useState<string>('');
  const [isDragActive, setIsDragActive] = useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'));
      if (droppedFiles.length === 0) return;

      if (activeTab === 'bulk') {
        setFiles(prev => [...prev, ...droppedFiles]);
      } else {
        const file = droppedFiles[0];
        setSingleFile(file);
        setSingleFilePreview(URL.createObjectURL(file));
        if (!singleData.title.trim()) {
          const titleWithoutExt = file.name.replace(/\.[^/.]+$/, "");
          setSingleData(prev => ({ ...prev, title: titleWithoutExt }));
        }
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const handleSingleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setSingleFile(file);
    if (file) {
      setSingleFilePreview(URL.createObjectURL(file));
      // Auto fill title with filename without extension if title is empty
      if (!singleData.title.trim()) {
        const titleWithoutExt = file.name.replace(/\.[^/.]+$/, "");
        setSingleData(prev => ({ ...prev, title: titleWithoutExt }));
      }
    } else {
      setSingleFilePreview('');
    }
  };

  const handleSingleFieldChange = (field: string, value: string | boolean) => {
    setSingleData(prev => {
      const next = { ...prev, [field]: value };
      
      // Auto-generate Instagram Caption based on group, album, pob
      if (['group_name', 'album_era', 'pob_name'].includes(field)) {
        const parts = [];
        if (next.group_name.trim()) parts.push(`#${next.group_name.trim()}`);
        if (next.album_era.trim()) parts.push(next.album_era.trim());
        if (next.pob_name.trim()) parts.push(next.pob_name.trim());
        next.igCaption = parts.join(' ');
      }
      return next;
    });
  };

  const handleBulkUpload = async () => {
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
          group_name: commonMetadata.group_name.trim(),
          album_era: commonMetadata.album_era.trim(),
          inventory_count: 1,
        });

        if (dbError) throw dbError;
      }

      setFiles([]);
      onComplete();
      alert('Upload successful!');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert('Error uploading: ' + message);
    } finally {
      setUploading(false);
    }
  };

  const handleSingleUpload = async () => {
    if (!singleFile) {
      alert('Please select an image file first.');
      return;
    }
    if (!singleData.title.trim()) {
      alert('Title is required.');
      return;
    }

    setUploading(true);
    try {
      // 1. Upload to Storage
      const fileExt = singleFile.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `card-images/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('cards')
        .upload(filePath, singleFile);

      if (uploadError) throw uploadError;

      // 2. Get Public URL
      const { data: { publicUrl } } = supabase.storage
        .from('cards')
        .getPublicUrl(filePath);

      // 3. Insert into Database
      const priceVal = parseFloat(singleData.price) || 0;
      const stockVal = parseInt(singleData.inventory_count) || 1;

      const { data: insertedCard, error: dbError } = await supabase
        .from('cards')
        .insert({
          title: singleData.title.trim(),
          image_url: publicUrl,
          price: priceVal,
          group_name: singleData.group_name.trim(),
          album_era: singleData.album_era.trim(),
          pob_name: singleData.pob_name.trim(),
          inventory_count: stockVal,
          source: 'manual'
        })
        .select('*')
        .single();

      if (dbError) throw dbError;

      // 4. Sync to Instagram if checked
      if (singleData.syncToIg && insertedCard) {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        const res = await fetch('/api/admin/publish-instagram', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token || ''}`,
          },
          body: JSON.stringify({
            imageUrl: publicUrl,
            caption: singleData.igCaption,
            cardId: insertedCard.id,
          }),
        });

        const syncResult = await res.json();
        if (!res.ok || syncResult.error) {
          alert(`Card uploaded successfully to website, but Instagram Sync failed: ${syncResult.error || 'Unknown error'}`);
        } else {
          alert('Upload and Instagram Sync successful!');
        }
      } else {
        alert('Upload successful!');
      }

      // Reset Single Form
      setSingleData({
        title: '',
        price: '',
        group_name: '',
        album_era: '',
        pob_name: '',
        inventory_count: '1',
        syncToIg: false,
        igCaption: '',
      });
      setSingleFile(null);
      setSingleFilePreview('');
      onComplete();
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      alert('Error uploading: ' + errMsg);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={`${styles.container} glass`}>
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'bulk' ? styles.active : ''}`}
          onClick={() => setActiveTab('bulk')}
        >
          Bulk Upload
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'single' ? styles.active : ''}`}
          onClick={() => setActiveTab('single')}
        >
          Single Upload & Sync
        </button>
      </div>

      {activeTab === 'bulk' ? (
        <>
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

          <div 
            className={`${styles.dropzone} ${isDragActive ? styles.dragActive : ''}`}
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
          >
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
            onClick={handleBulkUpload} 
            className={styles.uploadBtn}
            disabled={uploading || files.length === 0}
          >
            {uploading ? 'Uploading...' : `Upload ${files.length} Cards`}
          </button>
        </>
      ) : (
        <div className={styles.singleUploadLayout}>
          <h3>Single Upload & Instagram Sync</h3>
          
          {singleFilePreview && (
            <div className={styles.previewBox}>
              <img src={singleFilePreview} alt="Preview" className={styles.previewImg} />
              <div className={styles.previewInfo}>
                <strong>{singleData.title || 'Card Title'}</strong>
                <span>Price: ${singleData.price || '0.00'}</span>
                <span>{singleData.group_name || 'No Group'} • {singleData.album_era || 'No Album'} {singleData.pob_name ? `• POB: ${singleData.pob_name}` : ''}</span>
              </div>
            </div>
          )}

          <div className={styles.row}>
            <div className={styles.inputGroup}>
              <label>Title *</label>
              <input
                type="text"
                value={singleData.title}
                onChange={(e) => handleSingleFieldChange('title', e.target.value)}
                placeholder="Card Title"
                required
              />
            </div>
            <div className={styles.inputGroup}>
              <label>Price ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={singleData.price}
                onChange={(e) => handleSingleFieldChange('price', e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.inputGroup}>
              <label>Group Name</label>
              <input
                type="text"
                value={singleData.group_name}
                onChange={(e) => handleSingleFieldChange('group_name', e.target.value)}
                placeholder="e.g. aespa"
              />
            </div>
            <div className={styles.inputGroup}>
              <label>Album / Era</label>
              <input
                type="text"
                value={singleData.album_era}
                onChange={(e) => handleSingleFieldChange('album_era', e.target.value)}
                placeholder="e.g. Armageddon"
              />
            </div>
          </div>

          <div className={styles.row}>
            <div className={`${styles.inputGroup} ${styles.fullWidth}`}>
              <label>POB Name (Inclusion)</label>
              <input
                type="text"
                value={singleData.pob_name}
                onChange={(e) => handleSingleFieldChange('pob_name', e.target.value)}
                placeholder="e.g. Starriver, Makestar"
              />
            </div>
          </div>

          <div 
            className={`${styles.dropzone} ${isDragActive ? styles.dragActive : ''}`}
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
          >
            <input
              type="file"
              accept="image/*"
              onChange={handleSingleFileChange}
              id="single-file-input"
              className={styles.fileInput}
            />
            <label htmlFor="single-file-input">
              {singleFile ? singleFile.name : 'Select Card Image'}
            </label>
          </div>

          <div className={styles.row}>
            <div className={`${styles.inputGroup} ${styles.fullWidth}`}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={singleData.syncToIg}
                  onChange={(e) => handleSingleFieldChange('syncToIg', e.target.checked)}
                />
                Sync post to Instagram
              </label>
            </div>
          </div>

          {singleData.syncToIg && (
            <div className={styles.row}>
              <div className={`${styles.inputGroup} ${styles.fullWidth}`}>
                <label>Instagram Caption</label>
                <textarea
                  rows={4}
                  value={singleData.igCaption}
                  onChange={(e) => handleSingleFieldChange('igCaption', e.target.value)}
                  placeholder="Instagram Caption text..."
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--glass-border)',
                    padding: '0.75rem',
                    borderRadius: '8px',
                    color: 'white',
                    fontFamily: 'inherit',
                  }}
                />
              </div>
            </div>
          )}

          <button 
            onClick={handleSingleUpload} 
            className={styles.uploadBtn}
            disabled={uploading || !singleFile}
          >
            {uploading ? 'Uploading & Syncing...' : 'Upload Card & Sync'}
          </button>
        </div>
      )}
    </div>
  );
}
