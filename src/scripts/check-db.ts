import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function check() {
  const { data, error } = await supabase
    .from('cards')
    .select('id, title, image_url')
    .eq('source', 'instagram')
    .limit(5);

  if (error) {
    console.error('Fetch cards error:', error);
    return;
  }

  console.log('Sample cards in database:', data);

  if (data && data.length > 0) {
    const firstUrl = data[0].image_url;
    console.log(`\nTesting fetch on image URL: ${firstUrl}`);
    
    // We import node-fetch dynamically or just fetch
    const fetch = (await import('node-fetch')).default;
    try {
      const res = await fetch(firstUrl);
      console.log(`HTTP Status: ${res.status} ${res.statusText}`);
      console.log('Headers:', res.headers.raw());
      if (!res.ok) {
        const text = await res.text();
        console.log('Error Response body:', text);
      } else {
        console.log('✅ Image URL is accessible! Response OK.');
      }
    } catch (e: any) {
      console.error('Fetch error:', e.message);
    }
  }
}
check();



