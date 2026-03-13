/**
 * Demo Tracker computation engine.
 *
 * Computes two weekly metrics per AE for a given quarter:
 *   1. # of deals entering "Demo - Scheduled" stage
 *   2. # of deals entering "Demo - Completed" stage
 */

import { createServiceClient } from '@/lib/supabase/client';
import { getQuarterInfo } from '@/lib/utils/quarter';
import { getWeekStart, formatDateUTC, getWeekNumberInQuarter } from '@/lib/hot-tracker/compute';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';

const DEMO_TRACKER_AE_EMAILS = SYNC_CONFIG.TARGET_AE_EMAILS.filter(
  (e) => e !== 'atiwari@opusbehavioral.com'
);

// ── Types ──

export interface DemoWeekMetrics {
  weekNumber: number;
  weekStart: string;
  weekEnd: string;
  demosScheduled: number;
  demosCompleted: number;
}

export interface OwnerDemoWeekMetrics extends DemoWeekMetrics {
  ownerId: string;
  hubspotOwnerId: string;
}

export interface DemoTrackerResult {
  fiscalYear: number;
  fiscalQuarter: number;
  teamWeeks: DemoWeekMetrics[];
  byOwner: Map<string, OwnerDemoWeekMetrics[]>;
}

// ── Week bucket builder (duplicated from hot-tracker since it's not exported) ──

function buildWeekBuckets(quarterStart: Date, quarterEnd: Date): { weekNumber: number; weekStart: string; weekEnd: string }[] {
  const weeks: { weekNumber: number; weekStart: string; weekEnd: string }[] = [];
  let cursor = getWeekStart(quarterStart);
  let weekNum = 1;

  while (cursor.getTime() <= quarterEnd.getTime() && weekNum <= 14) {
    const weekEnd = new Date(cursor);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

    weeks.push({
      weekNumber: weekNum,
      weekStart: formatDateUTC(cursor),
      weekEnd: formatDateUTC(weekEnd),
    });

    cursor = new Date(cursor);
    cursor.setUTCDate(cursor.getUTCDate() + 7);
    weekNum++;
  }

  return weeks;
}

// ── Main computation ──

export async function computeDemoTrackerForQuarter(
  year: number,
  quarter: number
): Promise<DemoTrackerResult> {
  const supabase = createServiceClient();
  const qi = getQuarterInfo(year, quarter);

  // Fetch target AE owners
  const { data: owners } = await supabase
    .from('owners')
    .select('id, hubspot_owner_id, first_name, last_name')
    .in('email', [...DEMO_TRACKER_AE_EMAILS]);

  const ownerList = owners || [];
  const weekSkeletons = buildWeekBuckets(qi.startDate, qi.endDate);

  // ── Metric 1: Demos Scheduled ──
  const scheduledByOwnerWeek = new Map<string, Map<number, number>>();

  const { data: scheduledDeals } = await supabase
    .from('deals')
    .select('owner_id, demo_scheduled_entered_at')
    .not('demo_scheduled_entered_at', 'is', null)
    .gte('demo_scheduled_entered_at', qi.startDate.toISOString())
    .lte('demo_scheduled_entered_at', qi.endDate.toISOString())
    .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID);

  for (const deal of scheduledDeals || []) {
    const ownerId = deal.owner_id;
    if (!ownerId) continue;
    const weekNum = getWeekNumberInQuarter(new Date(deal.demo_scheduled_entered_at!), qi.startDate);
    if (!scheduledByOwnerWeek.has(ownerId)) scheduledByOwnerWeek.set(ownerId, new Map());
    const ownerWeeks = scheduledByOwnerWeek.get(ownerId)!;
    ownerWeeks.set(weekNum, (ownerWeeks.get(weekNum) || 0) + 1);
  }

  // ── Metric 2: Demos Completed ──
  const completedByOwnerWeek = new Map<string, Map<number, number>>();

  const { data: completedDeals } = await supabase
    .from('deals')
    .select('owner_id, demo_completed_entered_at')
    .not('demo_completed_entered_at', 'is', null)
    .gte('demo_completed_entered_at', qi.startDate.toISOString())
    .lte('demo_completed_entered_at', qi.endDate.toISOString())
    .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID);

  for (const deal of completedDeals || []) {
    const ownerId = deal.owner_id;
    if (!ownerId) continue;
    const weekNum = getWeekNumberInQuarter(new Date(deal.demo_completed_entered_at!), qi.startDate);
    if (!completedByOwnerWeek.has(ownerId)) completedByOwnerWeek.set(ownerId, new Map());
    const ownerWeeks = completedByOwnerWeek.get(ownerId)!;
    ownerWeeks.set(weekNum, (ownerWeeks.get(weekNum) || 0) + 1);
  }

  // ── Assemble results ──
  const byOwner = new Map<string, OwnerDemoWeekMetrics[]>();

  for (const owner of ownerList) {
    const ownerWeeks: OwnerDemoWeekMetrics[] = weekSkeletons.map((w) => ({
      ...w,
      ownerId: owner.id,
      hubspotOwnerId: owner.hubspot_owner_id,
      demosScheduled: scheduledByOwnerWeek.get(owner.id)?.get(w.weekNumber) || 0,
      demosCompleted: completedByOwnerWeek.get(owner.id)?.get(w.weekNumber) || 0,
    }));
    byOwner.set(owner.id, ownerWeeks);
  }

  // Team totals
  const teamWeeks: DemoWeekMetrics[] = weekSkeletons.map((w) => {
    let demosScheduled = 0;
    let demosCompleted = 0;
    for (const ownerWeeks of byOwner.values()) {
      const ow = ownerWeeks.find((ow) => ow.weekNumber === w.weekNumber);
      if (ow) {
        demosScheduled += ow.demosScheduled;
        demosCompleted += ow.demosCompleted;
      }
    }
    return { ...w, demosScheduled, demosCompleted };
  });

  return { fiscalYear: year, fiscalQuarter: quarter, teamWeeks, byOwner };
}
