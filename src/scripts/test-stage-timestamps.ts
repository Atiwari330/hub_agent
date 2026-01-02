import { config } from 'dotenv';
config({ path: '.env.local' });

import { getHubSpotClient } from '../lib/hubspot/client';

// Sales pipeline stage IDs for tracking
const SALES_STAGES = {
  SQL: '17915773',
  DEMO_SCHEDULED: 'baedc188-ba76-4a41-8723-5bb99fe7c5bf',
  DEMO_COMPLETED: '963167283',
  CLOSED_WON: '97b2bcc6-fb34-4b56-8e6e-c349c88ef3d5',
} as const;

async function main() {
  console.log('Testing stage timestamp properties from HubSpot...\n');

  const client = getHubSpotClient();

  // Build property names for stage entry timestamps
  const stageProperties = Object.entries(SALES_STAGES).map(([name, id]) => ({
    name,
    property: `hs_v2_date_entered_${id}`,
  }));

  console.log('Fetching these properties:');
  stageProperties.forEach(({ name, property }) => {
    console.log(`  - ${name}: ${property}`);
  });

  // Fetch a few deals with these properties
  const properties = [
    'dealname',
    'dealstage',
    'amount',
    'createdate',
    ...stageProperties.map((s) => s.property),
  ];

  // Search for deals created in 2025-2026 (more recent)
  console.log('\nSearching for recent deals (2025+)...\n');

  const { FilterOperatorEnum } = await import('@hubspot/api-client/lib/codegen/crm/deals');

  const searchResponse = await client.crm.deals.searchApi.doSearch({
    filterGroups: [
      {
        filters: [
          {
            propertyName: 'createdate',
            operator: FilterOperatorEnum.Gte,
            value: '2025-01-01',
          },
        ],
      },
    ],
    properties,
    limit: 10,
  });

  console.log(`Found ${searchResponse.total} deals created in 2025+\n`);

  for (const deal of searchResponse.results) {
    console.log(`\n=== ${deal.properties.dealname} ===`);
    console.log(`  Deal Stage: ${deal.properties.dealstage}`);
    console.log(`  Amount: ${deal.properties.amount}`);
    console.log(`  Created: ${deal.properties.createdate}`);

    for (const { name, property } of stageProperties) {
      const value = deal.properties[property];
      console.log(`  ${name} entered: ${value || 'N/A'}`);
    }
  }

  console.log('\n\nDone!');
}

main().catch(console.error);
