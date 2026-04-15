import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { getHubSpotClient } from '../lib/hubspot/client';
import { TRACKED_STAGES } from '../lib/hubspot/stage-mappings';

const toTimestamp = (value: string | undefined | null): string | null => {
  if (!value || value === '') return null;
  if (/^\d{13}$/.test(value)) {
    return new Date(parseInt(value, 10)).toISOString();
  }
  return value;
};

async function main() {
  console.log('=== Debug: Upsert Error for a Single Deal ===\n');

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get Arc of Anchorage deal from Supabase (just to get the hubspot_deal_id and owner mapping)
  const { data: dbDeal } = await sb
    .from('deals')
    .select('hubspot_deal_id, owner_id, hubspot_owner_id')
    .ilike('deal_name', '%Arc of Anchorage%')
    .limit(1)
    .single();

  if (!dbDeal) {
    console.error('Deal not found in DB');
    return;
  }

  // Fetch from HubSpot Basic API with all the properties the sync uses
  const client = getHubSpotClient();
  const DEAL_PROPERTIES = [
    'dealname', 'amount', 'closedate', 'pipeline', 'dealstage',
    'hubspot_owner_id', 'createdate', 'hs_lastmodifieddate', 'description',
    'notes_last_updated', 'lead_source__sync_', 'notes_next_activity_date',
    'hs_next_step', 'product_s', 'proposal_stage', 'hs_all_collaborator_owner_ids',
  ];

  const deal = await client.crm.deals.basicApi.getById(
    dbDeal.hubspot_deal_id,
    DEAL_PROPERTIES
  );

  // Build the exact same payload the sync job builds
  const dealData = {
    hubspot_deal_id: deal.id,
    deal_name: deal.properties.dealname,
    amount: deal.properties.amount ? parseFloat(deal.properties.amount) : null,
    close_date: toTimestamp(deal.properties.closedate),
    pipeline: deal.properties.pipeline,
    deal_stage: deal.properties.dealstage,
    description: deal.properties.description,
    owner_id: dbDeal.owner_id,
    hubspot_owner_id: deal.properties.hubspot_owner_id,
    hubspot_created_at: toTimestamp(deal.properties.createdate),
    lead_source: deal.properties['lead_source__sync_'],
    last_activity_date: toTimestamp(deal.properties.notes_last_updated),
    next_activity_date: toTimestamp(deal.properties.notes_next_activity_date),
    next_step: deal.properties.hs_next_step,
    products: deal.properties.product_s,
    deal_substage: deal.properties.proposal_stage,
    deal_collaborator: deal.properties.hs_all_collaborator_owner_ids,
    mql_entered_at: toTimestamp(deal.properties[TRACKED_STAGES?.MQL?.property]),
    sql_entered_at: toTimestamp(deal.properties[TRACKED_STAGES?.SQL?.property]),
    discovery_entered_at: toTimestamp(deal.properties[TRACKED_STAGES?.DISCOVERY?.property]),
    demo_scheduled_entered_at: toTimestamp(deal.properties[TRACKED_STAGES?.DEMO_SCHEDULED?.property]),
    demo_completed_entered_at: toTimestamp(deal.properties[TRACKED_STAGES?.DEMO_COMPLETED?.property]),
    closed_won_entered_at: toTimestamp(deal.properties[TRACKED_STAGES?.CLOSED_WON?.property]),
    synced_at: new Date().toISOString(),
  };

  console.log('Payload being sent to Supabase:');
  console.log(JSON.stringify(dealData, null, 2));

  console.log('\nAttempting upsert...');
  const { data, error } = await sb
    .from('deals')
    .upsert([dealData], { onConflict: 'hubspot_deal_id' })
    .select('hubspot_deal_id, next_step');

  if (error) {
    console.error('\nUPSERT FAILED:');
    console.error('  message:', error.message);
    console.error('  details:', error.details);
    console.error('  hint:', error.hint);
    console.error('  code:', error.code);
  } else {
    console.log('\nUPSERT SUCCEEDED:');
    console.log(JSON.stringify(data, null, 2));
  }
}

main().catch(console.error);
