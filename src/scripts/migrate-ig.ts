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

type MigratedCardInsert = {
  title: string;
  description: string;
  price: number;
  group_name: string;
  album_era: string;
  member_name: string;
  image_url: string;
  source: 'instagram';
  original_ig_url: string;
};

async function getExistingStorageFiles(): Promise<Set<string>> {
  const existingFiles = new Set<string>();
  let offset = 0;
  const limit = 1000;
  
  while (true) {
    console.log(`   Fetching storage files (offset: ${offset})...`);
    const { data, error } = await supabase.storage
      .from('cards')
      .list('migrated', {
        limit,
        offset,
        sortBy: { column: 'name', order: 'asc' }
      });
      
    if (error) {
      console.error(`❌ Error listing storage files:`, error.message);
      break;
    }
    
    if (!data || data.length === 0) {
      break;
    }
    
    for (const item of data) {
      if (item.name) {
        existingFiles.add(item.name);
      }
    }
    
    if (data.length < limit) {
      break;
    }
    
    offset += limit;
  }
  
  console.log(`ℹ️ Found ${existingFiles.size} existing files in Supabase Storage.`);
  return existingFiles;
}

async function asyncPool<T, R>(
  concurrency: number,
  iterable: T[],
  iteratorFn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: Promise<R>[] = [];
  const executing: Promise<void>[] = [];
  
  for (const item of iterable) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    results.push(p);
    
    if (concurrency <= iterable.length) {
      const e: Promise<void> = p.then(() => {
        executing.splice(executing.indexOf(e), 1);
      });
      executing.push(e);
      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(results);
}

async function getExistingDbKeys(): Promise<Set<string>> {
  const existingKeys = new Set<string>();
  let offset = 0;
  const limit = 1000;
  
  while (true) {
    console.log(`   Fetching database cards (offset: ${offset})...`);
    const { data, error } = await supabase
      .from('cards')
      .select('original_ig_url')
      .range(offset, offset + limit - 1);
      
    if (error) {
      console.error(`❌ Error fetching cards from database:`, error.message);
      break;
    }
    
    if (!data || data.length === 0) {
      break;
    }
    
    for (const item of data) {
      if (item.original_ig_url) {
        existingKeys.add(item.original_ig_url);
      }
    }
    
    if (data.length < limit) {
      break;
    }
    
    offset += limit;
  }
  
  console.log(`ℹ️ Found ${existingKeys.size} existing Instagram cards in database.`);
  return existingKeys;
}

async function migrate() {
  console.log('🚀 Starting highly optimized bulk migration with complete image check...');

  if (!fs.existsSync(EXPORT_DIR)) {
    console.error(`❌ Folder 'ig_export' not found! Please create it and put your IG data inside.`);
    return;
  }

  const files = fs.readdirSync(EXPORT_DIR);
  const textFiles = files.filter(f => f.endsWith('.txt'));

  console.log(`🔍 Fetching existing storage files to see what is already uploaded...`);
  const existingStorageFiles = await getExistingStorageFiles();

  console.log(`🔍 Fetching existing migrated cards from database...`);
  const existingDbKeys = await getExistingDbKeys();

  console.log(`🚀 Processing metadata for ${textFiles.length} posts...`);

  const cardsToInsert: MigratedCardInsert[] = [];
  const uploadTasks: { baseName: string; fileName: string; imgPath: string }[] = [];
  let alreadyExistInBoth = 0;
  let onlyNeedUpload = 0;

  for (let i = 0; i < textFiles.length; i++) {
    const txtFile = textFiles[i];
    const baseName = txtFile.replace('.txt', '');
    
    // Find the primary image
    const imgFile = files.find(f => 
      (f === `${baseName}.jpg` || f === `${baseName}_1.jpg` || f === `${baseName}.png`)
    );
    
    if (!imgFile) {
      continue;
    }

    const targetIgUrl = `https://www.instagram.com/p/${baseName}/`;
    const extension = path.extname(imgFile);
    const fileName = `${baseName}${extension}`;
    const imgPath = path.join(EXPORT_DIR, imgFile);

    const hasInDb = existingDbKeys.has(targetIgUrl);
    const hasInStorage = existingStorageFiles.has(fileName);

    if (hasInDb && hasInStorage) {
      alreadyExistInBoth++;
      continue;
    }

    // If missing in Storage, we need to upload it
    if (!hasInStorage) {
      uploadTasks.push({ baseName, fileName, imgPath });
      if (hasInDb) {
        onlyNeedUpload++;
      }
    }

    // If missing in DB, we need to insert it
    if (!hasInDb) {
      try {
        const caption = fs.readFileSync(path.join(EXPORT_DIR, txtFile), 'utf-8');
        const metadata = parseCaption(caption);
        const { data: { publicUrl } } = supabase.storage
          .from('cards')
          .getPublicUrl(`migrated/${fileName}`);

        cardsToInsert.push({
          title: metadata.title,
          description: caption,
          price: metadata.price,
          group_name: metadata.group,
          album_era: metadata.album_era,
          member_name: metadata.member,
          image_url: publicUrl,
          source: 'instagram',
          original_ig_url: targetIgUrl
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error(`❌ Failed processing metadata for ${baseName}:`, message);
      }
    }
  }

  console.log(`\n📊 Analysis Results:`);
  console.log(`⏭️ Already fully migrated (DB & Storage exist): ${alreadyExistInBoth}`);
  console.log(`📤 Images needing upload to Storage: ${uploadTasks.length} (out of which ${onlyNeedUpload} already exist in DB but missed in Storage)`);
  console.log(`➕ Cards needing database insertion: ${cardsToInsert.length}`);

  // 1. Upload missing images
  if (uploadTasks.length > 0) {
    console.log(`\n📤 Starting concurrent uploads for ${uploadTasks.length} images...`);
    let uploadedCount = 0;
    let failedCount = 0;

    await asyncPool(15, uploadTasks, async (task) => {
      try {
        const fileBuffer = fs.readFileSync(task.imgPath);
        const { error: uploadError } = await supabase.storage
          .from('cards')
          .upload(`migrated/${task.fileName}`, fileBuffer, { 
            contentType: 'image/jpeg',
            upsert: true 
          });
        if (uploadError) {
          console.error(`❌ Upload failed for ${task.fileName}:`, uploadError.message);
          failedCount++;
        } else {
          uploadedCount++;
          if (uploadedCount % 50 === 0 || uploadedCount === uploadTasks.length) {
            console.log(`   Uploaded ${uploadedCount}/${uploadTasks.length} images...`);
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`❌ Exception uploading ${task.fileName}:`, message);
        failedCount++;
      }
    });
    console.log(`✅ Upload process completed. Success: ${uploadedCount}, Failed: ${failedCount}`);
  }

  // 2. Insert missing cards into database
  if (cardsToInsert.length > 0) {
    console.log(`\n🚀 Executing bulk database insertion...`);
    const chunkSize = 100;
    let insertedCount = 0;

    for (let i = 0; i < cardsToInsert.length; i += chunkSize) {
      const chunk = cardsToInsert.slice(i, i + chunkSize);
      const { error: insertErr } = await supabase
        .from('cards')
        .insert(chunk);

      if (insertErr) {
        console.error(`❌ Bulk insertion error for chunk starting at index ${i}:`, insertErr.message);
      } else {
        insertedCount += chunk.length;
        console.log(`   Inserted chunk ${i / chunkSize + 1} (${chunk.length} cards)`);
      }
    }
    console.log(`✅ Successfully inserted ${insertedCount} cards in bulk.`);
  }

  printSummary(cardsToInsert.length, 0, alreadyExistInBoth);
}

function printSummary(success: number, fail: number, skipped: number) {
  console.log(`\n🏁 Migration Complete!`);
  console.log(`📊 Success: ${success}`);
  console.log(`⏭️ Skipped (already exist): ${skipped}`);
  console.log(`❌ Failed: ${fail}`);
}

const GROUP_MAP: Record<string, string> = {
  'svt': 'Seventeen',
  'seventeen': 'Seventeen',
  '82major': '82major',
  '82m': '82major',
  'p1h': 'P1Harmony',
  'p1harmony': 'P1Harmony',
  'zb1': 'ZEROBASEONE',
  'zerobaseone': 'ZEROBASEONE',
  'lsf': 'LE SSERAFIM',
  'lesserafim': 'LE SSERAFIM',
  'adt': '&Team',
  '&team': '&Team',
  'amp': 'Ampers&one',
  'ampers&one': 'Ampers&one',
  'nct': 'NCT',
  'nctw': 'NCT Wish',
  'crv': 'CRAVITY',
  'cravity': 'CRAVITY',
  'bnd': 'BOYNEXTDOOR',
  'boynextdoor': 'BOYNEXTDOOR',
  'kfl': 'Kickflip',
  'kickflip': 'Kickflip',
  'cye': 'CYE',
  'ahf': 'ahof',
  'ahof': 'ahof',
  'xahf': 'ahof',
  'xlov': 'xlov',
  'nua': 'NouerA',
  'nouera': 'NouerA',
  'atz': 'Ateez',
  'ateez': 'Ateez',
  'cyn': 'Yena',
  'yena': 'Yena',
  'adp': 'Allday project',
  'allday': 'Allday project',
  'kik': 'kiiikiii',
  'kiiikiii': 'kiiikiii',
  'ehp': 'Enhypen',
  'enhypen': 'Enhypen',
  'xik': 'Xikers',
  'xikers': 'Xikers',
  'tws': 'TWS',
  'illit': 'Illit',
  'aespa': 'aespa',
  'h2h': 'aespa',
  'txt': 'TXT',
  'itzy': 'Itzy',
  'gmmtv': 'GMMTV',
  'evnne': 'Evnne',
  'rescene': 'RESCENE',
  'qwer': 'QWER',
  'kep1er': 'Kep1er',
  'kiss of life': 'Kiss of Life',
  'gidle': '(G)I-DLE',
  'i-dle': '(G)I-DLE',
  'exo': 'EXO',
  'kai': 'EXO',
  'chanyeol': 'EXO',
  'baekhyun': 'EXO',
  'riiz': 'Riize',
  'riize': 'Riize',
  'stray': 'Stray Kids',
  'skz': 'Stray Kids'
};

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

  // 2. Parse Group, Album & Title
  if (firstLine.startsWith('#')) {
    const tokens = firstLine.split(/\s+/).filter(Boolean);
    const firstToken = tokens[0]; // e.g. "#meguronua" or "#riize"
    
    // Clean tag to extract abbreviation: remove leading '#', 'meguro', 'megurop', 'megurox'
    let rawTag = firstToken.substring(1).toLowerCase(); // remove '#'
    if (rawTag.startsWith('megurop')) {
      rawTag = rawTag.substring(7);
    } else if (rawTag.startsWith('megurox')) {
      rawTag = rawTag.substring(7);
    } else if (rawTag.startsWith('meguro')) {
      rawTag = rawTag.substring(6);
    }
    
    // Attempt to match Group from clean abbreviation
    if (GROUP_MAP[rawTag]) {
      group = GROUP_MAP[rawTag];
    }
    
    // If abbreviation not in map, check the other tokens for known group names
    if (!group) {
      for (const token of tokens) {
        const cleanedToken = token.replace(/[^a-zA-Z0-9&]/g, '').toLowerCase();
        if (GROUP_MAP[cleanedToken]) {
          group = GROUP_MAP[cleanedToken];
          break;
        }
      }
    }
    
    // If still not matched, fallback to the second token (legacy behavior)
    if (!group && tokens.length >= 2) {
      group = tokens[1];
    }
    
    // Filter out group tokens from the title/description parts
    const groupLower = group.toLowerCase();
    const groupWords = groupLower.split(/\s+/);
    
    const remainingTokens = tokens.slice(1).filter(t => {
      const cleanedT = t.toLowerCase().replace(/[^a-zA-Z0-9&]/g, '');
      if (t === firstToken) return false;
      if (cleanedT === rawTag) return false;
      if (groupWords.includes(cleanedT)) return false;
      return true;
    });

    if (remainingTokens.length >= 1) {
      album_era = remainingTokens[0];
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
