/**
 * Instagram to Supabase Migration Script
 * 
 * Usage:
 * 1. Put your exported images and .txt files in a folder named 'ig_export'
 * 2. Run: npx ts-node src/scripts/migrate-ig.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import nodeFetch from 'node-fetch';
import { SocksProxyAgent } from 'socks-proxy-agent';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const proxy = process.env.proxy;

let customFetch: typeof nodeFetch = nodeFetch;
if (proxy) {
  const cleanProxy = proxy.replace('http://', '').replace('https://', '');
  const socksProxy = `socks5h://${cleanProxy}`;
  console.log(`🌐 Routing Supabase requests through SOCKS5 proxy: ${socksProxy}`);
  const agent = new SocksProxyAgent(socksProxy);
  customFetch = (url, init) => {
    return nodeFetch(url, {
      ...init,
      agent
    });
  };
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  global: {
    fetch: customFetch as unknown as typeof fetch
  }
});

const EXPORT_DIR = path.join(process.cwd(), 'ig_export');

async function migrate() {
  console.log('🚀 Starting migration...');

  if (!fs.existsSync(EXPORT_DIR)) {
    console.error(`❌ Folder 'ig_export' not found! Please create it and put your IG data inside.`);
    return;
  }

  const files = fs.readdirSync(EXPORT_DIR);
  const textFiles = files.filter(f => f.endsWith('.txt'));

  console.log(`🔍 Fetching existing migrated cards from database...`);
  const { data: existingCards, error: fetchError } = await supabase
    .from('cards')
    .select('title, description');

  if (fetchError) {
    console.error('❌ Failed to fetch existing cards:', fetchError.message);
    return;
  }

  const existingKeys = new Set((existingCards || []).map(c => `${c.title}::${c.description}`));
  console.log(`ℹ️ Found ${existingKeys.size} existing Instagram cards in database.`);

  console.log(`🚀 Starting migration of ${textFiles.length} posts...`);

  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < textFiles.length; i++) {
    const txtFile = textFiles[i];
    const baseName = txtFile.replace('.txt', '');
    
    // Find the primary image (either basename.jpg or basename_1.jpg)
    const imgFile = files.find(f => 
      (f === `${baseName}.jpg` || f === `${baseName}_1.jpg` || f === `${baseName}.png`)
    );
    
    if (!imgFile) {
      console.warn(`[${i+1}/${textFiles.length}] ⚠️ No image found for ${txtFile}, skipping.`);
      continue;
    }

    try {
      const caption = fs.readFileSync(path.join(EXPORT_DIR, txtFile), 'utf-8');
      const metadata = parseCaption(caption);

      // Check if already migrated
      const key = `${metadata.title}::${caption}`;
      if (existingKeys.has(key)) {
        skippedCount++;
        continue;
      }

      const imgPath = path.join(EXPORT_DIR, imgFile);
      const fileBuffer = fs.readFileSync(imgPath);
      const extension = path.extname(imgFile);
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}${extension}`;
      
      const { error: uploadError } = await supabase.storage
        .from('cards')
        .upload(`migrated/${fileName}`, fileBuffer, { 
          contentType: 'image/jpeg',
          upsert: true 
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('cards')
        .getPublicUrl(`migrated/${fileName}`);

      const { error: dbError } = await supabase.from('cards').insert({
        title: metadata.title,
        description: caption,
        price: metadata.price,
        group_name: metadata.group,
        album_era: metadata.album_era,
        member_name: metadata.member,
        image_url: publicUrl,
        source: 'instagram',
        original_ig_url: `https://www.instagram.com/p/${baseName.split('_')[0]}/` // Best guess
      });

      if (dbError) throw dbError;

      successCount++;
      if (successCount % 10 === 0) {
        console.log(`✅ Progress: ${successCount}/${textFiles.length} (${Math.round(successCount/textFiles.length*100)}%)`);
      }
    } catch (err: unknown) {
      failCount++;
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`❌ [${i+1}/${textFiles.length}] Failed ${baseName}:`, message);
    }

    // Small delay to prevent hitting Supabase rate limits
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  printSummary(successCount, failCount, skippedCount);
}

function printSummary(success: number, fail: number, skipped: number) {
  console.log(`\n🏁 Migration Complete!`);
  console.log(`📊 Success: ${success}`);
  console.log(`⏭️ Skipped (already exist): ${skipped}`);
  console.log(`❌ Failed: ${fail}`);
}

function parseCaption(caption: string) {
  const lines = caption.split('\n');
  const firstLine = lines[0]?.trim() || '';
  
  let price = 0;
  let group = '';
  let album_era = '';
  const member = '';

  // 1. Extract Price (handles "$35 set", "$24", etc.)
  const priceMatch = caption.match(/\$(\d+)(?:\s+set)?/i);
  if (priceMatch) {
    price = parseFloat(priceMatch[1]);
  }

  // 2. Extract Group and Album from the first line
  if (firstLine.startsWith('#')) {
    const tokens = firstLine.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
      group = tokens[1];
      const lowerGroup = group.toLowerCase();
      // Beautify known groups
      if (lowerGroup === 'p1harmony') {
        group = 'P1Harmony';
      } else if (lowerGroup === 'illit') {
        group = 'Illit';
      } else if (lowerGroup === 'ampers&one') {
        group = 'Ampers&one';
      } else if (lowerGroup === '&team') {
        group = '&Team';
      } else if (lowerGroup === 'xikers') {
        group = 'Xikers';
      } else if (lowerGroup === 'riize') {
        group = 'Riize';
      }
    }
    if (tokens.length >= 3) {
      album_era = tokens[2];
    }
  }

  // 3. Extract Title (strip first token if it starts with #)
  let title = firstLine;
  if (firstLine.startsWith('#')) {
    const tokens = firstLine.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
      title = tokens.slice(1).join(' ');
    }
  }
  title = title.substring(0, 80).trim() || 'IG Post';

  return { title, price, group, album_era, member };
}

migrate();
