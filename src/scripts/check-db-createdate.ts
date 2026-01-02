import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('=== DATABASE hubspot_created_at CHECK ===\n');

  // Count deals with/without hubspot_created_at
  const { count: totalDeals } = await supabase
    .from('deals')
    .select('*', { count: 'exact', head: true });

  const { count: withCreatedate } = await supabase
    .from('deals')
    .select('*', { count: 'exact', head: true })
    .not('hubspot_created_at', 'is', null);

  const { count: withoutCreatedate } = await supabase
    .from('deals')
    .select('*', { count: 'exact', head: true })
    .is('hubspot_created_at', null);

  console.log(`Total deals: ${totalDeals}`);
  console.log(`With hubspot_created_at: ${withCreatedate}`);
  console.log(`Without hubspot_created_at: ${withoutCreatedate}`);

  // Get sample of deals WITH hubspot_created_at
  console.log('\n--- SAMPLE WITH hubspot_created_at ---');
  const { data: withData } = await supabase
    .from('deals')
    .select('deal_name, hubspot_created_at, synced_at')
    .not('hubspot_created_at', 'is', null)
    .limit(3);

  for (const deal of withData || []) {
    console.log(`${deal.deal_name?.substring(0, 40)} | ${deal.hubspot_created_at} | synced: ${deal.synced_at}`);
  }

  // Get sample of deals WITHOUT hubspot_created_at
  console.log('\n--- SAMPLE WITHOUT hubspot_created_at ---');
  const { data: withoutData } = await supabase
    .from('deals')
    .select('deal_name, hubspot_created_at, synced_at')
    .is('hubspot_created_at', null)
    .limit(5);

  for (const deal of withoutData || []) {
    console.log(`${deal.deal_name?.substring(0, 40)} | ${deal.hubspot_created_at || 'NULL'} | synced: ${deal.synced_at}`);
  }
}

main().catch(console.error);
