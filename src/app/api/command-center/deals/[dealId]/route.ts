import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { computeLikelihoodTier } from '@/lib/command-center/config';
import type { DealForecastItem, LikelihoodTier } from '@/lib/command-center/types';

const STAGE_TIMELINE_FIELDS = [
  { column: 'mql_entered_at', label: 'MQL', stage: 'MQL' },
  { column: 'discovery_entered_at', label: 'SQL/Discovery', stage: 'SQL_DISCOVERY' },
  { column: 'demo_scheduled_entered_at', label: 'Demo Scheduled', stage: 'DEMO_SCHEDULED' },
  { column: 'demo_completed_entered_at', label: 'Demo Completed', stage: 'DEMO_COMPLETED' },
  { column: 'proposal_entered_at', label: 'Proposal/Evaluating', stage: 'PROPOSAL_EVALUATING' },
  { column: 'closed_won_entered_at', label: 'Closed Won', stage: 'CLOSED_WON' },
];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const authResult = await checkApiAuth(RESOURCES.Q2_COMMAND_CENTER);
  if (authResult instanceof NextResponse) return authResult;

  const { dealId } = await params;
  const supabase = await createServerSupabaseClient();

  try {
    // Fetch intelligence, deal, override, and coaching in parallel
    const [intResult, dealResult, overrideResult, coachResult] = await Promise.all([
      supabase
        .from('deal_intelligence')
        .select('*')
        .eq('hubspot_deal_id', dealId)
        .single(),
      supabase
        .from('deals')
        .select('*')
        .eq('hubspot_deal_id', dealId)
        .single(),
      supabase
        .from('deal_forecast_overrides')
        .select('*')
        .eq('hubspot_deal_id', dealId)
        .order('created_at', { ascending: false })
        .limit(1),
      supabase
        .from('pre_demo_coach_analyses')
        .select('situation, next_action, follow_up')
        .eq('hubspot_deal_id', dealId)
        .limit(1),
    ]);

    if (intResult.error || !intResult.data) {
      return NextResponse.json({ error: 'Deal intelligence not found' }, { status: 404 });
    }
    if (dealResult.error || !dealResult.data) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const intel = intResult.data;
    const deal = dealResult.data;
    const override = overrideResult.data?.[0] || null;
    const coach = coachResult.data?.[0] || null;

    const tier = computeLikelihoodTier(
      intel.overall_score,
      intel.llm_status,
      intel.buyer_sentiment,
    ) as LikelihoodTier;

    const dealItem: DealForecastItem = {
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
    };

    // Build stage timeline
    const timeline = STAGE_TIMELINE_FIELDS.map((f) => ({
      stage: f.stage,
      label: f.label,
      enteredAt: (deal as Record<string, unknown>)[f.column] as string | null,
    }));

    return NextResponse.json({
      deal: dealItem,
      timeline,
      intelligence: {
        hygieneScore: intel.hygiene_score,
        momentumScore: intel.momentum_score,
        engagementScore: intel.engagement_score,
        riskScore: intel.risk_score,
        issues: intel.issues || [],
        missingFields: intel.missing_fields || [],
        llmReasoning: intel.reasoning,
        recommendedAction: intel.recommended_action,
        coaching: coach
          ? {
              situation: coach.situation,
              nextAction: coach.next_action,
              followUp: coach.follow_up,
            }
          : null,
      },
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
  } catch (error) {
    console.error('Deal detail error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch deal detail' },
      { status: 500 },
    );
  }
}
