import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function check() {
  const { data, error } = await supabase.from('cards').select('id, title, source, created_at').limit(20);
  if (error) console.error(error);
  else console.log('Current Cards in DB:', JSON.stringify(data, null, 2));
}
check();
