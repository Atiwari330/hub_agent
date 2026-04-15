import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { getHubSpotClient } from '../lib/hubspot/client';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/deals';

const DEAL_NAME = 'Arc of Anchorage';

async function main() {
  console.log(`\n=== Debug: Next Step Sync for "${DEAL_NAME}" ===\n`);

  // --- Step 1: Query Supabase for the deal ---
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: dbDeal, error: dbError } = await supabase
    .from('deals')
    .select('hubspot_deal_id, deal_name, next_step, next_step_last_updated_at, synced_at')
    .ilike('deal_name', `%${DEAL_NAME}%`)
    .limit(1)
    .single();

  if (dbError || !dbDeal) {
    console.error('Supabase query failed:', dbError?.message);
    return;
  }

  const hubspotDealId = dbDeal.hubspot_deal_id;
  console.log(`Found in Supabase: hubspot_deal_id = ${hubspotDealId}`);
  console.log(`  deal_name:                ${dbDeal.deal_name}`);
  console.log(`  next_step (DB):           ${JSON.stringify(dbDeal.next_step)}`);
  console.log(`  next_step_last_updated_at: ${dbDeal.next_step_last_updated_at}`);
  console.log(`  synced_at:                ${dbDeal.synced_at}`);

  // --- Step 2: Query HubSpot Basic API (real-time, bypasses search index) ---
  const client = getHubSpotClient();

  console.log(`\n--- HubSpot Basic API (real-time) ---`);
  try {
    const basicDeal = await client.crm.deals.basicApi.getById(
      hubspotDealId,
      ['dealname', 'hs_next_step', 'hs_lastmodifieddate']
    );
    console.log(`  dealname:              ${basicDeal.properties.dealname}`);
    console.log(`  hs_next_step:          ${JSON.stringify(basicDeal.properties.hs_next_step)}`);
    console.log(`  hs_lastmodifieddate:   ${basicDeal.properties.hs_lastmodifieddate}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  Basic API error: ${msg}`);
  }

  // --- Step 3: Query HubSpot Search API (uses search index, may lag) ---
  console.log(`\n--- HubSpot Search API (indexed) ---`);
  try {
    const searchResponse = await client.crm.deals.searchApi.doSearch({
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'hs_object_id',
              operator: FilterOperatorEnum.Eq,
              value: hubspotDealId,
            },
          ],
        },
      ],
      properties: ['dealname', 'hs_next_step', 'hs_lastmodifieddate'],
      limit: 1,
    });

    if (searchResponse.results.length === 0) {
      console.log('  No results from Search API!');
    } else {
      const searchDeal = searchResponse.results[0];
      console.log(`  dealname:              ${searchDeal.properties.dealname}`);
      console.log(`  hs_next_step:          ${JSON.stringify(searchDeal.properties.hs_next_step)}`);
      console.log(`  hs_lastmodifieddate:   ${searchDeal.properties.hs_lastmodifieddate}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  Search API error: ${msg}`);
  }

  // --- Step 4: Comparison ---
  console.log(`\n--- Summary ---`);
  console.log(`Compare the hs_next_step values above.`);
  console.log(`If Basic API has the new value but Search API doesn't → Search index lag`);
  console.log(`If both HubSpot APIs have it but DB doesn't → Upsert issue`);
  console.log(`If Basic API also has old value → Update didn't save in HubSpot\n`);
}

main().catch(console.error);
