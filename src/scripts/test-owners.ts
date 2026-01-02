import { config } from 'dotenv';
config({ path: '.env.local' });
import { listAllOwners, getOwnerByEmail } from '../lib/hubspot/owners';

async function main() {
  console.log('Testing owner operations...\n');

  // Test listing all owners
  console.log('1. Listing all owners:');
  const owners = await listAllOwners();
  console.log(`   Found ${owners.length} owners\n`);

  for (const owner of owners.slice(0, 5)) {
    const name = `${owner.firstName || ''} ${owner.lastName || ''}`.trim() || owner.email;
    console.log(`   - ${name} (${owner.email})`);
  }

  if (owners.length > 5) {
    console.log(`   ... and ${owners.length - 5} more\n`);
  }

  // Test lookup by email if we have owners
  if (owners[0]) {
    console.log(`\n2. Looking up owner by email: ${owners[0].email}`);
    const owner = await getOwnerByEmail(owners[0].email);
    if (owner) {
      console.log(`   ✅ Found: ${owner.firstName} ${owner.lastName} (ID: ${owner.id})`);
    } else {
      console.log('   ❌ Owner not found');
    }
  }

  console.log('\n✅ Owner operations test complete!');
}

main().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
