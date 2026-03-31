/**
 * Q2 2026 Reverse-Engineering Analysis
 *
 * Analyzes historical deal data to determine what lead generation and demo
 * activity is required to hit the $925K team new logo ARR target in Q2 2026.
 *
 * Pulls ALL deals from Supabase (paginated to avoid 1000-row limit),
 * computes conversion rates, average deal sizes, cycle times, and then
 * reverse-engineers the required inputs for Q2.
 *
 * Usage:
 *   npx tsx src/scripts/q2-reverse-engineer.ts
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

// ── Paginated fetch to avoid Supabase 1000-row default limit ──

async function fetchAllDeals() {
  const PAGE_SIZE = 500;
  let allDeals: any[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('deals')
      .select(`
        id,
        hubspot_deal_id,
        deal_name,
        amount,
        close_date,
        pipeline,
        deal_stage,
        owner_id,
        hubspot_owner_id,
        hubspot_created_at,
        mql_entered_at,
        discovery_entered_at,
        demo_scheduled_entered_at,
        demo_completed_entered_at,
        proposal_entered_at,
        closed_won_entered_at,
        created_at,
        synced_at
      `)
      .eq('pipeline', SALES_PIPELINE_ID)
      .range(offset, offset + PAGE_SIZE - 1)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching deals:', error.message);
      process.exit(1);
    }

    allDeals = allDeals.concat(data || []);
    hasMore = (data || []).length === PAGE_SIZE;
    offset += PAGE_SIZE;
  }

  return allDeals;
}

async function fetchOwners() {
  const { data, error } = await supabase
    .from('owners')
    .select('id, first_name, last_name, email, hubspot_owner_id');

  if (error) {
    console.error('Error fetching owners:', error.message);
    process.exit(1);
  }
  return data || [];
}

// ── Helpers ──

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

// ── Main Analysis ──

async function main() {
  console.log('\n🔍 Fetching all deals from Supabase (paginated)...');
  const allDeals = await fetchAllDeals();
  console.log(`   Total sales pipeline deals in DB: ${allDeals.length}`);

  const owners = await fetchOwners();
  const ownerMap = new Map(owners.map((o) => [o.id, o]));
  const ownerByHubspotId = new Map(owners.map((o) => [o.hubspot_owner_id, o]));

  // Target AE emails for the team
  const TARGET_AE_EMAILS = [
    'cgarraffa@opusbehavioral.com',
    'jrice@opusbehavioral.com',
    'atiwari@opusbehavioral.com',
    'zclaussen@opusbehavioral.com',
    'hgomez@opusbehavioral.com',
  ];
  const targetAeOwnerIds = new Set(
    owners.filter((o) => TARGET_AE_EMAILS.includes(o.email)).map((o) => o.id)
  );

  // Quarters to analyze: Q1 2025 through Q1 2026 (historical), plus Q2 2026 (target)
  const quarters: { qi: QuarterInfo; label: string }[] = [
    { qi: getQuarterInfo(2025, 1), label: 'Q1 2025' },
    { qi: getQuarterInfo(2025, 2), label: 'Q2 2025' },
    { qi: getQuarterInfo(2025, 3), label: 'Q3 2025' },
    { qi: getQuarterInfo(2025, 4), label: 'Q4 2025' },
    { qi: getQuarterInfo(2026, 1), label: 'Q1 2026' },
  ];

  const output: string[] = [];
  const log = (s: string = '') => {
    console.log(s);
    output.push(s);
  };

  log('\n════════════════════════════════════════════════════════════════════');
  log('  Q2 2026 REVERSE-ENGINEERING ANALYSIS');
  log('  Target: $925,000 Team New Logo ARR');
  log('════════════════════════════════════════════════════════════════════\n');

  // ── Data integrity check ──
  log('## DATA INTEGRITY CHECK\n');

  const dealsWithNoAmount = allDeals.filter((d) => !d.amount || Number(d.amount) === 0);
  const dealsWithNoOwner = allDeals.filter((d) => !d.owner_id);
  const dealsWithNoCreateDate = allDeals.filter((d) => !d.hubspot_created_at);

  log(`Total sales pipeline deals: ${allDeals.length}`);
  log(`Deals with no amount: ${dealsWithNoAmount.length}`);
  log(`Deals with no owner: ${dealsWithNoOwner.length}`);
  log(`Deals with no HubSpot create date: ${dealsWithNoCreateDate.length}`);

  // Check for deals with closed_won_entered_at but missing timestamps
  const closedWonDeals = allDeals.filter((d) => d.closed_won_entered_at);
  const closedWonNoDemo = closedWonDeals.filter((d) => !d.demo_completed_entered_at);
  log(`Closed-won deals total (all time): ${closedWonDeals.length}`);
  log(`Closed-won deals missing demo_completed_entered_at: ${closedWonNoDemo.length}`);
  log(`  (these may have been closed before stage tracking was added)\n`);

  // ── Per-quarter funnel analysis ──
  log('## QUARTERLY FUNNEL ANALYSIS\n');
  log('Each section shows deals that ENTERED that stage during the quarter.\n');

  interface QuarterStats {
    label: string;
    dealsCreated: number;
    dealsCreatedTeam: number;
    mqlEntered: number;
    discoveryEntered: number;
    demoScheduledEntered: number;
    demoCompletedEntered: number;
    proposalEntered: number;
    closedWonEntered: number;
    closedWonARR: number;
    closedWonDeals: any[];
    avgDealSize: number;
    cycleTimes: number[];
    demoToCycleTimes: number[];
    createToDemoTimes: number[];
  }

  const quarterStats: QuarterStats[] = [];

  for (const { qi, label } of quarters) {
    // Deals CREATED in this quarter (using hubspot_created_at)
    const createdInQ = allDeals.filter((d) => isInQuarter(d.hubspot_created_at, qi));
    const createdInQTeam = createdInQ.filter((d) => targetAeOwnerIds.has(d.owner_id));

    // Stage entries in this quarter
    const mqlInQ = allDeals.filter((d) => isInQuarter(d.mql_entered_at, qi));
    const discoveryInQ = allDeals.filter((d) => isInQuarter(d.discovery_entered_at, qi));
    const demoSchedInQ = allDeals.filter((d) => isInQuarter(d.demo_scheduled_entered_at, qi));
    const demoCompInQ = allDeals.filter((d) => isInQuarter(d.demo_completed_entered_at, qi));
    const proposalInQ = allDeals.filter((d) => isInQuarter(d.proposal_entered_at, qi));
    const closedWonInQ = allDeals.filter((d) => isInQuarter(d.closed_won_entered_at, qi));

    // Closed-won ARR
    const closedWonARR = closedWonInQ.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
    const avgDealSize = closedWonInQ.length > 0 ? closedWonARR / closedWonInQ.length : 0;

    // Cycle times: from hubspot_created_at to closed_won_entered_at
    const cycleTimes: number[] = [];
    const demoToCycleTimes: number[] = [];
    const createToDemoTimes: number[] = [];

    for (const d of closedWonInQ) {
      if (d.hubspot_created_at && d.closed_won_entered_at) {
        cycleTimes.push(daysBetween(d.hubspot_created_at, d.closed_won_entered_at));
      }
      if (d.demo_completed_entered_at && d.closed_won_entered_at) {
        demoToCycleTimes.push(daysBetween(d.demo_completed_entered_at, d.closed_won_entered_at));
      }
      if (d.hubspot_created_at && d.demo_completed_entered_at) {
        createToDemoTimes.push(daysBetween(d.hubspot_created_at, d.demo_completed_entered_at));
      }
    }

    const stats: QuarterStats = {
      label,
      dealsCreated: createdInQ.length,
      dealsCreatedTeam: createdInQTeam.length,
      mqlEntered: mqlInQ.length,
      discoveryEntered: discoveryInQ.length,
      demoScheduledEntered: demoSchedInQ.length,
      demoCompletedEntered: demoCompInQ.length,
      proposalEntered: proposalInQ.length,
      closedWonEntered: closedWonInQ.length,
      closedWonARR,
      closedWonDeals: closedWonInQ,
      avgDealSize,
      cycleTimes,
      demoToCycleTimes,
      createToDemoTimes,
    };
    quarterStats.push(stats);

    log(`### ${label}`);
    log(`| Metric | Count |`);
    log(`|--------|-------|`);
    log(`| Deals Created (all) | ${stats.dealsCreated} |`);
    log(`| Deals Created (team AEs) | ${stats.dealsCreatedTeam} |`);
    log(`| MQL Entered | ${stats.mqlEntered} |`);
    log(`| SQL/Discovery Entered | ${stats.discoveryEntered} |`);
    log(`| Demo Scheduled | ${stats.demoScheduledEntered} |`);
    log(`| Demo Completed | ${stats.demoCompletedEntered} |`);
    log(`| Proposal Entered | ${stats.proposalEntered} |`);
    log(`| Closed Won | ${stats.closedWonEntered} |`);
    log(`| Closed Won ARR | ${fmt(stats.closedWonARR)} |`);
    log(`| Avg Deal Size | ${stats.closedWonEntered > 0 ? fmt(stats.avgDealSize) : 'N/A'} |`);
    log('');

    if (stats.cycleTimes.length > 0) {
      log(`Cycle times (create → closed won): avg ${Math.round(cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length)} days, median ${median(cycleTimes)} days`);
    }
    if (stats.createToDemoTimes.length > 0) {
      log(`Create → Demo Completed: avg ${Math.round(createToDemoTimes.reduce((a, b) => a + b, 0) / createToDemoTimes.length)} days, median ${median(createToDemoTimes)} days`);
    }
    if (stats.demoToCycleTimes.length > 0) {
      log(`Demo Completed → Closed Won: avg ${Math.round(demoToCycleTimes.reduce((a, b) => a + b, 0) / demoToCycleTimes.length)} days, median ${median(demoToCycleTimes)} days`);
    }

    // List closed-won deals for verification
    if (closedWonInQ.length > 0) {
      log(`\nClosed-Won deals in ${label}:`);
      for (const d of closedWonInQ) {
        const owner = ownerMap.get(d.owner_id);
        const ownerName = owner ? `${owner.first_name} ${owner.last_name}` : 'Unknown';
        const amt = d.amount ? fmt(Number(d.amount)) : 'No amt';
        const created = d.hubspot_created_at ? new Date(d.hubspot_created_at).toISOString().split('T')[0] : '?';
        const closed = d.closed_won_entered_at ? new Date(d.closed_won_entered_at).toISOString().split('T')[0] : '?';
        const days = d.hubspot_created_at && d.closed_won_entered_at
          ? `${daysBetween(d.hubspot_created_at, d.closed_won_entered_at)}d`
          : '?';
        log(`  • ${d.deal_name} — ${ownerName} — ${amt} — Created: ${created} → Closed: ${closed} (${days})`);
      }
    }
    log('');
  }

  // ── Conversion Rate Summary ──
  log('## CONVERSION RATE SUMMARY (Last 5 Quarters)\n');
  log('| Quarter | Created | Demo Completed | Closed Won | Create→Demo % | Demo→Won % | Create→Won % | ARR | Avg Size |');
  log('|---------|---------|----------------|------------|---------------|------------|--------------|-----|----------|');

  for (const qs of quarterStats) {
    const createToDemo = qs.dealsCreated > 0 ? pct(qs.demoCompletedEntered / qs.dealsCreated) : 'N/A';
    const demoToWon = qs.demoCompletedEntered > 0 ? pct(qs.closedWonEntered / qs.demoCompletedEntered) : 'N/A';
    const createToWon = qs.dealsCreated > 0 ? pct(qs.closedWonEntered / qs.dealsCreated) : 'N/A';
    log(`| ${qs.label} | ${qs.dealsCreated} | ${qs.demoCompletedEntered} | ${qs.closedWonEntered} | ${createToDemo} | ${demoToWon} | ${createToWon} | ${fmt(qs.closedWonARR)} | ${qs.closedWonEntered > 0 ? fmt(qs.avgDealSize) : 'N/A'} |`);
  }
  log('');

  // ── Weighted averages for recent quarters (last 3 quarters with data) ──
  log('## WEIGHTED CONVERSION RATES (Recent Quarters with Closed-Won Data)\n');

  // Use quarters that have meaningful closed-won data
  const recentWithData = quarterStats.filter((qs) => qs.closedWonEntered > 0);
  const recentLabels = recentWithData.map((qs) => qs.label).join(', ');

  const totalCreated = recentWithData.reduce((s, qs) => s + qs.dealsCreated, 0);
  const totalDemoCompleted = recentWithData.reduce((s, qs) => s + qs.demoCompletedEntered, 0);
  const totalClosedWon = recentWithData.reduce((s, qs) => s + qs.closedWonEntered, 0);
  const totalARR = recentWithData.reduce((s, qs) => s + qs.closedWonARR, 0);
  const overallAvgDealSize = totalClosedWon > 0 ? totalARR / totalClosedWon : 0;

  const allCycleTimes = recentWithData.flatMap((qs) => qs.cycleTimes);
  const allCreateToDemoTimes = recentWithData.flatMap((qs) => qs.createToDemoTimes);
  const allDemoToCloseTimes = recentWithData.flatMap((qs) => qs.demoToCycleTimes);

  const createToDemoRate = totalCreated > 0 ? totalDemoCompleted / totalCreated : 0;
  const demoToWonRate = totalDemoCompleted > 0 ? totalClosedWon / totalDemoCompleted : 0;
  const createToWonRate = totalCreated > 0 ? totalClosedWon / totalCreated : 0;

  log(`Based on: ${recentLabels}`);
  log('');
  log(`| Metric | Value |`);
  log(`|--------|-------|`);
  log(`| Total Deals Created | ${totalCreated} |`);
  log(`| Total Demo Completed | ${totalDemoCompleted} |`);
  log(`| Total Closed Won | ${totalClosedWon} |`);
  log(`| Total ARR | ${fmt(totalARR)} |`);
  log(`| **Avg Deal Size** | **${fmt(overallAvgDealSize)}** |`);
  log(`| **Create → Demo Completed %** | **${pct(createToDemoRate)}** |`);
  log(`| **Demo Completed → Won %** | **${pct(demoToWonRate)}** |`);
  log(`| **Create → Won %** | **${pct(createToWonRate)}** |`);
  log('');

  if (allCycleTimes.length > 0) {
    const avgCycle = Math.round(allCycleTimes.reduce((a, b) => a + b, 0) / allCycleTimes.length);
    const medCycle = median(allCycleTimes);
    log(`| **Avg Cycle Time (Create → Won)** | **${avgCycle} days (median ${medCycle})** |`);
  }
  if (allCreateToDemoTimes.length > 0) {
    const avg = Math.round(allCreateToDemoTimes.reduce((a, b) => a + b, 0) / allCreateToDemoTimes.length);
    const med = median(allCreateToDemoTimes);
    log(`| **Avg Create → Demo Completed** | **${avg} days (median ${med})** |`);
  }
  if (allDemoToCloseTimes.length > 0) {
    const avg = Math.round(allDemoToCloseTimes.reduce((a, b) => a + b, 0) / allDemoToCloseTimes.length);
    const med = median(allDemoToCloseTimes);
    log(`| **Avg Demo Completed → Won** | **${avg} days (median ${med})** |`);
  }
  log('');

  // ── REVERSE ENGINEERING: What's needed for Q2 2026 ──
  log('════════════════════════════════════════════════════════════════════');
  log('## Q2 2026 REVERSE-ENGINEERED REQUIREMENTS');
  log('════════════════════════════════════════════════════════════════════\n');

  const Q2_TARGET = 925000;
  const q2Qi = getQuarterInfo(2026, 2);

  log(`**Target:** ${fmt(Q2_TARGET)} team new logo ARR`);
  log(`**Quarter:** ${q2Qi.label} (Apr 1 – Jun 30, 2026)\n`);

  // Required number of closed-won deals
  const requiredCloses = Math.ceil(Q2_TARGET / overallAvgDealSize);
  log(`### Step 1: Required Closed-Won Deals\n`);
  log(`At historical average deal size of ${fmt(overallAvgDealSize)}:`);
  log(`  ${fmt(Q2_TARGET)} ÷ ${fmt(overallAvgDealSize)} = **${requiredCloses} closed-won deals needed**\n`);

  // Required demo completed
  const requiredDemos = demoToWonRate > 0 ? Math.ceil(requiredCloses / demoToWonRate) : 0;
  log(`### Step 2: Required Demos Completed\n`);
  log(`At historical demo-to-won rate of ${pct(demoToWonRate)}:`);
  log(`  ${requiredCloses} ÷ ${pct(demoToWonRate)} = **${requiredDemos} demos completed needed**\n`);

  // Required new leads / deals created
  const requiredLeads = createToDemoRate > 0 ? Math.ceil(requiredDemos / createToDemoRate) : 0;
  log(`### Step 3: Required New Leads Created\n`);
  log(`At historical create-to-demo rate of ${pct(createToDemoRate)}:`);
  log(`  ${requiredDemos} ÷ ${pct(createToDemoRate)} = **${requiredLeads} new leads/deals needed**\n`);

  // Monthly breakdown
  log(`### Step 4: Monthly Pace\n`);
  log(`| Metric | Per Quarter | Per Month | Per Week |`);
  log(`|--------|-------------|-----------|----------|`);
  log(`| New Leads Created | ${requiredLeads} | ${Math.ceil(requiredLeads / 3)} | ${Math.ceil(requiredLeads / 13)} |`);
  log(`| Demos Completed | ${requiredDemos} | ${Math.ceil(requiredDemos / 3)} | ${Math.ceil(requiredDemos / 13)} |`);
  log(`| Closed-Won Deals | ${requiredCloses} | ${Math.ceil(requiredCloses / 3)} | ${Math.ceil(requiredCloses / 13)} |`);
  log(`| Revenue | ${fmt(Q2_TARGET)} | ${fmt(Math.round(Q2_TARGET / 3))} | ${fmt(Math.round(Q2_TARGET / 13))} |`);
  log('');

  // ── Timing constraints ──
  log('### Step 5: Timing Constraints (Critical Deadlines)\n');

  if (allCycleTimes.length > 0) {
    const avgCycle = Math.round(allCycleTimes.reduce((a, b) => a + b, 0) / allCycleTimes.length);
    const medCycle = median(allCycleTimes);

    // Q2 ends June 30
    const q2End = new Date('2026-06-30');

    // Deals created need to be created by (end of Q2 minus avg cycle time) to close in Q2
    const latestCreateAvg = new Date(q2End.getTime() - avgCycle * 24 * 60 * 60 * 1000);
    const latestCreateMed = new Date(q2End.getTime() - medCycle * 24 * 60 * 60 * 1000);

    log(`Based on historical cycle times:`);
    log(`- **Average full cycle (create → won):** ${avgCycle} days`);
    log(`- **Median full cycle:** ${medCycle} days`);
    log('');
    log(`To close within Q2 (by Jun 30):`);
    log(`- At average cycle: deals must be **created by ${latestCreateAvg.toISOString().split('T')[0]}**`);
    log(`- At median cycle: deals must be **created by ${latestCreateMed.toISOString().split('T')[0]}**`);
    log('');
  }

  if (allDemoToCloseTimes.length > 0) {
    const avgDemoToClose = Math.round(allDemoToCloseTimes.reduce((a, b) => a + b, 0) / allDemoToCloseTimes.length);
    const medDemoToClose = median(allDemoToCloseTimes);
    const q2End = new Date('2026-06-30');

    const latestDemoAvg = new Date(q2End.getTime() - avgDemoToClose * 24 * 60 * 60 * 1000);
    const latestDemoMed = new Date(q2End.getTime() - medDemoToClose * 24 * 60 * 60 * 1000);

    log(`- **Average demo-to-close:** ${avgDemoToClose} days`);
    log(`- **Median demo-to-close:** ${medDemoToClose} days`);
    log('');
    log(`To close within Q2, demos must be **completed by ${latestDemoAvg.toISOString().split('T')[0]}** (avg) or **${latestDemoMed.toISOString().split('T')[0]}** (median)`);
    log('');
  }

  if (allCreateToDemoTimes.length > 0) {
    const avgCreateToDemo = Math.round(allCreateToDemoTimes.reduce((a, b) => a + b, 0) / allCreateToDemoTimes.length);
    const medCreateToDemo = median(allCreateToDemoTimes);

    log(`- **Average create-to-demo:** ${avgCreateToDemo} days`);
    log(`- **Median create-to-demo:** ${medCreateToDemo} days`);
    log('');
  }

  // ── Existing pipeline analysis: what's already in the funnel for Q2 ──
  log('### Step 6: Existing Pipeline Entering Q2\n');
  log('Deals currently in active stages that could close in Q2:\n');

  const activeStages = new Set([
    S.SQL_DISCOVERY.id,
    S.DEMO_SCHEDULED.id,
    S.DEMO_COMPLETED.id,
    S.QUALIFIED_VALIDATED.id,
    S.PROPOSAL_EVALUATING.id,
    S.MSA_SENT_REVIEW.id,
  ]);

  const activePipelineDeals = allDeals.filter((d) => activeStages.has(d.deal_stage));
  const stageLabel: Record<string, string> = Object.fromEntries(
    Object.values(SALES_PIPELINE_STAGES).map((s) => [s.id, s.label])
  );

  // Group by stage
  const byStage = new Map<string, any[]>();
  for (const d of activePipelineDeals) {
    const key = d.deal_stage;
    if (!byStage.has(key)) byStage.set(key, []);
    byStage.get(key)!.push(d);
  }

  let totalPipelineARR = 0;
  const stageOrder = [S.SQL_DISCOVERY.id, S.DEMO_SCHEDULED.id, S.DEMO_COMPLETED.id, S.QUALIFIED_VALIDATED.id, S.PROPOSAL_EVALUATING.id, S.MSA_SENT_REVIEW.id];

  log('| Stage | Deal Count | Total ARR | Avg Size |');
  log('|-------|------------|-----------|----------|');

  for (const stageId of stageOrder) {
    const deals = byStage.get(stageId) || [];
    const arr = deals.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    totalPipelineARR += arr;
    const avg = deals.length > 0 ? arr / deals.length : 0;
    log(`| ${stageLabel[stageId] || stageId} | ${deals.length} | ${fmt(arr)} | ${deals.length > 0 ? fmt(avg) : 'N/A'} |`);
  }

  log(`| **TOTAL** | **${activePipelineDeals.length}** | **${fmt(totalPipelineARR)}** | |`);
  log('');

  // Weighted pipeline (apply historical stage-to-close conversion)
  // For each stage, estimate how much is likely to close
  log('**Weighted pipeline estimate** (applying historical conversion rates):\n');

  // We need stage-specific win rates. Let's compute them.
  // For deals that closed won, what stage were they at before?
  // We'll use a simpler approach: conversion rates based on how far along the deal is

  // Demo Completed+ to Won rate
  const postDemoDeals = activePipelineDeals.filter((d) =>
    [S.DEMO_COMPLETED.id, S.QUALIFIED_VALIDATED.id, S.PROPOSAL_EVALUATING.id, S.MSA_SENT_REVIEW.id].includes(d.deal_stage)
  );
  const postDemoARR = postDemoDeals.reduce((s, d) => s + (Number(d.amount) || 0), 0);

  const preDemoDeals = activePipelineDeals.filter((d) =>
    [S.SQL_DISCOVERY.id, S.DEMO_SCHEDULED.id].includes(d.deal_stage)
  );
  const preDemoARR = preDemoDeals.reduce((s, d) => s + (Number(d.amount) || 0), 0);

  const weightedPostDemo = postDemoARR * demoToWonRate;
  const weightedPreDemo = preDemoARR * createToWonRate; // conservative: use full funnel rate

  log(`| Pipeline Segment | Raw ARR | Conversion Rate Used | Weighted ARR |`);
  log(`|------------------|---------|---------------------|--------------|`);
  log(`| Post-Demo (Demo Completed+) | ${fmt(postDemoARR)} | ${pct(demoToWonRate)} (demo→won) | ${fmt(Math.round(weightedPostDemo))} |`);
  log(`| Pre-Demo (Discovery, Demo Sched) | ${fmt(preDemoARR)} | ${pct(createToWonRate)} (create→won) | ${fmt(Math.round(weightedPreDemo))} |`);
  log(`| **Total Weighted Pipeline** | ${fmt(totalPipelineARR)} | | **${fmt(Math.round(weightedPostDemo + weightedPreDemo))}** |`);
  log('');

  const gap = Q2_TARGET - Math.round(weightedPostDemo + weightedPreDemo);
  log(`**Gap to fill with new Q2 pipeline:** ${fmt(gap > 0 ? gap : 0)}`);
  log('');

  if (gap > 0) {
    const gapCloses = Math.ceil(gap / overallAvgDealSize);
    const gapDemos = demoToWonRate > 0 ? Math.ceil(gapCloses / demoToWonRate) : 0;
    const gapLeads = createToDemoRate > 0 ? Math.ceil(gapDemos / createToDemoRate) : 0;

    log(`To fill the gap:`);
    log(`- **${gapCloses} additional closed-won deals** needed (beyond existing pipeline)`);
    log(`- **${gapDemos} additional demos completed** needed`);
    log(`- **${gapLeads} additional new leads** needed`);
    log('');
  }

  // ── Per-AE breakdown of what's needed ──
  log('### Step 7: Per-AE Target Breakdown\n');

  const aeTargets: Record<string, number> = {
    'cgarraffa@opusbehavioral.com': 400000,
    'jrice@opusbehavioral.com': 300000,
    'atiwari@opusbehavioral.com': 90000,
    'zclaussen@opusbehavioral.com': 90000,
    'hgomez@opusbehavioral.com': 25000,
  };

  log('| AE | Q2 Target | Deals Needed | Demos Needed | Leads Needed | Deals/Mo | Demos/Mo |');
  log('|----|-----------|-------------|-------------|-------------|----------|----------|');

  for (const [email, target] of Object.entries(aeTargets)) {
    const owner = owners.find((o) => o.email === email);
    const name = owner ? `${owner.first_name} ${owner.last_name}` : email;
    const dealsNeeded = Math.ceil(target / overallAvgDealSize);
    const demosNeeded = demoToWonRate > 0 ? Math.ceil(dealsNeeded / demoToWonRate) : 0;
    const leadsNeeded = createToDemoRate > 0 ? Math.ceil(demosNeeded / createToDemoRate) : 0;
    log(`| ${name} | ${fmt(target)} | ${dealsNeeded} | ${demosNeeded} | ${leadsNeeded} | ${Math.ceil(dealsNeeded / 3)} | ${Math.ceil(demosNeeded / 3)} |`);
  }
  log('');

  // ── Q1 2026 detailed look (most recent complete quarter) ──
  const q1Stats = quarterStats.find((qs) => qs.label === 'Q1 2026');
  if (q1Stats) {
    log('### Step 8: Q1 2026 Benchmark (Most Recent Quarter)\n');
    log(`Q1 2026 closed ${fmt(q1Stats.closedWonARR)} with ${q1Stats.closedWonEntered} deals.`);
    log(`Q2 2026 target is ${fmt(Q2_TARGET)}, which is **${(Q2_TARGET / (q1Stats.closedWonARR || 1)).toFixed(1)}x** what Q1 achieved.`);
    log('');

    // What would Q1's conversion rates produce if applied to the required input?
    log(`If Q2 matches Q1's pace:`);
    log(`- Q1 created ${q1Stats.dealsCreated} deals, completed ${q1Stats.demoCompletedEntered} demos, closed ${q1Stats.closedWonEntered} deals`);
    log(`- To hit ${fmt(Q2_TARGET)}, the team would need **${(Q2_TARGET / (q1Stats.closedWonARR || 1) * q1Stats.dealsCreated).toFixed(0)} leads** at Q1 rates`);
    log(`- Or increase deal size, or improve conversion rates, or a combination`);
    log('');
  }

  // ── Scenario analysis ──
  log('### Step 9: Scenario Analysis\n');

  const scenarios = [
    { name: 'Conservative (historical rates)', dealSize: overallAvgDealSize, demoWon: demoToWonRate, createDemo: createToDemoRate },
    { name: 'Optimistic (+20% deal size)', dealSize: overallAvgDealSize * 1.2, demoWon: demoToWonRate, createDemo: createToDemoRate },
    { name: 'Improved conversion (+25% demo→won)', dealSize: overallAvgDealSize, demoWon: Math.min(1, demoToWonRate * 1.25), createDemo: createToDemoRate },
    { name: 'All improvements combined', dealSize: overallAvgDealSize * 1.2, demoWon: Math.min(1, demoToWonRate * 1.25), createDemo: Math.min(1, createToDemoRate * 1.25) },
  ];

  log('| Scenario | Avg Deal Size | Demo→Won | Create→Demo | Closes Needed | Demos Needed | Leads Needed |');
  log('|----------|--------------|----------|------------|---------------|-------------|-------------|');

  for (const s of scenarios) {
    const closes = Math.ceil(Q2_TARGET / s.dealSize);
    const demos = Math.ceil(closes / s.demoWon);
    const leads = Math.ceil(demos / s.createDemo);
    log(`| ${s.name} | ${fmt(s.dealSize)} | ${pct(s.demoWon)} | ${pct(s.createDemo)} | ${closes} | ${demos} | ${leads} |`);
  }
  log('');

  // ── Final summary ──
  log('════════════════════════════════════════════════════════════════════');
  log('## EXECUTIVE SUMMARY');
  log('════════════════════════════════════════════════════════════════════\n');

  log(`**Q2 2026 Target:** ${fmt(Q2_TARGET)} team new logo ARR\n`);
  log(`**Based on historical data (${recentLabels}):**\n`);
  log(`1. **Average closed-won deal size:** ${fmt(overallAvgDealSize)}`);
  log(`2. **Deals needed to close:** ${requiredCloses}`);
  log(`3. **Demos needed to complete:** ${requiredDemos} (at ${pct(demoToWonRate)} demo→won rate)`);
  log(`4. **New leads needed:** ${requiredLeads} (at ${pct(createToDemoRate)} create→demo rate)`);
  log(`5. **Monthly pace:** ${Math.ceil(requiredLeads / 3)} leads/mo, ${Math.ceil(requiredDemos / 3)} demos/mo, ${Math.ceil(requiredCloses / 3)} closes/mo`);

  if (allCycleTimes.length > 0) {
    const medCycle = median(allCycleTimes);
    log(`6. **Median deal cycle:** ${medCycle} days — most leads that will close in Q2 need to exist by mid-quarter`);
  }

  log('');
  log('---');
  log(`*Analysis generated ${new Date().toISOString().split('T')[0]} from ${allDeals.length} sales pipeline deals in Supabase.*`);

  // Write to file
  const filename = `q2-2026-reverse-engineering.md`;
  fs.writeFileSync(filename, output.join('\n'), 'utf-8');
  log(`\n📄 Report written to ${filename}`);
}

main().catch(console.error);
