import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const KNOWN_GROUPS = [
  { pattern: /\bp1harmony\b|\bp1h\b/i, name: 'P1Harmony' },
  { pattern: /\bampers&one\b|\bampersandone\b/i, name: 'Ampers&one' },
  { pattern: /\briize\b|\briz\b/i, name: 'Riize' },
  { pattern: /\bcravity\b|\bcrv\b/i, name: 'CRAVITY' },
  { pattern: /\bnct\s*wish\b|\bnctw\b/i, name: 'NCT Wish' },
  { pattern: /\bnct\b/i, name: 'NCT' },
  { pattern: /\bive\b/i, name: 'Ive' },
  { pattern: /\bstray\s*kids\b|\bskz\b/i, name: 'Stray Kids' },
  { pattern: /\bbaekhyun\b/i, name: 'Baekhyun' },
  { pattern: /\b82major\b|\b82m\b/i, name: '82major' },
  { pattern: /\baespa\b|\bh2h\b/i, name: 'aespa' },
  { pattern: /\bnewjeans\b|\bnew\s*jeans\b/i, name: 'NewJeans' },
  { pattern: /\billit\b/i, name: 'Illit' },
  { pattern: /\bkickflip\b|\bkfl\b/i, name: 'Kickflip' },
  { pattern: /\b&team\b|\badt\b/i, name: '&Team' },
  { pattern: /\bxikers\b|\bxik\b/i, name: 'Xikers' },
  { pattern: /\bchanyeol\b|\bkai\b|\bexo\b/i, name: 'EXO' },
  { pattern: /\byena\b|\bcyn\b/i, name: 'Yena' },
  { pattern: /\bxdinary\b/i, name: 'Xdinary Heroes' },
  { pattern: /\bone\s*pact\b/i, name: 'One Pact' },
  { pattern: /\bn\.flying\b/i, name: 'N.Flying' },
  { pattern: /\btxt\b|\btomorrow\s*x\s*together\b/i, name: 'TXT' },
  { pattern: /\bseventeen\b|\bsvt\b/i, name: 'Seventeen' },
  { pattern: /\bzerobaseone\b|\bzb1\b/i, name: 'ZEROBASEONE' },
  { pattern: /\blesserafim\b|\blsf\b/i, name: 'LE SSERAFIM' },
  { pattern: /\bboynextdoor\b|\bbnd\b/i, name: 'BOYNEXTDOOR' },
  { pattern: /\bnouer[a-z]*\b|\bnua\b/i, name: 'NouerA' },
  { pattern: /\bateez\b|\batz\b/i, name: 'Ateez' },
  { pattern: /\ballday\s*project\b|\ballday\b|\badp\b/i, name: 'Allday project' },
  { pattern: /\bkiiikiii\b|\bkik\b/i, name: 'kiiikiii' },
  { pattern: /\benhypen\b|\behp\b/i, name: 'Enhypen' },
  { pattern: /\btws\b/i, name: 'TWS' },
  { pattern: /\bevnne\b/i, name: 'Evnne' },
  { pattern: /\brescene\b/i, name: 'RESCENE' },
  { pattern: /\bqwer\b/i, name: 'QWER' },
  { pattern: /\bkep1er\b/i, name: 'Kep1er' },
  { pattern: /\bkiss\s*of\s*life\b/i, name: 'Kiss of Life' },
  { pattern: /\bgidle\b|\bi-dle\b|\b\(g\)i-dle\b/i, name: '(G)I-DLE' },
  { pattern: /\bcye\b/i, name: 'CYE' },
  { pattern: /\bahof\b|\bahf\b|\bxahf\b/i, name: 'ahof' },
  { pattern: /\bxlov\b/i, name: 'xlov' },
  { pattern: /\bgmmtv\b/i, name: 'GMMTV' },
  { pattern: /\bitzy\b/i, name: 'Itzy' }
];

type CardGroupRecord = {
  id: string;
  title: string | null;
  description: string | null;
  group_name: string | null;
};

async function main() {
  console.log('🚀 Starting regex-based group_name path correction...');

  let allCards: CardGroupRecord[] = [];
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
    allCards = allCards.concat(data as CardGroupRecord[]);
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
