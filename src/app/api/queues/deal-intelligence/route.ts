import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { ALL_OPEN_STAGE_IDS } from '@/lib/hubspot/stage-config';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';

// --- Types ---

export interface DealIntelligenceItem {
  hubspot_deal_id: string;
  pipeline: string;
  overall_grade: string;
  overall_score: number;
  hygiene_score: number;
  momentum_score: number;
  engagement_score: number;
  risk_score: number;
  missing_fields: string[];
  hygiene_compliant: boolean;
  next_step_status: string | null;
  days_since_activity: number | null;
  has_future_activity: boolean;
  stalled_severity: string | null;
  overdue_task_count: number;
  llm_status: string | null;
  llm_urgency: string | null;
  buyer_sentiment: string | null;
  deal_momentum: string | null;
  recommended_action: string | null;
  reasoning: string | null;
  key_risk: string | null;
  llm_confidence: number | null;
  deal_name: string | null;
  amount: number | null;
  stage_name: string | null;
  stage_id: string | null;
  days_in_stage: number | null;
  close_date: string | null;
  owner_id: string | null;
  owner_name: string | null;
  email_count: number;
  call_count: number;
  meeting_count: number;
  note_count: number;
  issues: { type: string; severity: string; message: string }[];
  top_action: string | null;
  top_action_type: string | null;
  llm_analyzed_at: string | null;
  rules_computed_at: string | null;
}

export interface DealIntelligenceResponse {
  deals: DealIntelligenceItem[];
  counts: {
    total: number;
    gradeA: number;
    gradeB: number;
    gradeC: number;
    gradeD: number;
    gradeF: number;
    analyzed: number;
    unanalyzed: number;
  };
}

// --- Route Handler ---

export async function GET() {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_DEAL_HEALTH);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  try {
    // Fetch all deal intelligence rows, joining with deals to filter open only
    const { data: intelligence, error } = await supabase
      .from('deal_intelligence')
      .select('*')
      .order('overall_score', { ascending: true });

    if (error) {
      console.error('Error fetching deal intelligence:', error);
      return NextResponse.json(
        { error: 'Failed to fetch deal intelligence', details: error.message },
        { status: 500 }
      );
    }

    // Filter to only open deals by cross-referencing with deals table
    const dealIds = (intelligence || []).map(d => d.hubspot_deal_id);
    let openDealIds = new Set<string>();

    if (dealIds.length > 0) {
      // Sales pipeline open deals only
      const { data: salesOpen } = await supabase
        .from('deals')
        .select('hubspot_deal_id')
        .in('hubspot_deal_id', dealIds)
        .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
        .in('deal_stage', ALL_OPEN_STAGE_IDS);

      openDealIds = new Set(
        (salesOpen || []).map(d => d.hubspot_deal_id)
      );
    }

    const deals: DealIntelligenceItem[] = (intelligence || [])
      .filter(d => openDealIds.has(d.hubspot_deal_id))
      .map(d => ({
        hubspot_deal_id: d.hubspot_deal_id,
        pipeline: d.pipeline,
        overall_grade: d.overall_grade,
        overall_score: d.overall_score,
        hygiene_score: d.hygiene_score,
        momentum_score: d.momentum_score,
        engagement_score: d.engagement_score,
        risk_score: d.risk_score,
        missing_fields: d.missing_fields || [],
        hygiene_compliant: d.hygiene_compliant,
        next_step_status: d.next_step_status,
        days_since_activity: d.days_since_activity,
        has_future_activity: d.has_future_activity,
        stalled_severity: d.stalled_severity,
        overdue_task_count: d.overdue_task_count,
        llm_status: d.llm_status,
        llm_urgency: d.llm_urgency,
        buyer_sentiment: d.buyer_sentiment,
        deal_momentum: d.deal_momentum,
        recommended_action: d.recommended_action,
        reasoning: d.reasoning,
        key_risk: d.key_risk,
        llm_confidence: d.llm_confidence,
        deal_name: d.deal_name,
        amount: d.amount ? Number(d.amount) : null,
        stage_name: d.stage_name,
        stage_id: d.stage_id,
        days_in_stage: d.days_in_stage,
        close_date: d.close_date,
        owner_id: d.owner_id,
        owner_name: d.owner_name,
        email_count: d.email_count || 0,
        call_count: d.call_count || 0,
        meeting_count: d.meeting_count || 0,
        note_count: d.note_count || 0,
        issues: d.issues || [],
        top_action: d.top_action,
        top_action_type: d.top_action_type,
        llm_analyzed_at: d.llm_analyzed_at,
        rules_computed_at: d.rules_computed_at,
      }));

    const response: DealIntelligenceResponse = {
      deals,
      counts: {
        total: deals.length,
        gradeA: deals.filter(d => d.overall_grade === 'A').length,
        gradeB: deals.filter(d => d.overall_grade === 'B').length,
        gradeC: deals.filter(d => d.overall_grade === 'C').length,
        gradeD: deals.filter(d => d.overall_grade === 'D').length,
        gradeF: deals.filter(d => d.overall_grade === 'F').length,
        analyzed: deals.filter(d => d.llm_analyzed_at).length,
        unanalyzed: deals.filter(d => !d.llm_analyzed_at).length,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Deal intelligence queue error:', error);
    return NextResponse.json(
      { error: 'Failed to get deal intelligence', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
