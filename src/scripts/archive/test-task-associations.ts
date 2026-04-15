/**
 * Test script to discover HubSpot task-to-deal association type IDs
 * Run with: npx tsx src/scripts/test-task-associations.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { getHubSpotClient } from '../lib/hubspot/client';

async function main() {
  const client = getHubSpotClient();

  console.log('Fetching task-to-deal association types...\n');

  try {
    // Get association types between tasks and deals
    const response = await client.crm.associations.v4.schema.definitionsApi.getAll(
      'tasks',
      'deals'
    );

    console.log('Association Types (tasks → deals):');
    console.log('='.repeat(50));

    for (const item of response.results) {
      console.log(`- Type ID: ${item.typeId}`);
      console.log(`  Label: ${item.label || '(default)'}`);
      console.log(`  Category: ${item.category}`);
      console.log('');
    }

    // Also check deals to tasks (reverse direction)
    console.log('\nAssociation Types (deals → tasks):');
    console.log('='.repeat(50));

    const reverseResponse = await client.crm.associations.v4.schema.definitionsApi.getAll(
      'deals',
      'tasks'
    );

    for (const item of reverseResponse.results) {
      console.log(`- Type ID: ${item.typeId}`);
      console.log(`  Label: ${item.label || '(default)'}`);
      console.log(`  Category: ${item.category}`);
      console.log('');
    }
  } catch (error) {
    console.error('Error fetching association types:', error);
  }
}

main();
