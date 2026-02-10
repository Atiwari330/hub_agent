/**
 * Portal SPIFF API Endpoint
 *
 * GET /api/portal/spiff
 * Returns all SPIFF metrics for the logged-in AE.
 */

import { NextResponse } from 'next/server';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth/types';
import { createServiceClient } from '@/lib/supabase/client';
import {
  fetchFilteredCallsByOwner,
  DASHBOARD_AE_EMAILS,
  type ContactFilterOptions,
} from '@/lib/hubspot/calls';
import { fetchProspectCountByOwner } from '@/lib/hubspot/contacts';
import { getStageNameMap } from '@/lib/hubspot/pipelines';
import { SALES_PIPELINE_ID } from '@/lib/hubspot/stage-mappings';
import { CALL_TIERS, getCallTier } from '@/lib/scorecard/daily-scorecard';
import { DEMO_TIERS, getDemoTier } from '@/lib/scorecard/weekly-scorecard';
import { PROSPECT_TIERS, getProspectTier } from '@/lib/scorecard/prospect-tiers';
import { calculateDealRisk } from '@/lib/utils/deal-risk';
import { getCurrentQuarter, getQuarterInfo, getQuarterProgress } from '@/lib/utils/quarter';

const HUBSPOT_PORTAL_ID = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || '7358632';

/**
 * Get start and end of a day in ET (America/New_York)
 */
function getDayBoundsET(date: Date): { start: Date; end: Date } {
  const dateStr = date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const start = new Date(`${dateStr}T00:00:00-05:00`);
  const end = new Date(`${dateStr}T23:59:59.999-05:00`);
  return { start, end };
}

/**
 * Get Monday of the current week (ET-aware)
 */
function getCurrentWeekMonday(): Date {
  const now = new Date();
  const etDateStr = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const etDate = new Date(etDateStr + 'T12:00:00-05:00');
  const dayOfWeek = etDate.getDay(); // 0=Sun, 1=Mon...6=Sat
  const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(etDate);
  monday.setDate(monday.getDate() - daysToSubtract);
  return monday;
}

/**
 * Get the last N business days ending with today (or most recent business day)
 */
function getRecentBusinessDays(count: number): Date[] {
  const now = new Date();
  const etDateStr = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const etDate = new Date(etDateStr + 'T12:00:00-05:00');

  const days: Date[] = [];
  const d = new Date(etDate);

  while (days.length < count) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      days.unshift(new Date(d));
    }
    d.setDate(d.getDate() - 1);
  }

  return days;
}

/**
 * Get start of current month in ET
 */
