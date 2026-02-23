import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

// --- Risk Scoring ---

interface RiskResult {
  score: number;
  level: 'Critical' | 'Warning' | 'Watch' | 'Healthy';
  reasons: string[];
}

function computeRisk(params: {
  openCount: number;
  oldestAgeDays: number;
  slaBreachCount: number;
  engineeringEscalations: number;
  waitingOnUs: number;
}): RiskResult {
  let score = 0;
  const reasons: string[] = [];

  // Open ticket volume
  if (params.openCount >= 5) {
    score += 25;
    reasons.push(`${params.openCount} open tickets`);
  } else if (params.openCount >= 3) {
    score += 15;
    reasons.push(`${params.openCount} open tickets`);
  } else if (params.openCount >= 1) {
    score += 5;
  }

  // Oldest ticket age
  if (params.oldestAgeDays >= 30) {
    score += 25;
    reasons.push(`Oldest ticket ${params.oldestAgeDays}d old`);
  } else if (params.oldestAgeDays >= 14) {
    score += 15;
    reasons.push(`Oldest ticket ${params.oldestAgeDays}d old`);
  } else if (params.oldestAgeDays >= 7) {
    score += 5;
  }

  // SLA breaches
  if (params.slaBreachCount >= 2) {
    score += 25;
    reasons.push(`${params.slaBreachCount} SLA breaches`);
  } else if (params.slaBreachCount >= 1) {
    score += 15;
    reasons.push('SLA breach');
  }

  // Engineering escalations
  if (params.engineeringEscalations >= 2) {
    score += 15;
    reasons.push(`${params.engineeringEscalations} engineering escalations`);
  } else if (params.engineeringEscalations >= 1) {
    score += 10;
    reasons.push('Engineering escalation');
  }

  // Waiting on us (ball in Support or Engineering court)
  if (params.waitingOnUs >= 2) {
    score += 10;
    reasons.push(`${params.waitingOnUs} tickets waiting on us`);
  }

  // Cap at 100
  score = Math.min(score, 100);

  const level =
    score >= 60
      ? 'Critical'
      : score >= 35
        ? 'Warning'
        : score >= 10
          ? 'Watch'
          : 'Healthy';

  return { score, level, reasons };
}

// --- Types ---

export interface SupportPulseTicket {
  ticketId: string;
  subject: string | null;
  sourceType: string | null;
  ageDays: number;
  priority: string | null;
  ballInCourt: string | null;
  pipelineStage: string | null;
  hasSLABreach: boolean;
  hasLinearTask: boolean;
}

export interface SupportPulseAccount {
  companyId: string | null;
  companyName: string | null;
  arr: number | null;
  openTicketCount: number;
  oldestOpenTicketDays: number;
  avgTimeToCloseHours: number | null;
  slaBreachCount: number;
  engineeringEscalations: number;
  waitingOnSupport: number;
  riskScore: number;
  riskLevel: 'Critical' | 'Warning' | 'Watch' | 'Healthy';
  alertReasons: string[];
  openTickets: SupportPulseTicket[];
}

export interface SupportPulseResponse {
  accounts: SupportPulseAccount[];
  counts: {
    total: number;
    critical: number;
    warning: number;
    watch: number;
  };
  summary: {
    totalOpenTickets: number;
    totalSLABreaches: number;
    totalEscalations: number;
    avgResolutionHours: number | null;
  };
}

// --- Route Handler ---

