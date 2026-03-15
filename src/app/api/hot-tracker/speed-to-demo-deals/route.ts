import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { getCurrentQuarter, getQuarterInfo } from '@/lib/utils/quarter';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { getWeekStart, formatDateUTC } from '@/lib/hot-tracker/compute';
import { getStageNameMap } from '@/lib/hubspot/pipelines';

export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.HOT_TRACKER);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();
  const searchParams = request.nextUrl.searchParams;
  const currentQ = getCurrentQuarter();
  const year = parseInt(searchParams.get('year') || String(currentQ.year));
  const quarter = parseInt(searchParams.get('quarter') || String(currentQ.quarter));
  const weekNumber = parseInt(searchParams.get('weekNumber') || '1');
  const ownerId = searchParams.get('ownerId') || null;

  const qi = getQuarterInfo(year, quarter);

  // Compute week date range
  const weekAlignedStart = getWeekStart(qi.startDate);
  const weekStartDate = new Date(weekAlignedStart);
  weekStartDate.setUTCDate(weekStartDate.getUTCDate() + (weekNumber - 1) * 7);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);
  weekEndDate.setUTCHours(23, 59, 59, 999);

  let query = supabase
    .from('deals')
    .select('hubspot_deal_id, deal_name, amount, deal_stage, owner_id, mql_entered_at, hubspot_created_at, demo_scheduled_entered_at')
    .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
    .gte('demo_scheduled_entered_at', weekStartDate.toISOString())
    .lte('demo_scheduled_entered_at', weekEndDate.toISOString());

  if (ownerId) query = query.eq('owner_id', ownerId);

  const { data: deals, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fetch owner names
  const ownerIds = [...new Set((deals || []).filter((d) => d.owner_id).map((d) => d.owner_id!))];
  const { data: owners } = await supabase
    .from('owners')
    .select('id, first_name, last_name')
    .in('id', ownerIds.length > 0 ? ownerIds : ['00000000-0000-0000-0000-000000000000']);

  const ownerNameMap = new Map(
    (owners || []).map((o) => [o.id, `${o.first_name || ''} ${o.last_name || ''}`.trim()])
  );

  let stageNameMap: Map<string, string>;
  try { stageNameMap = await getStageNameMap(); } catch { stageNameMap = new Map(); }

  const result = (deals || []).map((deal) => {
    const startDateStr = deal.mql_entered_at || deal.hubspot_created_at;
    const startDate = startDateStr ? new Date(startDateStr) : null;
    const demoDate = new Date(deal.demo_scheduled_entered_at!);
    const daysBetween = startDate
      ? Math.max(0, Math.round((demoDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24) * 10) / 10)
      : null;

    return {
      dealId: deal.hubspot_deal_id,
      dealName: deal.deal_name,
      ownerName: ownerNameMap.get(deal.owner_id || '') || 'Unknown',
      amount: deal.amount,
      stageName: stageNameMap.get(deal.deal_stage || '') || deal.deal_stage || 'Unknown',
      mqlDate: deal.mql_entered_at,
      createdDate: deal.hubspot_created_at,
      demoScheduledDate: deal.demo_scheduled_entered_at,
      daysBetween,
      usedFallback: !deal.mql_entered_at,
      hubspotUrl: `https://app.hubspot.com/contacts/7358632/deal/${deal.hubspot_deal_id}`,
    };
  }).sort((a, b) => (b.daysBetween || 0) - (a.daysBetween || 0));

  return NextResponse.json({
    deals: result,
    weekLabel: `Week ${weekNumber} (${formatDateUTC(weekStartDate)} – ${formatDateUTC(weekEndDate)})`,
  });
}
