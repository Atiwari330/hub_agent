import { createServiceClient } from '@/lib/supabase/client';
import { upsertAlert, resolveAlerts } from './alert-utils';
import { calculateBusinessHours } from './sla-monitor';

/**
 * Stale Ticket Checker — Phase 6, Proactive Intelligence
 *
 * Pure database query — no LLM needed.
 * Runs daily at 9 AM ET.
 *
 * Checks open tickets for inactivity:
 *   2 business days (20h) → info "Going Stale"
 *   5 business days (50h) → warning "Stale"
 *   10 business days (100h) → critical "Critical Stale"
 */

// Thresholds in business hours
const GOING_STALE_HOURS = 20;      // ~2 business days
const STALE_HOURS = 50;            // ~5 business days
const CRITICAL_STALE_HOURS = 100;  // ~10 business days

export interface StaleCheckResult {
  ticketsChecked: number;
  goingStale: number;
  stale: number;
  criticalStale: number;
  alertsCreated: number;
  alertsResolved: number;
  errors: string[];
}

export async function runStaleCheck(): Promise<StaleCheckResult> {
  const supabase = createServiceClient();
  const now = new Date();

  const result: StaleCheckResult = {
    ticketsChecked: 0,
    goingStale: 0,
    stale: 0,
    criticalStale: 0,
    alertsCreated: 0,
    alertsResolved: 0,
    errors: [],
  };

  // Fetch all open tickets with their last activity timestamps
  const { data: tickets, error } = await supabase
    .from('support_tickets')
    .select('hubspot_ticket_id, last_customer_message_at, last_agent_message_at, hs_last_modified_at, hubspot_created_at')
    .eq('is_closed', false);

  if (error || !tickets) {
    result.errors.push(error?.message || 'No tickets');
    return result;
  }

  for (const ticket of tickets) {
    result.ticketsChecked++;

    try {
      // Find the most recent activity timestamp
      const timestamps = [
        ticket.last_customer_message_at,
        ticket.last_agent_message_at,
        ticket.hs_last_modified_at,
      ].filter(Boolean) as string[];

      if (timestamps.length === 0) {
        // No activity tracked — use creation date
        if (!ticket.hubspot_created_at) continue;
        timestamps.push(ticket.hubspot_created_at);
      }

      const lastActivity = new Date(
        Math.max(...timestamps.map(t => new Date(t).getTime()))
      );

      const inactiveBusinessHours = calculateBusinessHours(lastActivity, now);

      if (inactiveBusinessHours >= CRITICAL_STALE_HOURS) {
        result.criticalStale++;
        await upsertAlert({
          ticketId: ticket.hubspot_ticket_id,
          alertType: 'stale',
          severity: 'critical',
          title: 'Critical stale — escalate to CS Manager',
          description: `No activity in ${Math.round(inactiveBusinessHours / 10)} business days. Consider escalating or closing.`,
          metadata: {
            inactive_business_hours: Math.round(inactiveBusinessHours),
            inactive_business_days: Math.round(inactiveBusinessHours / 10),
            last_activity: lastActivity.toISOString(),
          },
        });
        result.alertsCreated++;
      } else if (inactiveBusinessHours >= STALE_HOURS) {
        result.stale++;
        await upsertAlert({
          ticketId: ticket.hubspot_ticket_id,
          alertType: 'stale',
          severity: 'warning',
          title: 'Stale — no activity in 5 business days',
          description: `Last activity was ${Math.round(inactiveBusinessHours / 10)} business days ago. Check in with the customer.`,
          metadata: {
            inactive_business_hours: Math.round(inactiveBusinessHours),
            inactive_business_days: Math.round(inactiveBusinessHours / 10),
            last_activity: lastActivity.toISOString(),
          },
        });
        result.alertsCreated++;
      } else if (inactiveBusinessHours >= GOING_STALE_HOURS) {
        result.goingStale++;
        await upsertAlert({
          ticketId: ticket.hubspot_ticket_id,
          alertType: 'stale',
          severity: 'info',
          title: 'Going stale — consider checking in',
          description: `No activity in ${Math.round(inactiveBusinessHours / 10)} business days.`,
          metadata: {
            inactive_business_hours: Math.round(inactiveBusinessHours),
            inactive_business_days: Math.round(inactiveBusinessHours / 10),
            last_activity: lastActivity.toISOString(),
          },
        });
        result.alertsCreated++;
      } else {
        // Ticket is active — resolve any stale alerts
        const resolved = await resolveAlerts(ticket.hubspot_ticket_id, 'stale');
        result.alertsResolved += resolved;
      }
    } catch (err) {
      result.errors.push(`${ticket.hubspot_ticket_id}: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }

  return result;
}
