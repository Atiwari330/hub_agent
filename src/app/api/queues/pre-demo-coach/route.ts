import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { SALES_PIPELINE_STAGES } from '@/lib/hubspot/stage-config';
import { getAllPipelines } from '@/lib/hubspot/pipelines';
import { getBusinessDaysSinceDate } from '@/lib/utils/business-days';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { getCurrentQuarter } from '@/lib/utils/quarter';
import type { PreDemoCoachAnalysis } from './analyze/analyze-core';

// Only MQL and SQL/Discovery stages
const PRE_DEMO_COACH_STAGE_IDS = [
  SALES_PIPELINE_STAGES.MQL.id,
  SALES_PIPELINE_STAGES.SQL_DISCOVERY.id,
];

export interface PreDemoCoachDeal {
  id: string;
  hubspotDealId: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  stageId: string;
  ownerName: string;
  ownerId: string;
  closeDate: string | null;
  lastActivityDate: string | null;
  nextStep: string | null;
  hubspotCreatedAt: string | null;
  leadSource: string | null;
  daysInCurrentStage: number;
  daysSinceActivity: number;
  dealAgeDays: number;
  analysis: PreDemoCoachAnalysis | null;
}

export interface PreDemoCoachOwner {
  id: string;
  name: string;
}

export interface PreDemoCoachResponse {
  deals: PreDemoCoachDeal[];
  owners: PreDemoCoachOwner[];
  counts: {
    total: number;
    analyzed: number;
    unanalyzed: number;
  };
}

export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_PRE_DEMO_COACH);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();
  const { searchParams } = new URL(request.url);
  const ownerIdFilter = searchParams.get('ownerId');

  try {
    // Get target owners
    const { data: owners } = await supabase
      .from('owners')
      .select('id, hubspot_owner_id, first_name, last_name, email')
      .in('email', SYNC_CONFIG.TARGET_AE_EMAILS);

    if (!owners || owners.length === 0) {
      return NextResponse.json({ deals: [], owners: [], counts: { total: 0, analyzed: 0, unanalyzed: 0 } });
    }

    // Build owner lookup map
    const ownerMap = new Map<string, { name: string; email: string }>();
    for (const owner of owners) {
      const name = [owner.first_name, owner.last_name].filter(Boolean).join(' ') || owner.email;
      ownerMap.set(owner.id, { name, email: owner.email });
    }

    let ownerIds = owners.map((o) => o.id);

    if (ownerIdFilter) {
      if (!ownerIds.includes(ownerIdFilter)) {
        return NextResponse.json({ deals: [], owners: [], counts: { total: 0, analyzed: 0, unanalyzed: 0 } });
      }
      ownerIds = [ownerIdFilter];
    }

    // Only show deals with close date in the current quarter
    const currentQ = getCurrentQuarter();
    const qStart = currentQ.startDate.toISOString();
    const qEnd = currentQ.endDate.toISOString();

    // Fetch pre-demo deals (MQL + SQL/Discovery only, current quarter close dates)
    const { data: deals, error: dealsError } = await supabase
      .from('deals')
      .select(`
        id,
        hubspot_deal_id,
        deal_name,
        amount,
        deal_stage,
        owner_id,
        hubspot_created_at,
        close_date,
        last_activity_date,
        next_step,
        lead_source,
        mql_entered_at,
        sql_entered_at,
        discovery_entered_at
      `)
      .in('owner_id', ownerIds)
      .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
      .in('deal_stage', PRE_DEMO_COACH_STAGE_IDS)
      .or(`close_date.is.null,and(close_date.gte.${qStart},close_date.lte.${qEnd})`)
      .order('amount', { ascending: false, nullsFirst: false });

    if (dealsError) {
      console.error('Error fetching deals for pre-demo coach:', dealsError);
      return NextResponse.json(
        { error: 'Failed to fetch deals', details: dealsError.message },
        { status: 500 }
      );
    }

    if (!deals || deals.length === 0) {
      const ownerList = Array.from(ownerMap.entries()).map(([id, info]) => ({ id, name: info.name }));
      return NextResponse.json({ deals: [], owners: ownerList, counts: { total: 0, analyzed: 0, unanalyzed: 0 } });
    }

    // Get stage names
    const pipelines = await getAllPipelines();
    const salesPipeline = pipelines.find((p) => p.id === SYNC_CONFIG.TARGET_PIPELINE_ID);
    const stageMap = new Map<string, string>();
    if (salesPipeline) {
      for (const stage of salesPipeline.stages) {
        stageMap.set(stage.id, stage.label);
      }
    }

    // Fetch cached analyses
    const hubspotDealIds = deals.map((d) => d.hubspot_deal_id);
    const { data: analyses } = await supabase
      .from('pre_demo_coach_analyses')
      .select('*')
      .in('hubspot_deal_id', hubspotDealIds);

    const analysisMap = new Map<string, PreDemoCoachAnalysis>(
      (analyses || []).map((a) => [a.hubspot_deal_id, a as PreDemoCoachAnalysis])
    );

    // Build response
    const preDemoDeals: PreDemoCoachDeal[] = [];

    for (const deal of deals) {
      const ownerInfo = deal.owner_id ? ownerMap.get(deal.owner_id) : null;
      const stageId = deal.deal_stage || '';

      // Calculate days in current stage
      let currentStageEnteredAt: string | null = null;
      if (stageId === SALES_PIPELINE_STAGES.MQL.id) {
        currentStageEnteredAt = deal.mql_entered_at;
      } else if (stageId === SALES_PIPELINE_STAGES.SQL_DISCOVERY.id) {
        currentStageEnteredAt = deal.discovery_entered_at;
      }

      const effectiveEntryDate = currentStageEnteredAt || deal.hubspot_created_at;
      const daysInCurrentStage = effectiveEntryDate ? getBusinessDaysSinceDate(effectiveEntryDate) : 0;

      const dealAgeDays = deal.hubspot_created_at ? getBusinessDaysSinceDate(deal.hubspot_created_at) : 0;

      let daysSinceActivity: number;
      if (deal.last_activity_date) {
        daysSinceActivity = getBusinessDaysSinceDate(deal.last_activity_date);
      } else {
        daysSinceActivity = dealAgeDays;
      }

      preDemoDeals.push({
        id: deal.id,
        hubspotDealId: deal.hubspot_deal_id,
        dealName: deal.deal_name,
        amount: deal.amount,
        stageName: stageMap.get(stageId) || stageId || 'Unknown',
        stageId,
        ownerName: ownerInfo?.name || 'Unknown',
        ownerId: deal.owner_id || '',
        closeDate: deal.close_date,
        lastActivityDate: deal.last_activity_date,
        nextStep: deal.next_step,
        hubspotCreatedAt: deal.hubspot_created_at,
        leadSource: deal.lead_source,
        daysInCurrentStage,
        daysSinceActivity,
        dealAgeDays,
        analysis: analysisMap.get(deal.hubspot_deal_id) || null,
      });
    }

    const ownerList: PreDemoCoachOwner[] = Array.from(ownerMap.entries())
      .map(([id, info]) => ({ id, name: info.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const analyzed = preDemoDeals.filter((d) => d.analysis).length;

    return NextResponse.json({
      deals: preDemoDeals,
      owners: ownerList,
      counts: {
        total: preDemoDeals.length,
        analyzed,
        unanalyzed: preDemoDeals.length - analyzed,
      },
    } satisfies PreDemoCoachResponse);
  } catch (error) {
    console.error('Pre-demo coach queue error:', error);
    return NextResponse.json(
      { error: 'Failed to get pre-demo coach queue', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
