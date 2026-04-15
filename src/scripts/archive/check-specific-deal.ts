import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { getHubSpotClient } from '../lib/hubspot/client';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DEAL_NAME_SEARCH = 'Altura Recovery';

async function main() {
  console.log(`=== INVESTIGATING DEAL: "${DEAL_NAME_SEARCH}" ===\n`);

  // Check database first
  console.log('--- DATABASE CHECK ---');
  const { data: dbDeal, error } = await supabase
    .from('deals')
    .select('deal_name, hubspot_deal_id, hubspot_created_at, created_at')
    .ilike('deal_name', `%${DEAL_NAME_SEARCH}%`)
    .single();

  if (error) {
    console.log('DB Error:', error.message);
    return;
  }

  if (!dbDeal) {
    console.log('Deal not found in database');
    return;
  }

  console.log('Deal Name:', dbDeal.deal_name);
  console.log('HubSpot Deal ID:', dbDeal.hubspot_deal_id);
  console.log('hubspot_created_at:', dbDeal.hubspot_created_at || 'NULL');
  console.log('created_at (DB record):', dbDeal.created_at);

  // Check HubSpot directly
  console.log('\n--- HUBSPOT API CHECK ---');
  const client = getHubSpotClient();
  const deal = await client.crm.deals.basicApi.getById(
    dbDeal.hubspot_deal_id,
    ['dealname', 'createdate']
  );

  console.log('Deal Name:', deal.properties.dealname);
  console.log('createdate property:', deal.properties.createdate || 'NULL/EMPTY');
  console.log('createdAt (SDK metadata):', deal.createdAt?.toISOString() || 'NULL');

  // Compare
  console.log('\n--- DIAGNOSIS ---');
  if (!deal.properties.createdate && deal.createdAt) {
    console.log('ISSUE FOUND: HubSpot property "createdate" is empty, but SDK metadata "createdAt" has value.');
    console.log('FIX: Sync job should use deal.createdAt instead of deal.properties.createdate');
  } else if (deal.properties.createdate && !dbDeal.hubspot_created_at) {
    console.log('ISSUE FOUND: HubSpot has createdate, but database has NULL.');
    console.log('This suggests a sync/storage issue.');
  } else if (deal.properties.createdate && dbDeal.hubspot_created_at) {
    console.log('Both HubSpot and DB have values - no issue detected for this deal.');
  }
}

main().catch(console.error);
