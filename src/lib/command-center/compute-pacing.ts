/**
 * Pacing computation for the Command Center.
 *
 * Computes how deal creation by source and by week is tracking
 * relative to what's required to hit the Q2 ARR goal.
 *
 * Weeks are Sunday–Saturday (Eastern). The first and last weeks of the
 * quarter may be partial stubs — see src/lib/utils/weeks.ts.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getQuarterInfo, getQuarterProgress } from '@/lib/utils/quarter';
import { getQuarterWeeksSunSat, fractionalWeeksElapsed } from '@/lib/utils/weeks';
import type { PacingData, WeeklyPacingRow, WeeklyDealRef, SourcePacing } from './types';
import type { Q2GoalTrackerApiResponse } from '@/lib/q2-goal-tracker/types';
import { computeLeadsNeeded, computeDemosNeeded, computeDealsNeeded, computeGap } from '@/lib/q2-goal-tracker/math';

const SALES_PIPELINE_ID = '1c27e5a3-5e5e-4403-ab0f-d356bf268cf3';

export async function computePacingData(
  supabase: SupabaseClient,
  goalTrackerData: Q2GoalTrackerApiResponse,
): Promise<PacingData> {
  const q2 = getQuarterInfo(2026, 2);
  const weeks = getQuarterWeeksSunSat(q2);
  const progress = getQuarterProgress(q2);
  const weeksElapsedFractional = fractionalWeeksElapsed(q2, weeks);

  // Fetch all Q2 deals from Supabase (created in Q2 + in sales pipeline)
  const { data: q2Deals, error } = await supabase
    .from('deals')
    .select('hubspot_deal_id, deal_name, amount, lead_source, hubspot_created_at, demo_scheduled_entered_at, demo_completed_entered_at, closed_won_entered_at, deal_stage, owner_id')
    .eq('pipeline', SALES_PIPELINE_ID)
    .gte('hubspot_created_at', q2.startDate.toISOString())
    .lte('hubspot_created_at', q2.endDate.toISOString());

  // Fetch owner names for deal refs
  const { data: owners } = await supabase
    .from('owners')
    .select('id, first_name, last_name');
  const ownerMap = new Map((owners || []).map((o) => [String(o.id), [o.first_name, o.last_name].filter(Boolean).join(' ')]));

  if (error) throw new Error(`Failed to fetch Q2 deals: ${error.message}`);
  const deals = q2Deals || [];

  function toRef(d: typeof deals[number]): WeeklyDealRef {
    return {
      hubspotDealId: d.hubspot_deal_id,
      dealName: d.deal_name || '',
      amount: Number(d.amount) || 0,
      ownerName: ownerMap.get(String(d.owner_id)) || '',
    };
  }

  // Use the default rate set (first = Q1 2026) for required calculations
  const rates = goalTrackerData.historicalRates;
  const teamTarget = goalTrackerData.teamTarget;

  // Pace against the GAP, not the full team target. Mirrors the Q2 Goal Tracker's
  // "new Q2 activity needed (the work)" formula — subtract weighted team-confirmed
  // pipeline from the target, then reverse-engineer leads from the remaining ARR.
  const teamForecastRaw = goalTrackerData.pipelineCredit.teamForecastARR || 0;
  const teamForecastWeighted = Math.round(teamForecastRaw * rates.demoToWonRate);
  const gap = computeGap(teamTarget, teamForecastWeighted);

  const dealsNeeded = computeDealsNeeded(gap, rates.avgDealSize);
  const demosNeeded = computeDemosNeeded(dealsNeeded, rates.demoToWonRate);
  const leadsNeeded = computeLeadsNeeded(demosNeeded, rates.createToDemoRate);

  // Closed-won totals keyed by week-index so legacy weeklyActuals[] (which is
  // indexed by 7-day-from-quarter-start) lines up with Sun–Sat weeks.
  const closedWonByWeek = new Map<number, { arr: number; count: number }>();
  for (const d of deals) {
    if (!d.closed_won_entered_at) continue;
    const t = new Date(d.closed_won_entered_at).getTime();
    const weekIdx = weeks.findIndex((w) => t >= w.weekStart.getTime() && t <= w.weekEnd.getTime());
    if (weekIdx < 0) continue;
    const entry = closedWonByWeek.get(weekIdx) || { arr: 0, count: 0 };
    entry.arr += Number(d.amount) || 0;
    entry.count += 1;
    closedWonByWeek.set(weekIdx, entry);
  }

  // -- Weekly rows --
  const weeklyRows: WeeklyPacingRow[] = weeks.map((w, i) => {
    const wStart = w.weekStart.getTime();
    const wEnd = w.weekEnd.getTime();

    const weekDeals = deals.filter((d) => {
      if (!d.hubspot_created_at) return false;
      const t = new Date(d.hubspot_created_at).getTime();
      return t >= wStart && t <= wEnd;
    });

    const weekDemosScheduled = deals.filter((d) => {
      if (!d.demo_scheduled_entered_at) return false;
      const t = new Date(d.demo_scheduled_entered_at).getTime();
      return t >= wStart && t <= wEnd;
    });

    const weekDemos = deals.filter((d) => {
      if (!d.demo_completed_entered_at) return false;
      const t = new Date(d.demo_completed_entered_at).getTime();
      return t >= wStart && t <= wEnd;
    });

    const weekClosedWon = deals.filter((d) => {
      if (!d.closed_won_entered_at) return false;
      const t = new Date(d.closed_won_entered_at).getTime();
      return t >= wStart && t <= wEnd;
    });

    const closedTotals = closedWonByWeek.get(i) || { arr: 0, count: 0 };

    return {
      weekNumber: w.weekNumber,
      weekStart: w.weekStartDate,
      weekEnd: w.weekEndDate,
      isPartial: w.isPartial,
      isCurrent: w.isCurrent,
      leadsCreated: weekDeals.length,
      demosScheduled: weekDemosScheduled.length,
      dealsToDemo: weekDemos.length,
      closedWonARR: closedTotals.arr,
      closedWonCount: closedTotals.count,
      leadsCreatedDeals: weekDeals.map(toRef),
      demosScheduledDeals: weekDemosScheduled.map(toRef),
      demoCompletedDeals: weekDemos.map(toRef),
      closedWonDeals: weekClosedWon.map(toRef),
    };
  });

  // -- Source breakdown --
  const sourceMap = new Map<string, { total: number; weekly: number[] }>();
  for (const d of deals) {
    const src = d.lead_source || '(no lead source)';
    if (!sourceMap.has(src)) sourceMap.set(src, { total: 0, weekly: new Array(weeks.length).fill(0) });
    const entry = sourceMap.get(src)!;
    entry.total++;

    if (d.hubspot_created_at) {
      const t = new Date(d.hubspot_created_at).getTime();
      const weekIdx = weeks.findIndex((w) => t >= w.weekStart.getTime() && t <= w.weekEnd.getTime());
      if (weekIdx >= 0) entry.weekly[weekIdx]++;
    }
  }

  // Calculate required per source using historical source rates. Pacing uses
  // fractional days elapsed so partial first/last weeks don't create cliffs.
  const fractionElapsed = progress.daysElapsed / progress.totalDays;
  const totalCreated = deals.length;
  const sourceBreakdown: SourcePacing[] = [...sourceMap.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([source, data]) => {
      const historicalSource = goalTrackerData.leadSourceRates.find((s) => s.source === source);
      const historicalTotal = goalTrackerData.leadSourceRates.reduce((s, r) => s + r.dealsCreated, 0);
      const requiredTotal = historicalSource && historicalTotal > 0
        ? Math.ceil(leadsNeeded * (historicalSource.dealsCreated / historicalTotal))
        : 0;

      const expectedByNow = Math.ceil(requiredTotal * fractionElapsed);
      let paceStatus: 'ahead' | 'on_pace' | 'behind' = 'on_pace';
      if (data.total > expectedByNow * 1.1) paceStatus = 'ahead';
      else if (data.total < expectedByNow * 0.9) paceStatus = 'behind';

      return {
        source,
        totalCreated: data.total,
        weeklyBreakdown: data.weekly,
        requiredTotal,
        paceStatus,
      };
    });

  // Suppress unused var warning — kept for future per-week expected math.
  void weeksElapsedFractional;

  return {
    weeklyRows,
    sourceBreakdown,
    totalLeadsCreated: totalCreated,
    totalLeadsRequired: leadsNeeded,
    totalDealsCreated: totalCreated,
    totalDealsRequired: dealsNeeded,
    teamTarget,
    teamForecastWeighted,
    gap,
  };
}
