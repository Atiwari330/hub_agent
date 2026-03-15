import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { getCurrentQuarter, getQuarterInfo } from '@/lib/utils/quarter';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { getWeekStart, formatDateUTC } from '@/lib/hot-tracker/compute';
import { getStageNameMap } from '@/lib/hubspot/pipelines';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

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

  const weekAlignedStart = getWeekStart(qi.startDate);
  const weekStartDate = new Date(weekAlignedStart);
  weekStartDate.setUTCDate(weekStartDate.getUTCDate() + (weekNumber - 1) * 7);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);
  weekEndDate.setUTCHours(23, 59, 59, 999);

  let query = supabase
    .from('deals')
    .select('hubspot_deal_id, deal_name, amount, deal_stage, owner_id, demo_completed_entered_at, proposal_entered_at')
    .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
    .gte('demo_completed_entered_at', weekStartDate.toISOString())
    .lte('demo_completed_entered_at', weekEndDate.toISOString());

  if (ownerId) query = query.eq('owner_id', ownerId);

  const { data: deals, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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

  const now = new Date();

  const result = (deals || []).map((deal) => {
    const demoCompDate = new Date(deal.demo_completed_entered_at!);
    const proposalDate = deal.proposal_entered_at ? new Date(deal.proposal_entered_at) : null;
    const converted = proposalDate !== null && (proposalDate.getTime() - demoCompDate.getTime()) <= FOURTEEN_DAYS_MS;
    const daysBetween = converted && proposalDate
      ? Math.round((proposalDate.getTime() - demoCompDate.getTime()) / (1000 * 60 * 60 * 24) * 10) / 10
      : null;
    const windowElapsed = now.getTime() - demoCompDate.getTime() > FOURTEEN_DAYS_MS;

    return {
      dealId: deal.hubspot_deal_id,
      dealName: deal.deal_name,
      ownerName: ownerNameMap.get(deal.owner_id || '') || 'Unknown',
      amount: deal.amount,
      stageName: stageNameMap.get(deal.deal_stage || '') || deal.deal_stage || 'Unknown',
      demoCompletedDate: deal.demo_completed_entered_at,
      proposalDate: deal.proposal_entered_at,
      converted,
      daysBetween,
      status: converted ? 'converted' as const : windowElapsed ? 'missed' as const : 'pending' as const,
      hubspotUrl: `https://app.hubspot.com/contacts/7358632/deal/${deal.hubspot_deal_id}`,
    };
  }).sort((a, b) => {
    // Converted first, then pending, then missed
    const order = { converted: 0, pending: 1, missed: 2 };
    return order[a.status] - order[b.status];
  });

  return NextResponse.json({
    deals: result,
    weekLabel: `Week ${weekNumber} (${formatDateUTC(weekStartDate)} – ${formatDateUTC(weekEndDate)})`,
    inProgress: now.getTime() - weekEndDate.getTime() < FOURTEEN_DAYS_MS,
  });
}
