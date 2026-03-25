import { createServiceClient } from '@/lib/supabase/client';
import { getHubSpotClient } from '@/lib/hubspot/client';
import { getOwnerById } from '@/lib/hubspot/owners';
import { getTicketEngagementTimeline } from '@/lib/hubspot/ticket-engagements';
import { fetchLinearIssueContext, type LinearIssueContext } from '@/lib/linear/client';
import { generateText, stepCountIs } from 'ai';
import { getSonnetModel } from '@/lib/ai/provider';
import { lookupSupportKnowledgeTool } from '@/lib/ai/tools/support-knowledge';
import type { SupabaseClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const CUSTOMER_KNOWLEDGE_DIR = path.join(process.cwd(), 'src', 'lib', 'ai', 'knowledge', 'customers');

// --- Types ---

interface ThreadMessage {
  id: string;
  type: string;
  createdAt: string;
  text?: string;
  subject?: string;
  senders?: Array<{ name?: string; actorId?: string }>;
}

export interface ActionItem {
  id: string;
  description: string;
  who: string;
  priority: 'now' | 'today' | 'this_week';
  status_tags: string[];
}

export interface RelatedTicketInfo {
  ticketId: string;
  subject: string;
  summary: string;
}

export interface TicketActionBoardAnalysis {
  hubspot_ticket_id: string;
  situation_summary: string;
  action_items: ActionItem[];
  customer_temperature: string;
  temperature_reason: string | null;
  response_guidance: string | null;
  response_draft: string | null;
  context_snapshot: string | null;
  related_tickets: RelatedTicketInfo[];
  hours_since_customer_waiting: number | null;
  hours_since_last_outbound: number | null;
  hours_since_last_activity: number | null;
  status_tags: string[];
  confidence: number;
  knowledge_used: string | null;
  ticket_subject: string | null;
  company_name: string | null;
  assigned_rep: string | null;
  age_days: number | null;
  is_closed: boolean;
  has_linear: boolean;
  linear_state: string | null;
  analyzed_at: string;
}

export type AnalyzeActionBoardResult =
  | { success: true; analysis: TicketActionBoardAnalysis; usage?: { inputTokens: number; outputTokens: number; totalTokens: number } }
  | { success: false; error: string; details?: string; statusCode?: number };

// --- System Prompt ---

function buildSystemPrompt(): string {
  return `You are an operations analyst for the support team at Opus Behavioral Health, a healthcare SaaS company providing an EHR and practice management platform for behavioral health organizations.

YOUR PURPOSE:
Your output will be read by support agents who may NOT be the original handler of a ticket. Write as if the reader has ZERO context. Every action item must be self-contained and executable by anyone on the team. Your job is to extract every pending action from a ticket and make it impossible to ignore.

This is NOT a training tool (that's the Trainer Queue). This is NOT a management triage tool (that's the Manager Queue). This is an OPERATIONAL ACTION BOARD — its purpose is to drive every agent to move every ticket forward, every shift.

CRITICAL — TEAM-BASED ACTION ITEMS:
- NEVER reference specific support agents by name in action items. The support team works as a TEAM — any agent can pick up any ticket. Write "the support team should..." or "the agent handling this should...", NEVER "coordinate with [agent name]" or "[agent name] needs to...".
- You may mention agent names in SITUATION_SUMMARY or CONTEXT_SNAPSHOT for factual context (e.g., "Louis last responded on March 17"), but ACTION_ITEMS must be role-based and executable by whoever is on shift.

PRODUCT KNOWLEDGE RETRIEVAL:
You have access to the \`lookupSupportKnowledge\` tool which retrieves detailed knowledge about specific system areas (scheduling, billing/RCM, TO DO list, clinical documentation, client management, reporting, and more).

**You MUST call \`lookupSupportKnowledge\` at least once before producing your analysis.** Based on the ticket's subject and conversation, identify which system area(s) are relevant and retrieve the knowledge.

CUSTOMER-SPECIFIC CONTEXT:
Some tickets include a CUSTOMER CONTEXT section. When present, factor the customer's handling instructions into your urgency assessment and action items. VIP customers need tighter response times.

YOUR ANALYSIS MUST INCLUDE:

1. **SITUATION_SUMMARY** — 2-3 sentences. What's going on, plain English. Written so any agent picking this up for the first time understands the full picture. Include the customer name, the core issue, and where things currently stand.

2. **ACTION_ITEMS** — A JSON array of discrete actions needed to move this ticket forward. Each item:
   - \`id\`: unique string (e.g., "act_1", "act_2")
   - \`description\`: Specific, self-contained instruction. Not "follow up" — say exactly what to do. Example: "Reply to the customer acknowledging their March 20 email asking for an ETA and provide the timeline from the Linear ticket (currently In Progress, last updated March 19)."
   - \`who\`: "any_support_agent" | "engineering" | "cs_manager"
   - \`priority\`: "now" (do immediately) | "today" (before end of shift) | "this_week" (can wait a day or two)
   - \`status_tags\`: array of applicable tags from: "reply_needed", "update_due", "engineering_ping", "internal_action", "waiting_on_customer"

   A single ticket can have MULTIPLE action items. Common patterns:
   - Reply to customer AND ping engineering for status
   - Send status update to customer AND investigate the workaround internally
   - Follow up with engineering AND prepare a fallback plan

3. **CUSTOMER_TEMPERATURE** — One of: calm | frustrated | escalating | angry
   Based on the customer's actual words and tone in the conversation, not just the situation.

4. **TEMPERATURE_REASON** — One sentence explaining why. E.g., "Customer has emailed twice in 4 hours asking for updates with increasingly urgent language."

5. **STATUS_TAGS** — Array of tags that apply to this ticket overall: reply_needed, update_due, engineering_ping, internal_action, waiting_on_customer. A ticket can have MULTIPLE tags.

6. **CONTEXT_SNAPSHOT** — 2-3 sentence engagement recap. Who said what, what was tried, where things stand. Written for someone with zero context.

7. **HOURS_SINCE_CUSTOMER_WAITING** — Float. Use the TICKET METADATA fields "Last Customer Message" and "Last Agent Message" as the authoritative timestamps. If Last Agent Message is MORE RECENT than Last Customer Message, the customer is NOT waiting — output 0. If Last Customer Message is MORE RECENT than Last Agent Message, calculate hours between Last Customer Message and now. Do NOT try to recalculate this from the conversation thread — use the metadata timestamps.

8. **HOURS_SINCE_LAST_OUTBOUND** — Float. Hours since "Last Agent Message" in the TICKET METADATA. Use that timestamp, not your own calculation from the conversation thread.

9. **HOURS_SINCE_LAST_ACTIVITY** — Float. Hours since any meaningful activity (message, note, call, engineering update). Use the most recent of Last Customer Message, Last Agent Message, or engagement timeline entries.

10. **RELATED_TICKET_NOTES** — If other open tickets from the same company are provided, note any coordination needed. E.g., "This customer also has TICKET-789 open about billing sync — ensure your response here doesn't contradict information given there." If no related tickets or no coordination needed, write "NONE".

11. **CONFIDENCE** — 0.00-1.00 score for your analysis quality.

12. **KNOWLEDGE_USED** — Comma-separated list of knowledge areas retrieved, followed by a dash and one sentence explaining how the knowledge informed your analysis. If none retrieved, write "none".

TICKET HYGIENE:
- **Drive toward closure**: If the conversation shows the customer's issue appears resolved (fix confirmed, question answered, workaround provided) but the ticket is still open, include an action item for an agent to send a friendly closing message: "It looks like we were able to resolve this for you — I'm going to close out this ticket. If anything else comes up, feel free to open a new ticket or reach back out." Do not leave resolved tickets lingering.
- **Missing Linear task**: If the ticket involves engineering or developer work (API requests, custom development, bug investigations, code changes) and no Linear task is linked, include an action item to create a Linear task so the engineering work can be tracked and followed up on. Note: Copilot/Nabla form configuration is NOT engineering work — it is handled by the implementation/onboarding team and does NOT need a Linear task.
- **Copilot AI / Nabla configuration**: If the ticket involves Copilot AI form setup or configuration (mapping form fields to Nabla's output sections), this requires clinical section expertise and is NOT something support agents should handle independently. Include an action item to escalate to the implementation/onboarding team (Saagar's team) for the correct mapping. This is a handoff, not a collaboration — the implementation team owns Copilot configuration.
- **Missing company association**: If the COMPANY name in the ticket metadata shows "Unknown" or is missing, include an action item for the agent to associate the ticket with the correct Company record in HubSpot. Every ticket must be linked to a Company so it can be properly tracked and reported on.
- **Co-Destiny (VIP) accounts**: If the ticket metadata shows "Co-Destiny Account: YES", this is a VIP customer requiring elevated attention. Any blocking issue (billing, claims, workflow disruption, documentation failures) must be treated with critical urgency. Include an action item for the CS Manager to be notified immediately. Response times must be same-day. The support team should be pushing for resolution updates daily.

COMPLETION AUDIT:
When ACTION_ITEM_COMPLETIONS are provided, you must verify each claimed completion against the conversation and engagement timeline:
- If an agent claimed "replied to customer" but no new outbound message appears after their claimed completion time → include a VERIFICATION_FLAG in your response noting the discrepancy: "UNVERIFIED: [agent name] marked '[action]' as done at [time], but no corresponding activity found in HubSpot."
- If the action IS reflected in the data → note "VERIFIED: [action] confirmed in timeline."
- Include these flags so they can be used to update completion records.

Respond in this EXACT format:

SITUATION_SUMMARY: [2-3 sentences]
ACTION_ITEMS: [JSON array]
CUSTOMER_TEMPERATURE: [calm|frustrated|escalating|angry]
TEMPERATURE_REASON: [one sentence]
STATUS_TAGS: [comma-separated list]
CONTEXT_SNAPSHOT: [2-3 sentences]
HOURS_SINCE_CUSTOMER_WAITING: [float]
HOURS_SINCE_LAST_OUTBOUND: [float]
HOURS_SINCE_LAST_ACTIVITY: [float]
RELATED_TICKET_NOTES: [notes or NONE]
CONFIDENCE: [0.00-1.00]
KNOWLEDGE_USED: [areas — explanation]
VERIFICATION_FLAGS: [flags or NONE]`;
}

// --- Core Analysis Function ---

export async function analyzeActionBoardTicket(
  ticketId: string,
  readerClient?: SupabaseClient
): Promise<AnalyzeActionBoardResult> {
  const supabase = readerClient || createServiceClient();
  const serviceClient = createServiceClient();
  const hsClient = getHubSpotClient();

  try {
    // 1. Fetch ticket metadata
    const { data: ticket, error: ticketError } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('hubspot_ticket_id', ticketId)
      .single();

    if (ticketError || !ticket) {
      return { success: false, error: 'Ticket not found', details: ticketError?.message, statusCode: 404 };
    }

    // 2. Resolve owner name (try DB first, fall back to HubSpot API)
    let ownerName: string | null = null;
    if (ticket.hubspot_owner_id) {
      const { data: owner } = await supabase
        .from('owners')
        .select('first_name, last_name, email')
        .eq('hubspot_owner_id', ticket.hubspot_owner_id)
        .single();
      if (owner) {
        ownerName = [owner.first_name, owner.last_name].filter(Boolean).join(' ') || owner.email || null;
      } else {
        try {
          const hsOwner = await getOwnerById(ticket.hubspot_owner_id);
          if (hsOwner) {
            ownerName = [hsOwner.firstName, hsOwner.lastName].filter(Boolean).join(' ') || hsOwner.email || null;
          }
        } catch {
          console.warn(`Could not fetch owner ${ticket.hubspot_owner_id} from HubSpot`);
        }
      }
    }

    // 3. Fetch conversation thread from HubSpot
    let conversationMessages: ThreadMessage[] = [];
    try {
      const hsTicket = await hsClient.crm.tickets.basicApi.getById(ticketId, [
        'subject',
        'hs_conversations_originating_thread_id',
      ]);
      const threadId = hsTicket.properties.hs_conversations_originating_thread_id;

      if (threadId) {
        const messagesResponse = await hsClient.apiRequest({
          method: 'GET',
          path: `/conversations/v3/conversations/threads/${threadId}/messages`,
        });
        const messagesData = (await messagesResponse.json()) as { results?: ThreadMessage[] };
        conversationMessages = messagesData.results || [];
      }
    } catch (err) {
      console.warn(`Could not fetch conversation thread for ticket ${ticketId}:`, err);
    }

    // 4. Fetch engagement timeline
    let engagementTimeline;
    try {
      engagementTimeline = await getTicketEngagementTimeline(ticketId);
    } catch (err) {
      console.warn(`Could not fetch engagement timeline for ticket ${ticketId}:`, err);
      engagementTimeline = { engagements: [], counts: { emails: 0, notes: 0, calls: 0, meetings: 0, total: 0 } };
    }

    // 5. Fetch Linear engineering context (if linked)
    let linearContext: LinearIssueContext | null = null;
    if (ticket.linear_task) {
      try {
        linearContext = await fetchLinearIssueContext(ticket.linear_task);
      } catch (err) {
        console.warn(`Could not fetch Linear context for ticket ${ticketId}:`, err);
      }
    }

    // 6. Build conversation text
    const conversationText =
      conversationMessages.length > 0
        ? conversationMessages
            .slice(0, 20)
            .map((msg) => {
              const sender = msg.senders?.map((s) => s.name || s.actorId).join(', ') || 'Unknown';
              const text = msg.text || '(no text)';
              return `[${msg.createdAt}] ${sender}: ${text}`;
            })
            .join('\n\n')
        : 'No conversation thread available.';

    // 7. Build engagement timeline text
    const engagementTimelineText =
      engagementTimeline.engagements.length > 0
        ? engagementTimeline.engagements
            .slice(0, 30)
            .map((e) => {
              const ts = e.timestamp.toISOString().split('T')[0];
              const parts = [`[${ts}] ${e.type.toUpperCase()}`];
              if (e.author) parts.push(`by ${e.author}`);
              if (e.direction) parts.push(`(${e.direction})`);
              if (e.subject) parts.push(`— ${e.subject}`);
              if (e.body) parts.push(`\n    ${e.body.slice(0, 300)}`);
              if (e.duration) parts.push(`\n    Duration: ${Math.round(e.duration / 60)}min`);
              return parts.join(' ');
            })
            .join('\n')
        : 'No engagement timeline available.';

    // 8. Ticket age
    const createdAt = ticket.hubspot_created_at ? new Date(ticket.hubspot_created_at) : null;
    const ageDays = createdAt
      ? Math.round((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    // 9. Load customer-specific context (if available)
    let customerContext: string | null = null;
    if (ticket.hs_primary_company_name) {
      const normalizedName = ticket.hs_primary_company_name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-');
      const customerFilePath = path.join(CUSTOMER_KNOWLEDGE_DIR, `${normalizedName}.md`);
      try {
        customerContext = fs.readFileSync(customerFilePath, 'utf-8');
      } catch {
        // No customer-specific context — normal for most customers
      }
    }

    // 10. Fetch related open tickets from the same company (cross-ticket awareness)
    let relatedTicketsContext = '';
    if (ticket.hs_primary_company_name) {
      const { data: relatedTickets } = await supabase
        .from('support_tickets')
        .select('hubspot_ticket_id, subject')
        .eq('hs_primary_company_name', ticket.hs_primary_company_name)
        .eq('is_closed', false)
        .neq('hubspot_ticket_id', ticketId)
        .limit(10);

      if (relatedTickets && relatedTickets.length > 0) {
        // Fetch summaries from action board analyses if available
        const relatedIds = relatedTickets.map((t) => t.hubspot_ticket_id);
        const { data: relatedAnalyses } = await supabase
          .from('ticket_action_board_analyses')
          .select('hubspot_ticket_id, situation_summary')
          .in('hubspot_ticket_id', relatedIds);

        const summaryMap = new Map(
          (relatedAnalyses || []).map((a) => [a.hubspot_ticket_id, a.situation_summary])
        );

        relatedTicketsContext = `\n\nRELATED OPEN TICKETS FROM SAME COMPANY (${ticket.hs_primary_company_name}):\n` +
          relatedTickets.map((t) => {
            const summary = summaryMap.get(t.hubspot_ticket_id);
            return `- TICKET-${t.hubspot_ticket_id}: ${t.subject || 'No subject'}${summary ? ` — ${summary}` : ''}`;
          }).join('\n');
      }
    }

    // 11. Fetch recent action item completions for audit loop
    let completionsContext = '';
    const { data: recentCompletions } = await serviceClient
      .from('action_item_completions')
      .select('action_item_id, action_description, completed_at, completed_by, verified, verification_note')
      .eq('hubspot_ticket_id', ticketId)
      .order('completed_at', { ascending: false })
      .limit(20);

    if (recentCompletions && recentCompletions.length > 0) {
      // Resolve agent names
      const userIds = [...new Set(recentCompletions.map((c) => c.completed_by))];
      const { data: users } = await serviceClient
        .from('user_profiles')
        .select('id, display_name, email')
        .in('id', userIds);

      const userMap = new Map(
        (users || []).map((u) => [u.id, u.display_name || u.email || 'Unknown'])
      );

      completionsContext = `\n\nACTION ITEM COMPLETIONS (verify these against the conversation/engagement timeline):\n` +
        recentCompletions.map((c) => {
          const agentName = userMap.get(c.completed_by) || 'Unknown';
          const time = new Date(c.completed_at).toISOString();
          return `- "${c.action_description}" marked done by ${agentName} at ${time}`;
        }).join('\n');
    }

    // 12. Build user prompt
    const userPrompt = `Analyze this support ticket and extract all pending actions:

TICKET METADATA:
- Ticket ID: ${ticketId}
- Subject: ${ticket.subject || 'N/A'}
- Source: ${ticket.source_type || 'N/A'}
- Priority: ${ticket.priority || 'N/A'}
- Status: ${ticket.is_closed ? 'Closed' : 'Open'}
- Age: ${ageDays !== null ? `${ageDays} days` : 'Unknown'}
- Ball In Court: ${ticket.ball_in_court || 'N/A'}
- Software: ${ticket.software || 'N/A'}
- Assigned Rep: ${ownerName || 'Unassigned'}
- Last Customer Message: ${ticket.last_customer_message_at || 'Unknown'}
- Last Agent Message: ${ticket.last_agent_message_at || 'Unknown'}
- Co-Destiny Account: ${ticket.is_co_destiny ? 'YES — VIP customer requiring elevated attention' : 'No'}

COMPANY:
- Name: ${ticket.hs_primary_company_name || 'Unknown'}${customerContext ? `

CUSTOMER CONTEXT:
${customerContext}` : ''}

ENGAGEMENT SUMMARY:
- Emails: ${engagementTimeline.counts.emails}
- Notes: ${engagementTimeline.counts.notes}
- Calls: ${engagementTimeline.counts.calls}
- Meetings: ${engagementTimeline.counts.meetings}

CONVERSATION THREAD (${conversationMessages.length} messages):
${conversationText}

ENGAGEMENT TIMELINE (${engagementTimeline.engagements.length} items):
${engagementTimelineText}${linearContext ? `

LINEAR ENGINEERING CONTEXT:
- Linear Issue: ${linearContext.identifier} — ${linearContext.title}
- State: ${linearContext.state}
- Priority: ${linearContext.priority}
- Assignee: ${linearContext.assignee || 'Unassigned'}
- Created: ${linearContext.createdAt.split('T')[0]}
- Updated: ${linearContext.updatedAt.split('T')[0]}

Description:
${linearContext.description || '(no description)'}

Engineering Comments (${linearContext.comments.length}):
${linearContext.comments.length > 0
  ? linearContext.comments
      .map((c) => `[${c.createdAt.split('T')[0]}] ${c.author}: ${c.body}`)
      .join('\n\n')
  : 'No comments yet.'}${linearContext.relatedIssues.length > 0 ? `

Related Linear Issues (${linearContext.relatedIssues.length}):
${linearContext.relatedIssues
  .map((ri) => `- ${ri.identifier}: ${ri.title} (${ri.relationType}) — State: ${ri.state}, Priority: ${ri.priority}, Assignee: ${ri.assignee || 'Unassigned'}`)
  .join('\n')}` : ''}` : ticket.linear_task ? `

LINEAR ENGINEERING CONTEXT:
A Linear engineering ticket is linked to this support ticket (${ticket.linear_task}), confirming that an engineering escalation HAS occurred. Full details could not be retrieved. Do NOT state there is no engineering escalation.` : ''}${relatedTicketsContext}${completionsContext}`;

    // 13. Call LLM with knowledge retrieval tools
    const result = await generateText({
      model: getSonnetModel(),
      system: buildSystemPrompt(),
      prompt: userPrompt,
      tools: {
        lookupSupportKnowledge: lookupSupportKnowledgeTool,
      },
      stopWhen: stepCountIs(5),
    });

    // 14. Parse structured response
    const text = result.text || result.steps[result.steps.length - 1]?.text || '';

    const field = (name: string, fallback: string): string => {
      const m = text.match(new RegExp(`${name}:\\s*(.+?)(?=\\n[A-Z_]+:|\\n\\n|$)`, 'is'));
      return m ? m[1].trim() : fallback;
    };

    const numField = (name: string, fallback: number): number => {
      const m = text.match(new RegExp(`${name}:\\s*([\\d.]+)`, 'i'));
      return m ? parseFloat(m[1]) : fallback;
    };

    // Parse situation summary
    const situationSummary = field('SITUATION_SUMMARY', 'No summary available.');

    // Parse action items (JSON array)
    let actionItems: ActionItem[] = [];
    try {
      const actionItemsMatch = text.match(/ACTION_ITEMS:\s*(\[[\s\S]*?\])(?=\n[A-Z_]+:|\n\n|$)/i);
      if (actionItemsMatch) {
        const parsed = JSON.parse(actionItemsMatch[1]);
        if (Array.isArray(parsed)) {
          actionItems = parsed.map((item: Record<string, unknown>, idx: number) => ({
            id: (item.id as string) || `act_${idx + 1}`,
            description: (item.description as string) || 'No description',
            who: (item.who as string) || 'any_support_agent',
            priority: (['now', 'today', 'this_week'].includes(item.priority as string) ? item.priority : 'today') as 'now' | 'today' | 'this_week',
            status_tags: Array.isArray(item.status_tags) ? item.status_tags as string[] : [],
          }));
        }
      }
    } catch (err) {
      console.warn(`Could not parse ACTION_ITEMS JSON for ticket ${ticketId}:`, err);
    }

    // Parse other fields
    const customerTemperature = field('CUSTOMER_TEMPERATURE', 'calm').toLowerCase();
    const validTemps = ['calm', 'frustrated', 'escalating', 'angry'];
    const temperature = validTemps.includes(customerTemperature) ? customerTemperature : 'calm';
    const temperatureReason = field('TEMPERATURE_REASON', null as unknown as string) || null;

    const statusTagsRaw = field('STATUS_TAGS', 'waiting_on_customer');
    const validTags = ['reply_needed', 'update_due', 'engineering_ping', 'internal_action', 'waiting_on_customer'];
    const statusTags = statusTagsRaw.split(',').map((t) => t.trim().toLowerCase()).filter((t) => validTags.includes(t));
    if (statusTags.length === 0) statusTags.push('waiting_on_customer');

    const contextSnapshot = field('CONTEXT_SNAPSHOT', null as unknown as string) || null;

    const hoursSinceCustomerWaiting = numField('HOURS_SINCE_CUSTOMER_WAITING', 0);
    const hoursSinceLastOutbound = numField('HOURS_SINCE_LAST_OUTBOUND', 0);
    const hoursSinceLastActivity = numField('HOURS_SINCE_LAST_ACTIVITY', 0);

    const confidence = Math.min(1, Math.max(0, numField('CONFIDENCE', 0.5)));
    const knowledgeUsed = field('KNOWLEDGE_USED', null as unknown as string) || null;

    // Parse related ticket notes
    const relatedTicketNotes = field('RELATED_TICKET_NOTES', 'NONE');
    let relatedTicketsData: RelatedTicketInfo[] = [];
    if (relatedTicketNotes !== 'NONE' && ticket.hs_primary_company_name) {
      // Re-fetch related tickets for structured data
      const { data: relatedTickets } = await supabase
        .from('support_tickets')
        .select('hubspot_ticket_id, subject')
        .eq('hs_primary_company_name', ticket.hs_primary_company_name)
        .eq('is_closed', false)
        .neq('hubspot_ticket_id', ticketId)
        .limit(10);

      if (relatedTickets) {
        relatedTicketsData = relatedTickets.map((t) => ({
          ticketId: t.hubspot_ticket_id,
          subject: t.subject || 'No subject',
          summary: relatedTicketNotes,
        }));
      }
    }

    // Parse verification flags and update completions
    const verificationFlagsRaw = field('VERIFICATION_FLAGS', 'NONE');
    if (verificationFlagsRaw !== 'NONE' && recentCompletions && recentCompletions.length > 0) {
      // Try to update verified status on completions
      const unverifiedMatches = verificationFlagsRaw.matchAll(/UNVERIFIED:.*?"(.+?)".*?marked.*?done/gi);
      for (const match of unverifiedMatches) {
        const actionDesc = match[1];
        const completion = recentCompletions.find((c) =>
          c.action_description.toLowerCase().includes(actionDesc.toLowerCase())
        );
        if (completion) {
          await serviceClient
            .from('action_item_completions')
            .update({ verified: false, verification_note: match[0] })
            .eq('id', completion.action_item_id);
        }
      }

      const verifiedMatches = verificationFlagsRaw.matchAll(/VERIFIED:.*?"?(.+?)"?\s*confirmed/gi);
      for (const match of verifiedMatches) {
        const actionDesc = match[1];
        const completion = recentCompletions.find((c) =>
          c.action_description.toLowerCase().includes(actionDesc.toLowerCase())
        );
        if (completion) {
          await serviceClient
            .from('action_item_completions')
            .update({ verified: true, verification_note: match[0] })
            .eq('id', completion.action_item_id);
        }
      }
    }

    // 15. Upsert into ticket_action_board_analyses
    const analysisData: TicketActionBoardAnalysis = {
      hubspot_ticket_id: ticketId,
      situation_summary: situationSummary,
      action_items: actionItems,
      customer_temperature: temperature,
      temperature_reason: temperatureReason,
      response_guidance: null,
      response_draft: null,
      context_snapshot: contextSnapshot,
      related_tickets: relatedTicketsData,
      hours_since_customer_waiting: hoursSinceCustomerWaiting,
      hours_since_last_outbound: hoursSinceLastOutbound,
      hours_since_last_activity: hoursSinceLastActivity,
      status_tags: statusTags,
      confidence,
      knowledge_used: knowledgeUsed,
      ticket_subject: ticket.subject,
      company_name: ticket.hs_primary_company_name,
      assigned_rep: ownerName,
      age_days: ageDays,
      is_closed: ticket.is_closed || false,
      has_linear: !!ticket.linear_task,
      linear_state: linearContext?.state || null,
      analyzed_at: new Date().toISOString(),
    };

    const { error: upsertError } = await serviceClient
      .from('ticket_action_board_analyses')
      .upsert(analysisData, { onConflict: 'hubspot_ticket_id' });

    if (upsertError) {
      console.error('Error upserting action board analysis:', upsertError);
    }

    return {
      success: true,
      analysis: analysisData,
      usage: result.totalUsage ? {
        inputTokens: result.totalUsage.inputTokens ?? 0,
        outputTokens: result.totalUsage.outputTokens ?? 0,
        totalTokens: result.totalUsage.totalTokens ?? 0,
      } : undefined,
    };
  } catch (error) {
    console.error('Action board analysis error:', error);
    return {
      success: false,
      error: 'Failed to analyze ticket',
      details: error instanceof Error ? error.message : 'Unknown error',
      statusCode: 500,
    };
  }
}
