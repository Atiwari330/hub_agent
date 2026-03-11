import { NextRequest, NextResponse } from 'next/server';
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
 * GET /api/queues/support-quality/export
 *
 * Export quality analyses as CSV.
 * Query params:
 *   - grade: filter by quality_grade (optional)
 *   - sentiment: filter by customer_sentiment (optional)
 *   - rep: filter by assigned_rep (optional)
 */
export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_QUALITY);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const gradeFilter = searchParams.get('grade');
  const sentimentFilter = searchParams.get('sentiment');
  const repFilter = searchParams.get('rep');

  const supabase = await createServerSupabaseClient();

  try {
    let query = supabase
      .from('ticket_quality_analyses')
      .select('*')
      .order('analyzed_at', { ascending: false });

    if (gradeFilter) query = query.eq('quality_grade', gradeFilter);
    if (sentimentFilter) query = query.eq('customer_sentiment', sentimentFilter);
    if (repFilter) query = query.eq('assigned_rep', repFilter);

    const { data: analyses, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch analyses', details: error.message },
        { status: 500 }
      );
    }

    if (!analyses || analyses.length === 0) {
      return new Response('No quality analyses found', { status: 404 });
    }

    const headers = [
      'Ticket ID',
      'Subject',
      'Company',
      'Assigned Rep',
      'Quality Grade',
      'Overall Score',
      'Rep Competence',
      'Communication',
      'Resolution',
      'Efficiency',
      'Customer Sentiment',
      'Resolution Status',
      'Handling Quality',
      'Category',
      'Severity',
      'Rep Assessment',
      'Communication Assessment',
      'Resolution Assessment',
      'Efficiency Assessment',
      'Key Observations',
      'Improvement Areas',
      'Confidence (%)',
      'Status',
      'Ticket Created',
      'Analyzed At',
    ];

    const rows = analyses.map((a) =>
      [
        escapeCsvField(a.hubspot_ticket_id),
        escapeCsvField(a.ticket_subject),
        escapeCsvField(a.company_name),
        escapeCsvField(a.assigned_rep),
        escapeCsvField(a.quality_grade),
        String(a.overall_quality_score),
        String(a.rep_competence_score),
        String(a.communication_score),
        String(a.resolution_score),
        String(a.efficiency_score),
        escapeCsvField(a.customer_sentiment),
        escapeCsvField(a.resolution_status),
        escapeCsvField(a.handling_quality),
        escapeCsvField(a.primary_category),
        escapeCsvField(a.severity),
        escapeCsvField(a.rep_assessment),
        escapeCsvField(a.communication_assessment),
        escapeCsvField(a.resolution_assessment),
        escapeCsvField(a.efficiency_assessment),
        escapeCsvField(a.key_observations),
        escapeCsvField(a.improvement_areas),
        a.confidence != null ? String(Math.round(parseFloat(a.confidence) * 100)) : '',
        a.is_closed ? 'Closed' : 'Open',
        a.ticket_created_at ? new Date(a.ticket_created_at).toISOString() : '',
        a.analyzed_at ? new Date(a.analyzed_at).toISOString() : '',
      ].join(',')
    );

    const csv = [headers.join(','), ...rows].join('\n');
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `support-quality-analyses-${dateStr}.csv`;

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Support quality export error:', error);
    return NextResponse.json(
      {
        error: 'Failed to export quality analyses',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
