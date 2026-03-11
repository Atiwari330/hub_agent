import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

// --- Types ---

export interface QualityTicket {
  ticketId: string;
  subject: string | null;
  sourceType: string | null;
  ageDays: number;
  priority: string | null;
  ballInCourt: string | null;
  companyName: string | null;
  isClosed: boolean;
  analysis: {
    overall_quality_score: number;
    quality_grade: string;
    rep_competence_score: number;
    communication_score: number;
    resolution_score: number;
    efficiency_score: number;
    customer_sentiment: string;
    resolution_status: string;
    handling_quality: string;
    rep_assessment: string;
    communication_assessment: string;
    resolution_assessment: string;
    efficiency_assessment: string;
    key_observations: string;
    improvement_areas: string | null;
    assigned_rep: string | null;
    primary_category: string | null;
    severity: string | null;
    confidence: number;
    analyzed_at: string;
  } | null;
}

export interface SupportQualityResponse {
  tickets: QualityTicket[];
  counts: {
    total: number;
    analyzed: number;
    unanalyzed: number;
    byGrade: Record<string, number>;
    bySentiment: Record<string, number>;
  };
}

/**
 * GET /api/queues/support-quality
 *
 * List tickets with their quality analyses (if available).
 * Query params:
 *   - mode: 'open' (default) | 'last200' | 'all'
 *   - closedDays: include closed tickets from last N days
 */
export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_QUALITY);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') || 'open';
  const closedDays = searchParams.get('closedDays')
    ? parseInt(searchParams.get('closedDays')!, 10)
    : undefined;

  const supabase = await createServerSupabaseClient();

  try {
    // Fetch tickets
    let ticketQuery = supabase
      .from('support_tickets')
      .select('hubspot_ticket_id, subject, source_type, priority, ball_in_court, hs_primary_company_name, is_closed, hubspot_created_at')
      .order('hubspot_created_at', { ascending: false });

    if (mode === 'open') {
      ticketQuery = ticketQuery.eq('is_closed', false);
    } else if (mode === 'last200') {
      ticketQuery = ticketQuery.limit(200);
    }

    if (closedDays) {
      const since = new Date();
      since.setDate(since.getDate() - closedDays);
      ticketQuery = ticketQuery.gte('hubspot_created_at', since.toISOString());
    }

    const { data: tickets, error: ticketError } = await ticketQuery;

    if (ticketError) {
      return NextResponse.json(
        { error: 'Failed to fetch tickets', details: ticketError.message },
        { status: 500 }
      );
    }

    if (!tickets || tickets.length === 0) {
      return NextResponse.json({
        tickets: [],
        counts: { total: 0, analyzed: 0, unanalyzed: 0, byGrade: {}, bySentiment: {} },
      });
    }

    // Fetch quality analyses
    const ticketIds = tickets.map((t) => t.hubspot_ticket_id);
    const { data: analyses } = await supabase
      .from('ticket_quality_analyses')
      .select('*')
      .in('hubspot_ticket_id', ticketIds);

    const analysisMap = new Map(
      (analyses || []).map((a) => [a.hubspot_ticket_id, a])
    );

    // Build response
    const now = Date.now();
    const byGrade: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    const bySentiment: Record<string, number> = {};
    let analyzed = 0;

    const qualityTickets: QualityTicket[] = tickets.map((t) => {
      const a = analysisMap.get(t.hubspot_ticket_id);
      const createdAt = t.hubspot_created_at ? new Date(t.hubspot_created_at).getTime() : now;
      const ageDays = Math.round((now - createdAt) / (1000 * 60 * 60 * 24));

      if (a) {
        analyzed++;
        byGrade[a.quality_grade] = (byGrade[a.quality_grade] || 0) + 1;
        bySentiment[a.customer_sentiment] = (bySentiment[a.customer_sentiment] || 0) + 1;
      }

      return {
        ticketId: t.hubspot_ticket_id,
        subject: t.subject,
        sourceType: t.source_type,
        ageDays,
        priority: t.priority,
        ballInCourt: t.ball_in_court,
        companyName: t.hs_primary_company_name,
        isClosed: t.is_closed || false,
        analysis: a
          ? {
              overall_quality_score: a.overall_quality_score,
              quality_grade: a.quality_grade,
              rep_competence_score: a.rep_competence_score,
              communication_score: a.communication_score,
              resolution_score: a.resolution_score,
              efficiency_score: a.efficiency_score,
              customer_sentiment: a.customer_sentiment,
              resolution_status: a.resolution_status,
              handling_quality: a.handling_quality,
              rep_assessment: a.rep_assessment,
              communication_assessment: a.communication_assessment,
              resolution_assessment: a.resolution_assessment,
              efficiency_assessment: a.efficiency_assessment,
              key_observations: a.key_observations,
              improvement_areas: a.improvement_areas,
              assigned_rep: a.assigned_rep,
              primary_category: a.primary_category,
              severity: a.severity,
              confidence: a.confidence,
              analyzed_at: a.analyzed_at,
            }
          : null,
      };
    });

    const response: SupportQualityResponse = {
      tickets: qualityTickets,
      counts: {
        total: tickets.length,
        analyzed,
        unanalyzed: tickets.length - analyzed,
        byGrade,
        bySentiment,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Support quality list error:', error);
    return NextResponse.json(
      {
        error: 'Failed to list support quality data',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
