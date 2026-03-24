import { createServiceClient } from '@/lib/supabase/client';
import { getHubSpotTicketUrl } from '@/lib/hubspot/urls';

export interface CoDestinyTicketSummary {
  ticketId: string;
  subject: string | null;
  issueSummary: string | null;
  nextAction: string | null;
  urgency: string | null;
  actionOwner: string | null;
  daysSinceLastActivity: number | null;
  ageDays: number | null;
  customerTemperature: string | null;
  assignedRep: string | null;
  hasLinear: boolean;
  linearTask: string | null;
  hubspotTicketUrl: string;
  appTicketUrl: string;
  hasAnalysis: boolean;
}

export interface CompanyGroup {
  companyName: string;
  companyId: string | null;
  tickets: CoDestinyTicketSummary[];
  companySummary?: string;
}

export interface CoDestinyReportData {
  date: Date;
  companies: CompanyGroup[];
  totals: {
    totalCoDestinyTickets: number;
    flaggedTickets: number;
    byUrgency: Record<string, number>;
  };
}

const NOTEWORTHY_URGENCIES = ['critical', 'high'];
const NOTEWORTHY_TEMPERATURES = ['frustrated', 'escalating', 'angry'];
const STALE_DAYS_THRESHOLD = 2;

function isNoteworthy(
  managerAnalysis: Record<string, unknown> | null,
  actionBoardAnalysis: Record<string, unknown> | null
): boolean {
  if (!managerAnalysis) return true; // unanalyzed VIP ticket = noteworthy

  const urgency = (managerAnalysis.urgency as string)?.toLowerCase();
  if (NOTEWORTHY_URGENCIES.includes(urgency)) return true;

  const actionOwner = managerAnalysis.action_owner as string | null;
  if (actionOwner === 'Support Manager') return true;

  const daysSince = managerAnalysis.days_since_last_activity as number | null;
  if (daysSince != null && daysSince >= STALE_DAYS_THRESHOLD) return true;

  const temp = (actionBoardAnalysis?.customer_temperature as string)?.toLowerCase();
  if (temp && NOTEWORTHY_TEMPERATURES.includes(temp)) return true;

  return false;
}

