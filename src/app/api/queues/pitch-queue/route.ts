import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { OPEN_TICKET_STAGE_IDS } from '@/lib/hubspot/ticket-stage-config';

// --- Types ---

export interface PitchAnalysis {
  hubspot_ticket_id: string;
  company_id: string | null;
  company_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  ticket_subject: string | null;
  recommendation: 'pitch' | 'skip' | 'maybe';
  confidence: number;
  talking_points: string | null;
  reasoning: string | null;
  customer_sentiment: 'positive' | 'neutral' | 'negative' | null;
  analyzed_at: string;
}

export interface PitchQueueTicket {
  ticketId: string;
  subject: string | null;
  sourceType: string | null;
  ageDays: number;
  priority: string | null;
  ballInCourt: string | null;
  companyId: string | null;
  companyName: string | null;
  category: string | null;
  analysis: PitchAnalysis | null;
}

export interface PitchQueueResponse {
  tickets: PitchQueueTicket[];
  counts: {
    total: number;
    analyzed: number;
    pitch: number;
    maybe: number;
    skip: number;
    unanalyzed: number;
  };
}

// --- Route Handler ---

export async function GET() {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_PITCH_QUEUE);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  try {
    // Fetch all open tickets
    const { data: openTickets, error: ticketsError } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('is_closed', false)
      .in('pipeline_stage', Array.from(OPEN_TICKET_STAGE_IDS));

    if (ticketsError) {
      console.error('Error fetching open tickets:', ticketsError);
      return NextResponse.json(
        { error: 'Failed to fetch tickets', details: ticketsError.message },
        { status: 500 }
      );
    }

    // Fetch all pitch analyses
    const ticketIds = (openTickets || []).map((t) => t.hubspot_ticket_id);
    const analyses: Record<string, PitchAnalysis> = {};

    if (ticketIds.length > 0) {
      const { data: analysisRows } = await supabase
        .from('pitch_analyses')
        .select('*')
        .in('hubspot_ticket_id', ticketIds);

      for (const row of analysisRows || []) {
        analyses[row.hubspot_ticket_id] = {
          hubspot_ticket_id: row.hubspot_ticket_id,
          company_id: row.company_id,
          company_name: row.company_name,
          contact_name: row.contact_name,
          contact_email: row.contact_email,
          ticket_subject: row.ticket_subject,
          recommendation: row.recommendation,
          confidence: parseFloat(row.confidence),
          talking_points: row.talking_points,
          reasoning: row.reasoning,
          customer_sentiment: row.customer_sentiment,
          analyzed_at: row.analyzed_at,
        };
      }
    }

    // Build ticket list
    const now = new Date();
    const tickets: PitchQueueTicket[] = (openTickets || []).map((ticket) => {
      const createdAt = ticket.hubspot_created_at
        ? new Date(ticket.hubspot_created_at)
        : now;
      const ageDays = Math.floor(
        (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      return {
        ticketId: ticket.hubspot_ticket_id,
        subject: ticket.subject,
        sourceType: ticket.source_type,
        ageDays,
        priority: ticket.priority,
        ballInCourt: ticket.ball_in_court,
        companyId: ticket.hs_primary_company_id,
        companyName: ticket.hs_primary_company_name,
        category: ticket.category,
        analysis: analyses[ticket.hubspot_ticket_id] || null,
      };
    });

    // Sort: unanalyzed first, then by age descending
    tickets.sort((a, b) => {
      if (a.analysis && !b.analysis) return 1;
      if (!a.analysis && b.analysis) return -1;
      return b.ageDays - a.ageDays;
    });

    // Compute counts
    const analyzed = tickets.filter((t) => t.analysis).length;
    const pitch = tickets.filter((t) => t.analysis?.recommendation === 'pitch').length;
    const maybe = tickets.filter((t) => t.analysis?.recommendation === 'maybe').length;
    const skip = tickets.filter((t) => t.analysis?.recommendation === 'skip').length;

    const response: PitchQueueResponse = {
      tickets,
      counts: {
        total: tickets.length,
        analyzed,
        pitch,
        maybe,
        skip,
        unanalyzed: tickets.length - analyzed,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Pitch queue error:', error);
    return NextResponse.json(
      {
        error: 'Failed to get pitch queue',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
