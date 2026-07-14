const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verify() {
  console.log('Verifying Database State...');

  const { count: total, error: e1 } = await supabase.from('cards').select('*', { count: 'exact', head: true });
  const { count: unlimitedTrue, error: e2 } = await supabase.from('cards').select('*', { count: 'exact', head: true }).eq('unlimited_inventory', true);
  const { count: unlimitedFalse, error: e3 } = await supabase.from('cards').select('*', { count: 'exact', head: true }).eq('unlimited_inventory', false);
  const { count: unlimitedNull, error: e4 } = await supabase.from('cards').select('*', { count: 'exact', head: true }).is('unlimited_inventory', null);

  if (e1 || e2 || e3 || e4) {
    console.error('Error fetching data:', e1 || e2 || e3 || e4);
    return;
  }

  console.log(`Total Cards: ${total}`);
  console.log(`unlimited_inventory=true: ${unlimitedTrue}`);
  console.log(`unlimited_inventory=false: ${unlimitedFalse}`);
  console.log(`unlimited_inventory=null: ${unlimitedNull}`);
  
  if (unlimitedNull === 0 && unlimitedTrue === total) {
    console.log('SUCCESS: All cards are properly initialized to unlimited_inventory=true');
  } else {
    console.error('FAILURE: Unexpected data distribution.');
  }
}

verify();
