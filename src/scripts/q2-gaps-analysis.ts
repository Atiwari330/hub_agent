/**
 * Q2 2026 Gap Analysis — Filling holes from the initial analysis
 *
 * 1. Data integrity deep-dive: why are 907 deals missing hubspot_created_at?
 * 2. Per-AE historical performance vs their Q2 targets
 * 3. Weekly waterfall: by what week do demos/leads need to exist?
 *
 * Usage:
 *   npx tsx src/scripts/q2-gaps-analysis.ts
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
      .select('*')
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

// Also fetch ALL deals regardless of pipeline to check for pipeline filtering issues
async function fetchAllDealsNoPipelineFilter() {
  const PAGE_SIZE = 500;
  let allDeals: any[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('deals')
      .select('id, hubspot_deal_id, deal_name, pipeline, deal_stage, amount, hubspot_created_at, owner_id, closed_won_entered_at')
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
  console.log('\n🔍 Fetching deals...');
  const [salesDeals, allDbDeals, owners] = await Promise.all([
    fetchAllDeals(),
    fetchAllDealsNoPipelineFilter(),
    fetchOwners(),
  ]);

  const ownerMap = new Map(owners.map((o) => [o.id, o]));

  const TARGET_AE_EMAILS = [
    'cgarraffa@opusbehavioral.com', 'jrice@opusbehavioral.com',
    'atiwari@opusbehavioral.com', 'zclaussen@opusbehavioral.com',
    'hgomez@opusbehavioral.com',
  ];
  const targetAeOwners = owners.filter((o) => TARGET_AE_EMAILS.includes(o.email));
  const targetAeOwnerIds = new Set(targetAeOwners.map((o) => o.id));

  const output: string[] = [];
  const log = (s: string = '') => { console.log(s); output.push(s); };

  log('# Q2 2026 Analysis — SUPPLEMENTAL (Gap Coverage)');
  log(`*Generated ${new Date().toISOString().split('T')[0]}*\n`);
  log('---\n');

  // ═══════════════════════════════════════════════════════════════════
  // GAP 1: DATA INTEGRITY DEEP-DIVE
  // ═══════════════════════════════════════════════════════════════════

  log('## GAP 1: Data Integrity Investigation\n');

  log('### Total deals in database\n');
  log(`| Filter | Count |`);
  log(`|--------|-------|`);
  log(`| All deals in DB (any pipeline) | ${allDbDeals.length} |`);
  log(`| Sales pipeline deals only | ${salesDeals.length} |`);
  log(`| Non-sales-pipeline deals | ${allDbDeals.length - salesDeals.length} |`);
  log('');

  // Pipeline distribution
  const pipelineCounts = new Map<string, number>();
  for (const d of allDbDeals) {
    const p = d.pipeline || '(null)';
    pipelineCounts.set(p, (pipelineCounts.get(p) || 0) + 1);
  }
  log('### Pipeline distribution\n');
  log('| Pipeline ID | Count |');
  log('|-------------|-------|');
  for (const [p, count] of [...pipelineCounts.entries()].sort((a, b) => b[1] - a[1])) {
    const isSales = p === SALES_PIPELINE_ID ? ' ← SALES' : '';
    log(`| ${p}${isSales} | ${count} |`);
  }
  log('');

  // Now investigate missing hubspot_created_at
  const withCreateDate = salesDeals.filter((d) => d.hubspot_created_at);
  const noCreateDate = salesDeals.filter((d) => !d.hubspot_created_at);

  log('### Missing hubspot_created_at\n');
  log(`| Category | Count |`);
  log(`|----------|-------|`);
  log(`| Sales deals WITH hubspot_created_at | ${withCreateDate.length} |`);
  log(`| Sales deals WITHOUT hubspot_created_at | ${noCreateDate.length} |`);
  log('');

  // When were the missing-create-date deals synced? (use created_at as proxy)
  if (noCreateDate.length > 0) {
    const dates = noCreateDate.map((d) => new Date(d.created_at).getTime()).sort((a, b) => a - b);
    const earliest = new Date(dates[0]).toISOString().split('T')[0];
    const latest = new Date(dates[dates.length - 1]).toISOString().split('T')[0];

    log(`Missing-create-date deals: DB created_at range: ${earliest} to ${latest}`);
    log('');

    // Do any of the missing-create-date deals have closed_won_entered_at?
    const missingWithClosedWon = noCreateDate.filter((d) => d.closed_won_entered_at);
    log(`Of the ${noCreateDate.length} missing-create-date deals:`);
    log(`- ${missingWithClosedWon.length} have closed_won_entered_at (closed won but we don't know when created)`);
    log(`- ${noCreateDate.filter((d) => d.demo_completed_entered_at).length} have demo_completed_entered_at`);
    log(`- ${noCreateDate.filter((d) => d.amount && Number(d.amount) > 0).length} have an amount set`);
    log(`- ${noCreateDate.filter((d) => d.owner_id).length} have an owner assigned`);
    log('');

    // Are these old deals? Check their deal stages
    const missingStages = new Map<string, number>();
    for (const d of noCreateDate) {
      const stageLabel = Object.values(SALES_PIPELINE_STAGES).find((s) => s.id === d.deal_stage)?.label || d.deal_stage || '(null)';
      missingStages.set(stageLabel, (missingStages.get(stageLabel) || 0) + 1);
    }

    log('**Stage distribution of deals missing hubspot_created_at:**\n');
    log('| Stage | Count |');
    log('|-------|-------|');
    for (const [stage, count] of [...missingStages.entries()].sort((a, b) => b[1] - a[1])) {
      log(`| ${stage} | ${count} |`);
    }
    log('');

    // Check close_date distribution as a proxy for when these deals are from
    const missingWithCloseDate = noCreateDate.filter((d) => d.close_date);
    if (missingWithCloseDate.length > 0) {
      const closeDates = missingWithCloseDate.map((d) => d.close_date).sort();
      log(`Close date range for missing-create-date deals: ${closeDates[0]} to ${closeDates[closeDates.length - 1]}`);

      // Group by year
      const byYear = new Map<string, number>();
      for (const cd of closeDates) {
        const year = cd.substring(0, 4);
        byYear.set(year, (byYear.get(year) || 0) + 1);
      }
      log('\n| Close Date Year | Count |');
      log('|----------------|-------|');
      for (const [year, count] of [...byYear.entries()].sort()) {
        log(`| ${year} | ${count} |`);
      }
      log('');
    }
  }

  // CRITICAL: Do any closed-won deals in the periods we analyzed lack hubspot_created_at?
  log('### Impact on our conversion rate analysis\n');

  const quarters = [
    getQuarterInfo(2025, 1), getQuarterInfo(2025, 2), getQuarterInfo(2025, 3),
    getQuarterInfo(2025, 4), getQuarterInfo(2026, 1),
  ];

  // Closed-won deals by quarter (using closed_won_entered_at)
  log('**Closed-won deals: with vs without hubspot_created_at**\n');
  log('| Quarter Closed | Total Won | With Create Date | Missing Create Date | ARR Missing |');
  log('|---------------|-----------|-----------------|--------------------|--------------------|');

  for (const qi of quarters) {
    const wonInQ = salesDeals.filter((d) => isInQuarter(d.closed_won_entered_at, qi));
    const wonWithDate = wonInQ.filter((d) => d.hubspot_created_at);
    const wonNoDate = wonInQ.filter((d) => !d.hubspot_created_at);
    const missingARR = wonNoDate.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    log(`| ${qi.label} | ${wonInQ.length} | ${wonWithDate.length} | ${wonNoDate.length} | ${fmt(missingARR)} |`);
  }
  log('');

  log('**Verdict:** If "Missing Create Date" is 0 across the board, our cohort analysis is not missing any closed-won deals — the 907 deals without create dates are older/irrelevant deals that never closed.\n');

  // ═══════════════════════════════════════════════════════════════════
  // GAP 2: PER-AE HISTORICAL PERFORMANCE
  // ═══════════════════════════════════════════════════════════════════

  log('## GAP 2: Per-AE Historical Performance vs. Q2 Targets\n');
  log('Has any AE ever hit their Q2 target in a single quarter?\n');

  const aeTargets: Record<string, number> = {
    'cgarraffa@opusbehavioral.com': 400000,
    'jrice@opusbehavioral.com': 300000,
    'atiwari@opusbehavioral.com': 90000,
    'zclaussen@opusbehavioral.com': 90000,
    'hgomez@opusbehavioral.com': 25000,
  };

  for (const [email, target] of Object.entries(aeTargets)) {
    const owner = owners.find((o) => o.email === email);
    if (!owner) {
      log(`### ${email} — NOT FOUND IN DATABASE\n`);
      continue;
    }

    const name = `${owner.first_name} ${owner.last_name}`;
    log(`### ${name} (${email}) — Q2 Target: ${fmt(target)}\n`);

    // Get all their closed-won deals
    const aeDeals = salesDeals.filter((d) => d.owner_id === owner.id);
    const aeWonDeals = aeDeals.filter((d) => d.closed_won_entered_at);

    log(`Total deals in pipeline: ${aeDeals.length}`);
    log(`Total closed-won (all time): ${aeWonDeals.length}`);
    log('');

    // Per-quarter breakdown
    log('| Quarter | Deals Created | Demo Completed | Closed Won | Won ARR | Avg Size |');
    log('|---------|--------------|----------------|------------|---------|----------|');

    for (const qi of quarters) {
      const created = aeDeals.filter((d) => d.hubspot_created_at && isInQuarter(d.hubspot_created_at, qi));
      const demoComp = aeDeals.filter((d) => isInQuarter(d.demo_completed_entered_at, qi));
      const won = aeDeals.filter((d) => isInQuarter(d.closed_won_entered_at, qi));
      const wonARR = won.reduce((s, d) => s + (Number(d.amount) || 0), 0);
      const avg = won.length > 0 ? wonARR / won.length : 0;

      log(`| ${qi.label} | ${created.length} | ${demoComp.length} | ${won.length} | ${fmt(wonARR)} | ${won.length > 0 ? fmt(avg) : 'N/A'} |`);
    }

    const totalWonARR = aeWonDeals.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const bestQtr = quarters.reduce((best, qi) => {
      const arr = aeDeals
        .filter((d) => isInQuarter(d.closed_won_entered_at, qi))
        .reduce((s, d) => s + (Number(d.amount) || 0), 0);
      return arr > best.arr ? { label: qi.label, arr } : best;
    }, { label: 'N/A', arr: 0 });

    log('');
    log(`**Best quarter:** ${bestQtr.label} at ${fmt(bestQtr.arr)}`);
    log(`**Q2 target (${fmt(target)}) is ${bestQtr.arr > 0 ? (target / bestQtr.arr).toFixed(1) + 'x' : '∞x'} their best quarter**`);
    log(`**All-time total closed-won ARR:** ${fmt(totalWonARR)}`);
    log('');

    // Their specific conversion rates (cohort style)
    const aeCreatedWithDate = aeDeals.filter((d) => d.hubspot_created_at);
    const aeEverDemo = aeCreatedWithDate.filter((d) => d.demo_completed_entered_at);
    const aeEverWon = aeCreatedWithDate.filter((d) => d.closed_won_entered_at);

    if (aeCreatedWithDate.length > 0) {
      log(`**Personal conversion rates (all time):**`);
      log(`- Create → Demo: ${pct(aeEverDemo.length / aeCreatedWithDate.length)} (${aeEverDemo.length}/${aeCreatedWithDate.length})`);
      if (aeEverDemo.length > 0) {
        log(`- Demo → Won: ${pct(aeEverWon.length / aeEverDemo.length)} (${aeEverWon.length}/${aeEverDemo.length})`);
      }
    }

    // Cycle times
    const aeCycleTimes = aeWonDeals
      .filter((d) => d.hubspot_created_at)
      .map((d) => daysBetween(d.hubspot_created_at, d.closed_won_entered_at));

    if (aeCycleTimes.length > 0) {
      const avg = Math.round(aeCycleTimes.reduce((a, b) => a + b, 0) / aeCycleTimes.length);
      log(`- Avg cycle time: ${avg} days (median ${median(aeCycleTimes)})`);
    }

    // List their won deals
    if (aeWonDeals.length > 0) {
      log('');
      log('**Closed-won deals:**');
      for (const d of aeWonDeals.sort((a, b) => new Date(b.closed_won_entered_at).getTime() - new Date(a.closed_won_entered_at).getTime())) {
        const amt = d.amount ? fmt(Number(d.amount)) : 'N/A';
        const closed = new Date(d.closed_won_entered_at).toISOString().split('T')[0];
        log(`- ${d.deal_name} — ${amt} — Closed ${closed}`);
      }
    }
    log('\n---\n');
  }

  // ═══════════════════════════════════════════════════════════════════
  // GAP 3: WEEKLY WATERFALL / PACING CHART
  // ═══════════════════════════════════════════════════════════════════

  log('## GAP 3: Weekly Waterfall — When Must Demos & Leads Exist?\n');

  // Get cycle time distributions from ALL closed-won deals
  const allWon = salesDeals.filter((d) => d.closed_won_entered_at && d.hubspot_created_at);
  const demoToCloseArr = allWon
    .filter((d) => d.demo_completed_entered_at)
    .map((d) => daysBetween(d.demo_completed_entered_at, d.closed_won_entered_at));
  const createToCloseArr = allWon.map((d) => daysBetween(d.hubspot_created_at, d.closed_won_entered_at));

  const medDemoToClose = median(demoToCloseArr);
  const medCreateToClose = median(createToCloseArr);

  // Use recent rates (Q1-Q4 2025)
  const recentCohorts = [getQuarterInfo(2025, 1), getQuarterInfo(2025, 2), getQuarterInfo(2025, 3), getQuarterInfo(2025, 4)];
  let rCreated = 0, rDemoComp = 0, rClosedWon = 0, rARR = 0;
  for (const qi of recentCohorts) {
    const created = salesDeals.filter((d) => d.hubspot_created_at && isInQuarter(d.hubspot_created_at, qi));
    rCreated += created.length;
    rDemoComp += created.filter((d) => d.demo_completed_entered_at).length;
    const won = created.filter((d) => d.closed_won_entered_at);
    rClosedWon += won.length;
    rARR += won.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  }
  const avgDeal = rClosedWon > 0 ? rARR / rClosedWon : 25000;
  const demoToWon = rDemoComp > 0 ? rClosedWon / rDemoComp : 0.2;
  const createToDemo = rCreated > 0 ? rDemoComp / rCreated : 0.5;

  const Q2_TARGET = 925000;
  const closesNeeded = Math.ceil(Q2_TARGET / avgDeal);
  const demosNeeded = Math.ceil(closesNeeded / demoToWon);
  const leadsNeeded = Math.ceil(demosNeeded / createToDemo);

  log(`Using: ${fmt(avgDeal)} avg deal, ${pct(demoToWon)} demo→won, ${pct(createToDemo)} create→demo`);
  log(`Median demo→close: ${medDemoToClose} days | Median create→close: ${medCreateToClose} days\n`);

  // Q2 2026 weeks
  const q2Start = new Date('2026-04-01');
  const q2End = new Date('2026-06-30');
  const weeks: { weekNum: number; start: Date; end: Date; label: string }[] = [];

  for (let i = 0; i < 13; i++) {
    const start = new Date(q2Start.getTime() + i * 7 * 86400000);
    const end = new Date(start.getTime() + 6 * 86400000);
    if (start > q2End) break;
    weeks.push({
      weekNum: i + 1,
      start,
      end: end > q2End ? q2End : end,
      label: `Wk ${i + 1} (${start.toISOString().split('T')[0]})`,
    });
  }

  // For each week's end date, work backwards to determine:
  // - How many deals could still close by Q2 end if demo completed that week?
  // - How many leads created that week could still close by Q2 end?
  log('### If a deal needs to close by June 30...\n');
  log('| Week | Dates | Days Left in Q2 | Can demo→close? | Can create→close? | Status |');
  log('|------|-------|----------------|-----------------|-------------------|--------|');

  for (const w of weeks) {
    const daysLeft = Math.round((q2End.getTime() - w.start.getTime()) / 86400000);
    const canDemoClose = daysLeft >= medDemoToClose ? 'Yes' : `No (need ${medDemoToClose}d)`;
    const canCreateClose = daysLeft >= medCreateToClose ? 'Yes' : `No (need ${medCreateToClose}d)`;
    const status =
      daysLeft >= medCreateToClose ? '🟢 Full funnel time' :
      daysLeft >= medDemoToClose ? '🟡 Demo only — too late to create new' :
      '🔴 Too late for median deal';
    log(`| ${w.label} | ${w.start.toISOString().split('T')[0]} – ${w.end.toISOString().split('T')[0]} | ${daysLeft} | ${canDemoClose} | ${canCreateClose} | ${status} |`);
  }
  log('');

  // Cumulative targets
  log('### Cumulative Weekly Targets\n');
  log('To hit $925K by end of Q2, you need to be at or ahead of this pace:\n');

  // Linear distribution weighted toward front-loading
  // Since deals take time to close, more leads need to come early
  // Simple model: assume even distribution of closes, work back from there
  const closesPerWeek = closesNeeded / 13;
  const demosPerWeek = demosNeeded / 13;
  const leadsPerWeek = leadsNeeded / 13;

  log('| Week | Cumulative Leads (target) | Cumulative Demos (target) | Cumulative Closes (target) | Cumulative Revenue |');
  log('|------|--------------------------|--------------------------|---------------------------|-------------------|');

  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    const cumLeads = Math.round(leadsPerWeek * (i + 1));
    const cumDemos = Math.round(demosPerWeek * (i + 1));
    const cumCloses = Math.round(closesPerWeek * (i + 1));
    const cumRev = Math.round(avgDeal * cumCloses);
    log(`| ${w.label} | ${cumLeads} | ${cumDemos} | ${cumCloses} | ${fmt(cumRev)} |`);
  }
  log('');

  log('### Front-Loaded Reality Check\n');
  log('Because deals take ~50 days to close, leads generated after mid-May mostly won\'t close in Q2.');
  log('A realistic front-loaded model:\n');

  // Front-loaded: 50% of leads in month 1, 35% month 2, 15% month 3
  const m1Leads = Math.round(leadsNeeded * 0.50);
  const m2Leads = Math.round(leadsNeeded * 0.35);
  const m3Leads = leadsNeeded - m1Leads - m2Leads;

  const m1Demos = Math.round(demosNeeded * 0.45);
  const m2Demos = Math.round(demosNeeded * 0.35);
  const m3Demos = demosNeeded - m1Demos - m2Demos;

  const m1Closes = Math.round(closesNeeded * 0.25);
  const m2Closes = Math.round(closesNeeded * 0.35);
  const m3Closes = closesNeeded - m1Closes - m2Closes;

  log('| Month | Leads Target | Demos Target | Closes Target | Revenue Target |');
  log('|-------|-------------|-------------|--------------|---------------|');
  log(`| **April** (generation month) | **${m1Leads}** | **${m1Demos}** | ${m1Closes} | ${fmt(Math.round(avgDeal * m1Closes))} |`);
  log(`| **May** (demo + close month) | **${m2Leads}** | **${m2Demos}** | ${m2Closes} | ${fmt(Math.round(avgDeal * m2Closes))} |`);
  log(`| **June** (closing month) | ${m3Leads} | ${m3Demos} | **${m3Closes}** | ${fmt(Math.round(avgDeal * m3Closes))} |`);
  log(`| **TOTAL** | ${leadsNeeded} | ${demosNeeded} | ${closesNeeded} | ${fmt(Q2_TARGET)} |`);
  log('');

  log('**Key insight:** April is the most critical month. 50% of all leads for the quarter must be in the pipeline by end of April to have enough time to progress through demos and close by June 30.\n');

  // ═══════════════════════════════════════════════════════════════════
  // UPDATED EXECUTIVE SUMMARY
  // ═══════════════════════════════════════════════════════════════════

  log('---\n');
  log('## UPDATED CONCLUSIONS\n');

  log('### Data Integrity');
  log('Check the "Missing Create Date" table above. If all closed-won deals in Q1 2025–Q1 2026 have `hubspot_created_at`, then the cohort rates are reliable. The ~900 deals without create dates are likely older pre-sync deals that don\'t affect recent conversion rate calculations.\n');

  log('### Per-AE Reality');
  log('Check each AE\'s "best quarter" vs their Q2 target. If Chris\'s best quarter was $44K and his target is $400K, that\'s a 9x jump. This isn\'t a math problem — it\'s a capacity and pipeline generation problem.\n');

  log('### Timing Waterfall');
  log('- **April:** Generate 50% of quarterly leads, start booking demos aggressively');
  log('- **May:** Continue lead gen (35%), complete majority of demos, start closing');
  log('- **June:** Closing month — leads created in June almost certainly won\'t close in Q2');
  log('- **After mid-May:** New lead creation has diminishing returns for Q2 revenue\n');

  // Write to file
  const filename = 'q2-2026-supplemental.md';
  fs.writeFileSync(filename, output.join('\n'), 'utf-8');
  log(`\n📄 Report written to ${filename}`);
}

main().catch(console.error);
