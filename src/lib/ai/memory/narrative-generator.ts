import { createServiceClient } from '@/lib/supabase/client';

/**
 * Narrative Generator — Phase 7, Contextual Memory
 *
 * Produces a ticket evolution timeline by comparing consecutive pass results
 * stored in analysis_pass_results.
 *
 * Each entry: timestamp + trigger event + what changed
 */

export interface NarrativeEntry {
  timestamp: string;
  triggerEvent: string | null;
  changes: string[];
  temperatureChange: { from: string; to: string } | null;
  actionItemsAdded: number;
  actionItemsCompleted: number;
  actionItemsSuperseded: number;
  situationDelta: string | null;
}

/**
 * Generate the evolution timeline for a ticket by comparing
 * consecutive analyses from the analysis_pass_results table.
 * Falls back to analyzing ticket_action_board_analyses history
 * if pass results aren't stored yet.
 *
 * Returns at most `limit` entries (default 10), most recent first.
 */
export async function generateTimeline(
  ticketId: string,
  limit: number = 10
): Promise<NarrativeEntry[]> {
  const supabase = createServiceClient();

  // Fetch pass results history grouped by creation time
  const { data: passResults } = await supabase
    .from('analysis_pass_results')
    .select('pass_type, result, created_at')
    .eq('hubspot_ticket_id', ticketId)
    .order('created_at', { ascending: true });

  if (!passResults || passResults.length === 0) {
    // No pass history yet — check if we can build from webhook events
    return await buildTimelineFromEvents(ticketId, limit);
  }

  // Group pass results by analysis run (same created_at within 60s window)
  const runs = groupIntoRuns(passResults);

  if (runs.length < 2) {
    // Need at least 2 runs to show changes
    const entries: NarrativeEntry[] = [];
    if (runs.length === 1) {
      entries.push({
        timestamp: runs[0].timestamp,
        triggerEvent: 'Initial analysis',
        changes: ['First analysis of this ticket'],
        temperatureChange: null,
        actionItemsAdded: countActionItems(runs[0]),
        actionItemsCompleted: 0,
        actionItemsSuperseded: 0,
        situationDelta: null,
      });
    }
    return entries;
  }

  // Compare consecutive runs to build narrative
  const entries: NarrativeEntry[] = [];

  for (let i = 1; i < runs.length; i++) {
    const prev = runs[i - 1];
    const curr = runs[i];

    const entry = compareRuns(prev, curr);
    entries.push(entry);
  }

  // Return most recent first, limited
  return entries.reverse().slice(0, limit);
}

// --- Internal types ---

interface AnalysisRun {
  timestamp: string;
  passes: Record<string, unknown>;
}

function groupIntoRuns(
  results: Array<{ pass_type: string; result: unknown; created_at: string }>
): AnalysisRun[] {
  const runs: AnalysisRun[] = [];
  let currentRun: AnalysisRun | null = null;

  for (const row of results) {
    const ts = new Date(row.created_at).getTime();

    if (!currentRun || ts - new Date(currentRun.timestamp).getTime() > 60000) {
      // New run (more than 60s gap)
      currentRun = { timestamp: row.created_at, passes: {} };
      runs.push(currentRun);
    }

    currentRun.passes[row.pass_type] = row.result;
  }

  return runs;
}

