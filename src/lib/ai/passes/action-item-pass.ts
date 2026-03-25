import { generateText, stepCountIs } from 'ai';
import { getModelForPass } from './models';
import { buildTicketMetadataSection, buildLinearSection } from './gather-context';
import { lookupSupportKnowledgeTool } from '@/lib/ai/tools/support-knowledge';
import type { TicketContext, ActionItemPassResult, ActionItem } from './types';

interface ActionItemDeps {
  situationSummary?: string;
}

export async function runActionItemPass(
  context: TicketContext,
  deps?: ActionItemDeps
): Promise<ActionItemPassResult> {
  const model = getModelForPass('action_items');

  const systemPrompt = `You are an operations analyst for the support team at Opus Behavioral Health, a healthcare SaaS company.

YOUR PURPOSE: Extract every pending action from a support ticket and generate specific, self-contained, executable action items. Your output drives agents to move every ticket forward, every shift.

EVERY TICKET MUST HAVE AT LEAST ONE ACTION ITEM. There is always something to do — even if the ticket is waiting on a customer, engineering, or a third party, there's a follow-up to schedule, an update to send, a status check to make, or a closure to initiate. An empty action list means agents have nothing to act on, which defeats the purpose of this board. If you genuinely cannot identify an action, default to a proactive follow-up or status update action.

PRODUCT KNOWLEDGE RETRIEVAL:
You have access to the \`lookupSupportKnowledge\` tool. You MUST call it at least once before producing your analysis, based on the ticket's subject and conversation.

CRITICAL RULES:
- NEVER reference specific support agents by name in action items. Write "the support team should..." or "the agent handling this should...", never "[name] needs to..."
- Each action item must be executable by anyone on the team with zero context beyond what you provide

TICKET HYGIENE:
- If the issue appears resolved but ticket is still open, include an action to send a closing message
- If engineering work is needed and no Linear task is linked, include an action to create one (except Copilot/Nabla config — that's implementation team)
- If Copilot AI/Nabla configuration is involved, include an action to escalate to implementation/onboarding team (Saagar's team)
- If company name is "Unknown" or missing, include an action to associate the ticket with the correct Company in HubSpot
- Co-Destiny (VIP) accounts: blocking issues need critical urgency, CS Manager notification, same-day response, daily resolution updates

Output EXACTLY two fields:

ACTION_ITEMS: A JSON array where each item has:
- "id": unique string (e.g., "act_1")
- "description": Specific instruction, not vague. Say exactly what to do.
- "who": "any_support_agent" | "engineering" | "cs_manager"
- "priority": "now" | "today" | "this_week"
- "status_tags": array from ["reply_needed", "update_due", "engineering_ping", "internal_action", "waiting_on_customer"]

STATUS_TAGS: Comma-separated list of tags that apply to this ticket overall (from the same set as above). A ticket can have MULTIPLE tags.`;

  let userPrompt = `${buildTicketMetadataSection(context)}`;

  if (deps?.situationSummary) {
    userPrompt += `\n\nSITUATION SUMMARY (from prior analysis):\n${deps.situationSummary}`;
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

  // Parse action items JSON
  let actionItems: ActionItem[] = [];
  try {
    const match = text.match(/ACTION_ITEMS:\s*(\[[\s\S]*?\])(?=\n[A-Z_]+:|\n\n|$)/i);
    if (match) {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) {
        actionItems = parsed.map((item: Record<string, unknown>, idx: number) => ({
          id: (item.id as string) || `act_${idx + 1}`,
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
    console.warn(`Could not parse ACTION_ITEMS JSON:`, err);
  }

  // Parse status tags
  const statusTagsRaw = text.match(/STATUS_TAGS:\s*(.+?)(?=\n[A-Z_]+:|\n\n|$)/is)?.[1] || 'waiting_on_customer';
  const validTags = ['reply_needed', 'update_due', 'engineering_ping', 'internal_action', 'waiting_on_customer'];
  const statusTags = statusTagsRaw.split(',').map((t) => t.trim().toLowerCase()).filter((t) => validTags.includes(t));
  if (statusTags.length === 0) statusTags.push('waiting_on_customer');

  return { action_items: actionItems, status_tags: statusTags };
}
