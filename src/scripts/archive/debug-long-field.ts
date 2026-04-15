import { config } from 'dotenv';
config({ path: '.env.local' });

import { getHubSpotClient } from '../lib/hubspot/client';

async function main() {
  const client = getHubSpotClient();
  const deal = await client.crm.deals.basicApi.getById('42824615766', [
    'dealname', 'amount', 'closedate', 'pipeline', 'dealstage',
    'hubspot_owner_id', 'createdate', 'hs_lastmodifieddate', 'description',
    'notes_last_updated', 'lead_source__sync_', 'notes_next_activity_date',
    'hs_next_step', 'product_s', 'proposal_stage', 'hs_all_collaborator_owner_ids',
  ]);

  const fields: [string, string | null][] = [
    ['dealname', deal.properties.dealname],
    ['description', deal.properties.description],
    ['lead_source', deal.properties['lead_source__sync_']],
    ['hs_next_step', deal.properties.hs_next_step],
    ['product_s', deal.properties.product_s],
    ['proposal_stage', deal.properties.proposal_stage],
    ['hs_all_collaborator_owner_ids', deal.properties.hs_all_collaborator_owner_ids],
  ];

  console.log('=== Field lengths for deal 42824615766 ===\n');
  for (const [name, value] of fields) {
    const len = value?.length ?? 0;
    const flag = len > 500 ? ' <<<< TOO LONG!' : '';
    console.log(`${name}: ${len} chars${flag}`);
    if (len > 200) {
      console.log(`  Value: ${value?.substring(0, 200)}...`);
    }
  }
}

main().catch(console.error);
