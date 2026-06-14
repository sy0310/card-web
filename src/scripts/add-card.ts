/**
 * CLI script to add a new card to Supabase.
 * 
 * Usage:
 * npx ts-node src/scripts/add-card.ts --title "Card Title" --price 15.00 --group "NewJeans" --member "Minji" --image "./path/to/image.jpg"
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const args = process.argv.slice(2);
  const params: { [key: string]: string } = {};

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    const val = args[i + 1];
    if (key && val) {
      params[key] = val;
    }
  }

  const title = params.title || params.t;
  const priceStr = params.price || params.p;
  const group = params.group || params.g;
  const member = params.member || params.m;
  const imagePath = params.image || params.i;

  if (!title || !priceStr || !group || !imagePath) {
    console.error('❌ Missing required parameters!');
    console.log('Usage: npx ts-node src/scripts/add-card.ts --title "Title" --price 15 --group "Group" --member "Member" --image "./path/to/image.jpg"');
    process.exit(1);
  }

  const price = parseFloat(priceStr);
  if (isNaN(price)) {
    console.error('❌ Price must be a valid number!');
    process.exit(1);
  }

  const absoluteImagePath = path.resolve(imagePath);
  if (!fs.existsSync(absoluteImagePath)) {
    console.error(`❌ Image file not found at: ${absoluteImagePath}`);
    process.exit(1);
  }

  console.log('🚀 Starting card creation...');
  console.log(`📝 Title: ${title}`);
  console.log(`💰 Price: $${price}`);
  console.log(`👥 Group: ${group}`);
  console.log(`👤 Member: ${member || 'N/A'}`);
  console.log(`🖼️ Image Path: ${absoluteImagePath}`);

  try {
    // 1. Read file buffer
    const fileBuffer = fs.readFileSync(absoluteImagePath);
    const extension = path.extname(absoluteImagePath);
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}${extension}`;
    
    // Determine content type
    let contentType = 'image/jpeg';
    if (extension.toLowerCase() === '.png') contentType = 'image/png';
    else if (extension.toLowerCase() === '.webp') contentType = 'image/webp';

    console.log('📤 Uploading image to Supabase Storage [cards/manual]...');
    const { error: uploadError } = await supabase.storage
      .from('cards')
      .upload(`manual/${fileName}`, fileBuffer, { 
        contentType,
        upsert: true 
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('cards')
      .getPublicUrl(`manual/${fileName}`);

    console.log(`✅ Image uploaded successfully: ${publicUrl}`);

    // 2. Insert card record into database
    console.log('💾 Inserting record into Supabase database [cards]...');
    const { data: insertedData, error: dbError } = await supabase.from('cards').insert({
      title,
      description: `Manual upload of ${title} for group ${group}`,
      price,
      group_name: group,
      member_name: member || null,
      image_url: publicUrl,
      source: 'manual',
      inventory_count: 1
    }).select();

    if (dbError) throw dbError;

    console.log('🎉 Card created successfully!');
    console.log('Record details:', JSON.stringify(insertedData, null, 2));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Failed to add card:', message);
    process.exit(1);
  }
}

main();
