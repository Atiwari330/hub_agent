/**
 * Q2 2026 Cohort Analysis (Refined)
 *
 * Fixes the timing problem in the initial analysis by tracking deal COHORTS:
 * for deals created in each quarter, how many EVENTUALLY reached each stage
 * (regardless of which quarter they hit that stage).
 *
 * Also segments by lead source / PPL vs non-PPL to get more accurate rates.
 *
 * Usage:
 *   npx tsx src/scripts/q2-cohort-analysis.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { getQuarterInfo, type QuarterInfo } from '../lib/utils/quarter';
import { SALES_PIPELINE_STAGES } from '../lib/hubspot/stage-config';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SALES_PIPELINE_ID = '1c27e5a3-5e5e-4403-ab0f-d356bf268cf3';
const S = SALES_PIPELINE_STAGES;

async function fetchAllDeals() {
  const PAGE_SIZE = 500;
  let allDeals: any[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('deals')
      .select(`
        id, hubspot_deal_id, deal_name, amount, close_date, pipeline,
        deal_stage, owner_id, hubspot_owner_id, hubspot_created_at,
        lead_source, mql_entered_at, discovery_entered_at,
        demo_scheduled_entered_at, demo_completed_entered_at,
        proposal_entered_at, closed_won_entered_at, created_at, synced_at
      `)
      .eq('pipeline', SALES_PIPELINE_ID)
      .range(offset, offset + PAGE_SIZE - 1)
      .order('created_at', { ascending: true });

    if (error) { console.error('Error:', error.message); process.exit(1); }
    allDeals = allDeals.concat(data || []);
    hasMore = (data || []).length === PAGE_SIZE;
    offset += PAGE_SIZE;
  }
  return allDeals;
}

async function fetchOwners() {
  const { data } = await supabase.from('owners').select('id, first_name, last_name, email, hubspot_owner_id');
  return data || [];
}

function isInQuarter(dateStr: string | null, qi: QuarterInfo): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d >= qi.startDate && d <= qi.endDate;
}

function daysBetween(d1: string, d2: string): number {
  return Math.round((new Date(d2).getTime() - new Date(d1).getTime()) / (1000 * 60 * 60 * 24));
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function fmt(n: number): string {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

async function main() {
  console.log('\n🔍 Fetching all deals...');
  const allDeals = await fetchAllDeals();
  const owners = await fetchOwners();
  const ownerMap = new Map(owners.map((o) => [o.id, o]));

  const TARGET_AE_EMAILS = [
    'cgarraffa@opusbehavioral.com', 'jrice@opusbehavioral.com',
    'atiwari@opusbehavioral.com', 'zclaussen@opusbehavioral.com',
    'hgomez@opusbehavioral.com',
  ];
  const targetAeOwnerIds = new Set(
    owners.filter((o) => TARGET_AE_EMAILS.includes(o.email)).map((o) => o.id)
  );

  const output: string[] = [];
  const log = (s: string = '') => { console.log(s); output.push(s); };

  log('# Q2 2026 Reverse-Engineering Analysis — REFINED');
  log(`*Generated ${new Date().toISOString().split('T')[0]} | ${allDeals.length} sales pipeline deals*\n`);
  log('---\n');

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 1: COHORT ANALYSIS
  // For each quarter's created deals, track EVENTUAL outcomes
  // ═══════════════════════════════════════════════════════════════════

  const quarters = [
    getQuarterInfo(2025, 1), getQuarterInfo(2025, 2), getQuarterInfo(2025, 3),
    getQuarterInfo(2025, 4), getQuarterInfo(2026, 1),
  ];

  log('## 1. COHORT ANALYSIS: What happened to deals created in each quarter?\n');
  log('This tracks deals from their CREATION quarter to their EVENTUAL outcome (which may be a later quarter).\n');

  // Only include cohorts with enough maturation time (exclude Q1 2026 from rate calculations
  // since many deals are still in-flight)
  log('| Creation Quarter | Deals Created | Ever Demo Completed | Ever Closed Won | Create→Demo % | Demo→Won % | Won ARR | Avg Deal Size |');
  log('|-----------------|---------------|---------------------|-----------------|---------------|------------|---------|--------------|');

  interface CohortStats {
    label: string;
    created: any[];
    demoCompleted: any[];
    closedWon: any[];
    closedWonARR: number;
    avgDealSize: number;
    createToDemoRate: number;
    demoToWonRate: number;
    cycleTimes: number[];
    createToDemoTimes: number[];
    demoToCloseTimes: number[];
    mature: boolean; // has had enough time to mature
  }

  const cohorts: CohortStats[] = [];

  for (const qi of quarters) {
    const created = allDeals.filter((d) => d.hubspot_created_at && isInQuarter(d.hubspot_created_at, qi));
    const demoCompleted = created.filter((d) => d.demo_completed_entered_at);
    const closedWon = created.filter((d) => d.closed_won_entered_at);
    const closedWonARR = closedWon.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const avgDealSize = closedWon.length > 0 ? closedWonARR / closedWon.length : 0;
    const createToDemoRate = created.length > 0 ? demoCompleted.length / created.length : 0;
    const demoToWonRate = demoCompleted.length > 0 ? closedWon.length / demoCompleted.length : 0;

    // Is this cohort old enough to have matured? (at least 1 quarter old)
    const now = new Date();
    const mature = qi.endDate.getTime() < now.getTime() - 90 * 24 * 60 * 60 * 1000;

    const cycleTimes: number[] = [];
    const createToDemoTimes: number[] = [];
    const demoToCloseTimes: number[] = [];

    for (const d of closedWon) {
      if (d.hubspot_created_at && d.closed_won_entered_at) {
        cycleTimes.push(daysBetween(d.hubspot_created_at, d.closed_won_entered_at));
      }
      if (d.hubspot_created_at && d.demo_completed_entered_at) {
        createToDemoTimes.push(daysBetween(d.hubspot_created_at, d.demo_completed_entered_at));
      }
      if (d.demo_completed_entered_at && d.closed_won_entered_at) {
        demoToCloseTimes.push(daysBetween(d.demo_completed_entered_at, d.closed_won_entered_at));
      }
    }

    const cs: CohortStats = {
      label: qi.label,
      created, demoCompleted, closedWon, closedWonARR, avgDealSize,
      createToDemoRate, demoToWonRate, cycleTimes, createToDemoTimes, demoToCloseTimes, mature,
    };
    cohorts.push(cs);

    const matureNote = mature ? '' : ' *';
    log(`| ${qi.label}${matureNote} | ${created.length} | ${demoCompleted.length} | ${closedWon.length} | ${pct(createToDemoRate)} | ${demoCompleted.length > 0 ? pct(demoToWonRate) : 'N/A'} | ${fmt(closedWonARR)} | ${closedWon.length > 0 ? fmt(avgDealSize) : 'N/A'} |`);
  }

  log('\n\\* = cohort still maturing (deals still in-flight, rates will increase)\n');

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 2: MATURE COHORT RATES (Q1-Q3 2025 — fully matured)
  // ═══════════════════════════════════════════════════════════════════

  log('## 2. MATURE COHORT CONVERSION RATES\n');
  log('Using only fully matured cohorts (Q1-Q3 2025) where deals have had time to progress through the full funnel.\n');

  const matureCohorts = cohorts.filter((c) => c.mature);
  const matureLabels = matureCohorts.map((c) => c.label).join(', ');

  const mCreated = matureCohorts.reduce((s, c) => s + c.created.length, 0);
  const mDemoComp = matureCohorts.reduce((s, c) => s + c.demoCompleted.length, 0);
  const mClosedWon = matureCohorts.reduce((s, c) => s + c.closedWon.length, 0);
  const mARR = matureCohorts.reduce((s, c) => s + c.closedWonARR, 0);
  const mAvgDeal = mClosedWon > 0 ? mARR / mClosedWon : 0;
  const mCreateToDemo = mCreated > 0 ? mDemoComp / mCreated : 0;
  const mDemoToWon = mDemoComp > 0 ? mClosedWon / mDemoComp : 0;
  const mCreateToWon = mCreated > 0 ? mClosedWon / mCreated : 0;

  const mAllCycles = matureCohorts.flatMap((c) => c.cycleTimes);
  const mAllCreateToDemo = matureCohorts.flatMap((c) => c.createToDemoTimes);
  const mAllDemoToClose = matureCohorts.flatMap((c) => c.demoToCloseTimes);

  log(`**Cohorts used:** ${matureLabels}\n`);
  log('| Metric | Value |');
  log('|--------|-------|');
  log(`| Deals Created | ${mCreated} |`);
  log(`| Eventually Demo Completed | ${mDemoComp} |`);
  log(`| Eventually Closed Won | ${mClosedWon} |`);
  log(`| Total Won ARR | ${fmt(mARR)} |`);
  log(`| **Avg Deal Size** | **${fmt(mAvgDeal)}** |`);
  log(`| **Create → Demo %** | **${pct(mCreateToDemo)}** |`);
  log(`| **Demo → Won %** | **${pct(mDemoToWon)}** |`);
  log(`| **Create → Won %** | **${pct(mCreateToWon)}** |`);

  if (mAllCycles.length > 0) {
    const avg = Math.round(mAllCycles.reduce((a, b) => a + b, 0) / mAllCycles.length);
    log(`| **Full Cycle (avg / median)** | **${avg} / ${median(mAllCycles)} days** |`);
  }
  if (mAllCreateToDemo.length > 0) {
    const avg = Math.round(mAllCreateToDemo.reduce((a, b) => a + b, 0) / mAllCreateToDemo.length);
    log(`| **Create → Demo (avg / median)** | **${avg} / ${median(mAllCreateToDemo)} days** |`);
  }
  if (mAllDemoToClose.length > 0) {
    const avg = Math.round(mAllDemoToClose.reduce((a, b) => a + b, 0) / mAllDemoToClose.length);
    log(`| **Demo → Won (avg / median)** | **${avg} / ${median(mAllDemoToClose)} days** |`);
  }
  log('');

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 3: INCLUDE Q4 2025 + Q1 2026 WITH PARTIAL CREDIT
  // Q4 2025 is mostly mature, Q1 2026 is still cooking
  // ═══════════════════════════════════════════════════════════════════

  log('## 3. RECENT COHORT RATES (Including Q4 2025)\n');
  log('Q4 2025 is ~90 days old — most deals that will convert should have by now.\n');

  const recentCohorts = cohorts.filter((c) => ['Q1 2025', 'Q2 2025', 'Q3 2025', 'Q4 2025'].includes(c.label));
  const rCreated = recentCohorts.reduce((s, c) => s + c.created.length, 0);
  const rDemoComp = recentCohorts.reduce((s, c) => s + c.demoCompleted.length, 0);
  const rClosedWon = recentCohorts.reduce((s, c) => s + c.closedWon.length, 0);
  const rARR = recentCohorts.reduce((s, c) => s + c.closedWonARR, 0);
  const rAvgDeal = rClosedWon > 0 ? rARR / rClosedWon : 0;
  const rCreateToDemo = rCreated > 0 ? rDemoComp / rCreated : 0;
  const rDemoToWon = rDemoComp > 0 ? rClosedWon / rDemoComp : 0;

  const rAllCycles = recentCohorts.flatMap((c) => c.cycleTimes);
  const rAllDemoToClose = recentCohorts.flatMap((c) => c.demoToCloseTimes);

  log('| Metric | Q1-Q3 2025 (mature) | Q1-Q4 2025 (recent) |');
  log('|--------|---------------------|---------------------|');
  log(`| Deals Created | ${mCreated} | ${rCreated} |`);
  log(`| Demo Completed | ${mDemoComp} | ${rDemoComp} |`);
  log(`| Closed Won | ${mClosedWon} | ${rClosedWon} |`);
  log(`| Total ARR | ${fmt(mARR)} | ${fmt(rARR)} |`);
  log(`| Avg Deal Size | ${fmt(mAvgDeal)} | ${fmt(rAvgDeal)} |`);
  log(`| Create → Demo % | ${pct(mCreateToDemo)} | ${pct(rCreateToDemo)} |`);
  log(`| Demo → Won % | ${pct(mDemoToWon)} | ${pct(rDemoToWon)} |`);
  log('');

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 4: Q1 2026 DEEP DIVE — The PPL effect
  // ═══════════════════════════════════════════════════════════════════

  log('## 4. Q1 2026 DEEP DIVE: Why 263 deals but only 17.5% conversion?\n');

  const q1_2026 = cohorts.find((c) => c.label === 'Q1 2026')!;

  // Segment by lead source
  const leadSourceCounts = new Map<string, { total: number; demo: number; won: number; arr: number }>();
  for (const d of q1_2026.created) {
    const src = d.lead_source || '(no lead source)';
    if (!leadSourceCounts.has(src)) leadSourceCounts.set(src, { total: 0, demo: 0, won: 0, arr: 0 });
    const entry = leadSourceCounts.get(src)!;
    entry.total++;
    if (d.demo_completed_entered_at) entry.demo++;
    if (d.closed_won_entered_at) {
      entry.won++;
      entry.arr += Number(d.amount) || 0;
    }
  }

  log('| Lead Source | Created | Demo Completed | Closed Won | Create→Demo % |');
  log('|------------|---------|----------------|------------|---------------|');
  const sortedSources = [...leadSourceCounts.entries()].sort((a, b) => b[1].total - a[1].total);
  for (const [src, counts] of sortedSources) {
    if (counts.total >= 2) {
      log(`| ${src} | ${counts.total} | ${counts.demo} | ${counts.won} | ${counts.total > 0 ? pct(counts.demo / counts.total) : 'N/A'} |`);
    }
  }
  log('');

  // Segment: deals with owner vs no owner
  const q1WithOwner = q1_2026.created.filter((d) => targetAeOwnerIds.has(d.owner_id));
  const q1NoOwner = q1_2026.created.filter((d) => !targetAeOwnerIds.has(d.owner_id));

  log('**Team AE-owned deals vs other:**\n');
  const q1TeamDemo = q1WithOwner.filter((d) => d.demo_completed_entered_at).length;
  const q1TeamWon = q1WithOwner.filter((d) => d.closed_won_entered_at).length;
  const q1OtherDemo = q1NoOwner.filter((d) => d.demo_completed_entered_at).length;

  log(`| Segment | Created | Demo | Won | Create→Demo % |`);
  log(`|---------|---------|------|-----|---------------|`);
  log(`| Team AEs | ${q1WithOwner.length} | ${q1TeamDemo} | ${q1TeamWon} | ${pct(q1TeamDemo / q1WithOwner.length)} |`);
  log(`| Other/Unassigned | ${q1NoOwner.length} | ${q1OtherDemo} | ${q1NoOwner.filter((d) => d.closed_won_entered_at).length} | ${q1NoOwner.length > 0 ? pct(q1OtherDemo / q1NoOwner.length) : 'N/A'} |`);
  log('');

  // Current stage distribution for Q1 2026 deals
  const stageLabel: Record<string, string> = Object.fromEntries(
    Object.values(SALES_PIPELINE_STAGES).map((s) => [s.id, s.label])
  );

  log('**Where are Q1 2026 deals now?**\n');
  const stageDist = new Map<string, number>();
  for (const d of q1_2026.created) {
    const label = stageLabel[d.deal_stage] || d.deal_stage || '(unknown)';
    stageDist.set(label, (stageDist.get(label) || 0) + 1);
  }

  log('| Current Stage | Count |');
  log('|--------------|-------|');
  for (const [stage, count] of [...stageDist.entries()].sort((a, b) => b[1] - a[1])) {
    log(`| ${stage} | ${count} |`);
  }
  log('');

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 5: REVERSE ENGINEERING WITH BEST RATES
  // Use mature cohort rates for the math
  // ═══════════════════════════════════════════════════════════════════

  const Q2_TARGET = 925000;

  log('## 5. Q2 2026 REQUIREMENTS (Using Mature Cohort Rates)\n');
  log(`**Target:** ${fmt(Q2_TARGET)} team new logo ARR\n`);

  // Use mature rates as "proven" rates, recent rates as "trending" rates
  const rates = {
    mature: { createToDemo: mCreateToDemo, demoToWon: mDemoToWon, avgDeal: mAvgDeal, label: 'Mature (Q1-Q3 2025)' },
    recent: { createToDemo: rCreateToDemo, demoToWon: rDemoToWon, avgDeal: rAvgDeal, label: 'Recent (Q1-Q4 2025)' },
  };

  for (const [key, r] of Object.entries(rates)) {
    const closesNeeded = Math.ceil(Q2_TARGET / r.avgDeal);
    const demosNeeded = Math.ceil(closesNeeded / r.demoToWon);
    const leadsNeeded = Math.ceil(demosNeeded / r.createToDemo);

    log(`### Using ${r.label} rates\n`);
    log(`| Step | Metric | Value |`);
    log(`|------|--------|-------|`);
    log(`| 1 | Avg deal size | ${fmt(r.avgDeal)} |`);
    log(`| 2 | Closed-won deals needed | ${closesNeeded} (${fmt(Q2_TARGET)} ÷ ${fmt(r.avgDeal)}) |`);
    log(`| 3 | Demo→Won rate | ${pct(r.demoToWon)} |`);
    log(`| 4 | **Demos needed** | **${demosNeeded}** (${closesNeeded} ÷ ${pct(r.demoToWon)}) |`);
    log(`| 5 | Create→Demo rate | ${pct(r.createToDemo)} |`);
    log(`| 6 | **New leads needed** | **${leadsNeeded}** (${demosNeeded} ÷ ${pct(r.createToDemo)}) |`);
    log('');

    log(`| Pace | Per Quarter | Per Month | Per Week |`);
    log(`|------|-------------|-----------|----------|`);
    log(`| Leads | ${leadsNeeded} | ${Math.ceil(leadsNeeded / 3)} | ${Math.ceil(leadsNeeded / 13)} |`);
    log(`| Demos | ${demosNeeded} | ${Math.ceil(demosNeeded / 3)} | ${Math.ceil(demosNeeded / 13)} |`);
    log(`| Closes | ${closesNeeded} | ${Math.ceil(closesNeeded / 3)} | ${Math.ceil(closesNeeded / 13)} |`);
    log('');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 6: EXISTING PIPELINE CREDIT
  // ═══════════════════════════════════════════════════════════════════

  log('## 6. EXISTING PIPELINE ENTERING Q2\n');

  const postDemoStages = new Set([
    S.DEMO_COMPLETED.id, S.QUALIFIED_VALIDATED.id,
    S.PROPOSAL_EVALUATING.id, S.MSA_SENT_REVIEW.id,
  ]);
  const preDemoStages = new Set([S.MQL.id, S.SQL_DISCOVERY.id, S.DEMO_SCHEDULED.id]);

  const activeDeals = allDeals.filter((d) =>
    postDemoStages.has(d.deal_stage) || preDemoStages.has(d.deal_stage)
  );

  const postDemo = activeDeals.filter((d) => postDemoStages.has(d.deal_stage));
  const preDemo = activeDeals.filter((d) => preDemoStages.has(d.deal_stage));

  const postDemoARR = postDemo.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const preDemoARR = preDemo.reduce((s, d) => s + (Number(d.amount) || 0), 0);

  // List the post-demo deals (these are the most likely to close)
  log('**Post-Demo pipeline (most likely to close in Q2):**\n');
  log('| Deal | Stage | AE | Amount | Days in Pipeline |');
  log('|------|-------|----|--------|-----------------|');

  for (const d of postDemo.sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))) {
    const owner = ownerMap.get(d.owner_id);
    const name = owner ? `${owner.first_name} ${owner.last_name}` : 'Unknown';
    const amt = d.amount ? fmt(Number(d.amount)) : 'N/A';
    const stage = stageLabel[d.deal_stage] || d.deal_stage;
    const daysInPipeline = d.hubspot_created_at
      ? daysBetween(d.hubspot_created_at, new Date().toISOString())
      : '?';
    log(`| ${d.deal_name.substring(0, 50)} | ${stage} | ${name} | ${amt} | ${daysInPipeline} |`);
  }

  log('');
  log(`**Post-Demo total raw ARR:** ${fmt(postDemoARR)} (${postDemo.length} deals)`);
  log(`**Pre-Demo total raw ARR:** ${fmt(preDemoARR)} (${preDemo.length} deals)`);
  log('');

  // Weighted with mature rates
  const weightedPost = postDemoARR * rates.recent.demoToWon;
  const weightedPre = preDemoARR * rates.recent.createToDemo * rates.recent.demoToWon;

  log(`**Weighted pipeline (using recent Q1-Q4 2025 rates):**\n`);
  log(`| Segment | Raw ARR | Rate | Weighted |`);
  log(`|---------|---------|------|----------|`);
  log(`| Post-Demo | ${fmt(postDemoARR)} | ${pct(rates.recent.demoToWon)} | ${fmt(Math.round(weightedPost))} |`);
  log(`| Pre-Demo | ${fmt(preDemoARR)} | ${pct(rates.recent.createToDemo)} × ${pct(rates.recent.demoToWon)} | ${fmt(Math.round(weightedPre))} |`);
  log(`| **Total** | | | **${fmt(Math.round(weightedPost + weightedPre))}** |`);
  log('');

  const gap = Q2_TARGET - Math.round(weightedPost + weightedPre);
  log(`**Gap to fill from new Q2 activity:** ${fmt(Math.max(0, gap))}\n`);

  if (gap > 0) {
    const gapCloses = Math.ceil(gap / rates.recent.avgDeal);
    const gapDemos = Math.ceil(gapCloses / rates.recent.demoToWon);
    const gapLeads = Math.ceil(gapDemos / rates.recent.createToDemo);
    log(`To close the gap (using recent rates):`);
    log(`- **${gapCloses} additional closes** @ ${fmt(rates.recent.avgDeal)} avg`);
    log(`- **${gapDemos} additional demos**`);
    log(`- **${gapLeads} additional new leads**`);
    log('');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 7: TIMING CONSTRAINTS
  // ═══════════════════════════════════════════════════════════════════

  log('## 7. CRITICAL TIMING DEADLINES\n');
  log('Q2 2026 = April 1 – June 30\n');

  // Use all closed-won deals for cycle time analysis
  const allWonDeals = allDeals.filter((d) => d.closed_won_entered_at && d.hubspot_created_at);
  const allCycleTimesArr = allWonDeals.map((d) => daysBetween(d.hubspot_created_at, d.closed_won_entered_at));
  const allDemoToCloseArr = allWonDeals
    .filter((d) => d.demo_completed_entered_at)
    .map((d) => daysBetween(d.demo_completed_entered_at, d.closed_won_entered_at));
  const allCreateToDemoArr = allWonDeals
    .filter((d) => d.demo_completed_entered_at)
    .map((d) => daysBetween(d.hubspot_created_at, d.demo_completed_entered_at));

  if (allCycleTimesArr.length > 0) {
    const avgCycle = Math.round(allCycleTimesArr.reduce((a, b) => a + b, 0) / allCycleTimesArr.length);
    const medCycle = median(allCycleTimesArr);
    const p25 = allCycleTimesArr.sort((a, b) => a - b)[Math.floor(allCycleTimesArr.length * 0.25)];
    const p75 = allCycleTimesArr.sort((a, b) => a - b)[Math.floor(allCycleTimesArr.length * 0.75)];

    log(`**Full cycle (create → closed won):** avg ${avgCycle}d, median ${medCycle}d, P25=${p25}d, P75=${p75}d\n`);

    const q2End = new Date('2026-06-30');
    const latestCreateMedian = new Date(q2End.getTime() - medCycle * 86400000);
    const latestCreateP75 = new Date(q2End.getTime() - p75 * 86400000);

    log(`To close by June 30:`);
    log(`- **50th percentile deal:** must be created by **${latestCreateMedian.toISOString().split('T')[0]}**`);
    log(`- **75th percentile deal:** must be created by **${latestCreateP75.toISOString().split('T')[0]}**`);
    log(`- Implication: most deals that will close in Q2 **already need to exist or be created in April**`);
    log('');
  }

  if (allDemoToCloseArr.length > 0) {
    const avgDTC = Math.round(allDemoToCloseArr.reduce((a, b) => a + b, 0) / allDemoToCloseArr.length);
    const medDTC = median(allDemoToCloseArr);
    const q2End = new Date('2026-06-30');
    const latestDemo = new Date(q2End.getTime() - medDTC * 86400000);

    log(`**Demo → Close:** avg ${avgDTC}d, median ${medDTC}d`);
    log(`- Demos must be completed by **${latestDemo.toISOString().split('T')[0]}** (median) to close in Q2`);
    log('');
  }

  if (allCreateToDemoArr.length > 0) {
    const avgCTD = Math.round(allCreateToDemoArr.reduce((a, b) => a + b, 0) / allCreateToDemoArr.length);
    const medCTD = median(allCreateToDemoArr);
    log(`**Create → Demo:** avg ${avgCTD}d, median ${medCTD}d`);
    log('');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 8: PER-AE BREAKDOWN
  // ═══════════════════════════════════════════════════════════════════

  log('## 8. PER-AE REQUIREMENTS\n');

  const aeTargets: Record<string, number> = {
    'cgarraffa@opusbehavioral.com': 400000,
    'jrice@opusbehavioral.com': 300000,
    'atiwari@opusbehavioral.com': 90000,
    'zclaussen@opusbehavioral.com': 90000,
    'hgomez@opusbehavioral.com': 25000,
  };

  // Use recent rates for the breakdown
  const r = rates.recent;

  log(`*Using Q1-Q4 2025 rates: ${fmt(r.avgDeal)} avg deal, ${pct(r.demoToWon)} demo→won, ${pct(r.createToDemo)} create→demo*\n`);
  log('| AE | Q2 Target | Closes Needed | Demos Needed | Leads Needed | Closes/Mo | Demos/Mo | Leads/Mo |');
  log('|----|-----------|--------------|-------------|-------------|-----------|----------|----------|');

  for (const [email, target] of Object.entries(aeTargets)) {
    const owner = owners.find((o) => o.email === email);
    const name = owner ? `${owner.first_name} ${owner.last_name}` : email.split('@')[0];
    const closes = Math.ceil(target / r.avgDeal);
    const demos = Math.ceil(closes / r.demoToWon);
    const leads = Math.ceil(demos / r.createToDemo);
    log(`| ${name} | ${fmt(target)} | ${closes} | ${demos} | ${leads} | ${Math.ceil(closes / 3)} | ${Math.ceil(demos / 3)} | ${Math.ceil(leads / 3)} |`);
  }
  log('');

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 9: SCENARIO ANALYSIS
  // ═══════════════════════════════════════════════════════════════════

  log('## 9. SCENARIO ANALYSIS\n');

  const scenarios = [
    { name: 'Historical rates (Q1-Q4 2025)', ds: r.avgDeal, dw: r.demoToWon, cd: r.createToDemo },
    { name: 'Larger deals (+30%)', ds: r.avgDeal * 1.3, dw: r.demoToWon, cd: r.createToDemo },
    { name: 'Better close rate (+30%)', ds: r.avgDeal, dw: Math.min(1, r.demoToWon * 1.3), cd: r.createToDemo },
    { name: 'Better demo conversion (+30%)', ds: r.avgDeal, dw: r.demoToWon, cd: Math.min(1, r.createToDemo * 1.3) },
    { name: 'All levers +20%', ds: r.avgDeal * 1.2, dw: Math.min(1, r.demoToWon * 1.2), cd: Math.min(1, r.createToDemo * 1.2) },
    { name: 'All levers +30%', ds: r.avgDeal * 1.3, dw: Math.min(1, r.demoToWon * 1.3), cd: Math.min(1, r.createToDemo * 1.3) },
  ];

  log('| Scenario | Avg Deal | Demo→Won | Create→Demo | Closes | Demos | Leads | Leads/Mo |');
  log('|----------|----------|----------|------------|--------|-------|-------|----------|');

  for (const s of scenarios) {
    const closes = Math.ceil(Q2_TARGET / s.ds);
    const demos = Math.ceil(closes / s.dw);
    const leads = Math.ceil(demos / s.cd);
    log(`| ${s.name} | ${fmt(s.ds)} | ${pct(s.dw)} | ${pct(s.cd)} | ${closes} | ${demos} | ${leads} | ${Math.ceil(leads / 3)} |`);
  }
  log('');

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 10: EXECUTIVE SUMMARY
  // ═══════════════════════════════════════════════════════════════════

  log('---\n');
  log('## EXECUTIVE SUMMARY\n');

  const closesNeeded = Math.ceil(Q2_TARGET / r.avgDeal);
  const demosNeeded = Math.ceil(closesNeeded / r.demoToWon);
  const leadsNeeded = Math.ceil(demosNeeded / r.createToDemo);

  log(`### The Math (Q1-Q4 2025 historical rates)\n`);
  log('```');
  log(`$925,000 target ÷ ${fmt(r.avgDeal)} avg deal = ${closesNeeded} closed-won deals`);
  log(`${closesNeeded} closes ÷ ${pct(r.demoToWon)} demo→won rate = ${demosNeeded} demos completed`);
  log(`${demosNeeded} demos ÷ ${pct(r.createToDemo)} create→demo rate = ${leadsNeeded} new leads`);
  log('```\n');

  log('### What Must Be True\n');
  log(`1. **${leadsNeeded} new leads** must enter the pipeline in Q2 (~${Math.ceil(leadsNeeded / 3)}/month, ~${Math.ceil(leadsNeeded / 13)}/week)`);
  log(`2. **${demosNeeded} demos** must be completed (~${Math.ceil(demosNeeded / 3)}/month, ~${Math.ceil(demosNeeded / 13)}/week)`);
  log(`3. **${closesNeeded} deals** must close at ~${fmt(r.avgDeal)} average (~${Math.ceil(closesNeeded / 3)}/month)`);
  log(`4. **Timing:** Median deal cycle is ${median(allCycleTimesArr)}d — most Q2 closes need to be created by mid-May at latest`);
  log(`5. **Existing pipeline** covers ~${fmt(Math.round(weightedPost + weightedPre))} (weighted), leaving a **${fmt(Math.max(0, gap))} gap**`);
  log('');

  log('### Context vs. Historical Performance\n');
  log(`| Quarter | Closed Won ARR | Deals | Avg Size |`);
  log(`|---------|---------------|-------|----------|`);
  for (const c of cohorts) {
    log(`| ${c.label} | ${fmt(c.closedWonARR)} | ${c.closedWon.length} | ${c.closedWon.length > 0 ? fmt(c.avgDealSize) : 'N/A'} |`);
  }
  log(`| **Q2 2026 Target** | **${fmt(Q2_TARGET)}** | **${closesNeeded}** | **${fmt(r.avgDeal)}** |`);
  log('');

  const bestQuarter = Math.max(...cohorts.map((c) => c.closedWonARR));
  log(`Best historical quarter: ${fmt(bestQuarter)} — Q2 target is **${(Q2_TARGET / bestQuarter).toFixed(1)}x** that number.`);
  log('');
  log('### Key Risks\n');
  log(`- The target requires **${(Q2_TARGET / bestQuarter).toFixed(1)}x** the best-ever quarterly performance`);
  log(`- Historical close rate of ${pct(r.demoToWon)} means ~${Math.round((1 - r.demoToWon) * 100)}% of demos won't convert`);
  log(`- Median deal takes ${median(allCycleTimesArr)} days start-to-finish, so late-quarter leads won't close in Q2`);
  log(`- Pipeline must be front-loaded: deals created in April/May are the ones that close in Q2`);
  log('');

  log('---');
  log(`*Analysis from ${allDeals.length} deals, ${allWonDeals.length} closed-won. Generated ${new Date().toISOString().split('T')[0]}.*`);

  // Write to file
  const filename = 'q2-2026-reverse-engineering.md';
  fs.writeFileSync(filename, output.join('\n'), 'utf-8');
  log(`\n📄 Report written to ${filename}`);
}

main().catch(console.error);
