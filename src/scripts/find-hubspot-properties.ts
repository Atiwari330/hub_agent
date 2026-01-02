import { getHubSpotClient } from '../lib/hubspot/client';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function findProperties() {
  const client = getHubSpotClient();
  
  // Get all deal properties
  const response = await client.crm.properties.coreApi.getAll('deals');
  
  // Properties we're looking for
  const searchTerms = [
    'lead', 'source', 'activity', 'next', 'step', 'product', 'substage', 'create'
  ];
  
  console.log('=== ALL DEAL PROPERTIES ===\n');
  
  // Group by relevance
  const relevant: any[] = [];
  const all: any[] = [];
  
  for (const prop of response.results) {
    const nameLower = prop.name.toLowerCase();
    const labelLower = prop.label.toLowerCase();
    
    all.push({ name: prop.name, label: prop.label, type: prop.type });
    
    if (searchTerms.some(term => nameLower.includes(term) || labelLower.includes(term))) {
      relevant.push({ name: prop.name, label: prop.label, type: prop.type, description: prop.description });
    }
  }
  
  console.log('=== RELEVANT PROPERTIES (matching search terms) ===\n');
  relevant.forEach(p => {
    console.log(`${p.name}`);
    console.log(`  Label: ${p.label}`);
    console.log(`  Type: ${p.type}`);
    if (p.description) console.log(`  Desc: ${p.description}`);
    console.log('');
  });
  
  console.log('\n=== TOTAL PROPERTIES COUNT ===');
  console.log(`Total: ${all.length} properties`);
}

findProperties();
