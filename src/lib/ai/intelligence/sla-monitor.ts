import { createServiceClient } from '@/lib/supabase/client';
import { upsertAlert, resolveAlerts } from './alert-utils';

/**
 * SLA Monitor — Phase 6, Proactive Intelligence
 *
 * Pure computation — no LLM needed.
 * Tracks SLA timers and pushes alerts at configurable thresholds.
 *
 * SLA rules:
 *   First response: 4 business hours (standard), 1 hour (VIP)
 *   Next response:  8 business hours (standard), 4 hours (VIP)
 *
 * Thresholds:
 *   50% → info "SLA Watch"
 *   75% → warning "SLA Warning"
 *   90% → critical "SLA Critical"
 *   100% → critical "SLA Breached"
 *
 * Business hours: 9 AM – 7 PM ET, Mon-Fri (10 hours/day)
 */

const TIMEZONE = 'America/New_York';
const BH_START = 9;  // 9 AM ET
const BH_END = 19;   // 7 PM ET
// SLA targets in business hours
const SLA_TARGETS = {
  standard: {
    first_response: 4,
    next_response: 8,
  },
  vip: {
    first_response: 1,
    next_response: 4,
  },
};

export interface SlaCheckResult {
  ticketId: string;
  slaType: 'first_response' | 'next_response';
  slaTargetHours: number;
  elapsedBusinessHours: number;
  percentUsed: number;
  severity: 'ok' | 'info' | 'warning' | 'critical';
  alertCreated: boolean;
}

/**
 * Run SLA monitoring across all open tickets.
 * Returns per-ticket results.
 */
