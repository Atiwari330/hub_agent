import { createServiceClient } from '@/lib/supabase/client';

/**
 * Database operations for the action_items table (Phase 4).
 * Centralizes all reads/writes so passes and endpoints share the same logic.
 */

export interface ActionItemRow {
  id: string;
  hubspot_ticket_id: string;
  description: string;
  who: string;
  priority: string;
  status: 'active' | 'completed' | 'superseded' | 'expired';
  status_tags: string[];
  created_at: string;
  created_by_pass: string | null;
  completed_at: string | null;
  completed_by: string | null;
  completed_method: string | null;
  superseded_by: string | null;
  superseded_at: string | null;
  expired_at: string | null;
  expired_reason: string | null;
  verified: boolean | null;
  verification_note: string | null;
  verified_at: string | null;
  sort_order: number;
}

/** Fetch active action items for a ticket */
export async function getActiveActionItems(ticketId: string): Promise<ActionItemRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('action_items')
    .select('*')
    .eq('hubspot_ticket_id', ticketId)
    .eq('status', 'active')
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('[action-items-db] Failed to fetch active items:', error);
    return [];
  }
  return (data || []) as ActionItemRow[];
}

/** Fetch all action items for a ticket (any status) */
export async function getAllActionItems(ticketId: string): Promise<ActionItemRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('action_items')
    .select('*')
    .eq('hubspot_ticket_id', ticketId)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('[action-items-db] Failed to fetch all items:', error);
    return [];
  }
  return (data || []) as ActionItemRow[];
}

/** Insert new action items */
export async function insertActionItems(
  ticketId: string,
  items: Array<{
    id: string;
    description: string;
    who: string;
    priority: string;
    status_tags: string[];
  }>,
  createdByPass: string
): Promise<void> {
  if (items.length === 0) return;
  const supabase = createServiceClient();

  const rows = items.map((item, idx) => ({
    id: item.id,
    hubspot_ticket_id: ticketId,
    description: item.description,
    who: item.who,
    priority: item.priority,
    status: 'active',
    status_tags: item.status_tags,
    created_by_pass: createdByPass,
    sort_order: idx,
  }));

  const { error } = await supabase
    .from('action_items')
    .upsert(rows, { onConflict: 'id,hubspot_ticket_id' });

  if (error) {
    console.error('[action-items-db] Failed to insert items:', error);
  }

  // Log creation events
  await logActionItemEvents(
    ticketId,
    items.map((item) => ({
      action_item_id: item.id,
      event_type: 'created',
      details: { pass: createdByPass, description: item.description },
    }))
  );
}

/** Mark items as superseded */
export async function supersedeActionItems(
  ticketId: string,
  items: Array<{ id: string; reason: string; supersededBy?: string }>
): Promise<void> {
  if (items.length === 0) return;
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  for (const item of items) {
    await supabase
      .from('action_items')
      .update({
        status: 'superseded',
        superseded_at: now,
        superseded_by: item.supersededBy || null,
        expired_reason: item.reason,
      })
      .eq('id', item.id)
      .eq('hubspot_ticket_id', ticketId)
      .eq('status', 'active');
  }

  await logActionItemEvents(
    ticketId,
    items.map((item) => ({
      action_item_id: item.id,
      event_type: 'superseded',
      details: { reason: item.reason, superseded_by: item.supersededBy },
    }))
  );
}

/** Mark items as completed */
export async function completeActionItems(
  ticketId: string,
  itemIds: string[],
  method: 'manual' | 'auto_detected',
  completedBy?: string
): Promise<void> {
  if (itemIds.length === 0) return;
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  for (const itemId of itemIds) {
    const update: Record<string, unknown> = {
      status: 'completed',
      completed_at: now,
      completed_method: method,
    };
    if (completedBy) update.completed_by = completedBy;

    await supabase
      .from('action_items')
      .update(update)
      .eq('id', itemId)
      .eq('hubspot_ticket_id', ticketId)
      .eq('status', 'active');
  }

  await logActionItemEvents(
    ticketId,
    itemIds.map((id) => ({
      action_item_id: id,
      event_type: method === 'auto_detected' ? 'auto_completed' : 'completed',
      details: { method, completed_by: completedBy },
    }))
  );
}

/** Mark items as expired */
export async function expireActionItems(
  ticketId: string,
  items: Array<{ id: string; reason: string }>
): Promise<void> {
  if (items.length === 0) return;
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  for (const item of items) {
    await supabase
      .from('action_items')
      .update({
        status: 'expired',
        expired_at: now,
        expired_reason: item.reason,
      })
      .eq('id', item.id)
      .eq('hubspot_ticket_id', ticketId)
      .eq('status', 'active');
  }

  await logActionItemEvents(
    ticketId,
    items.map((item) => ({
      action_item_id: item.id,
      event_type: 'expired',
      details: { reason: item.reason },
    }))
  );
}

/** Log events to action_item_events table */
async function logActionItemEvents(
  ticketId: string,
  events: Array<{ action_item_id: string; event_type: string; details: Record<string, unknown> }>
): Promise<void> {
  if (events.length === 0) return;
  const supabase = createServiceClient();

  const rows = events.map((e) => ({
    hubspot_ticket_id: ticketId,
    action_item_id: e.action_item_id,
    event_type: e.event_type,
    details: e.details,
  }));

  const { error } = await supabase.from('action_item_events').insert(rows);
  if (error) {
    console.error('[action-items-db] Failed to log events:', error);
  }
}
