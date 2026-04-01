/**
 * Server-side Supabase queries for Q2 Goal Tracker.
 *
 * Computes historical conversion rates (cohort-based), current pipeline,
 * per-AE data, and weekly closed-won actuals for Q2.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getQuarterInfo, getQuarterProgress } from '@/lib/utils/quarter';
import { SALES_PIPELINE_STAGES } from '@/lib/hubspot/stage-config';
import type {
  HistoricalRates,
  RateSet,
  LeadSourceRate,
  AEData,
  WeeklyActual,
  PipelineCredit,
  PipelineDeal,
} from './types';

const SALES_PIPELINE_ID = '1c27e5a3-5e5e-4403-ab0f-d356bf268cf3';
const S = SALES_PIPELINE_STAGES;

const POST_DEMO_STAGES = new Set([
  S.DEMO_COMPLETED.id, S.QUALIFIED_VALIDATED.id,
  S.PROPOSAL_EVALUATING.id, S.MSA_SENT_REVIEW.id,
]);
const PRE_DEMO_STAGES = new Set([
  S.MQL.id, S.SQL_DISCOVERY.id, S.DEMO_SCHEDULED.id,
]);

const STAGE_LABEL: Record<string, string> = Object.fromEntries(
  Object.values(SALES_PIPELINE_STAGES).map((s) => [s.id, s.label])
);

// AE targets from the Q2 2026 KPI document
const AE_TARGETS: Record<string, number> = {
  'cgarraffa@opusbehavioral.com': 400000,
  'jrice@opusbehavioral.com': 300000,
  'atiwari@opusbehavioral.com': 90000,
  'zclaussen@opusbehavioral.com': 90000,
  'hgomez@opusbehavioral.com': 25000,
};

// ── Paginated fetch ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Deal = Record<string, any>;

async function fetchAllSalesPipelineDeals(supabase: SupabaseClient) {
  const PAGE_SIZE = 500;
  let allDeals: Deal[] = [];
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
        proposal_entered_at, closed_won_entered_at, created_at
      `)
      .eq('pipeline', SALES_PIPELINE_ID)
      .range(offset, offset + PAGE_SIZE - 1)
      .order('created_at', { ascending: true });

    if (error) throw new Error(`Failed to fetch deals: ${error.message}`);
    allDeals = allDeals.concat(data || []);
    hasMore = (data || []).length === PAGE_SIZE;
    offset += PAGE_SIZE;
  }
  return allDeals;
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

// ── Compute rates for a set of cohort quarters ──

function computeCohortRates(
  allDeals: Deal[],
  quarters: ReturnType<typeof getQuarterInfo>[],
): { rates: HistoricalRates; totalCreated: number; totalDemoCompleted: number; totalClosedWon: number; totalWonARR: number } {
  let totalCreated = 0;
  let totalDemoCompleted = 0;
  let totalClosedWon = 0;
  let totalWonARR = 0;
  const cycleTimes: number[] = [];
  const demoToCloseTimes: number[] = [];
  const createToDemoTimes: number[] = [];

  for (const qi of quarters) {
    const created = allDeals.filter((d) => d.hubspot_created_at && isInQuarter(d.hubspot_created_at, qi));
    totalCreated += created.length;

    const demoComp = created.filter((d) => d.demo_completed_entered_at);
    totalDemoCompleted += demoComp.length;

    const won = created.filter((d) => d.closed_won_entered_at);
    totalClosedWon += won.length;
    totalWonARR += won.reduce((s, d) => s + (Number(d.amount) || 0), 0);

    for (const d of won) {
      if (d.hubspot_created_at && d.closed_won_entered_at) {
        cycleTimes.push(daysBetween(d.hubspot_created_at, d.closed_won_entered_at));
      }
      if (d.demo_completed_entered_at && d.closed_won_entered_at) {
        demoToCloseTimes.push(daysBetween(d.demo_completed_entered_at, d.closed_won_entered_at));
      }
      if (d.hubspot_created_at && d.demo_completed_entered_at) {
        createToDemoTimes.push(daysBetween(d.hubspot_created_at, d.demo_completed_entered_at));
      }
    }
  }

  // For Q1 2026 cohort specifically, many deals haven't had time to progress
  // so we also look at deals that CLOSED in Q1 2026 regardless of creation quarter
  // for avg deal size and cycle time (stage-entry based approach)

  return {
    rates: {
      avgDealSize: totalClosedWon > 0 ? totalWonARR / totalClosedWon : 25000,
      demoToWonRate: totalDemoCompleted > 0 ? totalClosedWon / totalDemoCompleted : 0.2,
      createToDemoRate: totalCreated > 0 ? totalDemoCompleted / totalCreated : 0.5,
      medianCycleTime: median(cycleTimes) || 50,
      medianDemoToClose: median(demoToCloseTimes) || 48,
      medianCreateToDemo: median(createToDemoTimes) || 6,
    },
    totalCreated,
    totalDemoCompleted,
    totalClosedWon,
    totalWonARR,
  };
}

// For Q1 2026, we use deals that CLOSED in Q1 (by closed_won_entered_at or close_date)
// rather than cohort-based, since the cohort is still immature
function computeQ1_2026ClosingRates(
  allDeals: Deal[],
): { rates: HistoricalRates; totalClosedWon: number; totalWonARR: number; totalDemoCompleted: number; totalCreated: number } {
  const qi = getQuarterInfo(2026, 1);
  const CLOSED_WON_ID = S.CLOSED_WON.id;

  // Quarter date boundaries for close_date comparison
  const qStartDate = '2026-01-01';
  const qEndDate = '2026-03-31';

  // Closed-won by timestamp
  const wonByTimestamp = allDeals.filter((d) => isInQuarter(d.closed_won_entered_at, qi));
  // Closed-won by stage + close_date
  const wonByDate = allDeals.filter((d) =>
    d.deal_stage === CLOSED_WON_ID && d.close_date && d.close_date >= qStartDate && d.close_date <= qEndDate
  );

  // Merge & deduplicate
  const wonMap = new Map<string, Deal>();
  for (const d of wonByTimestamp) wonMap.set(d.id, d);
  for (const d of wonByDate) wonMap.set(d.id, d);
  const closedWon = Array.from(wonMap.values());

  const totalWonARR = closedWon.reduce((s, d) => s + (Number(d.amount) || 0), 0);

  // Demo completed that entered in Q1
  const demoCompInQ1 = allDeals.filter((d) => isInQuarter(d.demo_completed_entered_at, qi));
  // Deals created in Q1
  const createdInQ1 = allDeals.filter((d) => d.hubspot_created_at && isInQuarter(d.hubspot_created_at, qi));

  // Demo→Won = closedWon / demos completed in Q1
  const demoToWon = demoCompInQ1.length > 0 ? closedWon.length / demoCompInQ1.length : 0.2;
  // Create→Demo = demos completed / deals created in Q1
  const createToDemo = createdInQ1.length > 0 ? demoCompInQ1.length / createdInQ1.length : 0.5;

  // Cycle times from the actual closed deals
  const cycleTimes: number[] = [];
  const demoToCloseTimes: number[] = [];
  const createToDemoTimes: number[] = [];

  for (const d of closedWon) {
    if (d.hubspot_created_at && d.closed_won_entered_at) {
      cycleTimes.push(daysBetween(d.hubspot_created_at, d.closed_won_entered_at));
    }
    if (d.demo_completed_entered_at && d.closed_won_entered_at) {
      demoToCloseTimes.push(daysBetween(d.demo_completed_entered_at, d.closed_won_entered_at));
    }
    if (d.hubspot_created_at && d.demo_completed_entered_at) {
      createToDemoTimes.push(daysBetween(d.hubspot_created_at, d.demo_completed_entered_at));
    }
  }

  return {
    rates: {
      avgDealSize: closedWon.length > 0 ? totalWonARR / closedWon.length : 25000,
      demoToWonRate: demoToWon,
      createToDemoRate: createToDemo,
      medianCycleTime: median(cycleTimes) || 50,
      medianDemoToClose: median(demoToCloseTimes) || 48,
      medianCreateToDemo: median(createToDemoTimes) || 6,
    },
    totalClosedWon: closedWon.length,
    totalWonARR,
    totalDemoCompleted: demoCompInQ1.length,
    totalCreated: createdInQ1.length,
  };
}

// ── Main compute function ──

export async function computeQ2GoalTrackerData(supabase: SupabaseClient) {
  // Fetch all data
  const [allDeals, ownersResult] = await Promise.all([
    fetchAllSalesPipelineDeals(supabase),
    supabase.from('owners').select('id, first_name, last_name, email, hubspot_owner_id'),
  ]);

  const owners = ownersResult.data || [];
  const ownerMap = new Map(owners.map((o) => [o.id, o]));

  // ── Rate Set 1: Q1 2026 (default — most recent quarter) ──
  const q1_2026_data = computeQ1_2026ClosingRates(allDeals);
  const q1RateSet: RateSet = {
    label: 'Q1 2026',
    description: `${q1_2026_data.totalClosedWon} closed-won deals, $${Math.round(q1_2026_data.totalWonARR).toLocaleString()} ARR`,
    rates: q1_2026_data.rates,
    sampleSize: q1_2026_data.totalClosedWon,
    totalARR: q1_2026_data.totalWonARR,
  };

  // ── Rate Set 2: Q1-Q4 2025 cohorts (larger sample) ──
  const cohortQuarters = [
    getQuarterInfo(2025, 1), getQuarterInfo(2025, 2),
    getQuarterInfo(2025, 3), getQuarterInfo(2025, 4),
  ];
  const cohortData = computeCohortRates(allDeals, cohortQuarters);
  const cohortRateSet: RateSet = {
    label: 'Q1-Q4 2025',
    description: `${cohortData.totalClosedWon} closed-won deals, $${Math.round(cohortData.totalWonARR).toLocaleString()} ARR`,
    rates: cohortData.rates,
    sampleSize: cohortData.totalClosedWon,
    totalARR: cohortData.totalWonARR,
  };

  const rateSets = [q1RateSet, cohortRateSet];
  // Default = Q1 2026 (first in array)
  const historicalRates = q1RateSet.rates;

  // ── Lead source rates from Q1 2026 (most recent full quarter with PPL data) ──
  const q1_2026 = getQuarterInfo(2026, 1);
  const q1Deals = allDeals.filter((d) => d.hubspot_created_at && isInQuarter(d.hubspot_created_at, q1_2026));

  const sourceMap = new Map<string, { total: number; demo: number }>();
  for (const d of q1Deals) {
    const src = d.lead_source || '(no lead source)';
    if (!sourceMap.has(src)) sourceMap.set(src, { total: 0, demo: 0 });
    const entry = sourceMap.get(src)!;
    entry.total++;
    if (d.demo_completed_entered_at) entry.demo++;
  }

  const leadSourceRates: LeadSourceRate[] = [...sourceMap.entries()]
    .filter(([, v]) => v.total >= 2)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([source, counts]) => ({
      source,
      createToDemoRate: counts.total > 0 ? counts.demo / counts.total : 0,
      dealsCreated: counts.total,
      demosCompleted: counts.demo,
    }));

  // ── Per-AE data ──
  const aeData: AEData[] = [];

  for (const [email, target] of Object.entries(AE_TARGETS)) {
    const owner = owners.find((o) => o.email === email);

    if (!owner) {
      aeData.push({
        name: email.split('@')[0],
        email,
        ownerId: null,
        q2Target: target,
        bestQuarterARR: 0,
        bestQuarterLabel: 'No data',
        allTimeWonARR: 0,
        allTimeWonCount: 0,
        personalDemoToWon: 0,
        personalCreateToDemo: 0,
      });
      continue;
    }

    const aeDeals = allDeals.filter((d) => d.owner_id === owner.id);
    const aeWon = aeDeals.filter((d) => d.closed_won_entered_at);
    const allTimeWonARR = aeWon.reduce((s, d) => s + (Number(d.amount) || 0), 0);

    // Best quarter
    const allQuarters = [...cohortQuarters, getQuarterInfo(2026, 1)];
    let bestQtrARR = 0;
    let bestQtrLabel = 'N/A';
    for (const qi of allQuarters) {
      const qtrWon = aeDeals.filter((d) => isInQuarter(d.closed_won_entered_at, qi));
      const qtrARR = qtrWon.reduce((s, d) => s + (Number(d.amount) || 0), 0);
      if (qtrARR > bestQtrARR) {
        bestQtrARR = qtrARR;
        bestQtrLabel = qi.label;
      }
    }

    // Personal conversion rates
    const aeWithDate = aeDeals.filter((d) => d.hubspot_created_at);
    const aeEverDemo = aeWithDate.filter((d) => d.demo_completed_entered_at);
    const aeEverWon = aeWithDate.filter((d) => d.closed_won_entered_at);

    aeData.push({
      name: `${owner.first_name} ${owner.last_name}`,
      email,
      ownerId: owner.id,
      q2Target: target,
      bestQuarterARR: bestQtrARR,
      bestQuarterLabel: bestQtrLabel,
      allTimeWonARR,
      allTimeWonCount: aeWon.length,
      personalDemoToWon: aeEverDemo.length > 0 ? aeEverWon.length / aeEverDemo.length : 0,
      personalCreateToDemo: aeWithDate.length > 0 ? aeEverDemo.length / aeWithDate.length : 0,
    });
  }

  // ── Weekly closed-won actuals for Q2 2026 ──
  const q2 = getQuarterInfo(2026, 2);
  const q2Start = new Date(q2.startDate);
  const weeklyActuals: WeeklyActual[] = [];

  for (let i = 0; i < 13; i++) {
    const weekStart = new Date(q2Start.getTime() + i * 7 * 86400000);
    const weekEnd = new Date(Math.min(weekStart.getTime() + 7 * 86400000 - 1, q2.endDate.getTime()));

    const weekDeals = allDeals.filter((d) => {
      if (!d.closed_won_entered_at) return false;
      const t = new Date(d.closed_won_entered_at).getTime();
      return t >= weekStart.getTime() && t <= weekEnd.getTime();
    });

    weeklyActuals.push({
      weekNumber: i + 1,
      weekStart: weekStart.toISOString().split('T')[0],
      weekEnd: weekEnd.toISOString().split('T')[0],
      closedWonARR: weekDeals.reduce((s, d) => s + (Number(d.amount) || 0), 0),
      closedWonCount: weekDeals.length,
    });
  }

  // ── Pipeline credit ──
  const activeDeals = allDeals.filter((d) =>
    POST_DEMO_STAGES.has(d.deal_stage) || PRE_DEMO_STAGES.has(d.deal_stage)
  );

  const postDemo = activeDeals.filter((d) => POST_DEMO_STAGES.has(d.deal_stage));
  const preDemo = activeDeals.filter((d) => PRE_DEMO_STAGES.has(d.deal_stage));

  const topDeals: PipelineDeal[] = postDemo
    .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))
    .slice(0, 15)
    .map((d) => {
      const owner = ownerMap.get(d.owner_id);
      return {
        dealName: d.deal_name,
        ownerName: owner ? `${owner.first_name} ${owner.last_name}` : 'Unknown',
        stage: STAGE_LABEL[d.deal_stage] || d.deal_stage,
        amount: Number(d.amount) || 0,
        daysInPipeline: d.hubspot_created_at
          ? daysBetween(d.hubspot_created_at, new Date().toISOString())
          : 0,
      };
    });

  const pipelineCredit: PipelineCredit = {
    postDemoRawARR: postDemo.reduce((s, d) => s + (Number(d.amount) || 0), 0),
    postDemoCount: postDemo.length,
    preDemoRawARR: preDemo.reduce((s, d) => s + (Number(d.amount) || 0), 0),
    preDemoCount: preDemo.length,
    topDeals,
  };

  // ── Quarter progress ──
  const progress = getQuarterProgress(q2);
  const currentWeek = Math.min(13, Math.ceil(progress.daysElapsed / 7));

  return {
    quarter: {
      year: q2.year,
      quarter: q2.quarter,
      label: q2.label,
      startDate: q2.startDate.toISOString(),
      endDate: q2.endDate.toISOString(),
    },
    progress: {
      ...progress,
      currentWeek,
      totalWeeks: 13,
    },
    rateSets,
    historicalRates,
    leadSourceRates,
    aeData,
    weeklyActuals,
    pipelineCredit,
    teamTarget: 925000,
  };
}
