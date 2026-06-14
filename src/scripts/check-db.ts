import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function check() {
  const { count, error } = await supabase.from('cards').select('*', { count: 'exact', head: true });
  if (error) console.error(error);
  else console.log('Current Cards in DB:', count);
}
check();



