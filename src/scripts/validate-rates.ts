/**
 * Validate the historical rates used in the Q2 Goal Tracker dashboard.
 * Checks for data integrity issues that could skew the numbers.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { getQuarterInfo } from '../lib/utils/quarter';
import { SALES_PIPELINE_STAGES } from '../lib/hubspot/stage-config';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SALES_PIPELINE_ID = '1c27e5a3-5e5e-4403-ab0f-d356bf268cf3';
const S = SALES_PIPELINE_STAGES;

async function fetchAllDeals() {
  const PAGE_SIZE = 500;
  let all: any[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from('deals')
      .select('*')
      .eq('pipeline', SALES_PIPELINE_ID)
      .range(offset, offset + PAGE_SIZE - 1)
      .order('created_at', { ascending: true });
    if (error) { console.error(error); process.exit(1); }
    all = all.concat(data || []);
    hasMore = (data || []).length === PAGE_SIZE;
    offset += PAGE_SIZE;
  }
  return all;
}

function isInQuarter(dateStr: string | null, qi: ReturnType<typeof getQuarterInfo>): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d >= qi.startDate && d <= qi.endDate;
}

function daysBetween(d1: string, d2: string): number {
  return Math.round((new Date(d2).getTime() - new Date(d1).getTime()) / 86400000);
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function main() {
  const allDeals = await fetchAllDeals();
  const { data: owners } = await supabase.from('owners').select('id, first_name, last_name, email');
  const ownerMap = new Map((owners || []).map((o) => [o.id, o]));

  console.log(`\nTotal sales pipeline deals in DB: ${allDeals.length}\n`);

  // ════════════════════════════════════════════
  // CHECK 1: Q1 2026 closed-won deals (most recent quarter)
  // ════════════════════════════════════════════
  const q1_2026 = getQuarterInfo(2026, 1);
  console.log('═══ Q1 2026 CLOSED-WON DEALS ═══');
  console.log(`Quarter: ${q1_2026.startDate.toISOString()} to ${q1_2026.endDate.toISOString()}\n`);

  // Method 1: closed_won_entered_at in Q1
  const wonByTimestamp = allDeals.filter((d) => isInQuarter(d.closed_won_entered_at, q1_2026));
  // Method 2: deal_stage = closed_won AND close_date in Q1
  const closedWonStageId = S.CLOSED_WON.id;
  const wonByStage = allDeals.filter((d) =>
    d.deal_stage === closedWonStageId &&
    d.close_date &&
    d.close_date >= '2026-01-01' && d.close_date <= '2026-03-31'
  );

  // Merge & deduplicate
  const wonMap = new Map<string, any>();
  for (const d of wonByTimestamp) wonMap.set(d.id, d);
  for (const d of wonByStage) wonMap.set(d.id, d);
  const q1Won = Array.from(wonMap.values());

  console.log(`By closed_won_entered_at: ${wonByTimestamp.length} deals`);
  console.log(`By deal_stage + close_date: ${wonByStage.length} deals`);
  console.log(`Merged (deduplicated): ${q1Won.length} deals\n`);

  const q1ARR = q1Won.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const q1AvgDeal = q1Won.length > 0 ? q1ARR / q1Won.length : 0;

  console.log(`Q1 2026 Closed-Won ARR: $${q1ARR.toLocaleString()}`);
  console.log(`Q1 2026 Avg Deal Size: $${Math.round(q1AvgDeal).toLocaleString()}`);
  console.log(`Q1 2026 Deal Count: ${q1Won.length}\n`);

  console.log('Individual deals:');
  for (const d of q1Won.sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))) {
    const owner = ownerMap.get(d.owner_id);
    const name = owner ? `${owner.first_name} ${owner.last_name}` : 'Unknown';
    const amt = d.amount ? `$${Number(d.amount).toLocaleString()}` : 'No amt';
    const closedAt = d.closed_won_entered_at ? new Date(d.closed_won_entered_at).toISOString().split('T')[0] : '?';
    const closeDate = d.close_date || '?';
    console.log(`  ${d.deal_name} — ${name} — ${amt} — closed_won_entered_at: ${closedAt} — close_date: ${closeDate}`);
  }

  // ════════════════════════════════════════════
  // CHECK 2: Dashboard uses Q1-Q4 2025 cohort rates
  // ════════════════════════════════════════════
  console.log('\n═══ Q1-Q4 2025 COHORT RATES (what the dashboard uses) ═══\n');

  const cohortQuarters = [
    getQuarterInfo(2025, 1), getQuarterInfo(2025, 2),
    getQuarterInfo(2025, 3), getQuarterInfo(2025, 4),
  ];

  let totalCreated = 0, totalDemoComp = 0, totalWon = 0, totalWonARR = 0;
  const allCycleTimes: number[] = [];

  for (const qi of cohortQuarters) {
    const created = allDeals.filter((d) => d.hubspot_created_at && isInQuarter(d.hubspot_created_at, qi));
    const demoComp = created.filter((d) => d.demo_completed_entered_at);
    const won = created.filter((d) => d.closed_won_entered_at);
    const wonARR = won.reduce((s, d) => s + (Number(d.amount) || 0), 0);

    totalCreated += created.length;
    totalDemoComp += demoComp.length;
    totalWon += won.length;
    totalWonARR += wonARR;

    for (const d of won) {
      if (d.hubspot_created_at && d.closed_won_entered_at) {
        allCycleTimes.push(daysBetween(d.hubspot_created_at, d.closed_won_entered_at));
      }
    }

    const avgDeal = won.length > 0 ? wonARR / won.length : 0;
    const demoToWon = demoComp.length > 0 ? (won.length / demoComp.length * 100).toFixed(1) : 'N/A';
    const createToDemo = created.length > 0 ? (demoComp.length / created.length * 100).toFixed(1) : 'N/A';

    console.log(`${qi.label}: Created=${created.length}, DemoComp=${demoComp.length}, Won=${won.length}, ARR=$${wonARR.toLocaleString()}, AvgDeal=$${Math.round(avgDeal).toLocaleString()}, Demo→Won=${demoToWon}%, Create→Demo=${createToDemo}%`);

    // List the won deals for each quarter
    for (const d of won) {
      const owner = ownerMap.get(d.owner_id);
      const name = owner ? `${owner.first_name} ${owner.last_name}` : 'Unknown';
      console.log(`    ✓ ${d.deal_name} — ${name} — $${Number(d.amount || 0).toLocaleString()}`);
    }
  }

  const overallAvgDeal = totalWon > 0 ? totalWonARR / totalWon : 0;
  const overallDemoToWon = totalDemoComp > 0 ? totalWon / totalDemoComp : 0;
  const overallCreateToDemo = totalCreated > 0 ? totalDemoComp / totalCreated : 0;

  console.log(`\n── TOTALS (Q1-Q4 2025 cohorts) ──`);
  console.log(`Total Created: ${totalCreated}`);
  console.log(`Total Demo Completed: ${totalDemoComp}`);
  console.log(`Total Closed Won: ${totalWon}`);
  console.log(`Total Won ARR: $${totalWonARR.toLocaleString()}`);
  console.log(`Avg Deal Size: $${Math.round(overallAvgDeal).toLocaleString()} ← DASHBOARD SHOWS $24,738`);
  console.log(`Demo→Won Rate: ${(overallDemoToWon * 100).toFixed(1)}% ← DASHBOARD SHOWS 21.6%`);
  console.log(`Create→Demo Rate: ${(overallCreateToDemo * 100).toFixed(1)}% ← DASHBOARD SHOWS 57.7%`);
  console.log(`Median Cycle Time: ${median(allCycleTimes)} days`);

  // ════════════════════════════════════════════
  // CHECK 3: Data integrity — potential skew issues
  // ════════════════════════════════════════════
  console.log('\n═══ DATA INTEGRITY CHECKS ═══\n');

  // Are there closed-won deals in Q1-Q4 2025 with closed_won_entered_at but NO hubspot_created_at?
  // These would be missed by the cohort analysis
  const allWonQ1Q4 = allDeals.filter((d) => {
    if (!d.closed_won_entered_at) return false;
    for (const qi of cohortQuarters) {
      if (isInQuarter(d.closed_won_entered_at, qi)) return true;
    }
    return false;
  });
  const wonMissingCreate = allWonQ1Q4.filter((d) => !d.hubspot_created_at);

  console.log(`Closed-won deals in Q1-Q4 2025 (by closed_won_entered_at): ${allWonQ1Q4.length}`);
  console.log(`  → Missing hubspot_created_at: ${wonMissingCreate.length}`);
  if (wonMissingCreate.length > 0) {
    console.log('  ⚠️  These deals ARE closed-won but were NOT counted in cohort rates:');
    for (const d of wonMissingCreate) {
      const owner = ownerMap.get(d.owner_id);
      const name = owner ? `${owner.first_name} ${owner.last_name}` : 'Unknown';
      console.log(`    ${d.deal_name} — ${name} — $${Number(d.amount || 0).toLocaleString()}`);
    }
  }

  // Check: are there deals that closed in Q1 2026 but were CREATED in Q1-Q4 2025?
  // These are captured by the cohort analysis (good)
  const q1WonFromOlderCohorts = q1Won.filter((d) => {
    if (!d.hubspot_created_at) return false;
    for (const qi of cohortQuarters) {
      if (isInQuarter(d.hubspot_created_at, qi)) return true;
    }
    return false;
  });
  console.log(`\nQ1 2026 closed-won deals that were CREATED in Q1-Q4 2025: ${q1WonFromOlderCohorts.length}`);
  console.log(`  (These ARE captured by the cohort analysis as wins from those older cohorts)`);

  // Check: Supabase row count vs expected
  // Are we hitting the 1000-row limit anywhere?
  const { count } = await supabase
    .from('deals')
    .select('id', { count: 'exact', head: true })
    .eq('pipeline', SALES_PIPELINE_ID);

  console.log(`\nSupabase exact count (sales pipeline): ${count}`);
  console.log(`Our paginated fetch count: ${allDeals.length}`);
  console.log(`Match: ${count === allDeals.length ? '✅ YES' : '⚠️ NO — possible sync issue'}`);

  // Check: deals with closed_won_entered_at but deal_stage is NOT closed_won
  // (could indicate data inconsistency)
  const wonTimestampButNotStage = allDeals.filter(
    (d) => d.closed_won_entered_at && d.deal_stage !== closedWonStageId
  );
  console.log(`\nDeals with closed_won_entered_at but NOT in Closed Won stage: ${wonTimestampButNotStage.length}`);
  if (wonTimestampButNotStage.length > 0) {
    const stageLabel = Object.fromEntries(Object.values(S).map((s) => [s.id, s.label]));
    console.log('  (May have been reopened or moved back):');
    for (const d of wonTimestampButNotStage.slice(0, 10)) {
      const stage = stageLabel[d.deal_stage] || d.deal_stage;
      console.log(`    ${d.deal_name} — stage: ${stage} — closed_won_entered_at: ${new Date(d.closed_won_entered_at).toISOString().split('T')[0]}`);
    }
  }

  console.log('\n═══ DONE ═══\n');
}

main().catch(console.error);
