import { generateText } from 'ai';
import { getModelForPass } from './models';
import { getActiveActionItems, completeActionItems } from './action-items-db';

/**
 * Auto-completion detection pass (Phase 4).
 *
 * Triggered when an agent sends a response (webhook event type: agent_message).
 * Performs a lightweight LLM check to determine if the agent's message
 * addresses any currently active action items.
 *
 * Uses a cheap/fast model since this is a simple matching task.
 */

interface AutoCompleteResult {
  completedItemIds: string[];
  checked: boolean;
}

export async function runAutoCompleteCheck(
  ticketId: string,
  agentMessage: string
): Promise<AutoCompleteResult> {
  const activeItems = await getActiveActionItems(ticketId);

  if (activeItems.length === 0 || !agentMessage.trim()) {
    return { completedItemIds: [], checked: false };
  }

  // Use a cheap model — this is a simple matching task
  const model = getModelForPass('verification');

  const prompt = `An agent just sent the following response to a customer on a support ticket:

--- AGENT MESSAGE ---
${agentMessage.slice(0, 2000)}
--- END MESSAGE ---

Here are the currently active action items for this ticket:
${activeItems.map((item) => `- [${item.id}] (${item.who}, ${item.priority}) ${item.description}`).join('\n')}

Which action items (if any) does this response DIRECTLY address or complete?
Only mark an item as completed if the agent's message clearly fulfills what the action item asks for.
Do NOT mark items as completed if the message only partially addresses them.

Output EXACTLY one line:
COMPLETED_ITEMS: ["act_1", "act_3"] (a JSON array of item IDs, or [] if none)`;

  try {
    const result = await generateText({
      model,
      prompt,
    });

    const text = result.text || '';
    const match = text.match(/COMPLETED_ITEMS:\s*(\[[\s\S]*?\])/i);
    if (!match) {
      return { completedItemIds: [], checked: true };
    }

    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) {
      return { completedItemIds: [], checked: true };
    }

    const validIds = new Set(activeItems.map((i) => i.id));
    const completedIds = parsed
      .filter((id): id is string => typeof id === 'string' && validIds.has(id));

    if (completedIds.length > 0) {
      await completeActionItems(ticketId, completedIds, 'auto_detected');
    }

    return { completedItemIds: completedIds, checked: true };
  } catch (err) {
    console.error('[auto-complete-check] LLM call failed:', err);
    return { completedItemIds: [], checked: true };
  }
}
