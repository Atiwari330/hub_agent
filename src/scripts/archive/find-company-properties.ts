import { getHubSpotClient } from '../lib/hubspot/client';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function findCompanyProperties() {
  const client = getHubSpotClient();
  
  // Get all company properties
  const response = await client.crm.properties.coreApi.getAll('companies');
  
  // Properties we're looking for
  const searchTerms = ['notes', 'cs', 'qbr'];
  
  console.log('=== COMPANY PROPERTIES (matching: notes, cs, qbr) ===\n');
  
  for (const prop of response.results) {
    const nameLower = prop.name.toLowerCase();
    const labelLower = prop.label.toLowerCase();
    
    if (searchTerms.some(term => nameLower.includes(term) || labelLower.includes(term))) {
      console.log(`${prop.name}`);
      console.log(`  Label: ${prop.label}`);
      console.log(`  Type: ${prop.type}`);
      if (prop.description) console.log(`  Desc: ${prop.description}`);
      console.log('');
    }
  }
}

findCompanyProperties();