export async function runSlaMonitor(): Promise<{
  ticketsChecked: number;
  alertsCreated: number;
  alertsResolved: number;
  breaches: string[];
  results: SlaCheckResult[];
  errors: string[];
}> {
  const supabase = createServiceClient();

  // Get all open tickets where a customer is waiting (ball_in_court or last message is from customer)
  const { data: tickets, error } = await supabase
    .from('support_tickets')
    .select('hubspot_ticket_id, last_customer_message_at, last_agent_message_at, hubspot_created_at, is_co_destiny')
    .eq('is_closed', false);

  if (error || !tickets) {
    return {
      ticketsChecked: 0, alertsCreated: 0, alertsResolved: 0,
      breaches: [], results: [], errors: [error?.message || 'No tickets'],
    };
  }

  const output = {
    ticketsChecked: 0,
    alertsCreated: 0,
    alertsResolved: 0,
    breaches: [] as string[],
    results: [] as SlaCheckResult[],
    errors: [] as string[],
  };

  const now = new Date();

  for (const ticket of tickets) {
    try {
      const result = await checkTicketSla(ticket, now);
      output.ticketsChecked++;
      output.results.push(result);

      if (result.alertCreated) output.alertsCreated++;
      if (result.percentUsed >= 100) output.breaches.push(ticket.hubspot_ticket_id);

      // If SLA is ok (customer not waiting or responded), resolve any existing SLA alert
      if (result.severity === 'ok') {
        const resolved = await resolveAlerts(ticket.hubspot_ticket_id, 'sla_warning');
        output.alertsResolved += resolved;
      }
    } catch (err) {
      output.errors.push(`${ticket.hubspot_ticket_id}: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }

  return output;
}

async function checkTicketSla(
  ticket: {
    hubspot_ticket_id: string;
    last_customer_message_at: string | null;
    last_agent_message_at: string | null;
    hubspot_created_at: string | null;
    is_co_destiny: boolean | null;
  },
  now: Date
): Promise<SlaCheckResult> {
  const isVip = ticket.is_co_destiny || false;
  const targets = isVip ? SLA_TARGETS.vip : SLA_TARGETS.standard;

  // Determine which SLA applies
  const lastCustomer = ticket.last_customer_message_at ? new Date(ticket.last_customer_message_at) : null;
  const lastAgent = ticket.last_agent_message_at ? new Date(ticket.last_agent_message_at) : null;

  // If no customer message or agent responded after customer, SLA is met
  if (!lastCustomer || (lastAgent && lastAgent.getTime() >= lastCustomer.getTime())) {
    return {
      ticketId: ticket.hubspot_ticket_id,
      slaType: 'next_response',
      slaTargetHours: targets.next_response,
      elapsedBusinessHours: 0,
      percentUsed: 0,
      severity: 'ok',
      alertCreated: false,
    };
  }

  // Determine SLA type: first_response if no agent has ever replied
  const slaType = lastAgent ? 'next_response' : 'first_response';
  const slaTarget = slaType === 'first_response' ? targets.first_response : targets.next_response;

  // Calculate business hours elapsed since the customer message
  const elapsed = calculateBusinessHours(lastCustomer, now);
  const percentUsed = Math.round((elapsed / slaTarget) * 100);

  let severity: SlaCheckResult['severity'] = 'ok';
  let alertCreated = false;

  if (percentUsed >= 100) {
    severity = 'critical';
  } else if (percentUsed >= 90) {
    severity = 'critical';
  } else if (percentUsed >= 75) {
    severity = 'warning';
  } else if (percentUsed >= 50) {
    severity = 'info';
  }

  if (severity !== 'ok') {
    const remainingHours = Math.max(0, slaTarget - elapsed);
    const label = percentUsed >= 100
      ? 'SLA Breached'
      : percentUsed >= 90
        ? 'SLA Critical'
        : percentUsed >= 75
          ? 'SLA Warning'
          : 'SLA Watch';

    await upsertAlert({
      ticketId: ticket.hubspot_ticket_id,
      alertType: 'sla_warning',
      severity,
      title: `${label} (${percentUsed}%)`,
      description: percentUsed >= 100
        ? `SLA breached — customer has been waiting ${formatHours(elapsed)} (target: ${slaTarget}h)`
        : `${formatHours(remainingHours)} remaining before SLA breach`,
      metadata: {
        sla_type: slaType,
        sla_target_hours: slaTarget,
        elapsed_business_hours: Math.round(elapsed * 10) / 10,
        percent_used: percentUsed,
        is_vip: isVip,
        customer_waiting_since: lastCustomer.toISOString(),
      },
    });
    alertCreated = true;
  }

  return {
    ticketId: ticket.hubspot_ticket_id,
    slaType,
    slaTargetHours: slaTarget,
    elapsedBusinessHours: Math.round(elapsed * 10) / 10,
    percentUsed,
    severity,
    alertCreated,
  };
}

/**
 * Calculate business hours between two dates.
 * Business hours: 9 AM – 7 PM ET, Monday–Friday.
 */
export function calculateBusinessHours(start: Date, end: Date): number {
  if (end <= start) return 0;

  let totalHours = 0;
  const current = new Date(start);

  // Iterate day by day
  while (current < end) {
    const etParts = getETParts(current);
    const dayOfWeek = etParts.weekday;
    const hour = etParts.hour;

    // Skip weekends
    if (dayOfWeek === 'Sat' || dayOfWeek === 'Sun') {
      advanceToNextDay(current);
      continue;
    }

    if (hour < BH_START) {
      // Before business hours — skip to start of business
      setToBusinessStart(current);
      if (current >= end) break;
      continue;
    }

    if (hour >= BH_END) {
      // After business hours — skip to next day
      advanceToNextDay(current);
      continue;
    }

    // Within business hours
    const effectiveEnd = new Date(Math.min(
      getEndOfBusinessDay(current).getTime(),
      end.getTime()
    ));

    const hoursThisSlot = (effectiveEnd.getTime() - current.getTime()) / (1000 * 60 * 60);
    totalHours += Math.max(0, hoursThisSlot);

    // Move to the effective end
    current.setTime(effectiveEnd.getTime());

    // If we hit end of business day, advance to next day
    if (current.getTime() >= getEndOfBusinessDay(current).getTime()) {
      advanceToNextDay(current);
    }
  }

  return totalHours;
}

// --- Timezone helpers ---

function getETParts(date: Date): { weekday: string; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  });
  const parts = formatter.formatToParts(date);
  return {
    weekday: parts.find(p => p.type === 'weekday')?.value || '',
    hour: parseInt(parts.find(p => p.type === 'hour')?.value || '0'),
    minute: parseInt(parts.find(p => p.type === 'minute')?.value || '0'),
  };
}

function getEndOfBusinessDay(date: Date): Date {
  // Get the current date in ET and set to BH_END
  const etDate = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

  // Parse MM/DD/YYYY
  const [month, day, year] = etDate.split('/').map(Number);

  // Create a date string for BH_END in ET
  const targetET = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${BH_END}:00:00`);

  // Convert from ET to UTC by finding the offset
  const offsetMs = date.getTime() - new Date(
    date.toLocaleString('en-US', { timeZone: TIMEZONE })
  ).getTime();

  // This is approximate but works for business hour calculations
  return new Date(targetET.getTime() - offsetMs);
}

function setToBusinessStart(date: Date): void {
  const etParts = getETParts(date);
  const hoursToAdd = BH_START - etParts.hour - (etParts.minute / 60);
  date.setTime(date.getTime() + hoursToAdd * 60 * 60 * 1000);
}

function advanceToNextDay(date: Date): void {
  // Move forward by enough hours to get to the next calendar day in ET
  // Simplification: advance 24 hours and then snap to business start
  const nextDay = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  const etParts = getETParts(nextDay);

  // Set to business start of next day
  const adjustment = (BH_START - etParts.hour) * 60 * 60 * 1000 - etParts.minute * 60 * 1000;
  nextDay.setTime(nextDay.getTime() + adjustment);

  // Skip weekends
  let weekday = getETParts(nextDay).weekday;
  while (weekday === 'Sat' || weekday === 'Sun') {
    nextDay.setTime(nextDay.getTime() + 24 * 60 * 60 * 1000);
    weekday = getETParts(nextDay).weekday;
  }

  date.setTime(nextDay.getTime());
}

function formatHours(hours: number): string {
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${Math.round(hours % 24)}h`;
  if (hours >= 1) return `${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m`;
  return `${Math.round(hours * 60)}m`;
}
