import { getHubSpotClient } from '../lib/hubspot/client';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const NEW_PROPERTIES = [
  'dealname',
  'createdate',
  'lead_source',
  'notes_last_updated',
  'notes_next_activity_date',
  'hs_next_step',
  'product_s',
  'proposal_stage',
];

async function testProperties() {
  const client = getHubSpotClient();

  // Get a few deals with all the new properties
  const response = await client.crm.deals.basicApi.getPage(
    5,
    undefined,
    NEW_PROPERTIES
  );

  console.log('=== TESTING NEW PROPERTIES ON REAL DEALS ===\n');

  for (const deal of response.results) {
    console.log('Deal:', deal.properties.dealname);
    console.log('  createdate:', deal.properties.createdate || '(empty)');
    console.log('  lead_source:', deal.properties.lead_source || '(empty)');
    console.log('  notes_last_updated:', deal.properties.notes_last_updated || '(empty)');
    console.log('  notes_next_activity_date:', deal.properties.notes_next_activity_date || '(empty)');
    console.log('  hs_next_step:', deal.properties.hs_next_step || '(empty)');
    console.log('  product_s:', deal.properties.product_s || '(empty)');
    console.log('  proposal_stage (Deal Substage):', deal.properties.proposal_stage || '(empty)');
    console.log('');
  }

  console.log('=== ALL PROPERTIES RETRIEVED SUCCESSFULLY ===');
}

testProperties();
