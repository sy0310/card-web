import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const KNOWN_GROUPS = [
  { pattern: /\bp1harmony\b|\bp1h\b/i, name: 'P1Harmony' },
  { pattern: /\bampers&one\b|\bampersandone\b/i, name: 'Ampers&one' },
  { pattern: /\briize\b|\briz\b/i, name: 'Riize' },
  { pattern: /\bcravity\b|\bfto\b/i, name: 'Cravity' },
  { pattern: /\bnct\b/i, name: 'NCT' },
  { pattern: /\bive\b/i, name: 'Ive' }, // Only matches distinct word "ive", avoiding "starriver" or "live"
  { pattern: /\bstray\s*kids\b|\bskz\b/i, name: 'Stray Kids' },
  { pattern: /\bbaekhyun\b/i, name: 'Baekhyun' },
  { pattern: /\b82major\b|\b82m\b/i, name: '82major' },
  { pattern: /\baespa\b|\bh2h\b/i, name: 'aespa' },
  { pattern: /\bnewjeans\b|\bnew\s*jeans\b/i, name: 'NewJeans' },
  { pattern: /\billit\b/i, name: 'Illit' },
  { pattern: /\bkickflip\b/i, name: 'Kickflip' },
  { pattern: /\b&team\b/i, name: '&Team' },
  { pattern: /\bxikers\b|\bxik\b/i, name: 'Xikers' },
  // Additional rules to fix wrong assignments
  { pattern: /\bchanyeol\b|\bkai\b|\bexo\b/i, name: 'EXO' },
  { pattern: /\byena\b/i, name: 'Yena' },
  { pattern: /\bxdinary\b/i, name: 'Xdinary Heroes' },
  { pattern: /\bone\s*pact\b/i, name: 'One Pact' },
  { pattern: /\bn\.flying\b/i, name: 'N.Flying' },
  { pattern: /\btxt\b|\btomorrow\s*x\s*together\b/i, name: 'TXT' }
];

async function main() {
  console.log('🚀 Starting regex-based group_name path correction...');

  let allCards: any[] = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('cards')
      .select('id, title, description, group_name')
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error('Fetch error:', error);
      return;
    }
    if (!data || data.length === 0) break;
    allCards = allCards.concat(data);
    if (data.length < pageSize) break;
    page++;
  }

  console.log(`Retrieved ${allCards.length} cards. Performing regex matching...`);

  let updatedCount = 0;

  for (const card of allCards) {
    const title = card.title || '';
    const desc = card.description || '';
    const textToSearch = `${title} ${desc}`;
    const currentGroup = card.group_name || '';

    // If group is empty, or suspicious short words
    const isSuspicious = !currentGroup || 
                         currentGroup.trim().length <= 3 || 
                         ['the', 'ahof', 'one', 'yena', 'nctw', 'h2h', 'xik', 'riz', '82m', 'exo'].includes(currentGroup.toLowerCase()) ||
                         // Force fix if it was wrongly assigned to Ive due to "starriver"
                         (currentGroup === 'Ive' && (textToSearch.toLowerCase().includes('starriver') || textToSearch.toLowerCase().includes('chanyeol') || textToSearch.toLowerCase().includes('kai') || textToSearch.toLowerCase().includes('one pact') || textToSearch.toLowerCase().includes('xdinary')));

    if (isSuspicious) {
      let matchedGroup = '';

      for (const groupConfig of KNOWN_GROUPS) {
        if (groupConfig.pattern.test(textToSearch)) {
          matchedGroup = groupConfig.name;
          break;
        }
      }

      if (matchedGroup && matchedGroup !== currentGroup) {
        console.log(`👉 Patching: "${title}" (${card.id}) -> Set group: "${matchedGroup}" (was: "${currentGroup}")`);
        const { error: patchErr } = await supabase
          .from('cards')
          .update({ group_name: matchedGroup })
          .eq('id', card.id);

        if (patchErr) {
          console.error(`   ❌ Failed to patch:`, patchErr.message);
        } else {
          updatedCount++;
        }
      }
    }
  }

  console.log(`✅ Completed. Corrected group names for ${updatedCount} cards.`);
}

main();
