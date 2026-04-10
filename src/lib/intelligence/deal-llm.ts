/**
 * Deal Intelligence LLM Analysis (Phase 2)
 *
 * Expanded Deal Coach prompt that produces momentum/engagement/risk scores (0-100)
 * in addition to the standard coaching output.
 *
 * Runs on: never-analyzed deals, deals >3 days stale, grade D/F deals (daily), stage-changed deals
 */

import type { LanguageModel } from 'ai';
import { createServiceClient } from '@/lib/supabase/client';
import { analyzeDealCoach, type DealCoachAnalysis } from '@/app/api/queues/deal-coach/analyze/analyze-core';
import { computeGrade, computeOverallScore } from './deal-rules';
import { PRE_DEMO_STAGE_IDS } from '@/lib/hubspot/stage-config';
import { SALES_PIPELINE_STAGES } from '@/lib/hubspot/stage-config';
import { batchFetchDealEngagements } from '@/lib/hubspot/batch-engagements';
import { analyzePreDemoEffort } from './pre-demo-llm';
import { getDeepSeekModel } from '@/lib/ai/provider';
import { paginatedFetch } from '@/lib/supabase/paginate';

// --- Score Mapping from LLM outputs ---

function mapMomentumToScore(momentum: string | null): number {
  switch (momentum) {
    case 'accelerating': return 90;
    case 'steady': return 70;
    case 'slowing': return 40;
    case 'stalled': return 15;
    default: return 50; // neutral baseline
  }
}

function mapSentimentToEngagementScore(sentiment: string | null): number {
  switch (sentiment) {
    case 'positive': return 95;
    case 'engaged': return 80;
    case 'neutral': return 55;
    case 'unresponsive': return 25;
    case 'negative': return 15;
    default: return 50; // neutral baseline
  }
}

function mapStatusToRiskScore(status: string | null, urgency: string | null): number {
  // Higher score = lower risk (healthier)
  let baseScore: number;
  switch (status) {
    case 'on_track': baseScore = 90; break;
    case 'no_action_needed': baseScore = 85; break;
    case 'nurture': baseScore = 70; break;
    case 'needs_action': baseScore = 50; break;
    case 'at_risk': baseScore = 25; break;
    case 'stalled': baseScore = 10; break;
    case 'uncertain': baseScore = 50; break;
    default: baseScore = 50;
  }

  // Urgency modifier
  switch (urgency) {
    case 'critical': baseScore -= 15; break;
    case 'high': baseScore -= 5; break;
    case 'medium': break; // no modifier
    case 'low': baseScore += 5; break;
  }

  return Math.max(0, Math.min(100, baseScore));
}

// --- Main Analysis Function ---

export interface LLMAnalysisResult {
  success: boolean;
  dealId: string;
  error?: string;
}

