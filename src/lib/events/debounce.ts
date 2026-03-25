import { createServiceClient } from '@/lib/supabase/client';
import { runAnalysisPipeline } from '@/lib/ai/passes/orchestrator';
import type { PassType } from '@/lib/ai/passes/types';

/**
 * Database-based debouncing for serverless environments.
 *
 * Instead of in-memory timers (which don't persist across serverless invocations),
 * we use the webhook_events table as a queue:
 *
 * 1. Webhook handler inserts event with processed_at = NULL
 * 2. Before running analysis, check if there are other unprocessed events
 *    for the same ticket within the debounce window
 * 3. If so, merge the passes and process them all at once
 *
 * This gives a natural debounce: HubSpot often fires multiple property changes
 * for a single user action, and they arrive within a few seconds of each other.
 */

const DEBOUNCE_WINDOW_SECONDS = 5;

export interface DebouncedEvent {
  ticketId: string;
  mergedPasses: PassType[];
  eventIds: string[];
}

/**
 * Process unprocessed webhook events, grouping by ticket ID.
 * Events within the debounce window for the same ticket get merged.
 * Returns the list of tickets processed and which passes were run.
 */
export async function processQueuedEvents(): Promise<DebouncedEvent[]> {
  const supabase = createServiceClient();

  // Fetch unprocessed events older than the debounce window
  // (so we don't process events that might still be accumulating)
  const cutoff = new Date(Date.now() - DEBOUNCE_WINDOW_SECONDS * 1000).toISOString();

  const { data: events, error } = await supabase
    .from('webhook_events')
    .select('id, hubspot_ticket_id, passes_triggered, created_at')
    .is('processed_at', null)
    .is('error', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true });

  if (error || !events || events.length === 0) {
    return [];
  }

  // Group by ticket ID and merge passes
  const grouped = new Map<string, { passes: Set<PassType>; eventIds: string[] }>();

  for (const event of events) {
    if (!event.hubspot_ticket_id) continue;

    const existing = grouped.get(event.hubspot_ticket_id);
    const passes = (event.passes_triggered || []) as PassType[];

    if (existing) {
      passes.forEach((p) => existing.passes.add(p));
      existing.eventIds.push(event.id);
    } else {
      grouped.set(event.hubspot_ticket_id, {
        passes: new Set(passes),
        eventIds: [event.id],
      });
    }
  }

  // Process each ticket's merged passes
  const results: DebouncedEvent[] = [];

  for (const [ticketId, { passes, eventIds }] of grouped) {
    const mergedPasses = Array.from(passes);

    try {
      await runAnalysisPipeline(ticketId, { passes: mergedPasses });

      // Mark all events as processed
      await supabase
        .from('webhook_events')
        .update({ processed_at: new Date().toISOString() })
        .in('id', eventIds);

      results.push({ ticketId, mergedPasses, eventIds });
    } catch (err) {
      console.error(`[debounce] Failed to process ticket ${ticketId}:`, err);
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      await supabase
        .from('webhook_events')
        .update({ processed_at: new Date().toISOString(), error: errorMsg })
        .in('id', eventIds);
    }
  }

  return results;
}

/**
 * Insert an event into the queue without processing it immediately.
 * Used by webhook handlers to achieve debouncing — the event will be
 * picked up by processQueuedEvents() after the debounce window.
 */
export async function enqueueEvent(
  source: string,
  eventType: string,
  ticketId: string,
  passes: PassType[],
  rawPayload?: unknown
): Promise<string> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('webhook_events')
    .insert({
      source,
      event_type: eventType,
      hubspot_ticket_id: ticketId,
      passes_triggered: passes,
      raw_payload: rawPayload || null,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[debounce] Failed to enqueue event:', error);
    return 'unknown';
  }

  return data.id;
}
