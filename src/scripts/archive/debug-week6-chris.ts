// @ts-nocheck
/**
 * Debug: Chris Garraffa Week 6 SQL Count
 *
 * Investigates why the Hot Tracker shows only 2 SQLs for Chris in Week 6
 * (Feb 2–8, 2026). Compares Supabase cached data against HubSpot live data.
 *
 * Usage: npx tsx src/scripts/debug-week6-chris.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { getHubSpotClient } from '../lib/hubspot/client';
import { TRACKED_STAGES } from '../lib/hubspot/stage-mappings';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/deals';

const CHRIS_EMAIL = 'cgarraffa@opusbehavioral.com';
const SALES_PIPELINE_ID = '1c27e5a3-5e5e-4403-ab0f-d356bf268cf3';

// Week 6 = Mon Feb 2 – Sun Feb 8, 2026 (UTC)
const WEEK6_START = '2026-02-02T00:00:00.000Z';
const WEEK6_END = '2026-02-08T23:59:59.999Z';

// Q1 2026
const Q1_START = '2026-01-01T00:00:00.000Z';
const Q1_END = '2026-03-31T23:59:59.999Z';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // ─── Step 1: Look up Chris's owner IDs ───
  console.log('=== Step 1: Chris Garraffa Owner IDs ===\n');

  const { data: ownerRows, error: ownerErr } = await supabase
    .from('owners')
    .select('id, hubspot_owner_id, first_name, last_name, email')
    .eq('email', CHRIS_EMAIL);

  if (ownerErr || !ownerRows?.length) {
    console.error('Could not find Chris in owners table:', ownerErr?.message);
    return;
  }

  for (const o of ownerRows) {
    console.log(`  Supabase UUID: ${o.id}`);
    console.log(`  HubSpot Owner ID: ${o.hubspot_owner_id}`);
    console.log(`  Name: ${o.first_name} ${o.last_name}`);
    console.log(`  Email: ${o.email}\n`);
  }

  const supabaseOwnerIds = ownerRows.map((o) => o.id);
  const hubspotOwnerIds = ownerRows.map((o) => o.hubspot_owner_id);

  // ─── Step 2: DB deals with discovery_entered_at in Week 6 ───
  console.log('=== Step 2: DB deals with discovery_entered_at in Week 6 (Feb 2–8) ===\n');

  const { data: week6Sql, error: w6Err } = await supabase
    .from('deals')
    .select('hubspot_deal_id, deal_name, discovery_entered_at, owner_id, hubspot_owner_id, stage_name, pipeline')
    .in('owner_id', supabaseOwnerIds)
    .not('discovery_entered_at', 'is', null)
    .gte('discovery_entered_at', WEEK6_START)
    .lte('discovery_entered_at', WEEK6_END)
    .eq('pipeline', SALES_PIPELINE_ID);

  if (w6Err) console.error('  Query error:', w6Err.message);
  console.log(`  Found ${week6Sql?.length ?? 0} deals:\n`);
  for (const d of week6Sql || []) {
    console.log(`    ${d.deal_name}`);
    console.log(`      HubSpot ID: ${d.hubspot_deal_id}`);
    console.log(`      discovery_entered_at: ${d.discovery_entered_at}`);
    console.log(`      stage: ${d.stage_name}`);
    console.log('');
  }

  // ─── Step 3: ALL DB deals with discovery_entered_at in Q1 2026 ───
  console.log('=== Step 3: ALL DB deals with discovery_entered_at in Q1 2026 ===\n');

  const { data: q1Sql, error: q1Err } = await supabase
    .from('deals')
    .select('hubspot_deal_id, deal_name, discovery_entered_at, owner_id, stage_name')
    .in('owner_id', supabaseOwnerIds)
    .not('discovery_entered_at', 'is', null)
    .gte('discovery_entered_at', Q1_START)
    .lte('discovery_entered_at', Q1_END)
    .eq('pipeline', SALES_PIPELINE_ID)
    .order('discovery_entered_at', { ascending: true });

  if (q1Err) console.error('  Query error:', q1Err.message);
  console.log(`  Found ${q1Sql?.length ?? 0} deals in Q1:\n`);
  for (const d of q1Sql || []) {
    console.log(`    ${d.deal_name}`);
    console.log(`      discovery_entered_at: ${d.discovery_entered_at}`);
    console.log(`      stage: ${d.stage_name}`);
    console.log('');
  }

  // ─── Step 4: Deals with OTHER stage timestamps in Week 6 ───
  console.log('=== Step 4: Deals entering OTHER stages in Week 6 ===\n');

  const stageColumns = [
    { key: 'MQL', col: 'mql_entered_at' },
    { key: 'DEMO_SCHEDULED', col: 'demo_scheduled_entered_at' },
    { key: 'DEMO_COMPLETED', col: 'demo_completed_entered_at' },
    { key: 'CLOSED_WON', col: 'closed_won_entered_at' },
    { key: 'PROPOSAL', col: 'proposal_entered_at' },
  ];

  for (const { key, col } of stageColumns) {
    const { data: stageDeals } = await supabase
      .from('deals')
      .select(`hubspot_deal_id, deal_name, ${col}, owner_id, stage_name, discovery_entered_at`)
      .in('owner_id', supabaseOwnerIds)
      .not(col, 'is', null)
      .gte(col, WEEK6_START)
      .lte(col, WEEK6_END)
      .eq('pipeline', SALES_PIPELINE_ID);

    console.log(`  ${key} (${col}): ${stageDeals?.length ?? 0} deals`);
    for (const d of stageDeals || []) {
      console.log(`    - ${d.deal_name} | ${col}: ${(d as Record<string, unknown>)[col]} | discovery_entered_at: ${d.discovery_entered_at ?? 'NULL'}`);
    }
    console.log('');
  }

  // ─── Step 5: Deals CREATED in Week 6 ───
  console.log('=== Step 5: Deals CREATED in Week 6 (by hubspot_created_at) ===\n');

  const { data: createdW6 } = await supabase
    .from('deals')
    .select('hubspot_deal_id, deal_name, hubspot_created_at, discovery_entered_at, stage_name')
    .in('owner_id', supabaseOwnerIds)
    .gte('hubspot_created_at', WEEK6_START)
    .lte('hubspot_created_at', WEEK6_END)
    .eq('pipeline', SALES_PIPELINE_ID)
    .order('hubspot_created_at', { ascending: true });

  console.log(`  Found ${createdW6?.length ?? 0} deals created in Week 6:\n`);
  for (const d of createdW6 || []) {
    console.log(`    ${d.deal_name}`);
    console.log(`      created: ${d.hubspot_created_at}`);
    console.log(`      discovery_entered_at: ${d.discovery_entered_at ?? 'NULL'}`);
    console.log(`      stage: ${d.stage_name}`);
    console.log('');
  }

  // ─── Step 6: Cross-check with HubSpot directly ───
  console.log('=== Step 6: HubSpot direct query — Chris deals with discovery timestamp ===\n');

  const client = getHubSpotClient();
  const discoveryProp = TRACKED_STAGES.DISCOVERY.property; // hs_v2_date_entered_138092708

  const hsProps = [
    'dealname',
    'dealstage',
    'hubspot_owner_id',
    'pipeline',
    'createdate',
    discoveryProp,
    TRACKED_STAGES.MQL.property,
    TRACKED_STAGES.DEMO_SCHEDULED.property,
  ];

  // Search for Chris's deals in the sales pipeline with discovery timestamp in 2026
  for (const hsOwnerId of hubspotOwnerIds) {
    console.log(`  Querying HubSpot for owner ${hsOwnerId}...\n`);

    let after: string | undefined;
    let allDeals: Array<{ id: string; properties: Record<string, string | null> }> = [];

    do {
      const response = await client.crm.deals.searchApi.doSearch({
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'hubspot_owner_id',
                operator: FilterOperatorEnum.Eq,
                value: hsOwnerId,
              },
              {
                propertyName: 'pipeline',
                operator: FilterOperatorEnum.Eq,
                value: SALES_PIPELINE_ID,
              },
              {
                propertyName: discoveryProp,
                operator: FilterOperatorEnum.Gte,
                value: Q1_START,
              },
            ],
          },
        ],
        properties: hsProps,
        limit: 100,
        after: after ? after : undefined,
      });

      allDeals = allDeals.concat(response.results as typeof allDeals);
      after = response.paging?.next?.after;
    } while (after);

    console.log(`  HubSpot returned ${allDeals.length} deals with ${discoveryProp} in Q1 2026:\n`);

    // Sort by discovery timestamp
    allDeals.sort((a, b) => {
      const aDate = a.properties[discoveryProp] || '';
      const bDate = b.properties[discoveryProp] || '';
      return aDate.localeCompare(bDate);
    });

    for (const deal of allDeals) {
      const discDate = deal.properties[discoveryProp];
      const inWeek6 = discDate && discDate >= WEEK6_START && discDate <= WEEK6_END;
      console.log(`    ${inWeek6 ? '>>> ' : '    '}${deal.properties.dealname}`);
      console.log(`        HubSpot ID: ${deal.id}`);
      console.log(`        ${discoveryProp}: ${discDate}`);
      console.log(`        createdate: ${deal.properties.createdate}`);
      console.log(`        dealstage: ${deal.properties.dealstage}`);
      if (inWeek6) console.log(`        *** IN WEEK 6 ***`);
      console.log('');
    }

    // Summary
    const week6Hs = allDeals.filter((d) => {
      const ts = d.properties[discoveryProp];
      return ts && ts >= WEEK6_START && ts <= WEEK6_END;
    });
    console.log(`  --- Summary ---`);
    console.log(`  Total Q1 deals with discovery timestamp (HubSpot): ${allDeals.length}`);
    console.log(`  Week 6 deals (HubSpot): ${week6Hs.length}`);
    console.log(`  Week 6 deals (Supabase DB): ${week6Sql?.length ?? 0}`);
    console.log(`  Match: ${week6Hs.length === (week6Sql?.length ?? 0) ? 'YES' : 'NO — MISMATCH!'}\n`);

    // If there's a mismatch, identify which deals differ
    if (week6Hs.length !== (week6Sql?.length ?? 0)) {
      const dbIds = new Set((week6Sql || []).map((d) => d.hubspot_deal_id));
      const hsIds = new Set(week6Hs.map((d) => d.id));

      const inHsNotDb = week6Hs.filter((d) => !dbIds.has(d.id));
      const inDbNotHs = (week6Sql || []).filter((d) => !hsIds.has(d.hubspot_deal_id));

      if (inHsNotDb.length > 0) {
        console.log('  Deals in HubSpot Week 6 but NOT in DB:');
        for (const d of inHsNotDb) {
          console.log(`    - ${d.properties.dealname} (${d.id}) — ${discoveryProp}: ${d.properties[discoveryProp]}`);
        }
        console.log('');
      }
      if (inDbNotHs.length > 0) {
        console.log('  Deals in DB Week 6 but NOT in HubSpot:');
        for (const d of inDbNotHs) {
          console.log(`    - ${d.deal_name} (${d.hubspot_deal_id}) — discovery_entered_at: ${d.discovery_entered_at}`);
        }
        console.log('');
      }
    }
  }

  console.log('=== Done ===');
}

main().catch(console.error);
