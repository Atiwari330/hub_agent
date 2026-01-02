import { config } from 'dotenv';
config({ path: '.env.local' });
import { getHubSpotClient } from '../lib/hubspot/client';

async function main() {
  console.log('Testing HubSpot connection...\n');

  try {
    const client = getHubSpotClient();

    // Test basic API call
    const accountInfo = await client.crm.owners.ownersApi.getPage(undefined, undefined, 1);

    console.log('✅ Connection successful!');
    console.log(`   Found ${accountInfo.results.length} owner(s) in first page`);

    if (accountInfo.results[0]) {
      console.log('\n   Sample owner:');
      console.log(`   - Email: ${accountInfo.results[0].email}`);
      console.log(`   - Name: ${accountInfo.results[0].firstName} ${accountInfo.results[0].lastName}`);
    }

    // Test deals API
    const deals = await client.crm.deals.basicApi.getPage(1);
    console.log(`\n   Deals API accessible: ${deals.results.length > 0 ? 'Yes' : 'No deals found'}`);

  } catch (error) {
    console.error('❌ Connection failed:', error);
    process.exit(1);
  }
}

main();