const URGENCY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export async function getCoDestinyReportData(): Promise<CoDestinyReportData> {
  const supabase = createServiceClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';

  // 1. Fetch all open Co-Destiny tickets
  const { data: tickets, error: ticketsError } = await supabase
    .from('support_tickets')
    .select('hubspot_ticket_id, subject, hs_primary_company_name, hs_primary_company_id, hubspot_owner_id, linear_task, hubspot_created_at')
    .eq('is_co_destiny', true)
    .eq('is_closed', false);

  if (ticketsError) throw new Error(`Failed to fetch Co-Destiny tickets: ${ticketsError.message}`);
  if (!tickets || tickets.length === 0) {
    return {
      date: new Date(),
      companies: [],
      totals: { totalCoDestinyTickets: 0, flaggedTickets: 0, byUrgency: {} },
    };
  }

  const ticketIds = tickets.map((t) => t.hubspot_ticket_id);

  // 2. Batch-fetch manager analyses
  const managerAnalyses: Record<string, Record<string, unknown>> = {};
  for (let i = 0; i < ticketIds.length; i += 500) {
    const batch = ticketIds.slice(i, i + 500);
    const { data: rows } = await supabase
      .from('ticket_support_manager_analyses')
      .select('hubspot_ticket_id, issue_summary, next_action, urgency, action_owner, days_since_last_activity, assigned_rep, age_days, has_linear, linear_state, confidence')
      .in('hubspot_ticket_id', batch);
    if (rows) {
      for (const row of rows) {
        managerAnalyses[row.hubspot_ticket_id] = row;
      }
    }
  }

  // 3. Batch-fetch action board analyses (for customer_temperature)
  const actionBoardAnalyses: Record<string, Record<string, unknown>> = {};
  for (let i = 0; i < ticketIds.length; i += 500) {
    const batch = ticketIds.slice(i, i + 500);
    const { data: rows } = await supabase
      .from('ticket_action_board_analyses')
      .select('hubspot_ticket_id, customer_temperature')
      .in('hubspot_ticket_id', batch);
    if (rows) {
      for (const row of rows) {
        actionBoardAnalyses[row.hubspot_ticket_id] = row;
      }
    }
  }

  // 4. Resolve owner names
  const ownerIds = [...new Set(tickets.map((t) => t.hubspot_owner_id).filter(Boolean))];
  const ownerNames: Record<string, string> = {};
  if (ownerIds.length > 0) {
    const { data: owners } = await supabase
      .from('owners')
      .select('hubspot_owner_id, first_name, last_name')
      .in('hubspot_owner_id', ownerIds);
    if (owners) {
      for (const o of owners) {
        ownerNames[o.hubspot_owner_id] = `${o.first_name || ''} ${o.last_name || ''}`.trim();
      }
    }
  }

  // 5. Group by company, filter noteworthy, build summaries
  const companyMap = new Map<string, { companyId: string | null; tickets: CoDestinyTicketSummary[] }>();
  let flaggedCount = 0;
  const byUrgency: Record<string, number> = {};

  for (const ticket of tickets) {
    const mgr = managerAnalyses[ticket.hubspot_ticket_id] || null;
    const ab = actionBoardAnalyses[ticket.hubspot_ticket_id] || null;

    if (!isNoteworthy(mgr, ab)) continue;

    flaggedCount++;
    const urgency = ((mgr?.urgency as string) || 'unknown').toLowerCase();
    byUrgency[urgency] = (byUrgency[urgency] || 0) + 1;

    const ageDays = mgr
      ? (mgr.age_days as number | null)
      : ticket.hubspot_created_at
        ? Math.floor((Date.now() - new Date(ticket.hubspot_created_at).getTime()) / (1000 * 60 * 60 * 24))
        : null;

    const summary: CoDestinyTicketSummary = {
      ticketId: ticket.hubspot_ticket_id,
      subject: ticket.subject,
      issueSummary: (mgr?.issue_summary as string) || null,
      nextAction: (mgr?.next_action as string) || null,
      urgency,
      actionOwner: (mgr?.action_owner as string) || null,
      daysSinceLastActivity: (mgr?.days_since_last_activity as number) ?? null,
      ageDays,
      customerTemperature: (ab?.customer_temperature as string) || null,
      assignedRep: ownerNames[ticket.hubspot_owner_id] || (mgr?.assigned_rep as string) || null,
      hasLinear: !!(mgr?.has_linear || ticket.linear_task),
      linearTask: ticket.linear_task || null,
      hubspotTicketUrl: getHubSpotTicketUrl(ticket.hubspot_ticket_id),
      appTicketUrl: `${appUrl}/dashboard/queues/support-manager?ticket=${ticket.hubspot_ticket_id}`,
      hasAnalysis: !!mgr,
    };

    const companyName = ticket.hs_primary_company_name || 'Unknown Company';
    if (!companyMap.has(companyName)) {
      companyMap.set(companyName, { companyId: ticket.hs_primary_company_id, tickets: [] });
    }
    companyMap.get(companyName)!.tickets.push(summary);
  }

  // 6. Sort companies alphabetically, tickets by urgency
  const companies: CompanyGroup[] = [...companyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { companyId, tickets: companyTickets }]) => ({
      companyName: name,
      companyId,
      tickets: companyTickets.sort(
        (a, b) => (URGENCY_ORDER[a.urgency || ''] ?? 99) - (URGENCY_ORDER[b.urgency || ''] ?? 99)
      ),
    }));

  return {
    date: new Date(),
    companies,
    totals: {
      totalCoDestinyTickets: tickets.length,
      flaggedTickets: flaggedCount,
      byUrgency,
    },
  };
}
