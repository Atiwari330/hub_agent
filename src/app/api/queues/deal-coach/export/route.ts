import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { ALL_OPEN_STAGE_IDS, SALES_PIPELINE_STAGES } from '@/lib/hubspot/stage-config';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';

function escapeCsvField(value: string | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const STAGE_LABEL_MAP = new Map(
  Object.values(SALES_PIPELINE_STAGES).map((s) => [s.id, s.label])
);

const STAGE_ENTRY_MAP: Record<string, string> = {
  '2030251': 'mql_entered_at',
  '17915773': 'sql_entered_at',
  '138092708': 'discovery_entered_at',
  'baedc188-ba76-4a41-8723-5bb99fe7c5bf': 'demo_scheduled_entered_at',
  '963167283': 'demo_completed_entered_at',
  '97b2bcc6-fb34-4b56-8e6e-c349c88ef3d5': 'closed_won_entered_at',
  '59865091': 'proposal_entered_at',
};

/**
 * GET /api/queues/deal-coach/export
 *
 * Export analyzed deal coach results as a downloadable CSV file.
 * Query params:
 *   - status: 'all' | 'needs_action' | 'on_track' | 'at_risk' | 'stalled' | 'no_action_needed' | 'nurture' (default: 'all')
 *   - ae: owner name filter (default: 'all')
 *   - stage: stage ID filter (default: 'all')
 */
export async function GET(request: Request) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_DEAL_COACH);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get('status') || 'all';
  const aeFilter = searchParams.get('ae') || 'all';
  const stageFilter = searchParams.get('stage') || 'all';

  const supabase = await createServerSupabaseClient();

  try {
    // Fetch all open deals in the sales pipeline
    let dealsQuery = supabase
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
        mql_entered_at,
        sql_entered_at,
        discovery_entered_at,
        demo_scheduled_entered_at,
        demo_completed_entered_at,
        proposal_entered_at,
        closed_won_entered_at
      `)
      .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
      .in('deal_stage', ALL_OPEN_STAGE_IDS);

    if (stageFilter !== 'all') {
      dealsQuery = dealsQuery.eq('deal_stage', stageFilter);
    }

    const { data: deals, error: dealsError } = await dealsQuery
      .order('amount', { ascending: false, nullsFirst: false });

    if (dealsError) {
      return NextResponse.json(
        { error: 'Failed to fetch deals', details: dealsError.message },
        { status: 500 }
      );
    }

    if (!deals || deals.length === 0) {
      return new Response('No deals found', { status: 404 });
    }

    // Fetch owner names
    const ownerIds = [...new Set(deals.map((d) => d.owner_id).filter((id): id is string => id !== null))];
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

    // Apply AE filter
    let filteredDeals = deals;
    if (aeFilter !== 'all') {
      filteredDeals = filteredDeals.filter((d) => {
        const ownerName = d.owner_id ? ownerMap.get(d.owner_id) || null : null;
        return ownerName === aeFilter;
      });
    }

    const dealIds = filteredDeals.map((d) => d.hubspot_deal_id);
    if (dealIds.length === 0) {
      return new Response('No deals match the filters', { status: 404 });
    }

    // Fetch analyses — only export analyzed deals
    let analysisQuery = supabase
      .from('deal_coach_analyses')
      .select('hubspot_deal_id, status, urgency, buyer_sentiment, deal_momentum, recommended_action, reasoning, confidence, key_risk, email_count, call_count, meeting_count, note_count, analyzed_at')
      .in('hubspot_deal_id', dealIds);

    if (statusFilter !== 'all') {
      analysisQuery = analysisQuery.eq('status', statusFilter);
    }

    const { data: analyses, error: analysesError } = await analysisQuery;

    if (analysesError) {
      return NextResponse.json(
        { error: 'Failed to fetch analyses', details: analysesError.message },
        { status: 500 }
      );
    }

    if (!analyses || analyses.length === 0) {
      return new Response('No analyzed deals found', { status: 404 });
    }

    // Build analysis lookup
    const analysisMap = new Map(analyses.map((a) => [a.hubspot_deal_id, a]));

    // Build deal lookup
    const dealMap = new Map(filteredDeals.map((d) => [d.hubspot_deal_id, d]));

    // Build CSV
    const headers = [
      'Deal Name',
      'Amount',
      'AE',
      'Stage',
      'Days in Stage',
      'Close Date',
      'Status',
      'Urgency',
      'Buyer Sentiment',
      'Deal Momentum',
      'Recommended Action',
      'Reasoning',
      'Key Risk',
      'Confidence (%)',
      'Emails',
      'Calls',
      'Meetings',
      'Notes',
      'Lead Source',
      'Products',
      'Next Step',
      'Substage',
      'Analyzed At',
    ];

    const now = new Date();
    const rows = analyses.map((a) => {
      const deal = dealMap.get(a.hubspot_deal_id);
      const ownerName = deal?.owner_id ? ownerMap.get(deal.owner_id) || '' : '';
      const stageName = deal ? STAGE_LABEL_MAP.get(deal.deal_stage) || deal.deal_stage || '' : '';

      // Compute days in stage
      let daysInStage = '';
      if (deal) {
        const entryColumn = STAGE_ENTRY_MAP[deal.deal_stage];
        const dealRecord = deal as Record<string, unknown>;
        if (entryColumn && dealRecord[entryColumn]) {
          const enteredAt = new Date(dealRecord[entryColumn] as string);
          daysInStage = String(Math.floor((now.getTime() - enteredAt.getTime()) / (1000 * 60 * 60 * 24)));
        }
      }

      return [
        escapeCsvField(deal?.deal_name),
        deal?.amount != null ? String(deal.amount) : '',
        escapeCsvField(ownerName),
        escapeCsvField(stageName),
        daysInStage,
        deal?.close_date || '',
        escapeCsvField(a.status),
        escapeCsvField(a.urgency),
        escapeCsvField(a.buyer_sentiment),
        escapeCsvField(a.deal_momentum),
        escapeCsvField(a.recommended_action),
        escapeCsvField(a.reasoning),
        escapeCsvField(a.key_risk),
        a.confidence != null ? String(Math.round(parseFloat(a.confidence) * 100)) : '',
        a.email_count != null ? String(a.email_count) : '',
        a.call_count != null ? String(a.call_count) : '',
        a.meeting_count != null ? String(a.meeting_count) : '',
        a.note_count != null ? String(a.note_count) : '',
        escapeCsvField(deal?.lead_source),
        escapeCsvField(deal?.products),
        escapeCsvField(deal?.next_step),
        escapeCsvField(deal?.deal_substage),
        a.analyzed_at ? new Date(a.analyzed_at).toISOString() : '',
      ].join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');

    const dateStr = now.toISOString().split('T')[0];
    const filename = `deal-coach-analysis-${dateStr}.csv`;

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Deal coach export error:', error);
    return NextResponse.json(
      {
        error: 'Failed to export deal coach data',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
