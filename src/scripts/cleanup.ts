import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function cleanup() {
  console.log('🧹 Clearing ALL database records...');
  const { error: dbError, count } = await supabase
    .from('cards')
    .delete({ count: 'exact' })
    .neq('id', '00000000-0000-0000-0000-000000000000');
  
  if (dbError) console.error('❌ DB Error:', dbError.message);
  else console.log(`✅ Cleared ${count} records.`);

  console.log('🗑️ Clearing files from Storage bucket [cards]...');
  const { data: files, error: listError } = await supabase.storage
    .from('cards')
    .list('migrated');

  if (files && files.length > 0) {
    const paths = files.map(f => `migrated/${f.name}`);
    const { error: deleteError } = await supabase.storage.from('cards').remove(paths);
    if (deleteError) console.error('❌ Storage Error:', deleteError.message);
    else console.log(`✅ Deleted ${files.length} files from Storage.`);
  } else {
    console.log('ℹ️ No files found in Storage.');
  }
}
cleanup();
