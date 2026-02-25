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
 * GET /api/queues/support-intel/export
 *
 * Export categorized tickets as a downloadable CSV file.
 * Query params:
 *   - category: filter by primary_category (optional)
 *   - severity: filter by severity (optional)
 *   - issueType: filter by issue_type (optional)
 */
export async function GET(request: Request) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_INTEL);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const categoryFilter = searchParams.get('category');
  const severityFilter = searchParams.get('severity');
  const issueTypeFilter = searchParams.get('issueType');

  const supabase = await createServerSupabaseClient();

  try {
    let query = supabase
      .from('ticket_categorizations')
      .select('*')
      .order('ticket_created_at', { ascending: false });

    if (categoryFilter) {
      query = query.eq('primary_category', categoryFilter);
    }
    if (severityFilter) {
      query = query.eq('severity', severityFilter);
    }
    if (issueTypeFilter) {
      query = query.eq('issue_type', issueTypeFilter);
    }

    const { data: categorizations, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch categorizations', details: error.message },
        { status: 500 }
      );
    }

    if (!categorizations || categorizations.length === 0) {
      return new Response('No categorized tickets found', { status: 404 });
    }

    // Build CSV
    const headers = [
      'Company Name',
      'Ticket Subject',
      'Category',
      'Subcategory',
      'Affected Module',
      'Issue Type',
      'Severity',
      'Summary',
      'Customer Impact',
      'Root Cause Hint',
      'Tags',
      'Confidence (%)',
      'Status',
      'Ticket Created',
      'Analyzed At',
    ];

    const rows = categorizations.map((c) => {
      return [
        escapeCsvField(c.company_name),
        escapeCsvField(c.ticket_subject),
        escapeCsvField(c.primary_category),
        escapeCsvField(c.subcategory),
        escapeCsvField(c.affected_module),
        escapeCsvField(c.issue_type),
        escapeCsvField(c.severity),
        escapeCsvField(c.summary),
        escapeCsvField(c.customer_impact),
        escapeCsvField(c.root_cause_hint),
        escapeCsvField(c.tags ? c.tags.join(', ') : ''),
        c.confidence != null ? String(Math.round(parseFloat(c.confidence) * 100)) : '',
        c.is_closed ? 'Closed' : 'Open',
        c.ticket_created_at ? new Date(c.ticket_created_at).toISOString() : '',
        c.analyzed_at ? new Date(c.analyzed_at).toISOString() : '',
      ].join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');

    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `support-intel-categorizations-${dateStr}.csv`;

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Support intel export error:', error);
    return NextResponse.json(
      {
        error: 'Failed to export categorizations',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
