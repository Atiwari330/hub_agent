import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { getCurrentQuarter, getQuarterInfo } from '@/lib/utils/quarter';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { getWeekNumberInQuarter, buildWeekBuckets } from '@/lib/hot-tracker/compute';

// Same AE filter as the main hot tracker
const HOT_TRACKER_AE_EMAILS = SYNC_CONFIG.TARGET_AE_EMAILS.filter(
  (e) => e !== 'atiwari@opusbehavioral.com'
);

// Per-AE weekly goal defaults (placeholders — tune after seeing real data)
const STAGE_GOALS = {
  mql: 5,
  sqlDiscovery: 3,
  demoScheduled: 3,
  demoCompleted: 2,
};

// DB column → stage key mapping
const STAGE_COLUMNS = [
  { key: 'mql', column: 'mql_entered_at' },
  { key: 'sqlDiscovery', column: 'discovery_entered_at' },
  { key: 'demoScheduled', column: 'demo_scheduled_entered_at' },
  { key: 'demoCompleted', column: 'demo_completed_entered_at' },
] as const;

export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.HOT_TRACKER);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  const searchParams = request.nextUrl.searchParams;
  const currentQ = getCurrentQuarter();
  const year = parseInt(searchParams.get('year') || String(currentQ.year));
  const quarter = parseInt(searchParams.get('quarter') || String(currentQ.quarter));

  if (quarter < 1 || quarter > 4) {
    return NextResponse.json({ error: 'Quarter must be between 1 and 4' }, { status: 400 });
  }

  const qi = getQuarterInfo(year, quarter);

  // Resolve allowed owner IDs
  const { data: allowedOwners } = await supabase
    .from('owners')
    .select('id, first_name, last_name')
    .in('email', [...HOT_TRACKER_AE_EMAILS]);

  const ownerNameMap = new Map(
    (allowedOwners || []).map((o) => [o.id as string, `${o.first_name || ''} ${o.last_name || ''}`.trim()])
  );
  const allowedOwnerIds = new Set(ownerNameMap.keys());

  // Build week buckets for the quarter
  const weekBuckets = buildWeekBuckets(qi.startDate, qi.endDate);

  // Fetch all sales pipeline deals that have any of the 4 stage timestamps in the quarter
  // We query broadly and filter in JS for simplicity (avoids 4 separate queries)
  const { data: deals, error } = await supabase
    .from('deals')
    .select('owner_id, mql_entered_at, discovery_entered_at, demo_scheduled_entered_at, demo_completed_entered_at')
    .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Initialize week data structure
  type StageKey = 'mql' | 'sqlDiscovery' | 'demoScheduled' | 'demoCompleted';
  type StageCounts = Record<StageKey, number>;

  const weekData = new Map<number, {
    weekNumber: number;
    weekStart: string;
    weekEnd: string;
    team: StageCounts;
    byAE: Map<string, StageCounts>;
  }>();

  for (const wb of weekBuckets) {
    const aeCounts = new Map<string, StageCounts>();
    for (const ownerId of allowedOwnerIds) {
      aeCounts.set(ownerId, { mql: 0, sqlDiscovery: 0, demoScheduled: 0, demoCompleted: 0 });
    }
    weekData.set(wb.weekNumber, {
      ...wb,
      team: { mql: 0, sqlDiscovery: 0, demoScheduled: 0, demoCompleted: 0 },
      byAE: aeCounts,
    });
  }

  // Bucket each deal's stage entries into weeks
  const qStart = qi.startDate;
  const qEnd = qi.endDate;

  for (const deal of deals || []) {
    const ownerId = deal.owner_id;
    if (!ownerId || !allowedOwnerIds.has(ownerId)) continue;

    for (const { key, column } of STAGE_COLUMNS) {
      const timestamp = deal[column];
      if (!timestamp) continue;

      const date = new Date(timestamp);
      if (date < qStart || date > qEnd) continue;

      const weekNum = getWeekNumberInQuarter(date, qStart);
      const week = weekData.get(weekNum);
      if (!week) continue;

      week.team[key]++;
      const aeCounts = week.byAE.get(ownerId);
      if (aeCounts) aeCounts[key]++;
    }
  }

  // Build response
  const weeks = Array.from(weekData.values())
    .sort((a, b) => a.weekNumber - b.weekNumber)
    .map((w) => ({
      weekNumber: w.weekNumber,
      weekStart: w.weekStart,
      weekEnd: w.weekEnd,
      team: w.team,
      byAE: Array.from(w.byAE.entries()).map(([ownerId, counts]) => ({
        ownerId,
        ownerName: ownerNameMap.get(ownerId) || 'Unknown',
        ...counts,
      })),
    }));

  return NextResponse.json({ weeks, goals: STAGE_GOALS });
}
