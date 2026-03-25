import { generateText, stepCountIs } from 'ai';
import { getModelForPass } from './models';
import { buildTicketMetadataSection, buildLinearSection } from './gather-context';
import { lookupSupportKnowledgeTool } from '@/lib/ai/tools/support-knowledge';
import { getActiveActionItems, insertActionItems, supersedeActionItems } from './action-items-db';
import type { TicketContext, ActionItemPassResult, ActionItem } from './types';

interface ActionItemDeps {
  situationSummary?: string;
}

export async function runActionItemPass(
  context: TicketContext,
  deps?: ActionItemDeps
): Promise<ActionItemPassResult> {
  const model = getModelForPass('action_items');
  const ticketId = context.ticket.hubspot_ticket_id;

  // Fetch current active items from the action_items table
  const existingItems = await getActiveActionItems(ticketId);

  const systemPrompt = `You are an operations analyst for the support team at Opus Behavioral Health, a healthcare SaaS company.

YOUR PURPOSE: Manage the action item list for a support ticket. You receive the current ticket state AND the list of currently active action items. You must decide which items to keep, which to supersede, and what new items to create.

EVERY TICKET MUST HAVE AT LEAST ONE ACTION ITEM. There is always something to do — even if the ticket is waiting on a customer, engineering, or a third party, there's a follow-up to schedule, an update to send, a status check to make, or a closure to initiate. An empty action list means agents have nothing to act on, which defeats the purpose of this board. If you genuinely cannot identify an action, default to a proactive follow-up or status update action.

PRODUCT KNOWLEDGE RETRIEVAL:
You have access to the \`lookupSupportKnowledge\` tool. You MUST call it at least once before producing your analysis, based on the ticket's subject and conversation.

CRITICAL RULES:
- NEVER reference specific support agents by name in action items. Write "the support team should..." or "the agent handling this should...", never "[name] needs to..."
- Each action item must be executable by anyone on the team with zero context beyond what you provide
- PRESERVE CONTINUITY: Don't replace items that are still relevant. Agents get frustrated when their action list changes unnecessarily.
- Only supersede items when they are genuinely no longer relevant or accurate given the current ticket state.

TICKET HYGIENE:
- If the issue appears resolved but ticket is still open, include an action to send a closing message
- If engineering work is needed and no Linear task is linked, include an action to create one (except Copilot/Nabla config — that's implementation team)
- If Copilot AI/Nabla configuration is involved, include an action to escalate to implementation/onboarding team (Saagar's team)
- If company name is "Unknown" or missing, include an action to associate the ticket with the correct Company in HubSpot
- Co-Destiny (VIP) accounts: blocking issues need critical urgency, CS Manager notification, same-day response, daily resolution updates

Output EXACTLY three sections:

KEEP_ITEMS: A JSON array of existing item IDs that are STILL relevant and should remain active. Example: ["act_1", "act_3"]

SUPERSEDE_ITEMS: A JSON array of objects for items that are NO LONGER relevant. Each object has "id" and "reason". Example: [{"id": "act_2", "reason": "Customer already provided the requested information"}]

NEW_ITEMS: A JSON array of NEW action items to create. Each item has:
- "id": unique string (use "act_N" where N continues from the highest existing number)
- "description": Specific instruction, not vague. Say exactly what to do.
- "who": "any_support_agent" | "engineering" | "cs_manager"
- "priority": "now" | "today" | "this_week"
- "status_tags": array from ["reply_needed", "update_due", "engineering_ping", "internal_action", "waiting_on_customer"]

STATUS_TAGS: Comma-separated list of tags that apply to this ticket overall (from the same set as above). A ticket can have MULTIPLE tags.`;

  let userPrompt = `${buildTicketMetadataSection(context)}`;

  if (deps?.situationSummary) {
    userPrompt += `\n\nSITUATION SUMMARY (from prior analysis):\n${deps.situationSummary}`;
  }

  // Include current active action items for the LLM to evaluate
  if (existingItems.length > 0) {
    userPrompt += `\n\nCURRENT ACTIVE ACTION ITEMS (evaluate each one — keep if still relevant, supersede if not):\n`;
    userPrompt += existingItems.map((item, idx) =>
      `${idx + 1}. [${item.id}] (${item.priority}, ${item.who}) ${item.description}` +
      (item.status_tags.length > 0 ? ` [tags: ${item.status_tags.join(', ')}]` : '') +
      ` — created ${item.created_at}`
    ).join('\n');
  } else {
    userPrompt += `\n\nCURRENT ACTIVE ACTION ITEMS: None (this is a fresh analysis — generate all new items)`;
  }

  if (context.customerContext) {
    userPrompt += `\n\nCUSTOMER CONTEXT:\n${context.customerContext}`;
  }

  userPrompt += `\n\nCONVERSATION THREAD (${context.conversationMessages.length} messages):
${context.conversationText}

ENGAGEMENT TIMELINE (${context.engagementTimeline.engagements.length} items):
${context.engagementTimelineText}`;

  if (context.linearContext || context.ticket.linear_task) {
    userPrompt += `\n\n${buildLinearSection(context)}`;
  }

  if (context.recentCompletions.length > 0) {
    userPrompt += `\n\nRECENTLY COMPLETED ACTIONS (already done — do not re-generate these):\n` +
      context.recentCompletions.map((c) =>
        `- "${c.action_description}" completed by ${c.completed_by_name} at ${c.completed_at}`
      ).join('\n');
  }

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    tools: {
      lookupSupportKnowledge: lookupSupportKnowledgeTool,
    },
    stopWhen: stepCountIs(5),
  });

  const text = result.text || result.steps[result.steps.length - 1]?.text || '';

  // Parse KEEP_ITEMS
  let keepItemIds: string[] = [];
  try {
    const keepMatch = text.match(/KEEP_ITEMS:\s*(\[[\s\S]*?\])(?=\n[A-Z_]+:|\n\n|$)/i);
    if (keepMatch) {
      const parsed = JSON.parse(keepMatch[1]);
      if (Array.isArray(parsed)) {
        keepItemIds = parsed.filter((id): id is string => typeof id === 'string');
      }
    }
  } catch (err) {
    console.warn('[action-item-pass] Could not parse KEEP_ITEMS:', err);
  }

  // Parse SUPERSEDE_ITEMS
  let supersedeItems: Array<{ id: string; reason: string }> = [];
  try {
    const supersedeMatch = text.match(/SUPERSEDE_ITEMS:\s*(\[[\s\S]*?\])(?=\n[A-Z_]+:|\n\n|$)/i);
    if (supersedeMatch) {
      const parsed = JSON.parse(supersedeMatch[1]);
      if (Array.isArray(parsed)) {
        supersedeItems = parsed
          .filter((item: unknown): item is Record<string, unknown> => typeof item === 'object' && item !== null)
          .map((item) => ({
            id: String(item.id || ''),
            reason: String(item.reason || 'No longer relevant'),
          }))
          .filter((item) => item.id);
      }
    }
  } catch (err) {
    console.warn('[action-item-pass] Could not parse SUPERSEDE_ITEMS:', err);
  }

  // Parse NEW_ITEMS
  let newItems: ActionItem[] = [];
  try {
    const newMatch = text.match(/NEW_ITEMS:\s*(\[[\s\S]*?\])(?=\n[A-Z_]+:|\n\n|$)/i);
    if (newMatch) {
      const parsed = JSON.parse(newMatch[1]);
      if (Array.isArray(parsed)) {
        // Find highest existing act number to continue from
        const allIds = [...existingItems.map((i) => i.id), ...keepItemIds];
        const maxNum = allIds.reduce((max, id) => {
          const m = id.match(/act_(\d+)/);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0);

        newItems = parsed.map((item: Record<string, unknown>, idx: number) => ({
          id: (item.id as string) || `act_${maxNum + idx + 1}`,
          description: (item.description as string) || 'No description',
          who: (item.who as string) || 'any_support_agent',
          priority: (['now', 'today', 'this_week'].includes(item.priority as string)
            ? item.priority
            : 'today') as 'now' | 'today' | 'this_week',
          status_tags: Array.isArray(item.status_tags) ? (item.status_tags as string[]) : [],
        }));
      }
    }
  } catch (err) {
    console.warn('[action-item-pass] Could not parse NEW_ITEMS:', err);
  }

  // Parse status tags
  const statusTagsRaw = text.match(/STATUS_TAGS:\s*(.+?)(?=\n[A-Z_]+:|\n\n|$)/is)?.[1] || 'waiting_on_customer';
  const validTags = ['reply_needed', 'update_due', 'engineering_ping', 'internal_action', 'waiting_on_customer'];
  const statusTags = statusTagsRaw.split(',').map((t) => t.trim().toLowerCase()).filter((t) => validTags.includes(t));
  if (statusTags.length === 0) statusTags.push('waiting_on_customer');

  // --- Apply lifecycle changes to DB ---

  // Supersede items that LLM said are no longer relevant
  // Also supersede items that weren't mentioned in KEEP or SUPERSEDE (implicitly dropped)
  const mentionedIds = new Set([...keepItemIds, ...supersedeItems.map((s) => s.id)]);
  const implicitlyDropped = existingItems
    .filter((item) => !mentionedIds.has(item.id))
    .map((item) => ({ id: item.id, reason: 'Implicitly replaced by updated analysis' }));

  const allSuperseded = [...supersedeItems, ...implicitlyDropped];
  if (allSuperseded.length > 0) {
    await supersedeActionItems(ticketId, allSuperseded);
  }

  // Insert new items
  if (newItems.length > 0) {
    await insertActionItems(ticketId, newItems, 'action_items');
  }

  // Build the combined action_items array for backward compat (JSONB column)
  // = kept existing items + new items
  const keptItems: ActionItem[] = existingItems
    .filter((item) => keepItemIds.includes(item.id))
    .map((item) => ({
      id: item.id,
      description: item.description,
      who: item.who,
      priority: item.priority as 'now' | 'today' | 'this_week',
      status_tags: item.status_tags,
    }));

  const allActionItems = [...keptItems, ...newItems];

  // Ensure at least one action item (safety net)
  if (allActionItems.length === 0 && existingItems.length > 0) {
    // If LLM superseded everything but didn't create new ones, keep the existing items
    console.warn('[action-item-pass] LLM returned empty result set, keeping existing items');
    const fallbackItems = existingItems.map((item) => ({
      id: item.id,
      description: item.description,
      who: item.who,
      priority: item.priority as 'now' | 'today' | 'this_week',
      status_tags: item.status_tags,
    }));
    return { action_items: fallbackItems, status_tags: statusTags };
  }

  return { action_items: allActionItems, status_tags: statusTags };
}
