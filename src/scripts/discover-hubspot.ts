import { config } from 'dotenv';
config({ path: '.env.local' });

import { getHubSpotClient } from '../lib/hubspot/client';
import { listAllOwners } from '../lib/hubspot/owners';
import { getAllPipelines } from '../lib/hubspot/pipelines';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/deals';

async function main() {
  const client = getHubSpotClient();

  console.log('='.repeat(80));
  console.log('HUBSPOT API DISCOVERY REPORT');
  console.log('='.repeat(80));
  console.log();

  // ============================================
  // 1. DEAL PROPERTIES - What fields are available?
  // ============================================
  console.log('## 1. DEAL PROPERTIES AVAILABLE');
  console.log('-'.repeat(50));

  try {
    const dealProps = await client.crm.properties.coreApi.getAll('deals');
    console.log(`Total deal properties: ${dealProps.results.length}\n`);

    // Group by type
    const byGroup: Record<string, Array<{ name: string; label: string; type: string }>> = {};
    for (const prop of dealProps.results) {
      const group = prop.groupName || 'ungrouped';
      if (!byGroup[group]) byGroup[group] = [];
      byGroup[group].push({
        name: prop.name,
        label: prop.label,
        type: prop.type,
      });
    }

    // Print key properties
    console.log('KEY DEAL PROPERTIES:');
    const keyProps = [
      'dealname', 'amount', 'closedate', 'dealstage', 'pipeline',
      'hubspot_owner_id', 'lead_source__sync_', 'lead_source_detail',
      'hs_deal_stage_probability', 'amount_in_home_currency',
      'next_step', 'hs_next_step', 'products', 'prior_ehr',
      'onboarding_fee', 'migration_fee', 'cltv', 'deal_sub_stage',
      'sent_gift_or_incentive', 'hs_lastmodifieddate', 'notes_last_updated'
    ];

    for (const propName of keyProps) {
      const prop = dealProps.results.find(p => p.name === propName);
      if (prop) {
        console.log(`  ✓ ${prop.name} (${prop.type}) - "${prop.label}"`);
      }
    }

    console.log('\nALL CUSTOM PROPERTIES (non-HubSpot default):');
    const customProps = dealProps.results.filter(p => !p.name.startsWith('hs_') && !['dealname', 'amount', 'closedate', 'dealstage', 'pipeline', 'hubspot_owner_id', 'createdate'].includes(p.name));
    for (const prop of customProps.slice(0, 30)) {
      console.log(`  - ${prop.name}: "${prop.label}" (${prop.type})`);
    }
    if (customProps.length > 30) {
      console.log(`  ... and ${customProps.length - 30} more`);
    }
  } catch (e) {
    console.error('Error fetching deal properties:', e);
  }

  console.log();

  // ============================================
  // 2. CONTACT PROPERTIES
  // ============================================
  console.log('## 2. CONTACT PROPERTIES AVAILABLE');
  console.log('-'.repeat(50));

  try {
    const contactProps = await client.crm.properties.coreApi.getAll('contacts');
    console.log(`Total contact properties: ${contactProps.results.length}\n`);

    const keyContactProps = [
      'email', 'firstname', 'lastname', 'phone', 'company',
      'jobtitle', 'lifecyclestage', 'hs_lead_status',
      'hubspot_owner_id', 'hs_email_last_email_date'
    ];

    console.log('KEY CONTACT PROPERTIES:');
    for (const propName of keyContactProps) {
      const prop = contactProps.results.find(p => p.name === propName);
      if (prop) {
        console.log(`  ✓ ${prop.name} (${prop.type}) - "${prop.label}"`);
      }
    }
  } catch (e) {
    console.error('Error fetching contact properties:', e);
  }

  console.log();

  // ============================================
  // 3. PIPELINES AND STAGES
  // ============================================
  console.log('## 3. PIPELINES AND STAGES');
  console.log('-'.repeat(50));

  try {
    const pipelines = await getAllPipelines();
    console.log(`Total pipelines: ${pipelines.length}\n`);

    for (const pipeline of pipelines) {
      console.log(`PIPELINE: ${pipeline.label} (${pipeline.id})`);
      for (const stage of pipeline.stages.sort((a, b) => a.displayOrder - b.displayOrder)) {
        const prob = stage.metadata.probability ? ` - ${stage.metadata.probability * 100}%` : '';
        const closed = stage.metadata.isClosed ? ' [CLOSED]' : '';
        console.log(`  ${stage.displayOrder}. ${stage.label}${prob}${closed}`);
      }
      console.log();
    }
  } catch (e) {
    console.error('Error fetching pipelines:', e);
  }

  // ============================================
  // 4. FIND AEs: Jack, Amos, Christopher
  // ============================================
  console.log('## 4. ACCOUNT EXECUTIVES: Jack, Amos, Christopher');
  console.log('-'.repeat(50));

  const owners = await listAllOwners();
  const targetAEs = ['jack', 'amos', 'christopher', 'chris'];

  const foundAEs = owners.filter(o => {
    const name = `${o.firstName || ''} ${o.lastName || ''}`.toLowerCase();
    return targetAEs.some(t => name.includes(t));
  });

  console.log(`Found ${foundAEs.length} matching AEs:\n`);

  for (const ae of foundAEs) {
    console.log(`  - ${ae.firstName} ${ae.lastName}`);
    console.log(`    Email: ${ae.email}`);
    console.log(`    ID: ${ae.id}`);
    console.log();
  }

  // ============================================
  // 5. DEEP DIVE: Sample deals with ALL properties
  // ============================================
  console.log('## 5. SAMPLE DEAL - ALL POPULATED PROPERTIES');
  console.log('-'.repeat(50));

  try {
    // Get all property names to fetch
    const dealProps = await client.crm.properties.coreApi.getAll('deals');
    const allPropNames = dealProps.results.map(p => p.name);

    // Get one deal with all properties
    const sampleDeals = await client.crm.deals.basicApi.getPage(1, undefined, allPropNames);

    if (sampleDeals.results[0]) {
      const deal = sampleDeals.results[0];
      console.log(`Deal: ${deal.properties.dealname}\n`);
      console.log('POPULATED PROPERTIES:');

      const populated: Array<{ name: string; value: string }> = [];
      for (const [key, value] of Object.entries(deal.properties)) {
        if (value && value !== '' && value !== '0' && !key.startsWith('hs_object')) {
          populated.push({ name: key, value: String(value).substring(0, 100) });
        }
      }

      populated.sort((a, b) => a.name.localeCompare(b.name));
      for (const p of populated) {
        console.log(`  ${p.name}: ${p.value}`);
      }
    }
  } catch (e) {
    console.error('Error fetching sample deal:', e);
  }

  console.log();

  // ============================================
  // 6. ASSOCIATIONS - What's linked to deals?
  // ============================================
  console.log('## 6. ASSOCIATIONS AVAILABLE');
  console.log('-'.repeat(50));

  try {
    // Get association types for deals
    const assocTypes = await client.crm.associations.v4.schema.definitionsApi.getAll('deals', 'contacts');
    console.log('Deal -> Contact associations:', assocTypes.results.length);

    // Check what objects can be associated
    console.log('\nDeal association types we can explore:');
    console.log('  - contacts (people on the deal)');
    console.log('  - companies (company associated)');
    console.log('  - notes (logged notes)');
    console.log('  - emails (synced emails)');
    console.log('  - calls (logged calls)');
    console.log('  - meetings (scheduled meetings)');
    console.log('  - tasks (tasks on the deal)');

    // Get a sample deal and check its associations
    const deals = await client.crm.deals.basicApi.getPage(1);
    if (deals.results[0]) {
      const dealId = deals.results[0].id;
      console.log(`\nSample deal ${dealId} associations:`);

      const assocObjects = ['contacts', 'companies', 'notes', 'emails', 'calls', 'meetings', 'tasks'];
      for (const objType of assocObjects) {
        try {
          const assocs = await client.crm.associations.v4.basicApi.getPage('deals', dealId, objType, undefined, 100);
          if (assocs.results.length > 0) {
            console.log(`  ✓ ${objType}: ${assocs.results.length} associated`);
          } else {
            console.log(`  - ${objType}: none`);
          }
        } catch {
          console.log(`  ? ${objType}: unable to check`);
        }
      }
    }
  } catch (e) {
    console.error('Error checking associations:', e);
  }

  console.log();

  // ============================================
  // 7. AE PORTFOLIO ANALYSIS
  // ============================================
  console.log('## 7. AE PORTFOLIO ANALYSIS');
  console.log('-'.repeat(50));

  // Key properties to analyze
  const analyzeProps = [
    'dealname', 'amount', 'closedate', 'dealstage', 'pipeline',
    'lead_source__sync_', 'lead_source_detail', 'products', 'prior_ehr',
    'onboarding_fee', 'migration_fee', 'cltv', 'next_step',
    'hs_lastmodifieddate', 'notes_last_updated', 'hs_next_step'
  ];

  for (const ae of foundAEs.slice(0, 3)) { // Analyze up to 3 AEs
    console.log(`\n### ${ae.firstName} ${ae.lastName} (${ae.email})`);

    try {
      const response = await client.crm.deals.searchApi.doSearch({
        filterGroups: [{
          filters: [{
            propertyName: 'hubspot_owner_id',
            operator: FilterOperatorEnum.Eq,
            value: ae.id,
          }],
        }],
        properties: analyzeProps,
        limit: 100,
      });

      console.log(`Total deals: ${response.total || response.results.length}`);

      // Analyze what's populated
      const propCounts: Record<string, number> = {};
      let totalAmount = 0;
      const stages: Record<string, number> = {};
      const leadSources: Record<string, number> = {};

      for (const deal of response.results) {
        for (const prop of analyzeProps) {
          if (deal.properties[prop] && deal.properties[prop] !== '') {
            propCounts[prop] = (propCounts[prop] || 0) + 1;
          }
        }

        if (deal.properties.amount) {
          totalAmount += parseFloat(deal.properties.amount);
        }

        if (deal.properties.dealstage) {
          stages[deal.properties.dealstage] = (stages[deal.properties.dealstage] || 0) + 1;
        }

        if (deal.properties['lead_source__sync_']) {
          leadSources[deal.properties['lead_source__sync_']] = (leadSources[deal.properties['lead_source__sync_']] || 0) + 1;
        }
      }

      console.log(`Total pipeline value: $${totalAmount.toLocaleString()}`);
      console.log(`\nProperty fill rates (out of ${response.results.length} deals):`);
      for (const [prop, count] of Object.entries(propCounts).sort((a, b) => b[1] - a[1])) {
        const pct = Math.round(count / response.results.length * 100);
        console.log(`  ${prop}: ${count} (${pct}%)`);
      }

      if (Object.keys(leadSources).length > 0) {
        console.log(`\nLead sources:`);
        for (const [source, count] of Object.entries(leadSources).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
          console.log(`  ${source}: ${count}`);
        }
      }
    } catch (e) {
      console.error(`Error analyzing ${ae.firstName}:`, e);
    }
  }

  console.log();
  console.log('='.repeat(80));
  console.log('DISCOVERY COMPLETE');
  console.log('='.repeat(80));
}

main().catch(console.error);
