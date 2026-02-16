import { redirect } from 'next/navigation';
import { requirePermission, RESOURCES } from '@/lib/auth';
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
import { checkDealHygiene, checkDealStaleness } from '@/lib/utils/queue-detection';
import { isDateInPast, getDaysUntil } from '@/lib/utils/business-days';
import { PortalHeader } from '@/components/portal/portal-header';
import { SpiffRings } from '@/components/portal/spiff-rings';
import {
  ActionItemsCard,
  type HygieneDeal,
  type StalledDeal,
  type CloseDateDeal,
} from '@/components/portal/action-items-card';
import { PplSequenceCard } from '@/components/portal/ppl-sequence-card';

function getDayBoundsET(date: Date): { start: Date; end: Date } {
  const dateStr = date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const start = new Date(`${dateStr}T00:00:00-05:00`);
  const end = new Date(`${dateStr}T23:59:59.999-05:00`);
  return { start, end };
}

function getCurrentWeekMonday(): Date {
  const now = new Date();
  const etDateStr = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const etDate = new Date(etDateStr + 'T12:00:00-05:00');
  const dayOfWeek = etDate.getDay();
  const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(etDate);
  monday.setDate(monday.getDate() - daysToSubtract);
  return monday;
}

function getCurrentMonthBoundsET(): { start: Date; end: Date } {
  const now = new Date();
  const etDateStr = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const [year, month] = etDateStr.split('-').map(Number);
  const start = new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00-05:00`);
  const end = new Date(`${etDateStr}T23:59:59.999-05:00`);
  return { start, end };
}

export default async function PortalPage() {
  const user = await requirePermission(RESOURCES.PORTAL);

  if (!user.hubspotOwnerId) {
    redirect('/unauthorized');
  }

  const supabase = createServiceClient();
  const hubspotOwnerId = user.hubspotOwnerId;

  // Look up AE's owner record
  const { data: ownerRecord } = await supabase
    .from('owners')
    .select('first_name, last_name, email, hubspot_owner_id')
    .eq('hubspot_owner_id', hubspotOwnerId)
    .single();

  const aeName = ownerRecord
    ? [ownerRecord.first_name, ownerRecord.last_name].filter(Boolean).join(' ')
    : user.displayName || user.email;

  // Date ranges
  const today = new Date();
  const { start: todayStart, end: todayEnd } = getDayBoundsET(today);
  const weekMonday = getCurrentWeekMonday();
  const weekMondayStr = weekMonday.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const todayStr = today.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const { start: monthStart, end: monthEnd } = getCurrentMonthBoundsET();

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
  const [
    todayCalls,
    weekDemosResult,
    prospectCount,
    dealsResult,
    stageNames,
  ] = await Promise.all([
    fetchFilteredCallsByOwner(hubspotOwnerId, todayStart, todayEnd, contactFilter),
    supabase
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .eq('hubspot_owner_id', hubspotOwnerId)
      .eq('pipeline', SALES_PIPELINE_ID)
      .gte('demo_completed_entered_at', `${weekMondayStr}T00:00:00`)
      .lte('demo_completed_entered_at', `${todayStr}T23:59:59.999`),
    fetchProspectCountByOwner(hubspotOwnerId, monthStart, monthEnd),
    supabase
      .from('deals')
      .select('*')
      .eq('hubspot_owner_id', hubspotOwnerId)
      .eq('pipeline', SALES_PIPELINE_ID),
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

  const deals = dealsResult.data || [];

  // Stage classification helpers
  const CLOSED_WON_PATTERNS = ['closedwon', 'closed won', 'closed-won'];
  const CLOSED_LOST_PATTERNS = ['closedlost', 'closed lost', 'closed-lost'];
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

  const LATE_STAGE_PATTERNS = ['demo', 'proposal', 'negotiation', 'contract', 'legal', 'procurement'];

  const isLateStage = (stageName: string | null): boolean => {
    if (!stageName) return false;
    const lower = stageName.toLowerCase();
    return LATE_STAGE_PATTERNS.some((p) => lower.includes(p));
  };

  const resolveStageName = (stageId: string | null): string | null => {
    if (!stageId) return null;
    return stageNames.get(stageId) || null;
  };

  // Action Items — categorize active deals by issue type
  const activeDeals = deals.filter(
    (d) => !isClosedWon(d.deal_stage) && !isClosedLost(d.deal_stage)
  );

  const hygieneDeals: HygieneDeal[] = [];
  const stalledDeals: StalledDeal[] = [];
  const closeDateDeals: CloseDateDeal[] = [];
  const uniqueDealIds = new Set<string>();

  for (const d of activeDeals) {
    const dealStageName = resolveStageName(d.deal_stage);
    const dealIsHighPriority = isLateStage(dealStageName);
    const base = {
      id: d.id,
      hubspotDealId: d.hubspot_deal_id,
      dealName: d.deal_name,
      amount: d.amount,
    };

    // 1. Hygiene check
    const hygieneResult = checkDealHygiene({
      id: d.id,
      hubspot_created_at: d.hubspot_created_at,
      deal_substage: d.deal_substage,
      close_date: d.close_date,
      amount: d.amount,
      lead_source: d.lead_source,
      products: d.products,
      deal_collaborator: d.deal_collaborator ?? null,
    });
    if (!hygieneResult.isCompliant) {
      hygieneDeals.push({ ...base, missingFields: hygieneResult.missingFields, stageName: dealStageName, isHighPriority: dealIsHighPriority });
      uniqueDealIds.add(d.id);
    }

    // 2. Staleness check
    const stalenessResult = checkDealStaleness({
      last_activity_date: d.last_activity_date,
      next_activity_date: d.next_activity_date,
      hubspot_created_at: d.hubspot_created_at,
      close_date: d.close_date,
      next_step: d.next_step,
      next_step_due_date: d.next_step_due_date,
      next_step_status: d.next_step_status,
      amount: d.amount,
    });
    if (stalenessResult.isStalled && stalenessResult.severity) {
      stalledDeals.push({
        ...base,
        severity: stalenessResult.severity,
        daysSinceActivity: stalenessResult.daysSinceActivity,
        aggravatingFactors: stalenessResult.aggravatingFactors,
      });
      uniqueDealIds.add(d.id);
    }

    // 3. Past close date check
    if (d.close_date && isDateInPast(d.close_date)) {
      const daysOverdue = Math.abs(getDaysUntil(d.close_date));
      closeDateDeals.push({ ...base, closeDate: d.close_date, daysOverdue });
      uniqueDealIds.add(d.id);
    }
  }

  // Sort each category: high-priority first, then existing sort within each group
  hygieneDeals.sort(
    (a, b) =>
      (b.isHighPriority ? 1 : 0) - (a.isHighPriority ? 1 : 0) ||
      b.missingFields.length - a.missingFields.length ||
      (b.amount || 0) - (a.amount || 0)
  );
  const severityOrder = { critical: 0, warning: 1, watch: 2 };
  stalledDeals.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      b.daysSinceActivity - a.daysSinceActivity ||
      (b.amount || 0) - (a.amount || 0)
  );
  closeDateDeals.sort((a, b) => b.daysOverdue - a.daysOverdue || (b.amount || 0) - (a.amount || 0));

  return (
    <div className="space-y-6">
      {/* Header */}
      <PortalHeader name={aeName} />

      {/* SPIFF Rings */}
      <SpiffRings
        calls={{
          today: todayCallCount,
          dailyGoal: CALL_TIERS.BASELINE,
          tier: callTier,
        }}
        demos={{
          thisWeek: weeklyDemos,
          weeklyGoal: DEMO_TIERS.BASELINE,
          tier: demoTier,
        }}
        prospects={{
          thisMonth: prospectCount,
          monthlyGoal: PROSPECT_TIERS.BASELINE,
          tier: prospectTier,
        }}
      />

      {/* Action Items */}
      <ActionItemsCard
        hygiene={hygieneDeals}
        stalled={stalledDeals}
        closeDate={closeDateDeals}
        totalUniqueDeals={uniqueDealIds.size}
      />

      {/* PPL Sequence Compliance */}
      <PplSequenceCard />
    </div>
  );
}