export async function analyzeDealIntelligence(dealId: string): Promise<LLMAnalysisResult> {
  const supabase = createServiceClient();

  try {
    // Check if this is a pre-demo deal
    const { data: dealData } = await supabase
      .from('deals')
      .select('deal_stage, deal_name, hubspot_created_at, pipeline')
      .eq('hubspot_deal_id', dealId)
      .single();

    if (dealData && PRE_DEMO_STAGE_IDS.includes(dealData.deal_stage)) {
      return analyzePreDemoDealIntelligence(dealId, dealData, getDeepSeekModel());
    }

    // Post-demo: run the existing Deal Coach analysis with DeepSeek
    const model = getDeepSeekModel();
    const result = await analyzeDealCoach(dealId, { model });

    if (!result.success) {
      return { success: false, dealId, error: result.error };
    }

    const analysis: DealCoachAnalysis = result.analysis;

    // Map LLM outputs to dimension scores
    const llmMomentumScore = mapMomentumToScore(analysis.deal_momentum);
    const llmEngagementScore = mapSentimentToEngagementScore(analysis.buyer_sentiment);
    const llmRiskScore = mapStatusToRiskScore(analysis.status, analysis.urgency);

    // Fetch existing rules-based hygiene score
    const { data: existing } = await supabase
      .from('deal_intelligence')
      .select('hygiene_score')
      .eq('hubspot_deal_id', dealId)
      .single();

    const hygieneScore = existing?.hygiene_score ?? 50;

    // Recompute overall with LLM-derived scores
    const overallScore = computeOverallScore(hygieneScore, llmMomentumScore, llmEngagementScore, llmRiskScore);
    const overallGrade = computeGrade(overallScore);

    // Update deal_intelligence with LLM results
    const { error: updateError } = await supabase
      .from('deal_intelligence')
      .update({
        momentum_score: llmMomentumScore,
        engagement_score: llmEngagementScore,
        risk_score: llmRiskScore,
        overall_score: overallScore,
        overall_grade: overallGrade,
        llm_status: analysis.status,
        llm_urgency: analysis.urgency,
        buyer_sentiment: analysis.buyer_sentiment,
        deal_momentum: analysis.deal_momentum,
        recommended_action: analysis.recommended_action,
        reasoning: analysis.reasoning,
        key_risk: analysis.key_risk,
        llm_confidence: analysis.confidence,
        email_count: analysis.email_count,
        call_count: analysis.call_count,
        meeting_count: analysis.meeting_count,
        note_count: analysis.note_count,
        llm_analyzed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('hubspot_deal_id', dealId);

    if (updateError) {
      console.error(`Error updating deal intelligence for ${dealId}:`, updateError);
      return { success: false, dealId, error: updateError.message };
    }

    return { success: true, dealId };
  } catch (error) {
    console.error(`LLM analysis error for deal ${dealId}:`, error);
    return {
      success: false,
      dealId,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get deals that need LLM analysis refresh
 */
export async function getDealsNeedingLLMAnalysis(): Promise<string[]> {
  const supabase = createServiceClient();

  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  // Get deals that:
  // 1. Have never been analyzed (llm_analyzed_at is null)
  // 2. Were analyzed >3 days ago
  // 3. Have grade D or F
  const deals = await paginatedFetch(() =>
    supabase
      .from('deal_intelligence')
      .select('hubspot_deal_id, overall_grade, llm_analyzed_at')
      .or(`llm_analyzed_at.is.null,llm_analyzed_at.lt.${threeDaysAgo.toISOString()},overall_grade.in.(D,F)`),
  );

  return deals.map((d: { hubspot_deal_id: string }) => d.hubspot_deal_id);
}

// --- Pre-Demo LLM Analysis Helper ---

const STAGE_LABEL_MAP = new Map<string, string>(
  Object.values(SALES_PIPELINE_STAGES).map((s) => [s.id, s.label])
);

async function analyzePreDemoDealIntelligence(
  dealId: string,
  dealData: { deal_stage: string; deal_name: string | null; hubspot_created_at: string | null; pipeline: string },
  model?: LanguageModel
): Promise<LLMAnalysisResult> {
  const supabase = createServiceClient();

  try {
    const stageName = STAGE_LABEL_MAP.get(dealData.deal_stage) || dealData.deal_stage || 'Unknown';
    const daysInPreDemo = dealData.hubspot_created_at
      ? Math.max(1, Math.round((Date.now() - new Date(dealData.hubspot_created_at).getTime()) / (1000 * 60 * 60 * 24)))
      : 1;

    // Fetch engagements
    const engagementsMap = await batchFetchDealEngagements([dealId]);
    const engagements = engagementsMap.get(dealId) || { calls: [], emails: [], meetings: [] };

    // Fetch notes
    const { data: dealRow } = await supabase
      .from('deals')
      .select('id')
      .eq('hubspot_deal_id', dealId)
      .single();

    let notes: { note_body: string; note_timestamp: string; author_name: string | null }[] = [];
    if (dealRow) {
      const { data: notesData } = await supabase
        .from('deal_notes')
        .select('note_body, note_timestamp, author_name')
        .eq('deal_id', dealRow.id)
        .order('note_timestamp', { ascending: false })
        .limit(10);
      notes = notesData || [];
    }

    const result = await analyzePreDemoEffort(
      dealId,
      dealData.deal_name || 'Unknown',
      stageName,
      daysInPreDemo,
      engagements.calls,
      engagements.emails,
      engagements.meetings,
      notes,
      model ? { model } : undefined
    );

    if (!result.success) {
      return { success: false, dealId, error: result.error };
    }

    return { success: true, dealId };
  } catch (error) {
    console.error(`Pre-demo LLM analysis error for deal ${dealId}:`, error);
    return {
      success: false,
      dealId,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
