import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

// --- Types ---

type ViolationType = 'no_response' | 'customer_hanging' | 'customer_dark';
type Severity = 'critical' | 'warning' | 'watch';

export interface FollowUpAnalysisResponse {
  status: 'confirmed' | 'false_positive' | 'monitoring';
  urgency: 'critical' | 'high' | 'medium' | 'low';
  customer_sentiment: string | null;
  recommended_action: string;
  reasoning: string;
  last_meaningful_contact: string | null;
  confidence: number;
  engagement_count: number;
  analyzed_at: string;
}

export interface FollowUpTicket {
  ticketId: string;
  subject: string | null;
  companyName: string | null;
  companyId: string | null;
  ownerName: string | null;
  ownerId: string | null;
  priority: string | null;
  ageDays: number;
  violationType: ViolationType;
  violationLabel: string;
  severity: Severity;
  gapHours: number;
  gapDisplay: string;
  recommendedAction: string;
  pipelineStage: string | null;
  ballInCourt: string | null;
  linearTask: string | null;
  analysis: FollowUpAnalysisResponse | null;
}

export interface FollowUpQueueResponse {
  tickets: FollowUpTicket[];
  counts: {
    total: number;
    critical: number;
    warning: number;
    watch: number;
    byType: {
      noResponse: number;
      customerHanging: number;
      customerDark: number;
    };
    analyzed: number;
    unanalyzed: number;
    confirmed: number;
    falsePositive: number;
    monitoring: number;
  };
}

// --- Helpers ---

const SEVERITY_ORDER: Record<Severity, number> = { critical: 3, warning: 2, watch: 1 };

function formatGap(hours: number): string {
  if (hours < 1) return '<1h';
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = Math.round(hours % 24);
  if (remainingHours === 0) return `${days}d`;
  return `${days}d ${remainingHours}h`;
}

function hoursSince(date: Date, now: Date): number {
  return (now.getTime() - date.getTime()) / (1000 * 60 * 60);
}

// --- Route Handler ---

