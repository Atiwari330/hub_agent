import { getHubSpotClient } from '../lib/hubspot/client';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function findCompanyProperties() {
  const client = getHubSpotClient();
  const companyId = '33439312049'; // True North Recovery

  // CS-related search terms
  const searchTerms = [
    'health', 'score', 'contract', 'sentiment', 'revenue',
    'owner', 'name', 'parent', 'activity', 'end', 'annual', 'total'
  ];

  console.log('=== Fetching Company Properties for True North Recovery ===\n');
  console.log(`Company ID: ${companyId}\n`);

  // 1. Get all company properties
  console.log('Fetching all company property definitions...');
  const propsResponse = await client.crm.properties.coreApi.getAll('companies');
  const allPropertyNames = propsResponse.results.map(p => p.name);
  console.log(`Found ${allPropertyNames.length} company properties\n`);

  // 2. Fetch the company with all properties
  console.log('Fetching company data...\n');
  const company = await client.crm.companies.basicApi.getById(
    companyId,
    allPropertyNames
  );

  // 3. Build property map for lookup
  const propMap = new Map<string, { label: string; type: string; description?: string }>();
  for (const prop of propsResponse.results) {
    propMap.set(prop.name, {
      label: prop.label,
      type: prop.type,
      description: prop.description
    });
  }

  // 4. Filter and display CS-related properties
  interface PropDisplay {
    name: string;
    label: string;
    type: string;
    value: string | null;
    description?: string;
  }

  const relevantProps: PropDisplay[] = [];
  const allProps: PropDisplay[] = [];

  for (const [propName, propValue] of Object.entries(company.properties)) {
    const propMeta = propMap.get(propName);
    const nameLower = propName.toLowerCase();
    const labelLower = propMeta?.label?.toLowerCase() || '';

    const propDisplay: PropDisplay = {
      name: propName,
      label: propMeta?.label || propName,
      type: propMeta?.type || 'unknown',
      value: propValue,
      description: propMeta?.description
    };

    allProps.push(propDisplay);

    if (searchTerms.some(term => nameLower.includes(term) || labelLower.includes(term))) {
      relevantProps.push(propDisplay);
    }
  }

  console.log('=== CS-RELATED PROPERTIES (with values) ===\n');
  relevantProps
    .filter(p => p.value !== null && p.value !== '')
    .sort((a, b) => a.label.localeCompare(b.label))
    .forEach(p => {
      console.log(`${p.name}`);
      console.log(`  Label: ${p.label}`);
      console.log(`  Type: ${p.type}`);
      console.log(`  Value: ${p.value}`);
      if (p.description) console.log(`  Desc: ${p.description}`);
      console.log('');
    });

  console.log('=== CS-RELATED PROPERTIES (empty/null) ===\n');
  relevantProps
    .filter(p => p.value === null || p.value === '')
    .sort((a, b) => a.label.localeCompare(b.label))
    .forEach(p => {
      console.log(`${p.name} (${p.label}) - ${p.type}`);
    });

  console.log('\n=== ALL PROPERTIES WITH VALUES ===\n');
  allProps
    .filter(p => p.value !== null && p.value !== '')
    .sort((a, b) => a.label.localeCompare(b.label))
    .forEach(p => {
      console.log(`${p.name}: ${p.value}`);
      console.log(`  Label: ${p.label}`);
      console.log('');
    });

  console.log('\n=== SUMMARY ===');
  console.log(`Total properties: ${allProps.length}`);
  console.log(`CS-related properties: ${relevantProps.length}`);
  console.log(`Properties with values: ${allProps.filter(p => p.value !== null && p.value !== '').length}`);
}

findCompanyProperties().catch(console.error);
