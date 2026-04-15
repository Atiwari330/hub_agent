import { config } from 'dotenv';
config({ path: '.env.local' });

import { getHubSpotClient } from '../lib/hubspot/client';

async function main() {
  const client = getHubSpotClient();

  console.log('Fetching ticket pipelines from HubSpot...\n');

  const response = await client.crm.pipelines.pipelinesApi.getAll('tickets');

  for (const pipeline of response.results) {
    console.log(`\n=== Pipeline: ${pipeline.label} (ID: ${pipeline.id}) ===`);
    console.log('Stages:');

    const sortedStages = [...pipeline.stages].sort(
      (a, b) => a.displayOrder - b.displayOrder
    );

    for (const stage of sortedStages) {
      const ticketState = stage.metadata?.ticketState || 'unknown';
      const stateTag = ticketState === 'CLOSED' ? ' [CLOSED]' : ' [OPEN]';

      console.log(
        `  ${stage.displayOrder}. ${stage.label}${stateTag}`
      );
      console.log(`     ID: ${stage.id}`);
      console.log(`     ticketState: ${ticketState}`);
      if (stage.metadata?.isClosed) {
        console.log(`     isClosed: ${stage.metadata.isClosed}`);
      }
    }
  }

  console.log('\n\nDone!');
}

main().catch(console.error);