export async function GET() {
  // Check authorization
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_PULSE);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  try {
    // Fetch all open tickets
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

    // Fetch recently closed tickets for resolution metrics
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const { data: closedTickets, error: closedError } = await supabase
      .from('support_tickets')
      .select(
        'hs_primary_company_id, time_to_close'
      )
      .eq('is_closed', true)
      .gte('closed_date', ninetyDaysAgo.toISOString());

    if (closedError) {
      console.error('Error fetching closed tickets:', closedError);
      return NextResponse.json(
        { error: 'Failed to fetch closed tickets', details: closedError.message },
        { status: 500 }
      );
    }

    // Get company ARR from companies table
    const companyIds = [
      ...new Set(
        (openTickets || [])
          .map((t) => t.hs_primary_company_id)
          .filter((id): id is string => id !== null)
      ),
    ];

    const companyArrMap = new Map<string, number | null>();
    if (companyIds.length > 0) {
      const { data: companies } = await supabase
        .from('companies')
        .select('hubspot_company_id, arr')
        .in('hubspot_company_id', companyIds);

      for (const company of companies || []) {
        companyArrMap.set(company.hubspot_company_id, company.arr);
      }
    }

    // Build avg time-to-close map by company
    const closedByCompany = new Map<string, number[]>();
    for (const ticket of closedTickets || []) {
      if (ticket.hs_primary_company_id && ticket.time_to_close) {
        const existing = closedByCompany.get(ticket.hs_primary_company_id) || [];
        existing.push(ticket.time_to_close);
        closedByCompany.set(ticket.hs_primary_company_id, existing);
      }
    }

    // Group open tickets by company
    const now = new Date();
    const ticketsByCompany = new Map<
      string,
      {
        companyName: string | null;
        tickets: (typeof openTickets)[number][];
      }
    >();

    for (const ticket of openTickets || []) {
      const companyKey = ticket.hs_primary_company_id || '__no_company__';
      const existing = ticketsByCompany.get(companyKey);
      if (existing) {
        existing.tickets.push(ticket);
      } else {
        ticketsByCompany.set(companyKey, {
          companyName: ticket.hs_primary_company_name,
          tickets: [ticket],
        });
      }
    }

    // Build account-level aggregation
    const accounts: SupportPulseAccount[] = [];
    let totalSLABreaches = 0;
    let totalEscalations = 0;

    for (const [companyId, { companyName, tickets }] of ticketsByCompany) {
      const actualCompanyId =
        companyId === '__no_company__' ? null : companyId;

      // Compute metrics
      let oldestAgeDays = 0;
      let slaBreachCount = 0;
      let engineeringEscalations = 0;
      let waitingOnUs = 0;
      const openTicketItems: SupportPulseTicket[] = [];

      for (const ticket of tickets) {
        // Age in days
        const createdAt = ticket.hubspot_created_at
          ? new Date(ticket.hubspot_created_at)
          : now;
        const ageDays = Math.floor(
          (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (ageDays > oldestAgeDays) oldestAgeDays = ageDays;

        // SLA breaches
        const hasSLABreach =
          ticket.frt_sla_breached === true ||
          ticket.nrt_sla_breached === true;
        if (hasSLABreach) slaBreachCount++;

        // Engineering escalations
        const hasLinearTask = !!ticket.linear_task;
        if (hasLinearTask) engineeringEscalations++;

        // Ball in court
        const bic = (ticket.ball_in_court || '').toLowerCase();
        if (bic === 'support' || bic === 'engineering') {
          waitingOnUs++;
        }

        openTicketItems.push({
          ticketId: ticket.hubspot_ticket_id,
          subject: ticket.subject,
          sourceType: ticket.source_type,
          ageDays,
          priority: ticket.priority,
          ballInCourt: ticket.ball_in_court,
          pipelineStage: ticket.pipeline_stage,
          hasSLABreach,
          hasLinearTask,
        });
      }

      totalSLABreaches += slaBreachCount;
      totalEscalations += engineeringEscalations;

      // Avg time-to-close for this company
      const closedTimes = actualCompanyId
        ? closedByCompany.get(actualCompanyId)
        : null;
      const avgTimeToCloseHours = closedTimes && closedTimes.length > 0
        ? closedTimes.reduce((sum, t) => sum + t, 0) /
          closedTimes.length /
          (1000 * 60 * 60) // ms → hours
        : null;

      // Risk scoring
      const risk = computeRisk({
        openCount: tickets.length,
        oldestAgeDays,
        slaBreachCount,
        engineeringEscalations,
        waitingOnUs,
      });

      // Sort drill-down tickets by age descending
      openTicketItems.sort((a, b) => b.ageDays - a.ageDays);

      accounts.push({
        companyId: actualCompanyId,
        companyName,
        arr: actualCompanyId
          ? companyArrMap.get(actualCompanyId) ?? null
          : null,
        openTicketCount: tickets.length,
        oldestOpenTicketDays: oldestAgeDays,
        avgTimeToCloseHours: avgTimeToCloseHours
          ? Math.round(avgTimeToCloseHours * 10) / 10
          : null,
        slaBreachCount,
        engineeringEscalations,
        waitingOnSupport: waitingOnUs,
        riskScore: risk.score,
        riskLevel: risk.level,
        alertReasons: risk.reasons,
        openTickets: openTicketItems,
      });
    }

    // Sort by risk score descending
    accounts.sort((a, b) => b.riskScore - a.riskScore);

    // Compute overall avg resolution time
    const allClosedTimes = (closedTickets || [])
      .map((t) => t.time_to_close)
      .filter((t): t is number => t !== null);
    const overallAvgResolutionHours =
      allClosedTimes.length > 0
        ? Math.round(
            (allClosedTimes.reduce((sum, t) => sum + t, 0) /
              allClosedTimes.length /
              (1000 * 60 * 60)) *
              10
          ) / 10
        : null;

    const response: SupportPulseResponse = {
      accounts,
      counts: {
        total: accounts.length,
        critical: accounts.filter((a) => a.riskLevel === 'Critical').length,
        warning: accounts.filter((a) => a.riskLevel === 'Warning').length,
        watch: accounts.filter((a) => a.riskLevel === 'Watch').length,
      },
      summary: {
        totalOpenTickets: (openTickets || []).length,
        totalSLABreaches,
        totalEscalations,
        avgResolutionHours: overallAvgResolutionHours,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Support pulse error:', error);
    return NextResponse.json(
      {
        error: 'Failed to get support pulse',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
