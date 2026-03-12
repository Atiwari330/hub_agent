import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { getQuarterInfo, getCurrentQuarter } from '@/lib/utils/quarter';
import { getWeekStart, getWeekNumberInQuarter, formatDateUTC } from '@/lib/hot-tracker/compute';
import { batchFetchDealEngagements } from '@/lib/hubspot/batch-engagements';
import { countTouchesInRange, countUniqueTouchDays, countCompliantCallDays } from '@/lib/utils/touch-counter';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

const HUBSPOT_PORTAL_ID = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || '7358632';

export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.HOT_TRACKER);
  if (authResult instanceof NextResponse) return authResult;

  const params = request.nextUrl.searchParams;
  const currentQ = getCurrentQuarter();
  const year = parseInt(params.get('year') || String(currentQ.year));
  const quarter = parseInt(params.get('quarter') || String(currentQ.quarter));
  const weekNumber = parseInt(params.get('weekNumber') || '0');
  const ownerId = params.get('ownerId') || undefined;

  if (quarter < 1 || quarter > 4) {
    return NextResponse.json({ error: 'Quarter must be between 1 and 4' }, { status: 400 });
  }
  if (weekNumber < 1 || weekNumber > 14) {
    return NextResponse.json({ error: 'weekNumber must be between 1 and 14' }, { status: 400 });
  }

  const qi = getQuarterInfo(year, quarter);
  const supabase = await createServerSupabaseClient();

  // Build week date range from weekNumber
  const weekAlignedStart = getWeekStart(qi.startDate);
  const targetWeekStart = new Date(weekAlignedStart);
  targetWeekStart.setUTCDate(targetWeekStart.getUTCDate() + (weekNumber - 1) * 7);
  const targetWeekEnd = new Date(targetWeekStart);
  targetWeekEnd.setUTCDate(targetWeekEnd.getUTCDate() + 6);

  // Build week label
  const startLabel = targetWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const endLabel = targetWeekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const weekLabel = `Week ${weekNumber} (${startLabel} – ${endLabel})`;

  // Query PPL deals created during quarter
  let query = supabase
    .from('deals')
    .select('id, hubspot_deal_id, deal_name, hubspot_created_at, owner_id')
    .eq('lead_source', 'Paid Lead')
    .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
    .not('hubspot_created_at', 'is', null)
    .gte('hubspot_created_at', qi.startDate.toISOString())
    .lte('hubspot_created_at', qi.endDate.toISOString());

  if (ownerId) {
    query = query.eq('owner_id', ownerId);
  }

  const { data: pplDeals, error: dbError } = await query;

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  if (!pplDeals || pplDeals.length === 0) {
    return NextResponse.json({ deals: [], weekLabel });
  }

  // Filter to deals whose creation falls in this week number
  const dealsInWeek = pplDeals.filter((d) => {
    const created = new Date(d.hubspot_created_at!);
    return getWeekNumberInQuarter(created, qi.startDate) === weekNumber;
  });

  if (dealsInWeek.length === 0) {
    return NextResponse.json({ deals: [], weekLabel });
  }

  // Fetch owner names
  const ownerIds = [...new Set(dealsInWeek.map((d) => d.owner_id).filter(Boolean))];
  const { data: owners } = await supabase
    .from('owners')
    .select('id, first_name, last_name')
    .in('id', ownerIds.length > 0 ? ownerIds : ['00000000-0000-0000-0000-000000000000']);

  const ownerNameMap = new Map(
    (owners || []).map((o) => [o.id, `${o.first_name || ''} ${o.last_name || ''}`.trim()])
  );

  // Batch-fetch engagements
  const dealIds = dealsInWeek.map((d) => d.hubspot_deal_id);
  const engagements = await batchFetchDealEngagements(dealIds);

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  // Compute per-deal compliance (same logic as Metric 5 in compute.ts)
  const deals = dealsInWeek
    .map((deal) => {
      const createdDate = new Date(deal.hubspot_created_at!);
      createdDate.setUTCHours(0, 0, 0, 0);

      // Must have at least 1 full day elapsed
      if (createdDate >= todayStart) return null;

      const daysElapsed = Math.min(7,
        Math.floor((todayStart.getTime() - createdDate.getTime()) / (24 * 60 * 60 * 1000))
      );
      if (daysElapsed <= 0) return null;

      const week1Start = new Date(createdDate);
      week1Start.setHours(0, 0, 0, 0);
      const week1End = new Date(createdDate);
      week1End.setDate(week1End.getDate() + daysElapsed - 1);
      week1End.setHours(23, 59, 59, 999);

      const dealEngagements = engagements.get(deal.hubspot_deal_id);
      const calls = dealEngagements?.calls || [];
      const emails = dealEngagements?.emails || [];
      const meetingBooked = (dealEngagements?.meetings || []).length > 0;

      const uniqueTouchDays = countUniqueTouchDays(calls, emails, week1Start, week1End);
      const touches = countTouchesInRange(calls, emails, week1Start, week1End);
      const compliance = uniqueTouchDays / daysElapsed;

      // Call compliance (Metric 6)
      const callComplianceResult = countCompliantCallDays(
        calls, week1Start, week1End, daysElapsed, deal.hubspot_created_at!
      );

      // Check if first week is complete
      const week1EndFull = new Date(createdDate);
      week1EndFull.setDate(week1EndFull.getDate() + 7);
      const firstWeekComplete = week1EndFull <= todayStart;

      return {
        dealId: deal.hubspot_deal_id,
        dealName: deal.deal_name,
        ownerName: ownerNameMap.get(deal.owner_id!) || 'Unknown',
        createdAt: deal.hubspot_created_at!,
        daysElapsed,
        uniqueTouchDays,
        totalTouches: touches.total,
        calls: touches.calls,
        emails: touches.emails,
        compliance,
        callCompliance: callComplianceResult.compliance,
        compliantCallDays: callComplianceResult.compliantDays,
        totalCallDays: callComplianceResult.totalDays,
        callsPerDay: callComplianceResult.dailyBreakdown,
        lateCreation: callComplianceResult.lateCreation,
        firstWeekComplete,
        meetingBooked,
        hubspotUrl: `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${deal.hubspot_deal_id}/`,
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .sort((a, b) => {
      // Meeting-booked deals go to the bottom
      if (a.meetingBooked !== b.meetingBooked) return a.meetingBooked ? 1 : -1;
      // Within each group, worst compliance first
      return a.compliance - b.compliance;
    });

  return NextResponse.json({
    deals,
    weekLabel,
    weekStart: formatDateUTC(targetWeekStart),
    weekEnd: formatDateUTC(targetWeekEnd),
  });
}
