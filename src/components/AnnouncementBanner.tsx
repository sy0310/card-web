'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import styles from './AnnouncementBanner.module.css';

const defaultText = 'IG @meguro_abebe pls check carrd go rules before DM !!';

type BannerSettings = {
  enabled: boolean;
  text: string;
};

export default function AnnouncementBanner() {
  const [settings, setSettings] = useState<BannerSettings>({ enabled: true, text: defaultText });

  useEffect(() => {
    let active = true;

    void supabase
      .from('site_settings')
      .select('key, value')
      .in('key', ['banner_enabled', 'banner_text'])
      .then(({ data, error }) => {
        if (!active || error) return;

        const values = new Map((data ?? []).map(row => [row.key, row.value]));
        const text = String(values.get('banner_text') ?? '').trim() || defaultText;
        setSettings({
          enabled: values.get('banner_enabled') !== 'false',
          text,
        });
      });

    return () => {
      active = false;
    };
  }, []);

  if (!settings.enabled) return null;

  return (
    <aside className={styles.banner} aria-label="Store announcement">
      <p className={styles.track}>{settings.text}</p>
    </aside>
  );
}
