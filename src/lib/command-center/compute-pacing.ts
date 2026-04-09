/**
 * Pacing computation for the Command Center.
 *
 * Computes how deal creation by source and by week is tracking
 * relative to what's required to hit the Q2 ARR goal.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getQuarterInfo, getQuarterProgress } from '@/lib/utils/quarter';
import type { PacingData, WeeklyPacingRow, WeeklyDealRef, SourcePacing } from './types';
import type { Q2GoalTrackerApiResponse } from '@/lib/q2-goal-tracker/types';
import { computeLeadsNeeded, computeDemosNeeded, computeDealsNeeded } from '@/lib/q2-goal-tracker/math';

const SALES_PIPELINE_ID = '1c27e5a3-5e5e-4403-ab0f-d356bf268cf3';

export async function computePacingData(
  supabase: SupabaseClient,
  goalTrackerData: Q2GoalTrackerApiResponse,
): Promise<PacingData> {
  const q2 = getQuarterInfo(2026, 2);
  const progress = getQuarterProgress(q2);
  const currentWeek = Math.min(13, Math.ceil(progress.daysElapsed / 7));
  const q2Start = q2.startDate;

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

  // How many deals/demos/leads needed total for Q2
  const dealsNeeded = computeDealsNeeded(teamTarget, rates.avgDealSize);
  const demosNeeded = computeDemosNeeded(dealsNeeded, rates.demoToWonRate);
  const leadsNeeded = computeLeadsNeeded(demosNeeded, rates.createToDemoRate);

  // -- Weekly rows --
  const weeklyRows: WeeklyPacingRow[] = [];
  for (let i = 0; i < 13; i++) {
    const weekStart = new Date(q2Start.getTime() + i * 7 * 86400000);
    const weekEnd = new Date(Math.min(weekStart.getTime() + 7 * 86400000 - 1, q2.endDate.getTime()));

    const weekDeals = deals.filter((d) => {
      if (!d.hubspot_created_at) return false;
      const t = new Date(d.hubspot_created_at).getTime();
      return t >= weekStart.getTime() && t <= weekEnd.getTime();
    });

    const weekDemosScheduled = deals.filter((d) => {
      if (!d.demo_scheduled_entered_at) return false;
      const t = new Date(d.demo_scheduled_entered_at).getTime();
      return t >= weekStart.getTime() && t <= weekEnd.getTime();
    });

    const weekDemos = deals.filter((d) => {
      if (!d.demo_completed_entered_at) return false;
      const t = new Date(d.demo_completed_entered_at).getTime();
      return t >= weekStart.getTime() && t <= weekEnd.getTime();
    });

    // Closed-won deals for this week (from all Q2 deals, not just created-in-Q2)
    const weekClosedWon = deals.filter((d) => {
      if (!d.closed_won_entered_at) return false;
      const t = new Date(d.closed_won_entered_at).getTime();
      return t >= weekStart.getTime() && t <= weekEnd.getTime();
    });

    weeklyRows.push({
      weekNumber: i + 1,
      weekStart: weekStart.toISOString().split('T')[0],
      weekEnd: weekEnd.toISOString().split('T')[0],
      leadsCreated: weekDeals.length,
      demosScheduled: weekDemosScheduled.length,
      dealsToDemo: weekDemos.length,
      closedWonARR: goalTrackerData.weeklyActuals[i]?.closedWonARR || 0,
      closedWonCount: goalTrackerData.weeklyActuals[i]?.closedWonCount || 0,
      leadsCreatedDeals: weekDeals.map(toRef),
      demosScheduledDeals: weekDemosScheduled.map(toRef),
      demoCompletedDeals: weekDemos.map(toRef),
      closedWonDeals: weekClosedWon.map(toRef),
    });
  }

  // -- Source breakdown --
  const sourceMap = new Map<string, { total: number; weekly: number[] }>();
  for (const d of deals) {
    const src = d.lead_source || '(no lead source)';
    if (!sourceMap.has(src)) sourceMap.set(src, { total: 0, weekly: new Array(13).fill(0) });
    const entry = sourceMap.get(src)!;
    entry.total++;

    if (d.hubspot_created_at) {
      const weekIdx = Math.floor((new Date(d.hubspot_created_at).getTime() - q2Start.getTime()) / (7 * 86400000));
      if (weekIdx >= 0 && weekIdx < 13) entry.weekly[weekIdx]++;
    }
  }

  // Calculate required per source using historical source rates
  const totalCreated = deals.length;
  const sourceBreakdown: SourcePacing[] = [...sourceMap.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([source, data]) => {
      // Proportional requirement based on historical source mix
      const historicalSource = goalTrackerData.leadSourceRates.find((s) => s.source === source);
      const requiredTotal = historicalSource
        ? Math.ceil(leadsNeeded * (historicalSource.dealsCreated / goalTrackerData.leadSourceRates.reduce((s, r) => s + r.dealsCreated, 0)))
        : 0;

      const expectedByNow = Math.ceil(requiredTotal * (currentWeek / 13));
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

  return {
    weeklyRows,
    sourceBreakdown,
    totalLeadsCreated: totalCreated,
    totalLeadsRequired: leadsNeeded,
    totalDealsCreated: totalCreated,
    totalDealsRequired: dealsNeeded,
  };
}
