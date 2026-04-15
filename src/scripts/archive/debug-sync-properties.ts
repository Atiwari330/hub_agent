import { config } from 'dotenv';
config({ path: '.env.local' });

import { getAllDeals } from '../lib/hubspot/deals';

async function main() {
  console.log('=== DEBUGGING SYNC PROPERTIES ===\n');

  // Get all deals and check the first 10
  const deals = await getAllDeals();
  console.log(`Total deals fetched: ${deals.length}\n`);

  // Find Altura Recovery specifically
  const altura = deals.find(d => d.properties.dealname?.includes('Altura Recovery'));
  if (altura) {
    console.log('--- ALTURA RECOVERY DEAL ---');
    console.log('dealname:', altura.properties.dealname);
    console.log('createdate:', altura.properties.createdate);
    console.log('createdAt (object):', altura.createdAt);
    console.log('');
  }

  // Check a sample of deals
  console.log('--- SAMPLE OF 10 DEALS ---');
  for (const deal of deals.slice(0, 10)) {
    const hasPropertyCreatedate = !!deal.properties.createdate;
    const hasObjectCreatedAt = !!deal.createdAt;
    console.log(`${deal.properties.dealname?.substring(0, 40).padEnd(40)} | prop: ${hasPropertyCreatedate ? 'YES' : 'NO '} | obj: ${hasObjectCreatedAt ? 'YES' : 'NO '}`);
  }

  // Count deals with/without createdate
  let withProperty = 0;
  let withObject = 0;
  let withNeither = 0;

  for (const deal of deals) {
    if (deal.properties.createdate) withProperty++;
    if (deal.createdAt) withObject++;
    if (!deal.properties.createdate && !deal.createdAt) withNeither++;
  }

  console.log('\n--- SUMMARY ---');
  console.log(`Deals with properties.createdate: ${withProperty}/${deals.length}`);
  console.log(`Deals with createdAt object: ${withObject}/${deals.length}`);
  console.log(`Deals with neither: ${withNeither}/${deals.length}`);
}

main().catch(console.error);
