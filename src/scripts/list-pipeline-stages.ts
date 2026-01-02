import { config } from 'dotenv';
config({ path: '.env.local' });

import { getAllPipelines } from '../lib/hubspot/pipelines';

async function main() {
  console.log('Fetching pipeline stages from HubSpot...\n');

  const pipelines = await getAllPipelines();

  for (const pipeline of pipelines) {
    console.log(`\n=== Pipeline: ${pipeline.label} (ID: ${pipeline.id}) ===`);
    console.log('Stages:');

    // Sort by display order
    const sortedStages = [...pipeline.stages].sort((a, b) => a.displayOrder - b.displayOrder);

    for (const stage of sortedStages) {
      const closedTag = stage.metadata.isClosed ? ' [CLOSED]' : '';
      const probTag = stage.metadata.probability !== undefined
        ? ` (${stage.metadata.probability * 100}% probability)`
        : '';

      console.log(`  ${stage.displayOrder}. ${stage.label}${closedTag}${probTag}`);
      console.log(`     ID: ${stage.id}`);
      console.log(`     hs_v2_date_entered property: hs_v2_date_entered_${stage.id}`);
    }
  }

  console.log('\n\nDone!');
}

main().catch(console.error);
