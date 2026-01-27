import { getHubSpotClient } from '../lib/hubspot/client';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/deals';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const NEW_PROPERTIES = [
  'dealname',
  'createdate',
  'lead_source__sync_',
  'notes_last_updated',
  'notes_next_activity_date',
  'hs_next_step',
  'product_s',
  'proposal_stage',
];

async function testRecentDeals() {
  const client = getHubSpotClient();

  // Get recent deals (created in last 90 days)
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const response = await client.crm.deals.searchApi.doSearch({
    filterGroups: [
      {
        filters: [
          {
            propertyName: 'createdate',
            operator: FilterOperatorEnum.Gte,
            value: ninetyDaysAgo.getTime().toString(),
          },
        ],
      },
    ],
    properties: NEW_PROPERTIES,
    limit: 10,
    sorts: ['createdate'],
  });

  console.log('=== TESTING NEW PROPERTIES ON RECENT DEALS ===\n');
  console.log('Found', response.results.length, 'recent deals\n');

  for (const deal of response.results) {
    console.log('Deal:', deal.properties.dealname);
    console.log('  createdate:', deal.properties.createdate || '(empty)');
    console.log('  lead_source:', deal.properties['lead_source__sync_'] || '(empty)');
    console.log('  notes_last_updated:', deal.properties.notes_last_updated || '(empty)');
    console.log('  notes_next_activity_date:', deal.properties.notes_next_activity_date || '(empty)');
    console.log('  hs_next_step:', deal.properties.hs_next_step || '(empty)');
    console.log('  product_s:', deal.properties.product_s || '(empty)');
    console.log('  proposal_stage (Deal Substage):', deal.properties.proposal_stage || '(empty)');
    console.log('');
  }
}

testRecentDeals();
