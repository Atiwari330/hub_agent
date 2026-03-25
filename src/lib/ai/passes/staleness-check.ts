import { generateText } from 'ai';
import { getModelForPass } from './models';
import { expireActionItems } from './action-items-db';
import { createServiceClient } from '@/lib/supabase/client';

/**
 * Staleness check pass (Phase 4).
 *
 * Runs as a background cron job every 15 minutes during business hours.
 * For each ticket with active action items older than 2 hours where
 * the ticket has had activity since the item was created, runs a
 * lightweight LLM check: "Are these action items still relevant?"
 *
 * Items deemed irrelevant get status='expired' with a reason.
 */

interface StaleItem {
  id: string;
  hubspot_ticket_id: string;
  description: string;
  who: string;
  priority: string;
  created_at: string;
}

interface StalenessResult {
  ticketsChecked: number;
  itemsExpired: number;
  errors: number;
}

/** Find and expire stale action items across all tickets */
export async function runStalenessCheck(): Promise<StalenessResult> {
  const supabase = createServiceClient();
  const result: StalenessResult = { ticketsChecked: 0, itemsExpired: 0, errors: 0 };

  // Find active items older than 2 hours
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: staleItems, error } = await supabase
    .from('action_items')
    .select('id, hubspot_ticket_id, description, who, priority, created_at')
    .eq('status', 'active')
    .lt('created_at', twoHoursAgo)
    .order('hubspot_ticket_id');

  if (error || !staleItems || staleItems.length === 0) {
    return result;
  }

  // Group by ticket
  const byTicket = new Map<string, StaleItem[]>();
  for (const item of staleItems) {
    const list = byTicket.get(item.hubspot_ticket_id) || [];
    list.push(item);
    byTicket.set(item.hubspot_ticket_id, list);
  }

  // For each ticket, check if there's been activity since the oldest item
  for (const [ticketId, items] of byTicket) {
    const oldestItemTime = items.reduce(
      (min, item) => Math.min(min, new Date(item.created_at).getTime()),
      Infinity
    );

    // Check if ticket has had activity since the item was created
    const { data: ticket } = await supabase
      .from('support_tickets')
      .select('last_customer_message_at, last_agent_message_at, hs_last_modified_at')
      .eq('hubspot_ticket_id', ticketId)
      .single();

    if (!ticket) continue;

    const activityTimes = [
      ticket.last_customer_message_at,
      ticket.last_agent_message_at,
      ticket.hs_last_modified_at,
    ].filter(Boolean).map((t: string) => new Date(t).getTime());

    const hasRecentActivity = activityTimes.some((t) => t > oldestItemTime);
    if (!hasRecentActivity) continue; // No activity since items were created — skip

    // Run LLM relevance check
    try {
      const expired = await checkItemRelevance(ticketId, items, ticket);
      result.ticketsChecked++;
      if (expired.length > 0) {
        await expireActionItems(ticketId, expired);
        result.itemsExpired += expired.length;
      }
    } catch (err) {
      console.error(`[staleness-check] Failed for ticket ${ticketId}:`, err);
      result.errors++;
    }
  }

  return result;
}

async function checkItemRelevance(
  ticketId: string,
  items: StaleItem[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ticket: Record<string, any>
): Promise<Array<{ id: string; reason: string }>> {
  const model = getModelForPass('verification'); // cheap model

  const prompt = `You are reviewing active action items on a support ticket to check if they are still relevant.

TICKET: ${ticketId}
Last customer message: ${ticket.last_customer_message_at || 'Unknown'}
Last agent message: ${ticket.last_agent_message_at || 'Unknown'}
Last modified: ${ticket.hs_last_modified_at || 'Unknown'}

ACTIVE ACTION ITEMS (all older than 2 hours):
${items.map((item) => {
  const ageHours = Math.round((Date.now() - new Date(item.created_at).getTime()) / (1000 * 60 * 60));
  return `- [${item.id}] (${ageHours}h old, ${item.who}, ${item.priority}) ${item.description}`;
}).join('\n')}

For each item, determine if it is STILL RELEVANT or should be EXPIRED.
An item should be expired if:
- The action has likely already been done (based on activity timestamps)
- The item refers to something that is no longer applicable
- The item is a duplicate of another active item

DO NOT expire items that are still waiting for action and nothing has changed.
When in doubt, keep the item active.

Output EXACTLY one line:
EXPIRE_ITEMS: [{"id": "act_1", "reason": "Customer already responded"}, ...] (JSON array, or [] if all items are still relevant)`;

  const result = await generateText({
    model,
    prompt,
  });

  const text = result.text || '';
  const match = text.match(/EXPIRE_ITEMS:\s*(\[[\s\S]*?\])/i);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) return [];

    const validIds = new Set(items.map((i) => i.id));
    return parsed
      .filter((item: unknown): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).id === 'string'
      )
      .filter((item) => validIds.has(item.id as string))
      .map((item) => ({
        id: item.id as string,
        reason: String(item.reason || 'Expired due to staleness'),
      }));
  } catch {
    return [];
  }
}