function compareRuns(prev: AnalysisRun, curr: AnalysisRun): NarrativeEntry {
  const changes: string[] = [];
  let temperatureChange: NarrativeEntry['temperatureChange'] = null;
  let actionItemsAdded = 0;
  const actionItemsCompleted = 0;
  let actionItemsSuperseded = 0;
  let situationDelta: string | null = null;

  // Compare situation
  const prevSituation = getPassField(prev, 'situation', 'situation_summary');
  const currSituation = getPassField(curr, 'situation', 'situation_summary');
  if (currSituation && prevSituation && currSituation !== prevSituation) {
    // Truncate the diff to something useful
    situationDelta = currSituation;
    changes.push('Situation updated');
  }

  // Compare temperature
  const prevTemp = getPassField(prev, 'temperature', 'customer_temperature');
  const currTemp = getPassField(curr, 'temperature', 'customer_temperature');
  if (currTemp && prevTemp && currTemp !== prevTemp) {
    temperatureChange = { from: prevTemp, to: currTemp };
    changes.push(`Temperature: ${prevTemp} → ${currTemp}`);
  }

  // Compare action items
  const prevItems = getPassArray(prev, 'action_items', 'action_items');
  const currItems = getPassArray(curr, 'action_items', 'action_items');
  if (prevItems && currItems) {
    const prevIds = new Set(prevItems.map((i: { id?: string }) => i.id));
    const currIds = new Set(currItems.map((i: { id?: string }) => i.id));
    actionItemsAdded = currItems.filter((i: { id?: string }) => i.id && !prevIds.has(i.id)).length;
    actionItemsSuperseded = prevItems.filter((i: { id?: string }) => i.id && !currIds.has(i.id)).length;

    if (actionItemsAdded > 0) changes.push(`${actionItemsAdded} new action item${actionItemsAdded > 1 ? 's' : ''}`);
    if (actionItemsSuperseded > 0) changes.push(`${actionItemsSuperseded} action item${actionItemsSuperseded > 1 ? 's' : ''} superseded`);
  }

  // Determine trigger event from time gap
  const gapHours = (new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) / (1000 * 60 * 60);
  const triggerEvent = gapHours > 12 ? 'Scheduled re-analysis' : 'Event-triggered update';

  if (changes.length === 0) {
    changes.push('No significant changes');
  }

  return {
    timestamp: curr.timestamp,
    triggerEvent,
    changes,
    temperatureChange,
    actionItemsAdded,
    actionItemsCompleted,
    actionItemsSuperseded,
    situationDelta,
  };
}

function getPassField(run: AnalysisRun, passType: string, field: string): string | null {
  const passResult = run.passes[passType] as Record<string, unknown> | undefined;
  if (!passResult) return null;
  const value = passResult[field];
  return typeof value === 'string' ? value : null;
}

function getPassArray(run: AnalysisRun, passType: string, field: string): Array<Record<string, unknown>> | null {
  const passResult = run.passes[passType] as Record<string, unknown> | undefined;
  if (!passResult) return null;
  const value = passResult[field];
  return Array.isArray(value) ? value : null;
}

function countActionItems(run: AnalysisRun): number {
  const items = getPassArray(run, 'action_items', 'action_items');
  return items ? items.length : 0;
}

/**
 * Build a basic timeline from webhook events when no pass results are stored yet.
 */
async function buildTimelineFromEvents(ticketId: string, limit: number): Promise<NarrativeEntry[]> {
  const supabase = createServiceClient();

  const { data: events } = await supabase
    .from('webhook_events')
    .select('event_type, passes_triggered, created_at, processed_at')
    .eq('hubspot_ticket_id', ticketId)
    .not('processed_at', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!events || events.length === 0) return [];

  const eventLabels: Record<string, string> = {
    customer_message: 'Customer sent a message',
    agent_message: 'Agent responded',
    ticket_created: 'Ticket created',
    ticket_closed: 'Ticket closed',
    property_change: 'Ticket property changed',
    linear_state_change: 'Linear issue state changed',
    linear_comment: 'New Linear comment',
    action_completed: 'Action item completed',
  };

  return events.map((e) => ({
    timestamp: e.created_at,
    triggerEvent: eventLabels[e.event_type] || e.event_type,
    changes: [`Triggered passes: ${(e.passes_triggered || []).join(', ') || 'none'}`],
    temperatureChange: null,
    actionItemsAdded: 0,
    actionItemsCompleted: e.event_type === 'action_completed' ? 1 : 0,
    actionItemsSuperseded: 0,
    situationDelta: null,
  }));
}
