import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { getCurrentQuarter, getQuarterInfo } from '@/lib/utils/quarter';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { paginatedFetch } from '@/lib/supabase/paginate';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { getWeekNumberInQuarter, buildWeekBuckets, getWeekStart, formatDateUTC } from '@/lib/hot-tracker/compute';

// Same AE filter as the main hot tracker
const HOT_TRACKER_AE_EMAILS = SYNC_CONFIG.TARGET_AE_EMAILS.filter(
  (e) => e !== 'atiwari@opusbehavioral.com'
);

// Per-AE weekly goal defaults (placeholders — tune after seeing real data)
const STAGE_GOALS = {
  mqlSql: 5,
  demoScheduled: 3,
  demoCompleted: 2,
  speedToDemo: 5,        // ≤5 days is green
  demoToProposal: 0.5,   // 50% conversion goal
};

// DB column → stage key mapping
// MQL and SQL/Discovery are combined into one "mqlSql" bucket
const STAGE_COLUMNS = [
  { key: 'mqlSql', column: 'mql_entered_at' },
  { key: 'mqlSql', column: 'discovery_entered_at' },
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

  // Fetch all sales pipeline deals with relevant columns
  // Paginate — Supabase server caps at 1,000 rows regardless of .limit()
  let deals;
  try {
    deals = await paginatedFetch(() =>
      supabase
        .from('deals')
        .select('owner_id, hubspot_created_at, mql_entered_at, discovery_entered_at, demo_scheduled_entered_at, demo_completed_entered_at, proposal_entered_at')
        .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID),
    );
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // ─── Stage Counts (existing) ───
  type StageKey = 'mqlSql' | 'demoScheduled' | 'demoCompleted';
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
      aeCounts.set(ownerId, { mqlSql: 0, demoScheduled: 0, demoCompleted: 0 });
    }
    weekData.set(wb.weekNumber, {
      ...wb,
      team: { mqlSql: 0, demoScheduled: 0, demoCompleted: 0 },
      byAE: aeCounts,
    });
  }

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

  // ─── Metric A: Speed to Demo (days from MQL/created → Demo Scheduled) ───
  interface SpeedData { totalDays: number; dealCount: number }
  const speedByWeek = new Map<number, { team: SpeedData; byAE: Map<string, SpeedData> }>();

  for (const wb of weekBuckets) {
    const aeSpeed = new Map<string, SpeedData>();
    for (const ownerId of allowedOwnerIds) {
      aeSpeed.set(ownerId, { totalDays: 0, dealCount: 0 });
    }
    speedByWeek.set(wb.weekNumber, { team: { totalDays: 0, dealCount: 0 }, byAE: aeSpeed });
  }

  for (const deal of deals || []) {
    const ownerId = deal.owner_id;
    if (!ownerId || !allowedOwnerIds.has(ownerId)) continue;
    if (!deal.demo_scheduled_entered_at) continue;

    const demoDate = new Date(deal.demo_scheduled_entered_at);
    if (demoDate < qStart || demoDate > qEnd) continue;

    // Start date: mql_entered_at, fallback to hubspot_created_at
    const startDateStr = deal.mql_entered_at || deal.hubspot_created_at;
    if (!startDateStr) continue;

    const startDate = new Date(startDateStr);
    const days = Math.max(0, (demoDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    const weekNum = getWeekNumberInQuarter(demoDate, qStart);
    const sw = speedByWeek.get(weekNum);
    if (!sw) continue;

    sw.team.totalDays += days;
    sw.team.dealCount++;
    const aeData = sw.byAE.get(ownerId);
    if (aeData) {
      aeData.totalDays += days;
      aeData.dealCount++;
    }
  }

  // ─── Metric C: Demo → Proposal Conversion (14-day window) ───
  interface ConversionData { converted: number; total: number }
  const convByWeek = new Map<number, { team: ConversionData; byAE: Map<string, ConversionData> }>();

  for (const wb of weekBuckets) {
    const aeConv = new Map<string, ConversionData>();
    for (const ownerId of allowedOwnerIds) {
      aeConv.set(ownerId, { converted: 0, total: 0 });
    }
    convByWeek.set(wb.weekNumber, { team: { converted: 0, total: 0 }, byAE: aeConv });
  }

  const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

  for (const deal of deals || []) {
    const ownerId = deal.owner_id;
    if (!ownerId || !allowedOwnerIds.has(ownerId)) continue;
    if (!deal.demo_completed_entered_at) continue;

    const demoCompDate = new Date(deal.demo_completed_entered_at);
    if (demoCompDate < qStart || demoCompDate > qEnd) continue;

    const weekNum = getWeekNumberInQuarter(demoCompDate, qStart);
    const cw = convByWeek.get(weekNum);
    if (!cw) continue;

    cw.team.total++;
    const aeData = cw.byAE.get(ownerId);
    if (aeData) aeData.total++;

    // Check if converted to proposal within 14 days
    if (deal.proposal_entered_at) {
      const proposalDate = new Date(deal.proposal_entered_at);
      if (proposalDate.getTime() - demoCompDate.getTime() <= FOURTEEN_DAYS_MS) {
        cw.team.converted++;
        if (aeData) aeData.converted++;
      }
    }
  }

  // Determine in-progress weeks (14-day window hasn't elapsed)
  const now = new Date();
  const weekAlignedStart = getWeekStart(qStart);

  // ─── Build response ───
  const weeks = Array.from(weekData.values())
    .sort((a, b) => a.weekNumber - b.weekNumber)
    .map((w) => {
      const sw = speedByWeek.get(w.weekNumber);
      const cw = convByWeek.get(w.weekNumber);

      // Compute week end date for in-progress check
      const wStart = new Date(weekAlignedStart);
      wStart.setUTCDate(wStart.getUTCDate() + (w.weekNumber - 1) * 7);
      const wEnd = new Date(wStart);
      wEnd.setUTCDate(wEnd.getUTCDate() + 6);
      const inProgress = now.getTime() - wEnd.getTime() < FOURTEEN_DAYS_MS;

      return {
        weekNumber: w.weekNumber,
        weekStart: w.weekStart,
        weekEnd: w.weekEnd,
        team: w.team,
        byAE: Array.from(w.byAE.entries()).map(([ownerId, counts]) => {
          const aeSpeed = sw?.byAE.get(ownerId);
          const aeConv = cw?.byAE.get(ownerId);
          return {
            ownerId,
            ownerName: ownerNameMap.get(ownerId) || 'Unknown',
            ...counts,
            speedToDemo: {
              avgDays: aeSpeed && aeSpeed.dealCount > 0 ? aeSpeed.totalDays / aeSpeed.dealCount : 0,
              dealCount: aeSpeed?.dealCount || 0,
            },
            demoToProposal: {
              converted: aeConv?.converted || 0,
              total: aeConv?.total || 0,
              pct: aeConv && aeConv.total > 0 ? aeConv.converted / aeConv.total : 0,
              inProgress,
            },
          };
        }),
        speedToDemo: {
          avgDays: sw && sw.team.dealCount > 0 ? sw.team.totalDays / sw.team.dealCount : 0,
          dealCount: sw?.team.dealCount || 0,
        },
        demoToProposal: {
          converted: cw?.team.converted || 0,
          total: cw?.team.total || 0,
          pct: cw && cw.team.total > 0 ? cw.team.converted / cw.team.total : 0,
          inProgress,
        },
      };
    });

  return NextResponse.json({ weeks, goals: STAGE_GOALS });
}
