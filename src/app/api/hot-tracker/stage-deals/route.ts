import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { getCurrentQuarter, getQuarterInfo } from '@/lib/utils/quarter';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { getWeekStart, formatDateUTC } from '@/lib/hot-tracker/compute';
import { getStageNameMap } from '@/lib/hubspot/pipelines';

// Maps stage key → DB column(s). mqlSql queries both MQL and SQL/Discovery columns.
const STAGE_COLUMNS_MAP: Record<string, string[]> = {
  mqlSql: ['mql_entered_at', 'discovery_entered_at'],
  demoScheduled: ['demo_scheduled_entered_at'],
  demoCompleted: ['demo_completed_entered_at'],
};

const STAGE_LABEL_MAP: Record<string, string> = {
  mqlSql: 'MQL / SQL Discovery',
  demoScheduled: 'Demo Scheduled',
  demoCompleted: 'Demo Completed',
};

export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.HOT_TRACKER);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  const searchParams = request.nextUrl.searchParams;
  const currentQ = getCurrentQuarter();
  const year = parseInt(searchParams.get('year') || String(currentQ.year));
  const quarter = parseInt(searchParams.get('quarter') || String(currentQ.quarter));
  const weekNumber = parseInt(searchParams.get('weekNumber') || '1');
  const stage = searchParams.get('stage') || '';
  const ownerId = searchParams.get('ownerId') || null;

  const dbColumns = STAGE_COLUMNS_MAP[stage];
  if (!dbColumns) {
    return NextResponse.json(
      { error: `Invalid stage: ${stage}. Must be one of: ${Object.keys(STAGE_COLUMNS_MAP).join(', ')}` },
      { status: 400 }
    );
  }

  const qi = getQuarterInfo(year, quarter);

  // Compute the week's date range
  const weekAlignedStart = getWeekStart(qi.startDate);
  const weekStartDate = new Date(weekAlignedStart);
  weekStartDate.setUTCDate(weekStartDate.getUTCDate() + (weekNumber - 1) * 7);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);
  weekEndDate.setUTCHours(23, 59, 59, 999);

  // For combined stages (mqlSql), run one query per column and merge results
  const allDeals: { hubspot_deal_id: string; deal_name: string; amount: number | null; close_date: string | null; deal_stage: string | null; owner_id: string | null; enteredAt: string }[] = [];
  const seenDealIds = new Set<string>();

  for (const dbColumn of dbColumns) {
    let query = supabase
      .from('deals')
      .select('hubspot_deal_id, deal_name, amount, close_date, deal_stage, owner_id, mql_entered_at, discovery_entered_at, demo_scheduled_entered_at, demo_completed_entered_at')
      .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
      .gte(dbColumn, weekStartDate.toISOString())
      .lte(dbColumn, weekEndDate.toISOString());

    if (ownerId) {
      query = query.eq('owner_id', ownerId);
    }

    const { data: deals, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const colKey = dbColumn as 'mql_entered_at' | 'discovery_entered_at' | 'demo_scheduled_entered_at' | 'demo_completed_entered_at';
    for (const deal of deals || []) {
      if (!seenDealIds.has(deal.hubspot_deal_id)) {
        seenDealIds.add(deal.hubspot_deal_id);
        allDeals.push({
          hubspot_deal_id: deal.hubspot_deal_id,
          deal_name: deal.deal_name,
          amount: deal.amount,
          close_date: deal.close_date,
          deal_stage: deal.deal_stage,
          owner_id: deal.owner_id,
          enteredAt: deal[colKey] as string,
        });
      }
    }
  }

  // Fetch owner names
  const ownerIds = [...new Set(allDeals.filter((d) => d.owner_id).map((d) => d.owner_id!))];
  const { data: owners } = await supabase
    .from('owners')
    .select('id, first_name, last_name')
    .in('id', ownerIds.length > 0 ? ownerIds : ['00000000-0000-0000-0000-000000000000']);

  const ownerNameMap = new Map(
    (owners || []).map((o) => [o.id, `${o.first_name || ''} ${o.last_name || ''}`.trim()])
  );

  // Resolve stage names
  let stageNameMap: Map<string, string>;
  try {
    stageNameMap = await getStageNameMap();
  } catch {
    stageNameMap = new Map();
  }

  const result = allDeals.map((deal) => ({
    dealId: deal.hubspot_deal_id,
    dealName: deal.deal_name,
    ownerName: ownerNameMap.get(deal.owner_id || '') || 'Unknown',
    amount: deal.amount,
    closeDate: deal.close_date,
    stageName: stageNameMap.get(deal.deal_stage || '') || deal.deal_stage || 'Unknown',
    enteredAt: deal.enteredAt,
    hubspotUrl: `https://app.hubspot.com/contacts/7358632/deal/${deal.hubspot_deal_id}`,
  }));

  const weekLabel = `Week ${weekNumber} (${formatDateUTC(weekStartDate)} – ${formatDateUTC(weekEndDate)})`;

  return NextResponse.json({
    deals: result,
    weekLabel,
    stageLabel: STAGE_LABEL_MAP[stage] || stage,
  });
}
