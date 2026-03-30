import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { getCurrentQuarter, getQuarterInfo, getQuarterProgress } from '@/lib/utils/quarter';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { computeQuarterStageCounts } from '@/lib/demo-economics/compute';

const INDUSTRY_BENCHMARKS = {
  saasAvg: 0.25,
  smb: 0.32,
  midMarket: 0.25,
  topPerformer: 0.40,
  source: 'Optifai / SaaS Hero 2025–2026 B2B SaaS benchmarks',
};

export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.DEMO_TRACKER);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  const searchParams = request.nextUrl.searchParams;
  const currentQ = getCurrentQuarter();
  const year = parseInt(searchParams.get('year') || String(currentQ.year));
  const quarter = parseInt(searchParams.get('quarter') || String(currentQ.quarter));

  if (quarter < 1 || quarter > 4) {
    return NextResponse.json({ error: 'Quarter must be between 1 and 4' }, { status: 400 });
  }

  try {
    const qi = getQuarterInfo(year, quarter);
    const progress = getQuarterProgress(qi);

    // 1. Revenue target from quotas
    const { data: quotas } = await supabase
      .from('quotas')
      .select('quota_amount')
      .eq('fiscal_year', year)
      .eq('fiscal_quarter', quarter);

    const revenueTarget = (quotas || []).reduce(
      (sum, q) => sum + (q.quota_amount || 0),
      0
    );

    // 2. Stage counts + conversion rates
    const counts = await computeQuarterStageCounts(supabase, year, quarter);

    // 3. Backward math
    const avgDeal = counts.avgDealSize || 17332; // fallback to Q1 actual
    const closeRate = counts.closeRate || 0.375;
    const schedToComp = counts.scheduledToCompletedRate || 0.69;

    const dealsNeededToClose = revenueTarget > 0 ? Math.ceil(revenueTarget / avgDeal) : 0;
    const demosCompletedNeeded =
      closeRate > 0 ? Math.ceil(dealsNeededToClose / closeRate) : 0;
    const demosScheduledNeeded =
      schedToComp > 0 ? Math.ceil(demosCompletedNeeded / schedToComp) : 0;

    // 4. Weekly pace — try snapshots first, fall back to computing from deals
    const { data: snapshots } = await supabase
      .from('demo_tracker_snapshots')
      .select('week_number, week_start, week_end, demos_scheduled, demos_completed')
      .eq('fiscal_year', year)
      .eq('fiscal_quarter', quarter)
      .is('owner_id', null)
      .order('week_number', { ascending: true });

    const now = new Date();
    let weeks: Array<{
      weekNumber: number;
      weekStart: string;
      weekEnd: string;
      demosScheduled: number;
      demosCompleted: number;
      isCurrent: boolean;
      isFuture: boolean;
    }>;

    if (snapshots && snapshots.length > 0) {
      weeks = snapshots.map((s) => {
        const weekStart = new Date(s.week_start + 'T00:00:00');
        const weekEnd = new Date(s.week_end + 'T23:59:59');
        return {
          weekNumber: s.week_number,
          weekStart: s.week_start,
          weekEnd: s.week_end,
          demosScheduled: s.demos_scheduled,
          demosCompleted: s.demos_completed,
          isCurrent: now >= weekStart && now <= weekEnd,
          isFuture: weekStart > now,
        };
      });
    } else {
      // Compute weekly data from deals table directly
      const { data: allDeals } = await supabase
        .from('deals')
        .select('demo_scheduled_entered_at, demo_completed_entered_at, deal_stage');

      // Build 13 week buckets
      const weekBuckets: Array<{ weekNumber: number; weekStart: Date; weekEnd: Date; sched: number; comp: number }> = [];
      const bucketStart = new Date(qi.startDate);
      for (let w = 1; w <= 13; w++) {
        const ws = new Date(bucketStart);
        const we = new Date(ws);
        we.setDate(we.getDate() + 6);
        weekBuckets.push({ weekNumber: w, weekStart: ws, weekEnd: we, sched: 0, comp: 0 });
        bucketStart.setDate(bucketStart.getDate() + 7);
      }

      for (const deal of allDeals || []) {
        if (deal.demo_scheduled_entered_at) {
          const dt = new Date(deal.demo_scheduled_entered_at);
          if (dt >= qi.startDate && dt <= qi.endDate) {
            const diffMs = dt.getTime() - qi.startDate.getTime();
            const weekIdx = Math.min(Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)), 12);
            weekBuckets[weekIdx].sched++;
          }
        }
        if (deal.demo_completed_entered_at) {
          const dt = new Date(deal.demo_completed_entered_at);
          if (dt >= qi.startDate && dt <= qi.endDate) {
            const diffMs = dt.getTime() - qi.startDate.getTime();
            const weekIdx = Math.min(Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)), 12);
            weekBuckets[weekIdx].comp++;
          }
        }
      }

      const formatDate = (d: Date) => d.toISOString().split('T')[0];
      weeks = weekBuckets.map((b) => ({
        weekNumber: b.weekNumber,
        weekStart: formatDate(b.weekStart),
        weekEnd: formatDate(b.weekEnd),
        demosScheduled: b.sched,
        demosCompleted: b.comp,
        isCurrent: now >= b.weekStart && now <= b.weekEnd,
        isFuture: b.weekStart > now,
      }));
    }

    const totalWeeks = 13;
    const requiredPerWeek =
      demosScheduledNeeded > 0 ? demosScheduledNeeded / totalWeeks : 0;

    const currentWeekNum = weeks.find((w) => w.isCurrent)?.weekNumber || Math.ceil(progress.daysElapsed / 7);
    const cumulativeScheduled = weeks
      .filter((w) => !w.isFuture)
      .reduce((sum, w) => sum + w.demosScheduled, 0);
    const cumulativeNeededByNow = Math.round(requiredPerWeek * Math.min(currentWeekNum, totalWeeks));

    return NextResponse.json({
      quarter: {
        year,
        quarter,
        label: qi.label,
        startDate: qi.startDate.toISOString(),
        endDate: qi.endDate.toISOString(),
      },
      progress: {
        daysElapsed: progress.daysElapsed,
        totalDays: progress.totalDays,
        percentComplete: progress.percentComplete,
        currentWeek: Math.ceil(currentWeekNum),
        totalWeeks,
      },
      target: {
        revenueTarget,
        closedWon: counts.closedWonRevenue,
        closedWonCount: counts.closedWon,
        attainmentPct: revenueTarget > 0 ? (counts.closedWonRevenue / revenueTarget) * 100 : 0,
      },
      economics: {
        avgDealSize: avgDeal,
        closeRate,
        scheduledToCompletedRate: schedToComp,
        dealsNeededToClose,
        demosCompletedNeeded,
        demosScheduledNeeded,
      },
      actuals: {
        demosScheduled: counts.demosScheduled,
        demosCompleted: counts.demosCompleted,
        closedWon: counts.closedWon,
      },
      weeklyPace: {
        requiredPerWeek,
        weeks,
        cumulativeScheduled,
        cumulativeNeededByNow,
      },
      funnel: {
        demoScheduled: counts.demosScheduled,
        demoCompleted: counts.demosCompleted,
        closedWon: counts.closedWon,
        closedWonRevenue: counts.closedWonRevenue,
        scheduledToCompletedPct: counts.scheduledToCompletedRate * 100,
        completedToWonPct: counts.closeRate * 100,
      },
      benchmarks: INDUSTRY_BENCHMARKS,
    });
  } catch (err) {
    console.error('Demo economics API error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
