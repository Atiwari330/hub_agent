import { config } from 'dotenv';
config({ path: '.env.local' });

import { getAllPipelines } from '../lib/hubspot/pipelines';
import { createServiceClient } from '../lib/supabase/client';
import { SYNC_CONFIG } from '../lib/hubspot/sync-config';
import { ACTIVE_STAGE_IDS } from '../lib/hubspot/stage-config';

// Use centralized stage config
const ACTIVE_DEAL_STAGES = ACTIVE_STAGE_IDS;

async function main() {
  const supabase = createServiceClient();

  console.log('=== Overdue Queue Verification ===\n');

  // --- Step 1: Compare HubSpot stages to hardcoded array ---
  console.log('--- Step 1: HubSpot Stage Comparison ---\n');

  const pipelines = await getAllPipelines();
  const salesPipeline = pipelines.find((p) => p.id === SYNC_CONFIG.TARGET_PIPELINE_ID);

  if (!salesPipeline) {
    console.error('ERROR: Sales Pipeline not found!');
    return;
  }

  const sortedStages = [...salesPipeline.stages].sort((a, b) => a.displayOrder - b.displayOrder);
  const closedStageIds = new Set<string>();
  const activeHubSpotStageIds = new Set<string>();
  const mqlStageId = '2030251';

  console.log('Current HubSpot Sales Pipeline stages:');
  for (const stage of sortedStages) {
    const isClosed = stage.metadata.isClosed;
    const isMQL = stage.id === mqlStageId;
    const inArray = ACTIVE_DEAL_STAGES.includes(stage.id);

    if (isClosed) {
      closedStageIds.add(stage.id);
    } else if (!isMQL) {
      activeHubSpotStageIds.add(stage.id);
    }

    const status = isClosed
      ? '[CLOSED]'
      : isMQL
        ? '[MQL - excluded]'
        : inArray
          ? '[IN ARRAY]'
          : '[MISSING FROM ARRAY!]';

    console.log(`  ${stage.displayOrder}. ${stage.label} (${stage.id}) ${status}`);
  }

  // Check for stages in array but removed from HubSpot
  const hubSpotStageIds = new Set(sortedStages.map((s) => s.id));
  const removedStages = ACTIVE_DEAL_STAGES.filter((id) => !hubSpotStageIds.has(id));
  if (removedStages.length > 0) {
    console.log(`\n  WARNING: ${removedStages.length} stage(s) in ACTIVE_DEAL_STAGES no longer exist in HubSpot:`);
    for (const id of removedStages) {
      console.log(`    - ${id}`);
    }
  }

  // Check for active stages missing from array
  const missingStages = [...activeHubSpotStageIds].filter((id) => !ACTIVE_DEAL_STAGES.includes(id));
  if (missingStages.length > 0) {
    console.log(`\n  CRITICAL: ${missingStages.length} active stage(s) in HubSpot NOT in ACTIVE_DEAL_STAGES:`);
    for (const id of missingStages) {
      const stage = sortedStages.find((s) => s.id === id);
      console.log(`    - ${stage?.label || 'Unknown'} (${id})`);
    }
  } else {
    console.log('\n  All active HubSpot stages are covered by ACTIVE_DEAL_STAGES.');
  }

  // --- Step 2: Query Supabase for deals by stage ---
  console.log('\n--- Step 2: Deal Count by Stage (Supabase) ---\n');

  // Get target owner IDs
  const { data: owners } = await supabase
    .from('owners')
    .select('id, first_name, last_name, email')
    .in('email', SYNC_CONFIG.TARGET_AE_EMAILS);

  const ownerIds = owners?.map((o) => o.id) || [];
  console.log(`Target AEs found: ${owners?.length || 0}`);

  // Get all deals in the Sales Pipeline for target AEs
  const { data: allDeals } = await supabase
    .from('deals')
    .select('id, deal_stage, deal_name')
    .in('owner_id', ownerIds)
    .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID);

  // Count deals per stage
  const dealCountByStage = new Map<string, number>();
  for (const deal of allDeals || []) {
    const stage = deal.deal_stage || 'null';
    dealCountByStage.set(stage, (dealCountByStage.get(stage) || 0) + 1);
  }

  // Map stage IDs to names
  const stageNameMap = new Map<string, string>();
  for (const stage of sortedStages) {
    stageNameMap.set(stage.id, stage.label);
  }

  console.log('Deals per stage:');
  for (const [stageId, count] of [...dealCountByStage.entries()].sort((a, b) => b[1] - a[1])) {
    const stageName = stageNameMap.get(stageId) || 'Unknown';
    const covered = ACTIVE_DEAL_STAGES.includes(stageId);
    const tag = covered ? '' : closedStageIds.has(stageId) ? ' [CLOSED - OK]' : stageId === mqlStageId ? ' [MQL - OK]' : ' [NOT COVERED!]';
    console.log(`  ${stageName} (${stageId}): ${count} deal(s)${tag}`);
  }

  // Specifically count deals in stages NOT covered by ACTIVE_DEAL_STAGES (excluding closed/MQL)
  let missedDeals = 0;
  for (const [stageId, count] of dealCountByStage) {
    if (!ACTIVE_DEAL_STAGES.includes(stageId) && !closedStageIds.has(stageId) && stageId !== mqlStageId) {
      missedDeals += count;
    }
  }

  if (missedDeals > 0) {
    console.log(`\n  CRITICAL: ${missedDeals} deal(s) in active stages NOT covered by the queue!`);
  } else {
    console.log('\n  All active deals are covered by queue stage filters.');
  }

  // --- Step 3: Check last sync run ---
  console.log('\n--- Step 3: Last Sync Run ---\n');

  const { data: lastRun } = await supabase
    .from('workflow_runs')
    .select('*')
    .eq('workflow_name', 'sync-hubspot')
    .order('started_at', { ascending: false })
    .limit(1)
    .single();

  if (lastRun) {
    const startedAt = new Date(lastRun.started_at);
    const hoursAgo = Math.round((Date.now() - startedAt.getTime()) / (1000 * 60 * 60));
    console.log(`  Last sync: ${lastRun.started_at} (${hoursAgo}h ago)`);
    console.log(`  Status: ${lastRun.status}`);
    if (lastRun.result) {
      const result = typeof lastRun.result === 'string' ? JSON.parse(lastRun.result) : lastRun.result;
      console.log(`  Result: ${JSON.stringify(result, null, 2)}`);
    }
    if (lastRun.error_message) {
      console.log(`  Error: ${lastRun.error_message}`);
    }
  } else {
    console.log('  WARNING: No sync runs found in workflow_runs table!');
  }

  console.log('\n=== Verification Complete ===');
}

main().catch(console.error);
