import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { getFilteredDealsForSync } from '../lib/hubspot/deals';
import { getTargetOwners } from '../lib/hubspot/owners';
import { TRACKED_STAGES } from '../lib/hubspot/stage-mappings';

const toTimestamp = (value: string | undefined | null): string | null => {
  if (!value || value === '') return null;
  if (/^\d{13}$/.test(value)) {
    return new Date(parseInt(value, 10)).toISOString();
  }
  return value;
};

async function main() {
  console.log('=== Debug: Batch Upsert Failure ===\n');

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Step 1: Get owners the same way the sync does
  const owners = await getTargetOwners();
  console.log(`Found ${owners.length} target owners`);

  // Build ownerMap like the sync does
  const { data: dbOwners } = await sb
    .from('owners')
    .select('id, hubspot_owner_id');

  const ownerMap = new Map<string, string>();
  for (const o of dbOwners || []) {
    ownerMap.set(o.hubspot_owner_id, o.id);
  }

  // Step 2: Fetch deals the same way
  const ownerIds = owners.map((o) => o.id);
  const deals = await getFilteredDealsForSync(ownerIds);
  console.log(`Fetched ${deals.length} deals from HubSpot Search API\n`);

  // Step 3: Build the exact same payload
  const dealData = deals.map((deal) => ({
    hubspot_deal_id: deal.id,
    deal_name: deal.properties.dealname,
    amount: deal.properties.amount ? parseFloat(deal.properties.amount) : null,
    close_date: toTimestamp(deal.properties.closedate),
    pipeline: deal.properties.pipeline,
    deal_stage: deal.properties.dealstage,
    description: deal.properties.description,
    owner_id: deal.properties.hubspot_owner_id
      ? ownerMap.get(deal.properties.hubspot_owner_id) ?? null
      : null,
    hubspot_owner_id: deal.properties.hubspot_owner_id,
    hubspot_created_at: toTimestamp(deal.properties.createdate),
    lead_source: deal.properties.lead_source,
    last_activity_date: toTimestamp(deal.properties.notes_last_updated),
    next_activity_date: toTimestamp(deal.properties.notes_next_activity_date),
    next_step: deal.properties.hs_next_step,
    products: deal.properties.product_s,
    deal_substage: deal.properties.proposal_stage,
    deal_collaborator: deal.properties.hs_all_collaborator_owner_ids,
    mql_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.MQL.property]),
    sql_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.SQL.property]),
    discovery_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.DISCOVERY.property]),
    demo_scheduled_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.DEMO_SCHEDULED.property]),
    demo_completed_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.DEMO_COMPLETED.property]),
    closed_won_entered_at: toTimestamp(deal.properties[TRACKED_STAGES.CLOSED_WON.property]),
    synced_at: new Date().toISOString(),
  }));

  // Step 4: Try the full batch upsert
  console.log(`Attempting full batch upsert of ${dealData.length} deals...`);
  const { error: batchError } = await sb
    .from('deals')
    .upsert(dealData, { onConflict: 'hubspot_deal_id' });

  if (!batchError) {
    console.log('Full batch upsert SUCCEEDED! No issues found.');
    return;
  }

  console.error(`\nFull batch FAILED:`);
  console.error(`  message: ${batchError.message}`);
  console.error(`  details: ${batchError.details}`);
  console.error(`  hint: ${batchError.hint}`);
  console.error(`  code: ${batchError.code}`);

  // Step 5: Binary search to find the bad deal(s)
  console.log(`\nSearching for bad deal(s) via individual upserts...`);
  let failCount = 0;
  const failures: { dealName: string; dealId: string; error: string }[] = [];

  for (let i = 0; i < dealData.length; i++) {
    const d = dealData[i];
    const { error } = await sb
      .from('deals')
      .upsert([d], { onConflict: 'hubspot_deal_id' });

    if (error) {
      failCount++;
      failures.push({
        dealName: d.deal_name,
        dealId: d.hubspot_deal_id,
        error: error.message,
      });
      if (failures.length <= 10) {
        console.error(`  FAIL [${i}] "${d.deal_name}" (${d.hubspot_deal_id}): ${error.message}`);
        // Log the problematic field values
        console.error(`    amount: ${d.amount}, close_date: ${d.close_date}`);
        console.error(`    mql: ${d.mql_entered_at}, sql: ${d.sql_entered_at}`);
        console.error(`    discovery: ${d.discovery_entered_at}, demo_sched: ${d.demo_scheduled_entered_at}`);
        console.error(`    demo_comp: ${d.demo_completed_entered_at}, closed_won: ${d.closed_won_entered_at}`);
      }
    }
  }

  console.log(`\n--- Results ---`);
  console.log(`Total deals: ${dealData.length}`);
  console.log(`Failed: ${failCount}`);
  console.log(`Succeeded: ${dealData.length - failCount}`);

  if (failures.length > 10) {
    console.log(`\n(Showing first 10 of ${failures.length} failures)`);
  }
}

main().catch(console.error);
