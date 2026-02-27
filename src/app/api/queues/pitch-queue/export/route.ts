import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

function escapeCsvField(value: string | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * GET /api/queues/pitch-queue/export
 *
 * Export analyzed pitch queue tickets as a downloadable CSV file.
 * Query params:
 *   - filter: 'all' | 'pitch' | 'maybe' | 'skip' (default: 'all')
 */
export async function GET(request: Request) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_PITCH_QUEUE);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const filter = searchParams.get('filter') || 'all';

  const supabase = await createServerSupabaseClient();

  try {
    // Fetch open tickets
    const { data: openTickets, error: ticketsError } = await supabase
      .from('support_tickets')
      .select('hubspot_ticket_id, subject, source_type, priority, hubspot_created_at, hs_primary_company_name')
      .eq('is_closed', false);

    if (ticketsError) {
      return NextResponse.json(
        { error: 'Failed to fetch tickets', details: ticketsError.message },
        { status: 500 }
      );
    }

    const ticketIds = (openTickets || []).map((t) => t.hubspot_ticket_id);
    if (ticketIds.length === 0) {
      return new Response('No tickets found', { status: 404 });
    }

    // Fetch pitch analyses
    let query = supabase
      .from('pitch_analyses')
      .select('*')
      .in('hubspot_ticket_id', ticketIds);

    if (filter !== 'all') {
      query = query.eq('recommendation', filter);
    }

    const { data: analyses, error: analysesError } = await query;

    if (analysesError) {
      return NextResponse.json(
        { error: 'Failed to fetch analyses', details: analysesError.message },
        { status: 500 }
      );
    }

    if (!analyses || analyses.length === 0) {
      return new Response('No analyzed tickets found', { status: 404 });
    }

    // Build ticket lookup for extra fields
    const ticketMap = new Map(
      (openTickets || []).map((t) => [t.hubspot_ticket_id, t])
    );

    // Build CSV
    const headers = [
      'Company Name',
      'Ticket Subject',
      'Source',
      'Priority',
      'Age (days)',
      'Recommendation',
      'Confidence (%)',
      'Customer Sentiment',
      'Reasoning',
      'Talking Points',
      'Contact Name',
      'Contact Email',
      'Analyzed At',
    ];

    const now = new Date();
    const rows = analyses.map((a) => {
      const ticket = ticketMap.get(a.hubspot_ticket_id);
      const createdAt = ticket?.hubspot_created_at
        ? new Date(ticket.hubspot_created_at)
        : null;
      const ageDays = createdAt
        ? Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24))
        : '';

      return [
        escapeCsvField(a.company_name),
        escapeCsvField(a.ticket_subject),
        escapeCsvField(ticket?.source_type),
        escapeCsvField(ticket?.priority),
        String(ageDays),
        escapeCsvField(a.recommendation),
        a.confidence != null ? String(Math.round(parseFloat(a.confidence) * 100)) : '',
        escapeCsvField(a.customer_sentiment),
        escapeCsvField(a.reasoning),
        escapeCsvField(a.talking_points),
        escapeCsvField(a.contact_name),
        escapeCsvField(a.contact_email),
        a.analyzed_at ? new Date(a.analyzed_at).toISOString() : '',
      ].join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');

    const dateStr = now.toISOString().split('T')[0];
    const filename = `pitch-queue-analysis-${dateStr}.csv`;

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Pitch queue export error:', error);
    return NextResponse.json(
      {
        error: 'Failed to export pitch queue',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