export async function GET() {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_FOLLOW_UP);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  try {
    // Fetch all open tickets
    const { data: openTickets, error: ticketsError } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('is_closed', false);

    if (ticketsError) {
      console.error('Error fetching open tickets:', ticketsError);
      return NextResponse.json(
        { error: 'Failed to fetch tickets', details: ticketsError.message },
        { status: 500 }
      );
    }

    // Fetch owner names for display
    const ownerIds = [
      ...new Set(
        (openTickets || [])
          .map((t) => t.hubspot_owner_id)
          .filter((id): id is string => id !== null)
      ),
    ];

    const ownerMap = new Map<string, string>();
    if (ownerIds.length > 0) {
      const { data: owners } = await supabase
        .from('owners')
        .select('hubspot_owner_id, first_name, last_name')
        .in('hubspot_owner_id', ownerIds);

      for (const owner of owners || []) {
        const name = [owner.first_name, owner.last_name]
          .filter(Boolean)
          .join(' ');
        ownerMap.set(owner.hubspot_owner_id, name || 'Unknown');
      }
    }

    const now = new Date();
    const results: Omit<FollowUpTicket, 'analysis'>[] = [];

    for (const ticket of openTickets || []) {
      const createdAt = ticket.hubspot_created_at
        ? new Date(ticket.hubspot_created_at)
        : now;
      const ageDays = Math.floor(
        (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      const lastCustomerMsg = ticket.last_customer_message_at
        ? new Date(ticket.last_customer_message_at)
        : null;
      const lastAgentMsg = ticket.last_agent_message_at
        ? new Date(ticket.last_agent_message_at)
        : null;

      const base = {
        ticketId: ticket.hubspot_ticket_id,
        subject: ticket.subject,
        companyName: ticket.hs_primary_company_name,
        companyId: ticket.hs_primary_company_id,
        ownerName: ticket.hubspot_owner_id
          ? ownerMap.get(ticket.hubspot_owner_id) || null
          : null,
        ownerId: ticket.hubspot_owner_id,
        priority: ticket.priority,
        ageDays,
        pipelineStage: ticket.pipeline_stage,
        ballInCourt: ticket.ball_in_court || null,
        linearTask: ticket.linear_task || null,
      };

      // Scenario 3: No First Response
      if (!lastAgentMsg) {
        const gapHours = hoursSince(createdAt, now);
        if (gapHours >= 4) {
          const severity: Severity = gapHours >= 8 ? 'critical' : 'warning';
          results.push({
            ...base,
            violationType: 'no_response',
            violationLabel: 'No Response',
            severity,
            gapHours,
            gapDisplay: formatGap(gapHours),
            recommendedAction: 'Send first response',
          });
        }
        continue;
      }

      // Scenario 1: Customer Hanging — customer sent a message after agent's last message
      if (lastCustomerMsg && lastCustomerMsg > lastAgentMsg) {
        const gapHours = hoursSince(lastCustomerMsg, now);
        const gapDays = gapHours / 24;
        if (gapDays >= 1) {
          const severity: Severity = gapDays >= 2 ? 'critical' : 'warning';
          results.push({
            ...base,
            violationType: 'customer_hanging',
            violationLabel: 'Needs Reply',
            severity,
            gapHours,
            gapDisplay: formatGap(gapHours),
            recommendedAction:
              gapDays >= 2
                ? 'Reply urgently — customer waiting 2+ days'
                : 'Reply to customer',
          });
          continue;
        }
      }

      // Scenario 2: Customer Dark — agent sent last message, no customer reply, gap growing
      if (
        lastAgentMsg &&
        (!lastCustomerMsg || lastAgentMsg > lastCustomerMsg)
      ) {
        const gapHours = hoursSince(lastAgentMsg, now);
        const gapDays = gapHours / 24;
        if (gapDays >= 2) {
          const severity: Severity =
            gapDays >= 6
              ? 'critical'
              : gapDays >= 4
                ? 'warning'
                : 'watch';
          const recommendedAction =
            gapDays >= 6
              ? 'Send close warning'
              : gapDays >= 4
                ? 'Send second nudge'
                : 'Send first nudge';
          results.push({
            ...base,
            violationType: 'customer_dark',
            violationLabel: 'Needs Follow-Up',
            severity,
            gapHours,
            gapDisplay: formatGap(gapHours),
            recommendedAction,
          });
        }
      }
    }

    // Sort by severity (critical first), then gap descending
    results.sort((a, b) => {
      const sevDiff = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
      if (sevDiff !== 0) return sevDiff;
      return b.gapHours - a.gapHours;
    });

    // Fetch existing analyses from follow_up_analyses table
    const ticketIds = results.map((t) => t.ticketId);
    const analysisMap = new Map<string, FollowUpAnalysisResponse>();

    if (ticketIds.length > 0) {
      const { data: analyses } = await supabase
        .from('follow_up_analyses')
        .select('hubspot_ticket_id, status, urgency, customer_sentiment, recommended_action, reasoning, last_meaningful_contact, confidence, engagement_count, analyzed_at')
        .in('hubspot_ticket_id', ticketIds);

      for (const a of analyses || []) {
        analysisMap.set(a.hubspot_ticket_id, {
          status: a.status,
          urgency: a.urgency,
          customer_sentiment: a.customer_sentiment,
          recommended_action: a.recommended_action,
          reasoning: a.reasoning,
          last_meaningful_contact: a.last_meaningful_contact,
          confidence: a.confidence,
          engagement_count: a.engagement_count,
          analyzed_at: a.analyzed_at,
        });
      }
    }

    // Attach analysis to each ticket
    const ticketsWithAnalysis: FollowUpTicket[] = results.map((t) => ({
      ...t,
      analysis: analysisMap.get(t.ticketId) || null,
    }));

    const analyzed = ticketsWithAnalysis.filter((t) => t.analysis).length;
    const confirmed = ticketsWithAnalysis.filter((t) => t.analysis?.status === 'confirmed').length;
    const falsePositive = ticketsWithAnalysis.filter((t) => t.analysis?.status === 'false_positive').length;
    const monitoring = ticketsWithAnalysis.filter((t) => t.analysis?.status === 'monitoring').length;

    const response: FollowUpQueueResponse = {
      tickets: ticketsWithAnalysis,
      counts: {
        total: ticketsWithAnalysis.length,
        critical: ticketsWithAnalysis.filter((t) => t.severity === 'critical').length,
        warning: ticketsWithAnalysis.filter((t) => t.severity === 'warning').length,
        watch: ticketsWithAnalysis.filter((t) => t.severity === 'watch').length,
        byType: {
          noResponse: ticketsWithAnalysis.filter((t) => t.violationType === 'no_response').length,
          customerHanging: ticketsWithAnalysis.filter((t) => t.violationType === 'customer_hanging').length,
          customerDark: ticketsWithAnalysis.filter((t) => t.violationType === 'customer_dark').length,
        },
        analyzed,
        unanalyzed: ticketsWithAnalysis.length - analyzed,
        confirmed,
        falsePositive,
        monitoring,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Follow-up queue error:', error);
    return NextResponse.json(
      {
        error: 'Failed to get follow-up queue',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