function getCurrentMonthBoundsET(): { start: Date; end: Date } {
  const now = new Date();
  const etDateStr = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const [year, month] = etDateStr.split('-').map(Number);
  const start = new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00-05:00`);
  const end = new Date(`${etDateStr}T23:59:59.999-05:00`);
  return { start, end };
}

export async function GET() {
  const authResult = await checkApiAuth(RESOURCES.PORTAL);
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  if (!user.hubspotOwnerId) {
    return NextResponse.json(
      { error: 'No HubSpot owner linked to this account' },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const hubspotOwnerId = user.hubspotOwnerId;

  // Look up the AE's owner record for name
  const { data: ownerRecord } = await supabase
    .from('owners')
    .select('first_name, last_name, email, hubspot_owner_id')
    .eq('hubspot_owner_id', hubspotOwnerId)
    .single();

  const aeName = ownerRecord
    ? [ownerRecord.first_name, ownerRecord.last_name].filter(Boolean).join(' ')
    : user.displayName || user.email;

  // Get date ranges
  const today = new Date();
  const { start: todayStart, end: todayEnd } = getDayBoundsET(today);
  const weekMonday = getCurrentWeekMonday();
  const weekMondayStr = weekMonday.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const todayStr = today.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const { start: monthStart, end: monthEnd } = getCurrentMonthBoundsET();

  // Quarter info
  const currentQ = getCurrentQuarter();
  const quarterInfo = getQuarterInfo(currentQ.year, currentQ.quarter);
  const progress = getQuarterProgress(quarterInfo);

  // Resolve valid contact owner IDs for call filtering (the 5 dashboard AEs)
  const { data: dashboardOwners } = await supabase
    .from('owners')
    .select('hubspot_owner_id')
    .in('email', DASHBOARD_AE_EMAILS);

  const contactFilter: ContactFilterOptions = {
    requirePhone: true,
    validOwnerIds: new Set(
      (dashboardOwners || []).map((o) => o.hubspot_owner_id)
    ),
  };

  // Fetch all data in parallel
  const recentBusinessDays = getRecentBusinessDays(5);

  const [
    todayCalls,
    weekDemosResult,
    prospectCount,
    weekDailyCallResults,
    quotaResult,
    dealsResult,
    stageNames,
  ] = await Promise.all([
    // Today's calls from HubSpot (filtered to match dashboard)
    fetchFilteredCallsByOwner(hubspotOwnerId, todayStart, todayEnd, contactFilter),

    // This week's demos from Supabase
    supabase
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .eq('hubspot_owner_id', hubspotOwnerId)
      .eq('pipeline', SALES_PIPELINE_ID)
      .gte('demo_completed_entered_at', `${weekMondayStr}T00:00:00`)
      .lte('demo_completed_entered_at', `${todayStr}T23:59:59.999`),

    // This month's prospects from HubSpot
    fetchProspectCountByOwner(hubspotOwnerId, monthStart, monthEnd),

    // Calls per day for last 5 business days (for sparkline, filtered)
    Promise.all(
      recentBusinessDays.map(async (day) => {
        const { start, end } = getDayBoundsET(day);
        const calls = await fetchFilteredCallsByOwner(hubspotOwnerId, start, end, contactFilter);
        return calls.length;
      })
    ),

    // Quota for current quarter
    supabase
      .from('quotas')
      .select('quota_amount')
      .eq('hubspot_owner_id', hubspotOwnerId)
      .eq('fiscal_year', currentQ.year)
      .eq('fiscal_quarter', currentQ.quarter)
      .single(),

    // All deals for pipeline and alerts
    supabase
      .from('deals')
      .select('*')
      .eq('hubspot_owner_id', hubspotOwnerId)
      .eq('pipeline', SALES_PIPELINE_ID),

    // Stage names
    getStageNameMap().catch(() => new Map<string, string>()),
  ]);

  // Process calls
  const todayCallCount = todayCalls.length;
  const callTier = getCallTier(todayCallCount);

  // Process demos
  const weeklyDemos = weekDemosResult.count ?? 0;
  const demoTier = getDemoTier(weeklyDemos);

  // Process prospects
  const prospectTier = getProspectTier(prospectCount);

  // Process quota
  const quotaAmount = quotaResult.data?.quota_amount || 0;
  const deals = dealsResult.data || [];

  // Classify deals
  const CLOSED_WON_PATTERNS = ['closedwon', 'closed won', 'closed-won'];
  const CLOSED_LOST_PATTERNS = ['closedlost', 'closed lost', 'closed-lost'];
  const EXCLUDED_FROM_PIPELINE = ['mql', 'disqualified', 'qualified'];

  const isClosedWon = (stageId: string | null): boolean => {
    if (!stageId) return false;
    const name = stageNames.get(stageId) || stageId;
    return CLOSED_WON_PATTERNS.some((p) => name.toLowerCase().includes(p));
  };

  const isClosedLost = (stageId: string | null): boolean => {
    if (!stageId) return false;
    const name = stageNames.get(stageId) || stageId;
    return CLOSED_LOST_PATTERNS.some((p) => name.toLowerCase().includes(p));
  };

  const isInQuarter = (dateStr: string | null): boolean => {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    return date >= quarterInfo.startDate && date <= quarterInfo.endDate;
  };

  const isInPipeline = (stageId: string | null, closeDate: string | null): boolean => {
    if (!stageId) return false;
    if (isClosedWon(stageId) || isClosedLost(stageId)) return false;
    const name = stageNames.get(stageId) || stageId;
    if (EXCLUDED_FROM_PIPELINE.some((p) => name.toLowerCase().includes(p))) return false;
    return isInQuarter(closeDate);
  };

  // Quota attainment
  const closedWonDeals = deals.filter(
    (d) => isClosedWon(d.deal_stage) && isInQuarter(d.close_date)
  );
  const closedWonAmount = closedWonDeals.reduce(
    (sum, d) => sum + (d.amount || 0),
    0
  );
  const attainment = quotaAmount > 0 ? (closedWonAmount / quotaAmount) * 100 : 0;
  const expectedByNow = quotaAmount * (progress.percentComplete / 100);
  const pace = closedWonAmount - expectedByNow;
  const onTrack = pace >= 0;

  // Pipeline metrics
  const pipelineDeals = deals.filter((d) =>
    isInPipeline(d.deal_stage, d.close_date)
  );
  const pipelineValue = pipelineDeals.reduce(
    (sum, d) => sum + (d.amount || 0),
    0
  );
  const remainingQuota = Math.max(0, quotaAmount - closedWonAmount);
  const coverageRatio =
    quotaAmount === 0 ? null
    : remainingQuota > 0 ? Math.round((pipelineValue / remainingQuota) * 10) / 10
    : pipelineValue > 0 ? null
    : 0;

  // Alerts: deals needing attention (at_risk or stale, or overdue next steps)
  const alertDeals = deals
    .filter((d) => !isClosedWon(d.deal_stage) && !isClosedLost(d.deal_stage))
    .map((d) => {
      const stageName = d.deal_stage ? stageNames.get(d.deal_stage) || d.deal_stage : null;
      const risk = calculateDealRisk({
        stageName,
        closeDate: d.close_date,
        lastActivityDate: d.last_activity_date,
        nextActivityDate: d.next_activity_date,
        nextStep: d.next_step,
        sqlEnteredAt: d.sql_entered_at,
        demoScheduledEnteredAt: d.demo_scheduled_entered_at,
        demoCompletedEnteredAt: d.demo_completed_entered_at,
        hubspotCreatedAt: d.hubspot_created_at,
        nextStepDueDate: d.next_step_due_date,
        nextStepStatus: d.next_step_status,
      });

      return {
        id: d.id,
        hubspotDealId: d.hubspot_deal_id,
        dealName: d.deal_name,
        amount: d.amount,
        stageName,
        risk,
        hubspotUrl: `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${d.hubspot_deal_id}/`,
      };
    })
    .filter((d) => d.risk.level !== 'healthy')
    .sort((a, b) => {
      // Stale first, then at_risk
      if (a.risk.level === 'stale' && b.risk.level !== 'stale') return -1;
      if (a.risk.level !== 'stale' && b.risk.level === 'stale') return 1;
      // Then by amount descending
      return (b.amount || 0) - (a.amount || 0);
    });

  return NextResponse.json({
    ae: {
      name: aeName,
      email: user.email,
    },
    calls: {
      today: todayCallCount,
      dailyGoal: CALL_TIERS.BASELINE,
      tier: callTier,
      weekDaily: weekDailyCallResults,
    },
    demos: {
      thisWeek: weeklyDemos,
      weeklyGoal: DEMO_TIERS.BASELINE,
      tier: demoTier,
    },
    prospects: {
      thisMonth: prospectCount,
      monthlyGoal: PROSPECT_TIERS.BASELINE,
      tier: prospectTier,
    },
    quota: {
      target: quotaAmount,
      closedWon: closedWonAmount,
      attainment: Math.round(attainment * 10) / 10,
      pace: Math.round(pace),
      onTrack,
    },
    pipeline: {
      totalValue: pipelineValue,
      dealCount: pipelineDeals.length,
      coverageRatio,
    },
    alerts: {
      deals: alertDeals.slice(0, 10),
      totalAlerts: alertDeals.length,
    },
  });
}
