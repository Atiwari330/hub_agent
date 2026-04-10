/**
 * Shared Q2 deal fetching logic for Command Center endpoints.
 * Fetches deals with intelligence scores, scoped to Q2 2026.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { ALL_OPEN_STAGE_IDS, POST_DEMO_STAGE_IDS, SALES_PIPELINE_STAGES } from '@/lib/hubspot/stage-config';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { paginatedFetch } from '@/lib/supabase/paginate';
import { computeLikelihoodTier } from './config';
import type { DealForecastItem, LikelihoodTier } from './types';

const Q2_START = '2026-04-01';
const Q2_END = '2026-06-30';
const CLOSED_WON_ID = SALES_PIPELINE_STAGES.CLOSED_WON.id;

export async function fetchQ2Deals(supabase: SupabaseClient): Promise<DealForecastItem[]> {
  // Paginate deals query — Supabase server caps at 1,000 rows regardless of .limit()
  const [allIntel, allDeals, overrideResult] = await Promise.all([
    paginatedFetch(() =>
      supabase
        .from('deal_intelligence')
        .select('*')
        .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
        .order('overall_score', { ascending: false }),
    ),
    paginatedFetch(() =>
      supabase
        .from('deals')
        .select('hubspot_deal_id, deal_name, amount, deal_stage, close_date, lead_source, owner_id, closed_won_entered_at')
        .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID),
    ),
    supabase
      .from('deal_forecast_overrides')
      .select('*'),
  ]);

  const dealMap = new Map(allDeals.map((d) => [d.hubspot_deal_id, d]));
  const overrideMap = new Map((overrideResult.data || []).map((o) => [o.hubspot_deal_id, o]));
  const openStageSet = new Set(ALL_OPEN_STAGE_IDS);
  const forecastEligibleSet = new Set([...POST_DEMO_STAGE_IDS, CLOSED_WON_ID]);

  const deals: DealForecastItem[] = [];

  for (const intel of allIntel) {
    const deal = dealMap.get(intel.hubspot_deal_id);
    if (!deal) continue;

    // Only include bottom-of-funnel deals (Demo Completed+) in forecast
    if (!forecastEligibleSet.has(deal.deal_stage)) continue;

    const closeDate = deal.close_date;
    const closedWonAt = deal.closed_won_entered_at;
    const isOpen = openStageSet.has(deal.deal_stage);
    const isClosedWon = deal.deal_stage === CLOSED_WON_ID;

    const closeDateInQ2 = closeDate && closeDate >= Q2_START && closeDate <= Q2_END;
    const closeDateNull = !closeDate;
    const wonInQ2 = closedWonAt && closedWonAt >= Q2_START && closedWonAt <= `${Q2_END}T23:59:59`;
    const closeDateAfterQ2 = closeDate && closeDate > Q2_END;

    if (closeDateAfterQ2 && !wonInQ2) continue;
    if (!((isOpen && (closeDateInQ2 || closeDateNull)) || wonInQ2 || (isClosedWon && wonInQ2))) continue;

    const override = overrideMap.get(intel.hubspot_deal_id);
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
            likelihood: override.override_likelihood,
            amount: override.override_amount ? Number(override.override_amount) : null,
            reason: override.override_reason,
            overriddenBy: override.overridden_by,
            overriddenAt: override.created_at,
          }
        : null,
    });
  }

  return deals;
}
