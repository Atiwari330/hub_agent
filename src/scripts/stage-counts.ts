/**
 * Stage Counts CLI
 *
 * Counts how many deals reached Demo Scheduled and Demo Completed
 * in a given quarter, excluding deals that regressed back to earlier stages.
 *
 * Usage:
 *   npx tsx src/scripts/stage-counts.ts                    # Q1 2026 (default)
 *   npx tsx src/scripts/stage-counts.ts --quarter=2        # Q2 2026
 *   npx tsx src/scripts/stage-counts.ts --year=2025 --quarter=4
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { getQuarterInfo } from '../lib/utils/quarter';
import { SALES_PIPELINE_STAGES } from '../lib/hubspot/stage-config';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Stages that count as "regression" — deal went backward in the pipeline.
// Closed Lost is NOT regression; the deal progressed and had an outcome.
const REGRESSION_STAGES: Record<string, Set<string>> = {
  // For Demo Scheduled: regression = currently at MQL or SQL
  demoScheduled: new Set([
    SALES_PIPELINE_STAGES.MQL.id,
    SALES_PIPELINE_STAGES.SQL_LEGACY.id,
    SALES_PIPELINE_STAGES.SQL_DISCOVERY.id,
  ]),
  // For Demo Completed: regression = currently at MQL, SQL, or Demo Scheduled
  demoCompleted: new Set([
    SALES_PIPELINE_STAGES.MQL.id,
    SALES_PIPELINE_STAGES.SQL_LEGACY.id,
    SALES_PIPELINE_STAGES.SQL_DISCOVERY.id,
    SALES_PIPELINE_STAGES.DEMO_SCHEDULED.id,
  ]),
};

const STAGE_LABEL: Record<string, string> = Object.fromEntries(
  Object.values(SALES_PIPELINE_STAGES).map((s) => [s.id, s.label])
);

function parseArgs() {
  const args = process.argv.slice(2);
  const now = new Date();
  let year = now.getFullYear();
  let quarter = Math.floor(now.getMonth() / 3) + 1;

  for (const arg of args) {
    if (arg.startsWith('--year=')) year = parseInt(arg.split('=')[1]);
    if (arg.startsWith('--quarter=')) quarter = parseInt(arg.split('=')[1]);
  }

  return { year, quarter };
}

async function main() {
  const { year, quarter } = parseArgs();
  const qi = getQuarterInfo(year, quarter);

  console.log(`\n📊 Stage Counts for ${qi.label}`);
  console.log(`   ${qi.startDate.toISOString()} → ${qi.endDate.toISOString()}\n`);

  // Fetch deals with demo timestamps (targeted query to avoid Supabase 1000-row default limit)
  const { data: deals, error } = await supabase
    .from('deals')
    .select(`
      id,
      hubspot_deal_id,
      deal_name,
      amount,
      deal_stage,
      owner_id,
      demo_scheduled_entered_at,
      demo_completed_entered_at,
      closed_won_entered_at,
      proposal_entered_at
    `)
    .or('demo_scheduled_entered_at.not.is.null,demo_completed_entered_at.not.is.null');

  if (error) {
    console.error('Error fetching deals:', error.message);
    process.exit(1);
  }

  // Fetch owners for display
  const { data: owners } = await supabase
    .from('owners')
    .select('id, first_name, last_name, email');

  const ownerMap = new Map(
    (owners || []).map((o) => [o.id, `${o.first_name} ${o.last_name}`])
  );

  function isInQuarter(dateStr: string | null): boolean {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d >= qi.startDate && d <= qi.endDate;
  }

  function isRegressed(dealStage: string | null, regressionSet: Set<string>): boolean {
    if (!dealStage) return false;
    return regressionSet.has(dealStage);
  }

  const closedLostId = SALES_PIPELINE_STAGES.CLOSED_LOST.id;

  // --- Demo Scheduled: entered in Q1, exclude only true regressions (MQL/SQL) ---
  const allEnteredDemoScheduled = (deals || []).filter((d) => isInQuarter(d.demo_scheduled_entered_at));
  const demoScheduledRegressed = allEnteredDemoScheduled.filter((d) => isRegressed(d.deal_stage, REGRESSION_STAGES.demoScheduled));
  const demoScheduledClosedLost = allEnteredDemoScheduled.filter((d) => d.deal_stage === closedLostId);
  const demoScheduledDeals = allEnteredDemoScheduled.filter((d) => !isRegressed(d.deal_stage, REGRESSION_STAGES.demoScheduled));

  // --- Demo Completed: entered in Q1, exclude only true regressions (MQL/SQL/Demo Sched) ---
  const allEnteredDemoCompleted = (deals || []).filter((d) => isInQuarter(d.demo_completed_entered_at));
  const demoCompletedRegressed = allEnteredDemoCompleted.filter((d) => isRegressed(d.deal_stage, REGRESSION_STAGES.demoCompleted));
  const demoCompletedClosedLost = allEnteredDemoCompleted.filter((d) => d.deal_stage === closedLostId);
  const demoCompletedDeals = allEnteredDemoCompleted.filter((d) => !isRegressed(d.deal_stage, REGRESSION_STAGES.demoCompleted));

  // --- Print results ---
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  DEMO SCHEDULED in ${qi.label}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  ✅ Counting (at stage or beyond + closed lost): ${demoScheduledDeals.length}`);
  console.log(`      of which Closed Lost:                       ${demoScheduledClosedLost.length}`);
  console.log(`  ⬇️  Regressed to MQL/SQL (excluded):            ${demoScheduledRegressed.length}`);
  console.log(`  ── Total that ever entered Demo Scheduled:      ${allEnteredDemoScheduled.length}`);
  console.log();

  if (demoScheduledDeals.length > 0) {
    console.log('  Counting deals:');
    for (const d of demoScheduledDeals) {
      const stage = STAGE_LABEL[d.deal_stage] || d.deal_stage;
      const owner = ownerMap.get(d.owner_id) || 'Unknown';
      const amt = d.amount ? `$${Number(d.amount).toLocaleString()}` : 'No amt';
      console.log(`    • ${d.deal_name} [${stage}] — ${owner} — ${amt}`);
    }
    console.log();
  }

  if (demoScheduledRegressed.length > 0) {
    console.log('  Excluded (regressed to MQL/SQL):');
    for (const d of demoScheduledRegressed) {
      const stage = STAGE_LABEL[d.deal_stage] || d.deal_stage;
      const owner = ownerMap.get(d.owner_id) || 'Unknown';
      console.log(`    • ${d.deal_name} [${stage}] — ${owner}`);
    }
    console.log();
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  DEMO COMPLETED in ${qi.label}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  ✅ Counting (at stage or beyond + closed lost): ${demoCompletedDeals.length}`);
  console.log(`      of which Closed Lost:                       ${demoCompletedClosedLost.length}`);
  console.log(`  ⬇️  Regressed to MQL/SQL/Demo Sched (excluded): ${demoCompletedRegressed.length}`);
  console.log(`  ── Total that ever entered Demo Completed:      ${allEnteredDemoCompleted.length}`);
  console.log();

  if (demoCompletedDeals.length > 0) {
    console.log('  Counting deals:');
    for (const d of demoCompletedDeals) {
      const stage = STAGE_LABEL[d.deal_stage] || d.deal_stage;
      const owner = ownerMap.get(d.owner_id) || 'Unknown';
      const amt = d.amount ? `$${Number(d.amount).toLocaleString()}` : 'No amt';
      console.log(`    • ${d.deal_name} [${stage}] — ${owner} — ${amt}`);
    }
    console.log();
  }

  if (demoCompletedRegressed.length > 0) {
    console.log('  Excluded (regressed):');
    for (const d of demoCompletedRegressed) {
      const stage = STAGE_LABEL[d.deal_stage] || d.deal_stage;
      const owner = ownerMap.get(d.owner_id) || 'Unknown';
      console.log(`    • ${d.deal_name} [${stage}] — ${owner}`);
    }
    console.log();
  }

  // --- Per-AE breakdown ---
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  PER-AE BREAKDOWN');
  console.log('═══════════════════════════════════════════════════════════════');

  const aeIds = [...new Set([...demoScheduledDeals, ...demoCompletedDeals].map((d) => d.owner_id))];
  for (const aeId of aeIds) {
    const name = ownerMap.get(aeId) || 'Unknown';
    const ds = demoScheduledDeals.filter((d) => d.owner_id === aeId).length;
    const dc = demoCompletedDeals.filter((d) => d.owner_id === aeId).length;
    console.log(`  ${name.padEnd(25)} Demo Scheduled: ${ds}   Demo Completed: ${dc}`);
  }

  console.log();

  // --- Write CSV ---
  const csvRows: string[] = [
    'Deal Name,Owner,Amount,Current Stage,Demo Scheduled Date,Demo Completed Date,Counted As Demo Scheduled,Counted As Demo Completed',
  ];

  const demoSchedSet = new Set(demoScheduledDeals.map((d) => d.id));
  const demoCompSet = new Set(demoCompletedDeals.map((d) => d.id));
  const allRelevant = new Map<string, (typeof deals extends (infer T)[] | null ? T : never)>();
  for (const d of [...allEnteredDemoScheduled, ...allEnteredDemoCompleted]) {
    allRelevant.set(d.id, d);
  }

  for (const d of allRelevant.values()) {
    const esc = (s: string) => `"${(s || '').replace(/"/g, '""')}"`;
    const stage = STAGE_LABEL[d.deal_stage] || d.deal_stage;
    const owner = ownerMap.get(d.owner_id) || 'Unknown';
    const amt = d.amount ? Number(d.amount) : '';
    const dsDate = d.demo_scheduled_entered_at ? new Date(d.demo_scheduled_entered_at).toISOString().split('T')[0] : '';
    const dcDate = d.demo_completed_entered_at ? new Date(d.demo_completed_entered_at).toISOString().split('T')[0] : '';
    const countedDS = demoSchedSet.has(d.id) ? 'Yes' : isInQuarter(d.demo_scheduled_entered_at) ? 'No (regressed)' : '';
    const countedDC = demoCompSet.has(d.id) ? 'Yes' : isInQuarter(d.demo_completed_entered_at) ? 'No (regressed)' : '';

    csvRows.push([esc(d.deal_name), esc(owner), amt, esc(stage), dsDate, dcDate, countedDS, countedDC].join(','));
  }

  const csvFile = `stage-counts-${qi.label.replace(' ', '-')}.csv`;
  fs.writeFileSync(csvFile, csvRows.join('\n'), 'utf-8');
  console.log(`📄 CSV written to ${csvFile}`);
}

main().catch(console.error);
