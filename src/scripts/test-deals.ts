import { config } from 'dotenv';
config({ path: '.env.local' });
import { getDealsByOwnerId, getDealById, getAllDeals } from '../lib/hubspot/deals';
import { listAllOwners } from '../lib/hubspot/owners';

async function main() {
  console.log('Testing deal operations...\n');

  // Get all deals first
  console.log('1. Fetching all deals:');
  const allDeals = await getAllDeals();
  console.log(`   Found ${allDeals.length} total deals\n`);

  if (allDeals.length > 0) {
    console.log('   Sample deals:');
    for (const deal of allDeals.slice(0, 3)) {
      const amount = deal.properties.amount ? `$${parseFloat(deal.properties.amount).toLocaleString()}` : 'N/A';
      console.log(`   - ${deal.properties.dealname} | ${amount} | Stage: ${deal.properties.dealstage || 'N/A'}`);
    }
  }

  // Get owners to test filtering
  console.log('\n2. Fetching owners for deal filtering:');
  const owners = await listAllOwners();

  if (owners[0]) {
    const ownerName = `${owners[0].firstName || ''} ${owners[0].lastName || ''}`.trim() || owners[0].email;
    console.log(`   Testing deals for owner: ${ownerName}`);

    const ownerDeals = await getDealsByOwnerId(owners[0].id);
    console.log(`   Found ${ownerDeals.length} deals for this owner\n`);

    if (ownerDeals[0]) {
      console.log('   Sample deal:');
      console.log(`   - Name: ${ownerDeals[0].properties.dealname}`);
      console.log(`   - Amount: ${ownerDeals[0].properties.amount || 'N/A'}`);
      console.log(`   - Stage: ${ownerDeals[0].properties.dealstage || 'N/A'}`);
      console.log(`   - Close Date: ${ownerDeals[0].properties.closedate || 'N/A'}`);
    }
  }

  // Test single deal fetch
  if (allDeals[0]) {
    console.log(`\n3. Fetching single deal by ID: ${allDeals[0].id}`);
    const deal = await getDealById(allDeals[0].id);
    if (deal) {
      console.log(`   ✅ Found: ${deal.properties.dealname}`);
    } else {
      console.log('   ❌ Deal not found');
    }
  }

  console.log('\n✅ Deal operations test complete!');
}

main().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
