import { createServiceClient } from '@/lib/supabase/client';
import { runAnalysisPipeline } from '@/lib/ai/passes/orchestrator';
import { runAutoCompleteCheck } from '@/lib/ai/passes/auto-complete-check';
import { predictEscalation } from '@/lib/ai/intelligence/escalation-predictor';
import { resolveAlerts, resolveAllAlerts } from '@/lib/ai/intelligence/alert-utils';
import type { PassType } from '@/lib/ai/passes/types';

// --- Event types ---

export interface TicketEvent {
  source: 'hubspot' | 'linear' | 'internal';
  type: TicketEventType;
  ticketId: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
  rawPayload?: unknown;
}

export type TicketEventType =
  | 'customer_message'
  | 'agent_message'
  | 'ticket_created'
  | 'ticket_closed'
  | 'property_change'
  | 'linear_state_change'
  | 'linear_comment'
  | 'action_completed'
  | 'sla_threshold';

// --- Event → Pass mapping ---

const EVENT_PASS_MAP: Record<TicketEventType, PassType[]> = {
  customer_message: ['situation', 'action_items', 'temperature', 'timing', 'response_draft'],
  agent_message: ['timing', 'verification', 'action_items'],
  ticket_created: ['situation', 'action_items', 'temperature', 'timing', 'cross_ticket', 'response_draft'],
  ticket_closed: ['situation'],
  property_change: ['situation', 'action_items'],
  linear_state_change: ['situation', 'action_items'],
  linear_comment: ['situation', 'action_items'],
  action_completed: ['verification'],
  sla_threshold: ['action_items'],
};

// --- Main router ---

/**
 * Routes a ticket event to the appropriate analysis passes.
 * Logs the event to webhook_events, then runs targeted passes asynchronously.
 * Returns immediately after logging — analysis runs in the background.
 */
export async function routeEvent(event: TicketEvent): Promise<{ eventId: string; passes: PassType[] }> {
  const passes = EVENT_PASS_MAP[event.type];
  if (!passes || passes.length === 0) {
    return { eventId: '', passes: [] };
  }

  // Log the event
  const eventId = await logWebhookEvent(event, passes);

  // Run analysis asynchronously (don't await — webhook must respond fast)
  runAnalysisForEvent(eventId, event.ticketId, passes, event).catch((err) => {
    console.error(`[event-router] Analysis failed for event ${eventId}:`, err);
    markEventError(eventId, err instanceof Error ? err.message : 'Unknown error');
  });

  return { eventId, passes };
}

/**
 * Synchronous version that waits for analysis to complete.
 * Used by internal events where we're not in a webhook context.
 */
export async function routeEventSync(event: TicketEvent): Promise<{ eventId: string; passes: PassType[] }> {
  const passes = EVENT_PASS_MAP[event.type];
  if (!passes || passes.length === 0) {
    return { eventId: '', passes: [] };
  }

  const eventId = await logWebhookEvent(event, passes);

  try {
    await runAnalysisForEvent(eventId, event.ticketId, passes, event);
  } catch (err) {
    console.error(`[event-router] Analysis failed for event ${eventId}:`, err);
    await markEventError(eventId, err instanceof Error ? err.message : 'Unknown error');
  }

  return { eventId, passes };
}

// --- Helpers ---

async function logWebhookEvent(event: TicketEvent, passes: PassType[]): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('webhook_events')
    .insert({
      source: event.source,
      event_type: event.type,
      hubspot_ticket_id: event.ticketId,
      raw_payload: event.rawPayload || event.metadata || null,
      passes_triggered: passes,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[event-router] Failed to log webhook event:', error);
    return 'unknown';
  }

  return data.id;
}

async function runAnalysisForEvent(eventId: string, ticketId: string, passes: PassType[], event?: TicketEvent): Promise<void> {
  const supabase = createServiceClient();

  try {
    // Run auto-complete check for agent messages before the main analysis
    if (event?.type === 'agent_message' && event.metadata?.messageText) {
      try {
        await runAutoCompleteCheck(ticketId, event.metadata.messageText as string);
      } catch (err) {
        console.error(`[event-router] Auto-complete check failed for ${ticketId}:`, err);
        // Don't fail the main analysis if auto-complete check fails
      }
    }

    await runAnalysisPipeline(ticketId, { passes });

    // --- Phase 6: Proactive Intelligence hooks ---
    try {
      await runProactiveChecks(ticketId, event);
    } catch (err) {
      console.error(`[event-router] Proactive checks failed for ${ticketId}:`, err);
      // Don't fail the main event processing if proactive checks fail
    }

    // Mark event as processed
    await supabase
      .from('webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', eventId);
  } catch (err) {
    throw err;
  }
}

async function markEventError(eventId: string, errorMessage: string): Promise<void> {
  if (eventId === 'unknown') return;
  const supabase = createServiceClient();
  await supabase
    .from('webhook_events')
    .update({
      processed_at: new Date().toISOString(),
      error: errorMessage,
    })
    .eq('id', eventId);
}

/**
 * Run proactive intelligence checks after event processing.
 * - Escalation prediction: after temperature-related events
 * - Alert resolution: after agent responses and ticket closures
 */
async function runProactiveChecks(ticketId: string, event?: TicketEvent): Promise<void> {
  if (!event) return;

  // Resolve alerts based on event type
  switch (event.type) {
    case 'agent_message':
      // Agent responded → resolve SLA and stale alerts
      await resolveAlerts(ticketId, 'sla_warning');
      await resolveAlerts(ticketId, 'stale');
      break;

    case 'ticket_closed':
      // Ticket closed → resolve all alerts
      await resolveAllAlerts(ticketId);
      break;

    case 'customer_message':
      // Customer messaged → resolve stale alert (ticket is active)
      await resolveAlerts(ticketId, 'stale');
      break;
  }

  // Run escalation prediction after events that affect temperature
  const temperatureEvents: TicketEventType[] = ['customer_message', 'ticket_created'];
  if (temperatureEvents.includes(event.type)) {
    await predictEscalation(ticketId);
  }
}

/**
 * Get passes that should be triggered for a given event type.
 * Exported for use in tests and debugging.
 */
export function getPassesForEvent(eventType: TicketEventType): PassType[] {
  return EVENT_PASS_MAP[eventType] || [];
}
