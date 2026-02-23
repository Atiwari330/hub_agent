// @ts-nocheck
import { config } from 'dotenv';
config({ path: '.env.local' });

import { getHubSpotClient } from '../lib/hubspot/client';

async function main() {
  const client = getHubSpotClient();

  // 1. Get all ticket properties
  console.log('=== FETCHING ALL TICKET PROPERTIES ===\n');
  const propsResponse = await client.crm.properties.coreApi.getAll('tickets');
  const allProps = propsResponse.results;

  // Separate custom vs default
  const customProps = allProps.filter(
    (p) => !p.name.startsWith('hs_') && !p.name.startsWith('hubspot_')
  );
  const defaultProps = allProps.filter(
    (p) => p.name.startsWith('hs_') || p.name.startsWith('hubspot_')
  );

  console.log(`Total properties: ${allProps.length}`);
  console.log(`  HubSpot default: ${defaultProps.length}`);
  console.log(`  Custom/other: ${customProps.length}\n`);

  // Print all properties grouped
  console.log('--- CUSTOM / NON-DEFAULT PROPERTIES ---\n');
  for (const prop of customProps.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${prop.name}`);
    console.log(`    Label: ${prop.label}`);
    console.log(`    Type: ${prop.type} | Group: ${prop.groupName}`);
    if (prop.description) console.log(`    Desc: ${prop.description}`);
    if (prop.options && prop.options.length > 0) {
      console.log(
        `    Options: ${prop.options.map((o) => o.label).join(', ')}`
      );
    }
    console.log('');
  }

  console.log('--- HUBSPOT DEFAULT PROPERTIES ---\n');
  for (const prop of defaultProps.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${prop.name}`);
    console.log(`    Label: ${prop.label}`);
    console.log(`    Type: ${prop.type} | Group: ${prop.groupName}`);
    if (prop.description) console.log(`    Desc: ${prop.description}`);
    console.log('');
  }

  // 2. Pull 5 recent tickets with ALL properties to see which are populated
  console.log('\n=== SAMPLING 5 RECENT TICKETS ===\n');
  const allPropNames = allProps.map((p) => p.name);

  const searchResponse = await client.crm.tickets.searchApi.doSearch({
    filterGroups: [],
    properties: allPropNames,
    sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' as const }],
    limit: 5,
    after: undefined as unknown as string,
  });

  const populatedCounts = new Map<string, number>();
  const sampleValues = new Map<string, string>();

  for (const ticket of searchResponse.results) {
    console.log(`--- Ticket ${ticket.id}: ${ticket.properties.subject || '(no subject)'} ---`);
    for (const [key, value] of Object.entries(ticket.properties)) {
      if (value !== null && value !== undefined && value !== '') {
        populatedCounts.set(key, (populatedCounts.get(key) || 0) + 1);
        if (!sampleValues.has(key)) {
          sampleValues.set(key, String(value).substring(0, 100));
        }
      }
    }
    console.log('');
  }

  // 3. Summary: which properties have data
  console.log('\n=== PROPERTY POPULATION SUMMARY (properties with data in 5-ticket sample) ===\n');

  const populated = [...populatedCounts.entries()].sort(
    (a, b) => b[1] - a[1]
  );

  console.log(`${populated.length} properties had data out of ${allProps.length} total\n`);

  for (const [name, count] of populated) {
    const prop = allProps.find((p) => p.name === name);
    const label = prop ? prop.label : name;
    const isCustom =
      !name.startsWith('hs_') && !name.startsWith('hubspot_');
    const tag = isCustom ? ' [CUSTOM]' : '';
    const sample = sampleValues.get(name) || '';
    console.log(
      `  ${count}/5 | ${name} (${label})${tag}`
    );
    console.log(`         Sample: ${sample}`);
  }

  // 4. Properties with NO data
  const emptyProps = allProps
    .filter((p) => !populatedCounts.has(p.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  console.log(`\n=== EMPTY PROPERTIES (${emptyProps.length} with no data in sample) ===\n`);
  for (const prop of emptyProps) {
    const isCustom =
      !prop.name.startsWith('hs_') && !prop.name.startsWith('hubspot_');
    const tag = isCustom ? ' [CUSTOM]' : '';
    console.log(`  ${prop.name} (${prop.label})${tag}`);
  }

  console.log('\nDone!');
}

main().catch(console.error);
