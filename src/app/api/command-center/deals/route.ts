import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { ALL_OPEN_STAGE_IDS, SALES_PIPELINE_STAGES } from '@/lib/hubspot/stage-config';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { computeLikelihoodTier } from '@/lib/command-center/config';
import type { DealForecastItem, LikelihoodTier } from '@/lib/command-center/types';

const Q2_START = '2026-04-01';
const Q2_END = '2026-06-30';
const CLOSED_WON_ID = SALES_PIPELINE_STAGES.CLOSED_WON.id;

export async function GET() {
  const authResult = await checkApiAuth(RESOURCES.Q2_COMMAND_CENTER);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  try {
    // Fetch all deal intelligence rows for the sales pipeline
    const { data: intelligence, error: intError } = await supabase
      .from('deal_intelligence')
      .select('*')
      .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
      .order('overall_score', { ascending: false });

    if (intError) throw new Error(`Failed to fetch deal intelligence: ${intError.message}`);

    const allIntel = intelligence || [];
    const dealIds = allIntel.map((d) => d.hubspot_deal_id);

    if (dealIds.length === 0) {
      return NextResponse.json({ deals: [], counts: emptyCounts() });
    }

    // Fetch deal rows for close_date and stage filtering
    const { data: dealRows, error: dealError } = await supabase
      .from('deals')
      .select('hubspot_deal_id, deal_name, amount, deal_stage, close_date, lead_source, owner_id, closed_won_entered_at, mql_entered_at, discovery_entered_at, demo_scheduled_entered_at, demo_completed_entered_at, proposal_entered_at')
      .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
      .in('hubspot_deal_id', dealIds);

    if (dealError) throw new Error(`Failed to fetch deals: ${dealError.message}`);

    const dealMap = new Map((dealRows || []).map((d) => [d.hubspot_deal_id, d]));

    // Fetch overrides
    const { data: overrides } = await supabase
      .from('deal_forecast_overrides')
      .select('*')
      .in('hubspot_deal_id', dealIds);

    const overrideMap = new Map((overrides || []).map((o) => [o.hubspot_deal_id, o]));

    // Fetch pre-demo coaching
    const { data: coaching } = await supabase
      .from('pre_demo_coach_analyses')
      .select('hubspot_deal_id, situation, next_action, follow_up')
      .in('hubspot_deal_id', dealIds);

    const coachingMap = new Map((coaching || []).map((c) => [c.hubspot_deal_id, c]));

    // Filter to Q2-relevant deals
    const openStageSet = new Set(ALL_OPEN_STAGE_IDS);
    const deals: DealForecastItem[] = [];

    for (const intel of allIntel) {
      const deal = dealMap.get(intel.hubspot_deal_id);
      if (!deal) continue;

      const closeDate = deal.close_date;
      const closedWonAt = deal.closed_won_entered_at;
      const isOpen = openStageSet.has(deal.deal_stage);
      const isClosedWon = deal.deal_stage === CLOSED_WON_ID;

      // Q2 scoping logic
      const closeDateInQ2 = closeDate && closeDate >= Q2_START && closeDate <= Q2_END;
      const closeDateNull = !closeDate;
      const wonInQ2 = closedWonAt && closedWonAt >= Q2_START && closedWonAt <= `${Q2_END}T23:59:59`;
      const closeDateAfterQ2 = closeDate && closeDate > Q2_END;

      // Exclude deals pushed past Q2
      if (closeDateAfterQ2 && !wonInQ2) continue;
      // Include: open with Q2 close date or null close date, or closed-won in Q2
      if (!((isOpen && (closeDateInQ2 || closeDateNull)) || wonInQ2 || (isClosedWon && wonInQ2))) continue;

      const override = overrideMap.get(intel.hubspot_deal_id);
      const coach = coachingMap.get(intel.hubspot_deal_id);
      const tier = computeLikelihoodTier(
        intel.overall_score,
        intel.llm_status,
        intel.buyer_sentiment,
      ) as LikelihoodTier;

      deals.push({
        hubspotDealId: intel.hubspot_deal_id,
        dealName: intel.deal_name || deal.deal_name || '',
        ownerName: intel.owner_name || '',
        ownerId: intel.owner_id || deal.owner_id,
        amount: Number(intel.amount || deal.amount) || 0,
        stage: intel.stage_name || '',
        stageId: intel.stage_id || deal.deal_stage,
        closeDate: deal.close_date,
        leadSource: deal.lead_source,
        overallGrade: intel.overall_grade,
        overallScore: intel.overall_score,
        hygieneScore: intel.hygiene_score,
        momentumScore: intel.momentum_score,
        engagementScore: intel.engagement_score,
        riskScore: intel.risk_score,
        llmStatus: intel.llm_status,
        buyerSentiment: intel.buyer_sentiment,
        dealMomentum: intel.deal_momentum,
        keyRisk: intel.key_risk,
        recommendedAction: intel.recommended_action,
        reasoning: intel.reasoning,
        likelihoodTier: tier,
        override: override
          ? {
              likelihood: override.likelihood,
              amount: override.override_amount ? Number(override.override_amount) : null,
              reason: override.reason,
              overriddenBy: override.overridden_by,
              overriddenAt: override.created_at,
            }
          : null,
      });
    }

    const counts = {
      total: deals.length,
      byGrade: {
        A: deals.filter((d) => d.overallGrade === 'A').length,
        B: deals.filter((d) => d.overallGrade === 'B').length,
        C: deals.filter((d) => d.overallGrade === 'C').length,
        D: deals.filter((d) => d.overallGrade === 'D').length,
        F: deals.filter((d) => d.overallGrade === 'F').length,
      },
      byLikelihood: {
        highly_likely: deals.filter((d) => d.likelihoodTier === 'highly_likely').length,
        likely: deals.filter((d) => d.likelihoodTier === 'likely').length,
        possible: deals.filter((d) => d.likelihoodTier === 'possible').length,
        unlikely: deals.filter((d) => d.likelihoodTier === 'unlikely').length,
        insufficient_data: deals.filter((d) => d.likelihoodTier === 'insufficient_data').length,
      },
      withOverrides: deals.filter((d) => d.override).length,
    };

    return NextResponse.json({ deals, counts });
  } catch (error) {
    console.error('Command Center deals error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch deals' },
      { status: 500 },
    );
  }
}

function emptyCounts() {
  return {
    total: 0,
    byGrade: { A: 0, B: 0, C: 0, D: 0, F: 0 },
    byLikelihood: { highly_likely: 0, likely: 0, possible: 0, unlikely: 0, insufficient_data: 0 },
    withOverrides: 0,
  };
}
