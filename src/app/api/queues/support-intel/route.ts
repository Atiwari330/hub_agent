import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

// --- Types ---

export interface TicketCategorizationResponse {
  hubspot_ticket_id: string;
  primary_category: string;
  subcategory: string | null;
  affected_module: string | null;
  issue_type: string;
  severity: string;
  customer_impact: string | null;
  root_cause_hint: string | null;
  summary: string;
  tags: string[] | null;
  ticket_subject: string | null;
  company_id: string | null;
  company_name: string | null;
  ticket_created_at: string | null;
  is_closed: boolean;
  confidence: number;
  analyzed_at: string;
}

export interface SupportIntelTicket {
  ticketId: string;
  subject: string | null;
  sourceType: string | null;
  ageDays: number;
  priority: string | null;
  ballInCourt: string | null;
  companyId: string | null;
  companyName: string | null;
  category: string | null;
  isClosed: boolean;
  categorization: TicketCategorizationResponse | null;
}

export interface SupportIntelResponse {
  tickets: SupportIntelTicket[];
  counts: {
    total: number;
    categorized: number;
    uncategorized: number;
    bySeverity: { critical: number; high: number; medium: number; low: number };
    topCategory: { name: string; count: number } | null;
  };
}

// --- Route Handler ---

export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_INTEL);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  // Parse query params
  const mode = request.nextUrl.searchParams.get('mode');
  const closedDaysParam = parseInt(request.nextUrl.searchParams.get('closedDays') || '0', 10);
  const closedDays = Math.min(Math.max(isNaN(closedDaysParam) ? 0 : closedDaysParam, 0), 90);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let allTickets: any[] = [];

    if (mode === 'last200') {
      // Fetch the 200 most recent tickets regardless of open/closed status
      const { data: recentTickets, error: recentError } = await supabase
        .from('support_tickets')
        .select('*')
        .order('hubspot_created_at', { ascending: false })
        .limit(200);

      if (recentError) {
        console.error('Error fetching recent tickets:', recentError);
        return NextResponse.json(
          { error: 'Failed to fetch tickets', details: recentError.message },
          { status: 500 }
        );
      }

      allTickets = recentTickets || [];
    } else {
      // Default behavior: always fetch open tickets
      const { data: openTickets, error: openError } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('is_closed', false);

      if (openError) {
        console.error('Error fetching open tickets:', openError);
        return NextResponse.json(
          { error: 'Failed to fetch tickets', details: openError.message },
          { status: 500 }
        );
      }

      // Optionally fetch closed tickets within the date window
      let closedTickets: typeof openTickets = [];
      if (closedDays > 0) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - closedDays);
        const cutoffISO = cutoffDate.toISOString();

        const { data: closedRows, error: closedError } = await supabase
          .from('support_tickets')
          .select('*')
          .eq('is_closed', true)
          .gte('closed_date', cutoffISO);

        if (closedError) {
          console.error('Error fetching closed tickets:', closedError);
          // Non-fatal: continue with just open tickets
        } else {
          closedTickets = closedRows || [];
        }
      }

      allTickets = [...(openTickets || []), ...closedTickets];
    }

    // Fetch all ticket categorizations
    const ticketIds = (allTickets || []).map((t) => t.hubspot_ticket_id);
    const categorizations: Record<string, TicketCategorizationResponse> = {};

    if (ticketIds.length > 0) {
      // Supabase IN clause has a limit; batch if needed
      const batchSize = 500;
      for (let i = 0; i < ticketIds.length; i += batchSize) {
        const batch = ticketIds.slice(i, i + batchSize);
        const { data: catRows } = await supabase
          .from('ticket_categorizations')
          .select('*')
          .in('hubspot_ticket_id', batch);

        for (const row of catRows || []) {
          categorizations[row.hubspot_ticket_id] = {
            hubspot_ticket_id: row.hubspot_ticket_id,
            primary_category: row.primary_category,
            subcategory: row.subcategory,
            affected_module: row.affected_module,
            issue_type: row.issue_type,
            severity: row.severity,
            customer_impact: row.customer_impact,
            root_cause_hint: row.root_cause_hint,
            summary: row.summary,
            tags: row.tags,
            ticket_subject: row.ticket_subject,
            company_id: row.company_id,
            company_name: row.company_name,
            ticket_created_at: row.ticket_created_at,
            is_closed: row.is_closed,
            confidence: parseFloat(row.confidence),
            analyzed_at: row.analyzed_at,
          };
        }
      }
    }

    // Build ticket list
    const now = new Date();
    const tickets: SupportIntelTicket[] = (allTickets || []).map((ticket) => {
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
        isClosed: ticket.is_closed || false,
        categorization: categorizations[ticket.hubspot_ticket_id] || null,
      };
    });

    // Sort: uncategorized first, then by age descending
    tickets.sort((a, b) => {
      if (a.categorization && !b.categorization) return 1;
      if (!a.categorization && b.categorization) return -1;
      return b.ageDays - a.ageDays;
    });

    // Compute counts
    const categorized = tickets.filter((t) => t.categorization).length;
    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    const categoryCounts: Record<string, number> = {};

    for (const t of tickets) {
      if (t.categorization) {
        const sev = t.categorization.severity as keyof typeof severityCounts;
        if (sev in severityCounts) severityCounts[sev]++;

        const cat = t.categorization.primary_category;
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      }
    }

    // Find top category
    let topCategory: { name: string; count: number } | null = null;
    for (const [name, count] of Object.entries(categoryCounts)) {
      if (!topCategory || count > topCategory.count) {
        topCategory = { name, count };
      }
    }

    const response: SupportIntelResponse = {
      tickets,
      counts: {
        total: tickets.length,
        categorized,
        uncategorized: tickets.length - categorized,
        bySeverity: severityCounts,
        topCategory,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Support intel error:', error);
    return NextResponse.json(
      {
        error: 'Failed to get support intel data',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
