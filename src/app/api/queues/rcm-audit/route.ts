import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import type { TicketRcmAnalysis } from './analyze/analyze-rcm-core';

// --- Types ---

export interface RcmAuditTicket {
  ticketId: string;
  subject: string | null;
  sourceType: string | null;
  ageDays: number;
  priority: string | null;
  ballInCourt: string | null;
  companyName: string | null;
  isClosed: boolean;
  linearTask: string | null;
  analysis: TicketRcmAnalysis | null;
}

export interface RcmAuditResponse {
  tickets: RcmAuditTicket[];
  counts: {
    total: number;
    analyzed: number;
    unanalyzed: number;
    rcmRelated: number;
    notRcmRelated: number;
    hasLinear: number;
    bySeverity: { critical: number; high: number; medium: number; low: number };
    byCategory: Record<string, number>;
    byStatus: Record<string, number>;
  };
}

// --- Route Handler ---

export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_RCM_AUDIT);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  // Parse query params
  const mode = request.nextUrl.searchParams.get('mode');

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let allTickets: any[] = [];

    if (mode === 'last200') {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .order('hubspot_created_at', { ascending: false })
        .limit(200);

      if (error) {
        return NextResponse.json({ error: 'Failed to fetch tickets', details: error.message }, { status: 500 });
      }
      allTickets = data || [];
    } else {
      // Default: open tickets only
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('is_closed', false);

      if (error) {
        return NextResponse.json({ error: 'Failed to fetch tickets', details: error.message }, { status: 500 });
      }
      allTickets = data || [];
    }

    // Fetch all RCM analyses for these tickets
    const ticketIds = allTickets.map((t) => t.hubspot_ticket_id);
    const analyses: Record<string, TicketRcmAnalysis> = {};

    if (ticketIds.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < ticketIds.length; i += batchSize) {
        const batch = ticketIds.slice(i, i + batchSize);
        const { data: rows } = await supabase
          .from('ticket_rcm_analyses')
          .select('*')
          .in('hubspot_ticket_id', batch);

        for (const row of rows || []) {
          analyses[row.hubspot_ticket_id] = {
            hubspot_ticket_id: row.hubspot_ticket_id,
            is_rcm_related: row.is_rcm_related,
            rcm_system: row.rcm_system,
            issue_category: row.issue_category,
            issue_summary: row.issue_summary,
            problems: row.problems,
            severity: row.severity,
            current_status: row.current_status,
            vendor_blamed: row.vendor_blamed,
            confidence: parseFloat(row.confidence),
            ticket_subject: row.ticket_subject,
            company_name: row.company_name,
            assigned_rep: row.assigned_rep,
            is_closed: row.is_closed,
            analyzed_at: row.analyzed_at,
            linear_issue_id: row.linear_issue_id,
            linear_assessment: row.linear_assessment,
            linear_comment_count: row.linear_comment_count,
            linear_state: row.linear_state,
          };
        }
      }
    }

    // Build ticket list
    const now = new Date();
    const tickets: RcmAuditTicket[] = allTickets.map((ticket) => {
      const createdAt = ticket.hubspot_created_at ? new Date(ticket.hubspot_created_at) : now;
      const ageDays = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

      return {
        ticketId: ticket.hubspot_ticket_id,
        subject: ticket.subject,
        sourceType: ticket.source_type,
        ageDays,
        priority: ticket.priority,
        ballInCourt: ticket.ball_in_court,
        companyName: ticket.hs_primary_company_name,
        isClosed: ticket.is_closed || false,
        linearTask: ticket.linear_task || null,
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
    const rcmRelated = tickets.filter((t) => t.analysis?.is_rcm_related).length;
    const notRcmRelated = tickets.filter((t) => t.analysis && !t.analysis.is_rcm_related).length;
    const hasLinear = tickets.filter((t) => t.linearTask).length;
    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    const categoryCounts: Record<string, number> = {};
    const statusCounts: Record<string, number> = {};

    for (const t of tickets) {
      if (t.analysis?.is_rcm_related) {
        const sev = t.analysis.severity as keyof typeof severityCounts;
        if (sev in severityCounts) severityCounts[sev]++;

        if (t.analysis.issue_category) {
          categoryCounts[t.analysis.issue_category] = (categoryCounts[t.analysis.issue_category] || 0) + 1;
        }
        if (t.analysis.current_status) {
          statusCounts[t.analysis.current_status] = (statusCounts[t.analysis.current_status] || 0) + 1;
        }
      }
    }

    const response: RcmAuditResponse = {
      tickets,
      counts: {
        total: tickets.length,
        analyzed,
        unanalyzed: tickets.length - analyzed,
        rcmRelated,
        notRcmRelated,
        hasLinear,
        bySeverity: severityCounts,
        byCategory: categoryCounts,
        byStatus: statusCounts,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('RCM audit queue error:', error);
    return NextResponse.json(
      { error: 'Failed to get RCM audit data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
