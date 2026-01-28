import { config } from 'dotenv';
config({ path: '.env.local' });

import { getHubSpotClient } from '../lib/hubspot/client';
import { getAllPipelines } from '../lib/hubspot/pipelines';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/deals';

const UPSELL_PIPELINE_ID = '130845758';

async function main() {
  const client = getHubSpotClient();

  // ========================================
  // 1. PIPELINE STAGES
  // ========================================
  console.log('=== UPSELL PIPELINE STAGES ===\n');

  const pipelines = await getAllPipelines();
  const upsellPipeline = pipelines.find((p) => p.id === UPSELL_PIPELINE_ID);

  if (!upsellPipeline) {
    console.error(`Pipeline ${UPSELL_PIPELINE_ID} not found!`);
    console.log('Available pipelines:');
    for (const p of pipelines) {
      console.log(`  - ${p.label} (ID: ${p.id})`);
    }
    return;
  }

  console.log(`Pipeline: ${upsellPipeline.label} (ID: ${upsellPipeline.id})`);
  console.log('');

  const sortedStages = [...upsellPipeline.stages].sort((a, b) => a.displayOrder - b.displayOrder);
  const activeStages: string[] = [];
  const closedStages: string[] = [];

  for (const stage of sortedStages) {
    const closedTag = stage.metadata.isClosed ? ' [CLOSED]' : '';
    const probTag =
      stage.metadata.probability !== undefined
        ? ` (${stage.metadata.probability * 100}% probability)`
        : '';

    console.log(`  ${stage.displayOrder}. ${stage.label}${closedTag}${probTag}`);
    console.log(`     ID: ${stage.id}`);

    if (stage.metadata.isClosed) {
      closedStages.push(stage.id);
    } else {
      activeStages.push(stage.id);
    }
  }

  console.log(`\nActive stages (${activeStages.length}): ${activeStages.join(', ')}`);
  console.log(`Closed stages (${closedStages.length}): ${closedStages.join(', ')}`);

  // ========================================
  // 2. FETCH ALL UPSELL DEALS
  // ========================================
  console.log('\n\n=== FETCHING UPSELL DEALS ===\n');

  // Get all deal properties to know what to request
  const propsResponse = await client.crm.properties.coreApi.getAll('deals');
  const allPropertyNames = propsResponse.results.map((p) => p.name);
  console.log(`Total available deal properties: ${allPropertyNames.length}`);

  // Fetch deals - use core properties first for the search, then we'll fetch detailed props
  const coreProps = [
    'dealname',
    'amount',
    'closedate',
    'pipeline',
    'dealstage',
    'hubspot_owner_id',
    'createdate',
    'hs_lastmodifieddate',
    'description',
    'notes_last_updated',
    'lead_source__sync_',
    'notes_next_activity_date',
    'hs_next_step',
    'product_s',
    'proposal_stage',
    'hs_all_collaborator_owner_ids',
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allDeals: any[] = [];
  let after: string | undefined;

  do {
    const response = await client.crm.deals.searchApi.doSearch({
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'pipeline',
              operator: FilterOperatorEnum.Eq,
              value: UPSELL_PIPELINE_ID,
            },
          ],
        },
      ],
      properties: coreProps,
      limit: 100,
      after: after ? after : undefined,
    });

    for (const deal of response.results) {
      allDeals.push(deal);
    }

    after = response.paging?.next?.after;
    console.log(`  Fetched ${allDeals.length} deals so far... (total: ${response.total})`);
  } while (after);

  console.log(`\nTotal upsell deals: ${allDeals.length}`);

  // ========================================
  // 3. PROPERTY FILL RATES
  // ========================================
  console.log('\n\n=== PROPERTY FILL RATES (core properties) ===\n');

  const propFillCounts: Record<string, number> = {};

  for (const deal of allDeals) {
    for (const prop of coreProps) {
      const value = deal.properties[prop];
      if (value !== null && value !== undefined && value !== '') {
        propFillCounts[prop] = (propFillCounts[prop] || 0) + 1;
      }
    }
  }

  // Sort by fill rate descending
  const sortedProps = Object.entries(propFillCounts).sort((a, b) => b[1] - a[1]);

  for (const [prop, count] of sortedProps) {
    const pct = allDeals.length > 0 ? ((count / allDeals.length) * 100).toFixed(1) : '0';
    console.log(`  ${prop}: ${count}/${allDeals.length} (${pct}%)`);
  }

  // Show properties with 0 fill
  const zeroFillProps = coreProps.filter((p) => !propFillCounts[p]);
  if (zeroFillProps.length > 0) {
    console.log(`\n  Properties with 0% fill rate:`);
    for (const prop of zeroFillProps) {
      console.log(`    - ${prop}`);
    }
  }

  // ========================================
  // 4. EXTENDED PROPERTY DISCOVERY
  // ========================================
  console.log('\n\n=== EXTENDED PROPERTY DISCOVERY ===\n');
  console.log('Fetching a sample deal with chunked properties to find upsell-specific fields...\n');

  if (allDeals.length > 0) {
    const sampleDealId = allDeals[0].id;

    // HubSpot has a URL length limit, so we chunk properties into batches of 100
    const propChunkSize = 100;
    const populatedExtraProps: { name: string; label: string; value: string }[] = [];

    for (let i = 0; i < allPropertyNames.length; i += propChunkSize) {
      const chunk = allPropertyNames.slice(i, i + propChunkSize);
      try {
        const sampleDeal = await client.crm.deals.basicApi.getById(sampleDealId, chunk);

        for (const [propName, propValue] of Object.entries(sampleDeal.properties)) {
          if (
            propValue !== null &&
            propValue !== undefined &&
            propValue !== '' &&
            !coreProps.includes(propName) &&
            !propName.startsWith('hs_v2_date_entered_') &&
            !propName.startsWith('hs_v2_date_exited_') &&
            !propName.startsWith('hs_v2_cumulative_time_in_') &&
            !propName.startsWith('hs_date_entered_') &&
            !propName.startsWith('hs_date_exited_') &&
            !propName.startsWith('hs_time_in_')
          ) {
            const propMeta = propsResponse.results.find((p) => p.name === propName);
            populatedExtraProps.push({
              name: propName,
              label: propMeta?.label || propName,
              value: String(propValue).substring(0, 100),
            });
          }
        }
      } catch (err) {
        console.log(`  (skipped chunk ${i / propChunkSize + 1} due to error)`);
      }
    }

    // Deduplicate (a prop might appear in overlapping chunks)
    const seen = new Set<string>();
    const uniqueExtraProps = populatedExtraProps.filter((p) => {
      if (seen.has(p.name)) return false;
      seen.add(p.name);
      return true;
    });

    console.log(`Sample deal has ${uniqueExtraProps.length} populated non-core properties:\n`);

    uniqueExtraProps.sort((a, b) => a.name.localeCompare(b.name));
    for (const prop of uniqueExtraProps) {
      console.log(`  ${prop.name} ("${prop.label}")`);
      console.log(`    Value: ${prop.value}`);
    }

    // Check fill rates for custom (non-hs_) extra properties across all deals
    const interestingProps = uniqueExtraProps
      .filter((p) => !p.name.startsWith('hs_'))
      .map((p) => p.name);

    if (interestingProps.length > 0) {
      console.log(`\n\n=== FILL RATES FOR CUSTOM EXTRA PROPERTIES ===\n`);

      const extraPropCounts: Record<string, number> = {};
      let extraAfter: string | undefined;
      let checkedCount = 0;

      do {
        const response = await client.crm.deals.searchApi.doSearch({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: 'pipeline',
                  operator: FilterOperatorEnum.Eq,
                  value: UPSELL_PIPELINE_ID,
                },
              ],
            },
          ],
          properties: interestingProps,
          limit: 100,
          after: extraAfter ? extraAfter : undefined,
        });

        for (const deal of response.results) {
          for (const prop of interestingProps) {
            const value = deal.properties[prop];
            if (value !== null && value !== undefined && value !== '') {
              extraPropCounts[prop] = (extraPropCounts[prop] || 0) + 1;
            }
          }
          checkedCount++;
        }

        extraAfter = response.paging?.next?.after;
      } while (extraAfter);

      const sortedExtra = Object.entries(extraPropCounts).sort((a, b) => b[1] - a[1]);
      for (const [prop, count] of sortedExtra) {
        const pct = checkedCount > 0 ? ((count / checkedCount) * 100).toFixed(1) : '0';
        const propMeta = propsResponse.results.find((p) => p.name === prop);
        console.log(`  ${prop} ("${propMeta?.label || prop}"): ${count}/${checkedCount} (${pct}%)`);
      }
    }
  }

  // ========================================
  // 5. UNIQUE OWNERS
  // ========================================
  console.log('\n\n=== UPSELL DEAL OWNERS ===\n');

  const ownerDealCounts: Record<string, number> = {};
  for (const deal of allDeals) {
    const ownerId = deal.properties.hubspot_owner_id;
    if (ownerId) {
      ownerDealCounts[ownerId] = (ownerDealCounts[ownerId] || 0) + 1;
    }
  }

  const uniqueOwnerIds = Object.keys(ownerDealCounts);
  console.log(`Unique owners: ${uniqueOwnerIds.length}`);

  // Resolve owner names
  for (const ownerId of uniqueOwnerIds) {
    try {
      const owner = await client.crm.owners.ownersApi.getById(parseInt(ownerId));
      const name = [owner.firstName, owner.lastName].filter(Boolean).join(' ') || owner.email;
      console.log(`  ${name} (${owner.email}) - ${ownerDealCounts[ownerId]} deals [HubSpot ID: ${ownerId}]`);
    } catch {
      console.log(`  Unknown owner ID ${ownerId} - ${ownerDealCounts[ownerId]} deals`);
    }
  }

  // ========================================
  // 6. STAGE DISTRIBUTION
  // ========================================
  console.log('\n\n=== DEALS PER STAGE ===\n');

  const stageCounts: Record<string, number> = {};
  for (const deal of allDeals) {
    const stageId = deal.properties.dealstage;
    if (stageId) {
      stageCounts[stageId] = (stageCounts[stageId] || 0) + 1;
    }
  }

  const stageMap = new Map(upsellPipeline.stages.map((s) => [s.id, s.label]));
  const sortedStageCounts = Object.entries(stageCounts).sort((a, b) => b[1] - a[1]);

  for (const [stageId, count] of sortedStageCounts) {
    const stageName = stageMap.get(stageId) || 'Unknown';
    const isClosed = closedStages.includes(stageId);
    console.log(`  ${stageName}${isClosed ? ' [CLOSED]' : ''}: ${count} deals (ID: ${stageId})`);
  }

  // ========================================
  // 7. SAMPLE DEALS
  // ========================================
  console.log('\n\n=== SAMPLE UPSELL DEALS (first 10) ===\n');

  for (const deal of allDeals.slice(0, 10)) {
    const stageName = stageMap.get(deal.properties.dealstage) || 'Unknown';
    console.log(`  ${deal.properties.dealname}`);
    console.log(`    ID: ${deal.id}`);
    console.log(`    Amount: ${deal.properties.amount || 'N/A'}`);
    console.log(`    Stage: ${stageName} (${deal.properties.dealstage})`);
    console.log(`    Close Date: ${deal.properties.closedate || 'N/A'}`);
    console.log(`    Created: ${deal.properties.createdate || 'N/A'}`);
    console.log(`    Owner: ${deal.properties.hubspot_owner_id || 'N/A'}`);
    console.log(`    Lead Source: ${deal.properties.lead_source__sync_ || 'N/A'}`);
    console.log(`    Products: ${deal.properties.product_s || 'N/A'}`);
    console.log(`    Substage: ${deal.properties.proposal_stage || 'N/A'}`);
    console.log(`    Next Step: ${deal.properties.hs_next_step || 'N/A'}`);
    console.log(`    Collaborator: ${deal.properties.hs_all_collaborator_owner_ids || 'N/A'}`);
    console.log(`    Description: ${(deal.properties.description || 'N/A').substring(0, 100)}`);
    console.log('');
  }

  console.log('\n=== INVESTIGATION COMPLETE ===');
}

main().catch(console.error);
