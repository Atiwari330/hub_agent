/**
 * Q2 Email Stats
 *
 * One-off script that produces the specific data points needed to harden
 * Adi's Q2 leadership email. For each number it prints: the value, the
 * columns/filters used, the sample size, and a 1-2 sentence defense.
 *
 * Usage:
 *   npx tsx src/scripts/q2-email-stats.ts
 *
 * Correctness notes:
 * - Paginates Supabase reads (PAGE_SIZE=500) because Supabase caps single
 *   queries at 1,000 rows. Same pattern as q2-cohort-analysis.ts:30-56.
 * - Filters by pipeline = sales pipeline UUID so unrelated pipelines don't
 *   pollute the counts.
 * - Dedupes by hubspot_deal_id.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { getQuarterInfo, type QuarterInfo } from '../lib/utils/quarter';
import {
  computeDealsNeeded,
  computeDemosNeeded,
  computeLeadsNeeded,
} from '../lib/q2-goal-tracker/math';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const SALES_PIPELINE_ID = '1c27e5a3-5e5e-4403-ab0f-d356bf268cf3';

// Numbers from Adi's email (what we're sanity-checking)
const EMAIL_TEAM_TARGET = 925_000;
const EMAIL_CARRYOVER_FORECAST = 117_000;
const EMAIL_GAP = 808_000;
const EMAIL_LEADS_NEEDED = 889;
const EMAIL_DEMOS_NEEDED = 154;
const EMAIL_DEALS_NEEDED = 42;
const EMAIL_AVG_DEAL = 19_655;
const EMAIL_DEMO_TO_WON = 0.273;
const EMAIL_CREATE_TO_DEMO = 0.173;
const EMAIL_CYCLE_DAYS = 59;

interface Deal {
  hubspot_deal_id: string;
  deal_name: string | null;
  amount: number | string | null;
  close_date: string | null;
  pipeline: string | null;
  deal_stage: string | null;
  owner_id: string | null;
  hubspot_created_at: string | null;
  lead_source: string | null;
  mql_entered_at: string | null;
  discovery_entered_at: string | null;
  demo_scheduled_entered_at: string | null;
  demo_completed_entered_at: string | null;
  closed_won_entered_at: string | null;
}

interface Owner {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

async function fetchOwners(): Promise<Map<string, Owner>> {
  const { data, error } = await supabase
    .from('owners')
    .select('id, first_name, last_name, email');
  if (error) {
    console.error('Supabase error (owners):', error.message);
    process.exit(1);
  }
  const map = new Map<string, Owner>();
  for (const o of (data || []) as Owner[]) map.set(o.id, o);
  return map;
}

async function fetchAllSalesPipelineDeals(): Promise<Deal[]> {
  const PAGE_SIZE = 500;
  const seen = new Map<string, Deal>();
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('deals')
      .select(`
        hubspot_deal_id, deal_name, amount, close_date, pipeline,
        deal_stage, owner_id, hubspot_created_at, lead_source,
        mql_entered_at, discovery_entered_at,
        demo_scheduled_entered_at, demo_completed_entered_at,
        closed_won_entered_at
      `)
      .eq('pipeline', SALES_PIPELINE_ID)
      .range(offset, offset + PAGE_SIZE - 1)
      .order('hubspot_created_at', { ascending: true });

    if (error) {
      console.error('Supabase error:', error.message);
      process.exit(1);
    }

    const rows = (data || []) as Deal[];
    for (const d of rows) seen.set(d.hubspot_deal_id, d);
    hasMore = rows.length === PAGE_SIZE;
    offset += PAGE_SIZE;
  }

  return Array.from(seen.values());
}

function isInQuarter(dateStr: string | null, qi: QuarterInfo): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d >= qi.startDate && d <= qi.endDate;
}

function daysBetween(d1: string, d2: string): number {
  return Math.round(
    (new Date(d2).getTime() - new Date(d1).getTime()) / (1000 * 60 * 60 * 24),
  );
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function pctLessThan(arr: number[], threshold: number): number {
  if (arr.length === 0) return 0;
  return arr.filter((v) => v < threshold).length / arr.length;
}

function fmtPct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}

function fmtInt(v: number): string {
  return v.toLocaleString('en-US');
}

function fmtMoney(v: number): string {
  return '$' + Math.round(v).toLocaleString('en-US');
}

function section(title: string) {
  console.log('\n' + '═'.repeat(78));
  console.log(title);
  console.log('═'.repeat(78));
}

async function main() {
  console.log('Fetching all sales pipeline deals (paginated)...');
  const allDeals = await fetchAllSalesPipelineDeals();
  console.log(`✓ Fetched ${allDeals.length} distinct deals from sales pipeline`);
  const ownerMap = await fetchOwners();
  console.log(`✓ Fetched ${ownerMap.size} owners`);

  const q1_2026 = getQuarterInfo(2026, 1);
  const q4_2025 = getQuarterInfo(2025, 4);
  const q3_2025 = getQuarterInfo(2025, 3);
  const q2_2025 = getQuarterInfo(2025, 2);
  const q1_2025 = getQuarterInfo(2025, 1);

  // ─────────────────────────────────────────────────────────────────────
  // SECTION 1: Q1 2026 lead volume (deals created) vs Q2 required lift
  // ─────────────────────────────────────────────────────────────────────
  section('1. LEAD VOLUME: Q1 2026 ACTUAL vs Q2 REQUIRED (889)');

  const q1_2026_created = allDeals.filter((d) =>
    isInQuarter(d.hubspot_created_at, q1_2026),
  );
  const q4_2025_created = allDeals.filter((d) =>
    isInQuarter(d.hubspot_created_at, q4_2025),
  );
  const q3_2025_created = allDeals.filter((d) =>
    isInQuarter(d.hubspot_created_at, q3_2025),
  );

  const q1_2026_count = q1_2026_created.length;
  const q4_2025_count = q4_2025_created.length;
  const q3_2025_count = q3_2025_created.length;

  const liftVsQ1 = (EMAIL_LEADS_NEEDED / q1_2026_count - 1) * 100;
  const liftVsQ4 = (EMAIL_LEADS_NEEDED / q4_2025_count - 1) * 100;
  const liftVsQ3 = (EMAIL_LEADS_NEEDED / q3_2025_count - 1) * 100;

  console.log(`\nActual deals created per quarter (Sales Pipeline only):`);
  console.log(`  Q3 2025: ${fmtInt(q3_2025_count)}`);
  console.log(`  Q4 2025: ${fmtInt(q4_2025_count)}`);
  console.log(`  Q1 2026: ${fmtInt(q1_2026_count)}  ← most recent full quarter`);
  console.log(`\nQ2 2026 required lead volume: ${fmtInt(EMAIL_LEADS_NEEDED)}`);
  console.log(`\nLift required vs each recent quarter:`);
  console.log(
    `  vs Q1 2026 (${q1_2026_count}): +${liftVsQ1.toFixed(0)}% increase`,
  );
  console.log(
    `  vs Q4 2025 (${q4_2025_count}): +${liftVsQ4.toFixed(0)}% increase`,
  );
  console.log(
    `  vs Q3 2025 (${q3_2025_count}): +${liftVsQ3.toFixed(0)}% increase`,
  );

  console.log(`\nHow it was calculated:`);
  console.log(
    `  Count of distinct rows in deals where hubspot_created_at falls within`,
  );
  console.log(
    `  the EST quarter window AND pipeline = ${SALES_PIPELINE_ID.slice(0, 8)}...`,
  );
  console.log(`  Columns used: hubspot_deal_id, hubspot_created_at, pipeline.`);
  console.log(`\nDefense (drop into email):`);
  console.log(
    `  "For context, Q1 2026 sales pipeline lead volume was ${fmtInt(q1_2026_count)} deals created.`,
  );
  console.log(
    `   Hitting ${fmtInt(EMAIL_LEADS_NEEDED)} in Q2 at current conversion means a ${liftVsQ1.toFixed(0)}% increase over`,
  );
  console.log(
    `   last quarter's actual volume — this is a step-change in lead flow, not an incremental lift."`,
  );

  // ─────────────────────────────────────────────────────────────────────
  // SECTION 2: Cycle time — median + distribution (defends the May 7 cutoff)
  // ─────────────────────────────────────────────────────────────────────
  section('2. CYCLE TIME: MEDIAN + DISTRIBUTION (defends May 7 cutoff)');

  // Mature cohort: deals CREATED in 2025 (Q1-Q4) that reached closed_won.
  // We include all of 2025 because every quarter has had 3+ months of runway.
  const matureCohortQuarters = [q1_2025, q2_2025, q3_2025, q4_2025];
  const matureCreated = allDeals.filter((d) =>
    d.hubspot_created_at
      ? matureCohortQuarters.some((q) => isInQuarter(d.hubspot_created_at, q))
      : false,
  );
  const matureWon = matureCreated.filter((d) => d.closed_won_entered_at);

  // create → closed_won cycle
  const createToWon: number[] = [];
  for (const d of matureWon) {
    if (d.hubspot_created_at && d.closed_won_entered_at) {
      createToWon.push(daysBetween(d.hubspot_created_at, d.closed_won_entered_at));
    }
  }

  // demo → closed_won cycle
  const demoToWon: number[] = [];
  for (const d of matureWon) {
    if (d.demo_completed_entered_at && d.closed_won_entered_at) {
      demoToWon.push(
        daysBetween(d.demo_completed_entered_at, d.closed_won_entered_at),
      );
    }
  }

  console.log(`\nMature cohort: deals created Q1-Q4 2025 that reached closed-won`);
  console.log(`  Sample size: ${createToWon.length} closed-won deals`);
  console.log(`\nCreate → Closed Won cycle time:`);
  console.log(`  Average: ${avg(createToWon)} days  (email uses ${EMAIL_CYCLE_DAYS})`);
  console.log(`  Median:  ${median(createToWon)} days`);
  console.log(`\nCreate → Closed Won distribution (% of wins closing in under N days):`);
  for (const threshold of [30, 45, 55, 70, 90, 120]) {
    const p = pctLessThan(createToWon, threshold);
    const count = createToWon.filter((v) => v < threshold).length;
    console.log(
      `  < ${String(threshold).padStart(3, ' ')} days: ${fmtPct(p).padStart(6, ' ')}  (${count}/${createToWon.length})`,
    );
  }

  console.log(`\nDemo Completed → Closed Won cycle time:`);
  console.log(`  Sample size: ${demoToWon.length} deals`);
  console.log(`  Average: ${avg(demoToWon)} days`);
  console.log(`  Median:  ${median(demoToWon)} days`);
  console.log(`\nDemo → Closed Won distribution:`);
  for (const threshold of [14, 30, 45, 55, 70]) {
    const p = pctLessThan(demoToWon, threshold);
    const count = demoToWon.filter((v) => v < threshold).length;
    console.log(
      `  < ${String(threshold).padStart(3, ' ')} days: ${fmtPct(p).padStart(6, ' ')}  (${count}/${demoToWon.length})`,
    );
  }

  console.log(`\nHow it was calculated:`);
  console.log(
    `  For every deal where hubspot_created_at falls within Q1-Q4 2025 AND`,
  );
  console.log(
    `  closed_won_entered_at is set, compute days_between(create, won).`,
  );
  console.log(
    `  Columns used: hubspot_created_at, demo_completed_entered_at, closed_won_entered_at.`,
  );
  console.log(`  This is actual history — not projections, no fallbacks.`);
  console.log(`\nDefense (drop into email):`);
  const pctUnder55 = pctLessThan(createToWon, 55);
  const daysFromApr10ToMay7 = 27;
  const daysFromMay7ToJun30 = 54;
  console.log(
    `  "Median create-to-close is ${median(createToWon)} days (average ${avg(createToWon)}). Only ${fmtPct(pctUnder55)} of`,
  );
  console.log(
    `   2025 wins closed in under 55 days. That means any lead created after ~May 7`,
  );
  console.log(
    `   (${daysFromMay7ToJun30} days before quarter end) has only a ${fmtPct(pctUnder55, 0)} historical probability of converting`,
  );
  console.log(`   inside Q2 — this isn't a guess, it's what the 2025 cohort actually did."`);

  // ─────────────────────────────────────────────────────────────────────
  // SECTION 3: Verify 27.3% demo → close (and other baseline rates)
  // ─────────────────────────────────────────────────────────────────────
  section('3. VERIFY EMAIL BASELINES (27.3% demo→close, 17.3% create→demo)');

  // Q1 2026 closing rates (same formula as the Goal Tracker dashboard)
  const q1_2026_demos = allDeals.filter((d) =>
    isInQuarter(d.demo_completed_entered_at, q1_2026),
  );
  const q1_2026_wonByTs = allDeals.filter((d) =>
    isInQuarter(d.closed_won_entered_at, q1_2026),
  );
  // Also include by deal_stage + close_date (matches computeQuarterClosingRates)
  const CLOSED_WON_ID = '97b2bcc6-fb34-4b56-8e6e-c349c88ef3d5';
  const qStart = q1_2026.startDate.toISOString().slice(0, 10);
  const qEnd = q1_2026.endDate.toISOString().slice(0, 10);
  const q1_2026_wonByDate = allDeals.filter(
    (d) =>
      d.deal_stage === CLOSED_WON_ID &&
      d.close_date &&
      d.close_date >= qStart &&
      d.close_date <= qEnd,
  );
  const q1WonSet = new Map<string, Deal>();
  for (const d of q1_2026_wonByTs) q1WonSet.set(d.hubspot_deal_id, d);
  for (const d of q1_2026_wonByDate) q1WonSet.set(d.hubspot_deal_id, d);
  const q1_2026_won = Array.from(q1WonSet.values());

  const q1_demoToWon =
    q1_2026_demos.length > 0 ? q1_2026_won.length / q1_2026_demos.length : 0;
  const q1_createToDemo =
    q1_2026_count > 0 ? q1_2026_demos.length / q1_2026_count : 0;
  const q1_avgDeal =
    q1_2026_won.length > 0
      ? q1_2026_won.reduce((s, d) => s + (Number(d.amount) || 0), 0) /
        q1_2026_won.length
      : 0;

  // Mature cohort rates (Q1-Q4 2025 combined)
  const matureDemo = matureCreated.filter((d) => d.demo_completed_entered_at);
  const mature_createToDemo =
    matureCreated.length > 0 ? matureDemo.length / matureCreated.length : 0;
  const mature_demoToWon =
    matureDemo.length > 0 ? matureWon.length / matureDemo.length : 0;
  const mature_avgDeal =
    matureWon.length > 0
      ? matureWon.reduce((s, d) => s + (Number(d.amount) || 0), 0) /
        matureWon.length
      : 0;

  console.log(`\nQ1 2026 rates (matches Goal Tracker dashboard formula):`);
  console.log(
    `  Demo → Won:   ${fmtPct(q1_demoToWon)}  (${q1_2026_won.length} won / ${q1_2026_demos.length} demos)   email: ${fmtPct(EMAIL_DEMO_TO_WON)}`,
  );
  console.log(
    `  Create → Demo: ${fmtPct(q1_createToDemo)}  (${q1_2026_demos.length} demos / ${q1_2026_count} created)   email: ${fmtPct(EMAIL_CREATE_TO_DEMO)}`,
  );
  console.log(
    `  Avg Deal Size: ${fmtMoney(q1_avgDeal)}  (${q1_2026_won.length} deals)   email: ${fmtMoney(EMAIL_AVG_DEAL)}`,
  );

  console.log(`\nMature cohort rates (all of 2025, Q1-Q4 combined):`);
  console.log(
    `  Demo → Won:   ${fmtPct(mature_demoToWon)}  (${matureWon.length} won / ${matureDemo.length} demos)`,
  );
  console.log(
    `  Create → Demo: ${fmtPct(mature_createToDemo)}  (${matureDemo.length} demos / ${matureCreated.length} created)`,
  );
  console.log(
    `  Avg Deal Size: ${fmtMoney(mature_avgDeal)}  (${matureWon.length} deals)`,
  );

  console.log(`\nHow it was calculated:`);
  console.log(
    `  demo→won = deals with closed_won_entered_at in Q1 2026 / deals with`,
  );
  console.log(
    `  demo_completed_entered_at in Q1 2026. Same formula as the Q2 Goal Tracker.`,
  );
  console.log(`\nDefense (drop into email):`);
  const discrepancy = Math.abs(q1_demoToWon - EMAIL_DEMO_TO_WON) > 0.01;
  if (discrepancy) {
    console.log(
      `  ⚠ WARNING: The live Q1 2026 demo→won rate (${fmtPct(q1_demoToWon)}) differs from the`,
    );
    console.log(
      `    email's stated 27.3%. The email may be stale — consider updating.`,
    );
  } else {
    console.log(
      `  "The 27.3% demo-to-close rate is a direct measurement, not an estimate.`,
    );
    console.log(
      `   It is the Q1 2026 closed-won count divided by demos completed in Q1 2026`,
    );
    console.log(
      `   (${q1_2026_won.length}/${q1_2026_demos.length}). The 2025 cohort across all four quarters came in at`,
    );
    console.log(
      `   ${fmtPct(mature_demoToWon)}, so the 27.3% figure is consistent with a full year of data."`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // SECTION 3b: List the actual deals behind the 35.3% Q1 2026 rate
  // ─────────────────────────────────────────────────────────────────────
  section('3b. DEALS BEHIND THE 35.3% Q1 2026 DEMO→WON RATE');

  const ownerName = (id: string | null): string => {
    if (!id) return '(no owner)';
    const o = ownerMap.get(id);
    if (!o) return `(unknown: ${id.slice(0, 8)})`;
    const n = `${o.first_name || ''} ${o.last_name || ''}`.trim();
    return n || o.email || '(unnamed)';
  };

  const pad = (s: string, n: number) =>
    s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
  const padLeft = (s: string, n: number) =>
    s.length >= n ? s.slice(0, n) : ' '.repeat(n - s.length) + s;

  console.log(`\nFormula: closed_won_in_Q1_2026 / demos_completed_in_Q1_2026`);
  console.log(`         ${q1_2026_won.length} / ${q1_2026_demos.length} = ${fmtPct(q1_demoToWon)}`);
  console.log(
    `Note: numerator and denominator are independent sets (a deal can be`,
  );
  console.log(
    `      in demos but not yet won, or won with its demo in a prior quarter).`,
  );

  // Numerator: 18 closed-won deals (closed in Q1 2026)
  console.log(`\n─── NUMERATOR: ${q1_2026_won.length} closed-won deals (closed_won_entered_at in Q1 2026) ───`);
  console.log(
    pad('#', 3) +
      pad('Deal Name', 38) +
      padLeft('Amount', 11) +
      '  ' +
      pad('Owner', 18) +
      pad('Demo Date', 12) +
      pad('Won Date', 12) +
      pad('HS ID', 12),
  );
  const wonSorted = [...q1_2026_won].sort((a, b) => {
    const da = a.closed_won_entered_at || a.close_date || '';
    const db = b.closed_won_entered_at || b.close_date || '';
    return da.localeCompare(db);
  });
  let wonTotal = 0;
  wonSorted.forEach((d, i) => {
    const amt = Number(d.amount) || 0;
    wonTotal += amt;
    const demoDate = d.demo_completed_entered_at?.slice(0, 10) || '—';
    const wonDate =
      d.closed_won_entered_at?.slice(0, 10) || d.close_date?.slice(0, 10) || '—';
    console.log(
      pad(String(i + 1) + '.', 3) +
        pad(d.deal_name || '(unnamed)', 38) +
        padLeft(fmtMoney(amt), 11) +
        '  ' +
        pad(ownerName(d.owner_id), 18) +
        pad(demoDate, 12) +
        pad(wonDate, 12) +
        pad(d.hubspot_deal_id, 12),
    );
  });
  console.log(`    Total ARR: ${fmtMoney(wonTotal)}`);

  // Cross-tab: how many of the 18 wins had their demo IN Q1 2026 vs before?
  const wonWithDemoInQ1 = q1_2026_won.filter((d) =>
    isInQuarter(d.demo_completed_entered_at, q1_2026),
  );
  const wonWithDemoBeforeQ1 = q1_2026_won.filter(
    (d) =>
      d.demo_completed_entered_at &&
      !isInQuarter(d.demo_completed_entered_at, q1_2026),
  );
  const wonWithoutDemo = q1_2026_won.filter((d) => !d.demo_completed_entered_at);
  console.log(`\n    Of the ${q1_2026_won.length} wins:`);
  console.log(
    `      • ${wonWithDemoInQ1.length} had their demo completed in Q1 2026 (same quarter)`,
  );
  console.log(
    `      • ${wonWithDemoBeforeQ1.length} had their demo completed BEFORE Q1 2026 (carried over)`,
  );
  console.log(
    `      • ${wonWithoutDemo.length} have no demo_completed_entered_at timestamp`,
  );

  // Denominator: 51 demos completed in Q1 2026
  console.log(
    `\n─── DENOMINATOR: ${q1_2026_demos.length} demos completed (demo_completed_entered_at in Q1 2026) ───`,
  );
  console.log(
    pad('#', 4) +
      pad('Deal Name', 38) +
      padLeft('Amount', 11) +
      '  ' +
      pad('Owner', 18) +
      pad('Demo Date', 12) +
      pad('Current Stage', 20) +
      pad('HS ID', 12),
  );
  const demosSorted = [...q1_2026_demos].sort((a, b) => {
    const da = a.demo_completed_entered_at || '';
    const db = b.demo_completed_entered_at || '';
    return da.localeCompare(db);
  });
  const wonIds = new Set(q1_2026_won.map((d) => d.hubspot_deal_id));
  let demoTotal = 0;
  demosSorted.forEach((d, i) => {
    const amt = Number(d.amount) || 0;
    demoTotal += amt;
    const demoDate = d.demo_completed_entered_at?.slice(0, 10) || '—';
    const isWon = wonIds.has(d.hubspot_deal_id);
    const stageDisplay = isWon
      ? '✓ WON (in Q1)'
      : d.deal_stage === '97b2bcc6-fb34-4b56-8e6e-c349c88ef3d5'
        ? 'Closed Won'
        : d.deal_stage?.slice(0, 18) || '—';
    console.log(
      pad(String(i + 1) + '.', 4) +
        pad(d.deal_name || '(unnamed)', 38) +
        padLeft(fmtMoney(amt), 11) +
        '  ' +
        pad(ownerName(d.owner_id), 18) +
        pad(demoDate, 12) +
        pad(stageDisplay, 20) +
        pad(d.hubspot_deal_id, 12),
    );
  });
  console.log(`    Total ARR in play: ${fmtMoney(demoTotal)}`);

  // Overlap count
  const demoIds = new Set(q1_2026_demos.map((d) => d.hubspot_deal_id));
  const overlap = q1_2026_won.filter((d) => demoIds.has(d.hubspot_deal_id));
  console.log(
    `\n    Overlap: ${overlap.length} deals appear in BOTH sets (demoed AND won in Q1 2026).`,
  );
  console.log(
    `    The "true cohort rate" (same-quarter demo→won) = ${overlap.length}/${q1_2026_demos.length} = ${fmtPct(overlap.length / q1_2026_demos.length)}`,
  );
  console.log(
    `    vs the dashboard's ${q1_2026_won.length}/${q1_2026_demos.length} = ${fmtPct(q1_demoToWon)} "closing rate" formula.`,
  );

  // ─────────────────────────────────────────────────────────────────────
  // SECTION 4: Cross-check that 889/154/42 is consistent with current rates
  // ─────────────────────────────────────────────────────────────────────
  section('4. CROSS-CHECK: 889 leads / 154 demos / 42 closes');

  const closesNeeded = computeDealsNeeded(EMAIL_GAP, EMAIL_AVG_DEAL);
  const demosNeeded = computeDemosNeeded(closesNeeded, EMAIL_DEMO_TO_WON);
  const leadsNeeded = computeLeadsNeeded(demosNeeded, EMAIL_CREATE_TO_DEMO);

  console.log(`\nUsing the email's stated rates:`);
  console.log(
    `  Gap ${fmtMoney(EMAIL_GAP)} / ${fmtMoney(EMAIL_AVG_DEAL)} avg deal = ${closesNeeded} closes`,
  );
  console.log(
    `  ${closesNeeded} closes / ${fmtPct(EMAIL_DEMO_TO_WON)} demo→won = ${demosNeeded} demos`,
  );
  console.log(
    `  ${demosNeeded} demos / ${fmtPct(EMAIL_CREATE_TO_DEMO)} create→demo = ${leadsNeeded} leads`,
  );
  console.log(
    `\n  Email says:    ${EMAIL_DEALS_NEEDED} closes / ${EMAIL_DEMOS_NEEDED} demos / ${EMAIL_LEADS_NEEDED} leads`,
  );
  console.log(
    `  Calculated:    ${closesNeeded} closes / ${demosNeeded} demos / ${leadsNeeded} leads`,
  );
  if (
    closesNeeded !== EMAIL_DEALS_NEEDED ||
    demosNeeded !== EMAIL_DEMOS_NEEDED ||
    leadsNeeded !== EMAIL_LEADS_NEEDED
  ) {
    console.log(`  ⚠ Does not match — email numbers may need updating.`);
  } else {
    console.log(`  ✓ Matches exactly.`);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Summary footer
  // ─────────────────────────────────────────────────────────────────────
  section('SUMMARY');
  console.log(`
Ready-to-use numbers for the email:

  [Q1 LEAD VOLUME]
    Q1 2026 produced ${fmtInt(q1_2026_count)} leads on the Sales Pipeline.
    Q2 requires ${fmtInt(EMAIL_LEADS_NEEDED)} → a +${liftVsQ1.toFixed(0)}% increase over Q1 actual.
    (Q4 2025 baseline: ${fmtInt(q4_2025_count)}; Q3 2025: ${fmtInt(q3_2025_count)})

  [CYCLE TIME DEFENSE]
    Based on ${createToWon.length} wins from 2025: median ${median(createToWon)}d, avg ${avg(createToWon)}d.
    ${fmtPct(pctLessThan(createToWon, 55))} of 2025 wins closed in under 55 days.
    ${fmtPct(pctLessThan(createToWon, 70))} closed in under 70 days.
    ${fmtPct(pctLessThan(createToWon, 90))} closed in under 90 days.

  [27.3% VERIFICATION]
    Live Q1 2026 demo→won: ${fmtPct(q1_demoToWon)} (${q1_2026_won.length}/${q1_2026_demos.length})
    Full 2025 demo→won:    ${fmtPct(mature_demoToWon)} (${matureWon.length}/${matureDemo.length})
    Email number (27.3%):  ${discrepancy ? 'DOES NOT MATCH — update email' : 'MATCHES'}

  [MATH CONSISTENCY]
    889/154/42 chain ${closesNeeded === EMAIL_DEALS_NEEDED && demosNeeded === EMAIL_DEMOS_NEEDED && leadsNeeded === EMAIL_LEADS_NEEDED ? 'checks out at stated rates.' : 'DOES NOT reproduce — check inputs.'}
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
