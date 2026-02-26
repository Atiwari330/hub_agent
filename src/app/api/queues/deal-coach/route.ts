import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { ALL_OPEN_STAGE_IDS, SALES_PIPELINE_STAGES } from '@/lib/hubspot/stage-config';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';

// --- Types ---

export interface DealCoachAnalysisResponse {
  status: string;
  urgency: string;
  buyer_sentiment: string | null;
  deal_momentum: string | null;
  recommended_action: string;
  reasoning: string;
  confidence: number;
  key_risk: string | null;
  email_count: number;
  call_count: number;
  meeting_count: number;
  note_count: number;
  analyzed_at: string;
}

export interface DealCoachDeal {
  dealId: string;
  dealName: string | null;
  amount: number | null;
  stageName: string;
  stageId: string;
  daysInStage: number | null;
  closeDate: string | null;
  ownerName: string | null;
  ownerId: string | null;
  nextStep: string | null;
  products: string | null;
  leadSource: string | null;
  dealSubstage: string | null;
  analysis: DealCoachAnalysisResponse | null;
}

export interface DealCoachQueueResponse {
  deals: DealCoachDeal[];
  counts: {
    total: number;
    analyzed: number;
    unanalyzed: number;
    needsAction: number;
    onTrack: number;
    atRisk: number;
    stalled: number;
    noActionNeeded: number;
  };
}

// --- Stage label map ---

const STAGE_LABEL_MAP = new Map(
  Object.values(SALES_PIPELINE_STAGES).map((s) => [s.id, s.label])
);

// Stage entry timestamp columns in the deals table
const STAGE_ENTRY_MAP: Record<string, string> = {
  '2030251': 'mql_entered_at',
  '17915773': 'sql_entered_at',
  '138092708': 'discovery_entered_at',
  'baedc188-ba76-4a41-8723-5bb99fe7c5bf': 'demo_scheduled_entered_at',
  '963167283': 'demo_completed_entered_at',
  '97b2bcc6-fb34-4b56-8e6e-c349c88ef3d5': 'closed_won_entered_at',
  '59865091': 'proposal_entered_at',
};

// --- Route Handler ---

export async function GET() {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_DEAL_COACH);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  try {
    // Fetch all open deals in the sales pipeline
    const { data: deals, error: dealsError } = await supabase
      .from('deals')
      .select(`
        hubspot_deal_id,
        deal_name,
        amount,
        deal_stage,
        owner_id,
        close_date,
        next_step,
        products,
        lead_source,
        deal_substage,
        hubspot_created_at,
        mql_entered_at,
        sql_entered_at,
        discovery_entered_at,
        demo_scheduled_entered_at,
        demo_completed_entered_at,
        proposal_entered_at,
        closed_won_entered_at
      `)
      .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
      .in('deal_stage', ALL_OPEN_STAGE_IDS)
      .order('amount', { ascending: false, nullsFirst: false });

    if (dealsError) {
      console.error('Error fetching deals for deal coach:', dealsError);
      return NextResponse.json(
        { error: 'Failed to fetch deals', details: dealsError.message },
        { status: 500 }
      );
    }

    // Fetch owner names
    const ownerIds = [...new Set((deals || []).map((d) => d.owner_id).filter((id): id is string => id !== null))];
    const ownerMap = new Map<string, string>();

    if (ownerIds.length > 0) {
      const { data: owners } = await supabase
        .from('owners')
        .select('id, first_name, last_name')
        .in('id', ownerIds);

      for (const owner of owners || []) {
        const name = [owner.first_name, owner.last_name].filter(Boolean).join(' ');
        ownerMap.set(owner.id, name || 'Unknown');
      }
    }

    // Fetch existing analyses
    const dealIds = (deals || []).map((d) => d.hubspot_deal_id);
    const analysisMap = new Map<string, DealCoachAnalysisResponse>();

    if (dealIds.length > 0) {
      const { data: analyses } = await supabase
        .from('deal_coach_analyses')
        .select('hubspot_deal_id, status, urgency, buyer_sentiment, deal_momentum, recommended_action, reasoning, confidence, key_risk, email_count, call_count, meeting_count, note_count, analyzed_at')
        .in('hubspot_deal_id', dealIds);

      for (const a of analyses || []) {
        analysisMap.set(a.hubspot_deal_id, {
          status: a.status,
          urgency: a.urgency,
          buyer_sentiment: a.buyer_sentiment,
          deal_momentum: a.deal_momentum,
          recommended_action: a.recommended_action,
          reasoning: a.reasoning,
          confidence: a.confidence,
          key_risk: a.key_risk,
          email_count: a.email_count,
          call_count: a.call_count,
          meeting_count: a.meeting_count,
          note_count: a.note_count,
          analyzed_at: a.analyzed_at,
        });
      }
    }

    // Build response
    const now = new Date();
    const result: DealCoachDeal[] = (deals || []).map((deal) => {
      const stageName = STAGE_LABEL_MAP.get(deal.deal_stage) || deal.deal_stage || 'Unknown';

      // Compute days in stage from stage entry timestamp
      let daysInStage: number | null = null;
      const entryColumn = STAGE_ENTRY_MAP[deal.deal_stage];
      const dealRecord = deal as Record<string, unknown>;
      if (entryColumn && dealRecord[entryColumn]) {
        const enteredAt = new Date(dealRecord[entryColumn] as string);
        daysInStage = Math.floor((now.getTime() - enteredAt.getTime()) / (1000 * 60 * 60 * 24));
      }

      return {
        dealId: deal.hubspot_deal_id,
        dealName: deal.deal_name,
        amount: deal.amount ? Number(deal.amount) : null,
        stageName,
        stageId: deal.deal_stage,
        daysInStage,
        closeDate: deal.close_date,
        ownerName: deal.owner_id ? ownerMap.get(deal.owner_id) || null : null,
        ownerId: deal.owner_id,
        nextStep: deal.next_step,
        products: deal.products,
        leadSource: deal.lead_source,
        dealSubstage: deal.deal_substage,
        analysis: analysisMap.get(deal.hubspot_deal_id) || null,
      };
    });

    const analyzed = result.filter((d) => d.analysis).length;

    const response: DealCoachQueueResponse = {
      deals: result,
      counts: {
        total: result.length,
        analyzed,
        unanalyzed: result.length - analyzed,
        needsAction: result.filter((d) => d.analysis?.status === 'needs_action').length,
        onTrack: result.filter((d) => d.analysis?.status === 'on_track').length,
        atRisk: result.filter((d) => d.analysis?.status === 'at_risk').length,
        stalled: result.filter((d) => d.analysis?.status === 'stalled').length,
        noActionNeeded: result.filter((d) => d.analysis?.status === 'no_action_needed').length,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Deal coach queue error:', error);
    return NextResponse.json(
      {
        error: 'Failed to get deal coach queue',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
