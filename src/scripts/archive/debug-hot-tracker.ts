/**
 * Debug Hot Tracker: verify the HubSpot property name for gift/incentive
 * and check proposal-stage deals for actual values.
 *
 * Usage: npx tsx src/scripts/debug-hot-tracker.ts
 */
import { getHubSpotClient } from '../lib/hubspot/client';
import { TRACKED_STAGES } from '../lib/hubspot/stage-mappings';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/deals';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SALES_PIPELINE_ID = '1c27e5a3-5e5e-4403-ab0f-d356bf268cf3';

async function run() {
  const client = getHubSpotClient();

  // 1. Search all deal properties for "gift" or "incentive"
  console.log('=== Searching deal properties for "gift" or "incentive" ===\n');
  const propsResponse = await client.crm.properties.coreApi.getAll('deals');

  const matches = propsResponse.results.filter((p) => {
    const haystack = `${p.name} ${p.label} ${p.description || ''}`.toLowerCase();
    return haystack.includes('gift') || haystack.includes('incentive');
  });

  if (matches.length === 0) {
    console.log('No properties found matching "gift" or "incentive".');
  } else {
    for (const p of matches) {
      console.log(`  name:  ${p.name}`);
      console.log(`  label: ${p.label}`);
      console.log(`  type:  ${p.type}`);
      if (p.description) console.log(`  desc:  ${p.description}`);
      console.log('');
    }
  }

  // 2. Fetch a few proposal-stage deals and inspect the property values
  console.log('=== Fetching proposal-stage deals (up to 10) ===\n');

  const proposalProperty = TRACKED_STAGES.PROPOSAL.property;
  const dealProps = [
    'dealname',
    'dealstage',
    'hubspot_owner_id',
    'sent_gift_or_incentive',
    proposalProperty,
  ];

  // Proposal stage ID = 59865091
  const dealsResponse = await client.crm.deals.searchApi.doSearch({
    filterGroups: [
      {
        filters: [
          {
            propertyName: 'pipeline',
            operator: FilterOperatorEnum.Eq,
            value: SALES_PIPELINE_ID,
          },
          {
            propertyName: 'dealstage',
            operator: FilterOperatorEnum.Eq,
            value: '59865091',
          },
        ],
      },
    ],
    properties: dealProps,
    limit: 10,
  });

  console.log(`Found ${dealsResponse.total} deals currently in Proposal stage.\n`);

  for (const deal of dealsResponse.results) {
    console.log(`  Deal ${deal.id}: ${deal.properties.dealname}`);
    console.log(`    stage:                   ${deal.properties.dealstage}`);
    console.log(`    ${proposalProperty}: ${deal.properties[proposalProperty]}`);
    console.log(`    sent_gift_or_incentive:  ${deal.properties.sent_gift_or_incentive}`);
    console.log('');
  }
}

run().catch(console.error);
