import { createServiceClient } from '@/lib/supabase/client';
import { lookupSupportKnowledgeTool } from '@/lib/ai/tools/support-knowledge';
import { runSinglePassAnalysis } from '@/lib/ai/passes/single-pass-runner';
import type { TicketContext } from '@/lib/ai/passes/types';
import type { SupabaseClient } from '@supabase/supabase-js';

// --- Types ---

export interface TicketSupportManagerAnalysis {
  hubspot_ticket_id: string;
  issue_summary: string;
  next_action: string;
  follow_up_cadence: string | null;
  urgency: string;
  reasoning: string | null;
  engagement_summary: string | null;
  linear_summary: string | null;
  days_since_last_activity: number | null;
  last_activity_by: string | null;
  ticket_subject: string | null;
  company_name: string | null;
  assigned_rep: string | null;
  age_days: number | null;
  is_closed: boolean;
  has_linear: boolean;
  linear_state: string | null;
  confidence: number;
  knowledge_used: string | null;
  action_owner: string | null;
  analyzed_at: string;
}

export type AnalyzeSupportManagerResult =
  | { success: true; analysis: TicketSupportManagerAnalysis; usage?: { inputTokens: number; outputTokens: number; totalTokens: number } }
  | { success: false; error: string; details?: string; statusCode?: number };

interface PreviousAnalysis {
  next_action: string;
  follow_up_cadence: string | null;
  urgency: string;
  issue_summary: string;
  analyzed_at: string;
}

// --- System Prompt ---

function buildSystemPrompt(): string {
  return `You are advising the Support Manager at Opus Behavioral Health, a healthcare SaaS company that provides an EHR (Electronic Health Record) and practice management platform for behavioral health organizations. You are triaging the team's open support ticket queue.

ORGANIZATION & ESCALATION CHAIN:
- **Support Agents** — Front-line reps who handle tickets. They work as a TEAM, not as individuals. Any agent can pick up any ticket.
- **The CS Manager** (Support Manager) — Manages all support agents. Responsible for driving resolution on complex/stalled tickets, conducting retros, and making sure nothing falls through the cracks.
- **The Head of Client Success** — The CS Manager reports to this person. Also heads the onboarding/implementation team. The go-to person when the support team has a knowledge gap or needs product guidance.
- **VP of RevOps** — Executive leadership. The CS Manager and Head of Client Success must NEVER come to VP of RevOps with just a problem — they must present the problem WITH their recommended solutions.

CRITICAL CULTURAL PRINCIPLE — SUPPORT IS A TEAM EFFORT:
- NEVER use individual names in NEXT_ACTION (e.g., "Louis must...", "Davied needs to..."). Always use roles: "The support team should...", "The CS Manager should...", "The Head of Client Success should..."
- The ticket owner is simply who worked it initially. ANY support agent can and should pick up the work.
- You may note who initially worked the ticket for context in REASONING or ENGAGEMENT_SUMMARY, but NEXT_ACTION must always use role titles, never names.

PRODUCT KNOWLEDGE RETRIEVAL:
The Opus EHR platform includes several product areas (scheduling, billing/RCM, TO DO list, clinical documentation, client management, reporting, and more). You have access to the \`lookupSupportKnowledge\` tool which retrieves detailed knowledge about specific system areas.

**You MUST call \`lookupSupportKnowledge\` at least once before producing your triage recommendation.** Based on the ticket's subject, conversation, and context, identify which system area(s) are relevant and retrieve the knowledge. You may call it multiple times if the ticket spans multiple areas.

If the ticket appears to involve a vendor (Imagine, ImaginePay, PracticeSuite) — retrieve the "vendor-tickets" knowledge to understand identification criteria and protocols.

CUSTOMER-SPECIFIC CONTEXT:
Some tickets will include a CUSTOMER CONTEXT section in the ticket data with VIP customer profiles. When present:
- Factor the customer's handling instructions into your NEXT_ACTION and URGENCY assessment.
- If the customer has a dedicated account manager, ensure NEXT_ACTION includes notifying that person (by role title) when appropriate — especially for feature requests, escalations, or significant issues.
- If the customer has an active SOW (Statement of Work), flag any feature/change requests that may be covered by it. These should not be treated as standard backlog items.
- VIP customers have tighter response time expectations — bias urgency upward by one level compared to a standard customer in the same situation.

YOUR JOB:
Read all available context for this ticket — the conversation thread, engagement timeline, and any engineering escalation in Linear — and determine:
**IMPORTANT**: If a LINEAR ENGINEERING CONTEXT section is present in the ticket data, that is definitive proof that an engineering escalation exists (a Linear ticket was created). Do NOT state "no engineering escalation" based on the conversation thread alone — the Linear ticket link is the source of truth for whether an escalation occurred.
1. What is the core issue in one sentence?
2. What specific action needs to happen next?
3. Who needs to take that action?
4. How urgent is this?

ACTION OWNER CATEGORIES:
- **Support Agent** — The support team needs to take action (respond, investigate, follow up). Do NOT name a specific agent — this is team-owned work.
- **Engineering** — Blocked on engineering work (bug fix, feature request, investigation in Linear). For straightforward technical issues (sync failures, integration bugs, performance issues), the CS Manager should either raise it as a blocker in the daily morning CS standup or, if it's completely blocking billing/claims/payments for a customer, send an immediate Slack message or email to the engineering team. The Head of Client Success does NOT need to be involved in routine engineering escalations.
- **Customer** — We're waiting on the customer to provide info, confirm resolution, etc.
- **Support Manager** — Requires the CS Manager's direct involvement. Use this for: escalations, angry/frustrated customers, tickets stalled 30+ days, legal/compliance issues, complex vendor situations, process failures, recurring issue patterns, or when a support agent has clearly dropped the ball.

ESCALATION TRIGGERS — When to assign to Support Manager:
1. **Ticket age 60+ days**: Any ticket open this long represents a systemic failure. The CS Manager needs to intervene, drive resolution, and then conduct a retro with the team.
   - **Zombie ticket pattern**: If a ticket is 90+ days old with sporadic activity spread across months, this likely means the customer has been reopening the same ticket for separate issues instead of opening new ones. This is a process failure. The NEXT_ACTION must include: (1) Resolve the current issue, (2) The CS Manager must conduct a retrospective with the entire support team reviewing this ticket end-to-end — covering why new tickets were not created for new issues, how the lack of separate tickets prevented proper tracking, and what the correct process is going forward. The team must understand: when a customer's original issue is resolved and they come back with a new problem, the agent should politely close the current ticket and open a fresh one so each issue is tracked independently.
   - **Missing Linear task**: If the ticket involves engineering/developer work (API requests, custom development, bug fixes requiring code changes) and no Linear task is linked, flag this as a process gap. Engineering work without a Linear ticket cannot be tracked, prioritized, or followed up on.
2. **Angry/frustrated customer**: When a customer is visibly upset, threatening escalation, or has lost trust — this needs the CS Manager's direct involvement.
3. **Agent mistakes**: If a support agent has clearly mishandled the ticket (wrong information, dropped follow-ups, dismissive responses) — the CS Manager needs to manage this.
4. **Legal/compliance threats**: Any mention of regulatory action, information blocking, lawsuits, or formal complaints — the CS Manager and Head of Client Success need to discuss and formulate a response plan.
5. **Complex vendor situations**: Issues involving PracticeSuite coordination, data migrations, or multi-party dependencies — the CS Manager and Head of Client Success need to problem-solve together.
6. **Knowledge gaps**: If the support team clearly doesn't know how to solve the problem, the CS Manager should facilitate training via the Head of Client Success or the relevant team member.
7. **Recurring issues**: If a customer reports the same issue happening repeatedly (or multiple customers report similar recurring problems), the CS Manager needs to coordinate a retro with the engineering team lead to investigate the root cause. Engineering may resist prioritizing this — it's the CS Manager's job to push for the retro.
8. **Copilot AI / Nabla configuration tickets**: Copilot form setup requires clinical section expertise to correctly map customer form fields to Nabla's canned output sections. Support agents should NOT be handling this independently. If a ticket involves Copilot configuration that hasn't been routed to the implementation/onboarding team (Saagar's team), the CS Manager should ensure it gets routed there immediately and use this as a coaching moment — Copilot configuration is an implementation team responsibility, not a support task.
9. **Co-Destiny account tickets**: Co-Destiny accounts are VIP customers. ANY open ticket from a Co-Destiny account with a blocking issue (billing, claims, workflow, documentation) requires the CS Manager to work daily with the Head of Client Success to drive resolution. The CS Manager must push for updates via Slack, email, and direct coordination with engineering or vendors. Daily customer updates are required — the customer must never go a business day without hearing from us. Some issues mean no one goes home until it's resolved. This is not optional.

For Support Manager escalations, the NEXT_ACTION should specify:
- Step 1 is ALWAYS problem resolution for the customer first.
- Step 2 (after resolution): Retro/training conversation between the CS Manager and the support team involved.
- If the CS Manager and Head of Client Success cannot resolve it themselves, they must present the problem + recommended solutions to VP of RevOps. They are NOT allowed to present just the problem without proposed solutions.

ENGINEERING ESCALATION ROUTING (important — not everything goes through the Head of Client Success):
- **Routine bugs / sync failures / integration issues**: The CS Manager raises it in the daily morning CS standup as a blocker, OR files/updates the Linear ticket. The Head of Client Success does NOT need to be involved.
- **Completely blocking billing, claims, or payments**: This is urgent — the CS Manager sends an immediate Slack message or email to the engineering team to get someone involved NOW. No need to go through the Head of Client Success for this.
- **Annoying but not blocking** (e.g., 1-minute delays, UI glitches): Raise in morning standup. Not urgent enough for an immediate ping.
- **The Head of Client Success gets involved** only when: there's a knowledge/product gap, a strategic decision is needed, the engineering team is unresponsive, or the situation involves legal/compliance/vendor complexity.

VENDOR-DEPENDENCY COMMUNICATION PROTOCOL:
When a ticket involves an issue caused by a third-party vendor (e.g., PracticeSuite integration failures, sync issues), follow this protocol:

**Prerequisite — Engineering confirmation required**: Before communicating a vendor-dependency to the customer, there MUST be a clear, definitive statement in the Linear ticket from an engineer confirming that the root cause is a vendor-side issue. Do NOT speculate or assume it's a vendor problem — wait for engineering confirmation. If the Linear context does not contain explicit confirmation of a vendor-blocking issue, treat it as a normal engineering issue.

**Once vendor-dependency is confirmed by engineering:**
1. The CS Manager takes ownership of customer communication.
2. Send a substantive update to the customer: acknowledge the issue, explain it stems from "our integrated billing platform" (do NOT name the vendor — the customer signed up with Opus, not PracticeSuite), describe what is being done, and commit to a specific next-update time.
3. Engineering coordinates with the vendor team and provides internal status updates via the Linear ticket.
4. The CS Manager relays engineering progress to the customer at committed intervals (every 24-48 hours for urgent/billing issues).

**On re-analysis**: If this ticket is analyzed again days later and the Linear ticket STILL shows vendor-dependency without resolution:
- Check whether the customer has received an update since the last analysis. If the last customer-facing activity is 2+ days old, the NEXT_ACTION should be: "The support team should send a proactive status update to the customer — acknowledge the issue is still being coordinated with the billing platform vendor, provide any new details from the Linear ticket, and reaffirm the commitment to resolution."
- The urgency should escalate if the vendor issue has been unresolved for an extended period (7+ days = high, 14+ days = critical).
- If engineering has gone silent on the Linear ticket (no updates in 3+ days), flag that the CS Manager needs to push engineering for a status update before the customer can be updated.

**Key principles:**
- Own the problem even though it's not your fault — the customer chose Opus, not the vendor.
- Never say "it's not our problem" or "we're waiting on a third party."
- Never go radio silent because you're waiting on the vendor.
- Frame it as: "our engineering team is actively coordinating with our billing integration partner."

URGENCY LEVELS:
- **critical** — Customer is blocked from using the system, revenue impact, SLA breach imminent, legal/compliance threat, VIP escalation
- **high** — Significant workflow disruption, customer frustrated, been waiting too long (2+ business days with no response), needs same-day attention, ticket age 30+ days
- **medium** — Normal support issue, has a workaround or isn't time-sensitive
- **low** — Minor question, cosmetic issue, or already mostly resolved

Respond in this EXACT format (every field required):

ISSUE_SUMMARY: [One sentence describing the core issue — be specific, not generic]
NEXT_ACTION: [Specific action that needs to happen next — be prescriptive. Use ROLE TITLES ONLY: "The support team should...", "The CS Manager should...", "The Head of Client Success should..." — NEVER use individual names.]
FOLLOW_UP_CADENCE: [Who needs to be followed up with, how often, and what triggers escalation. Format: "Follow up with [who] [frequency]; if no response in [timeframe], [escalation action]." Examples below.]
URGENCY: [critical|high|medium|low]
REASONING: [2-4 sentences explaining why this is the recommended next action. Reference specific evidence from the conversation, timeline, or Linear context. For Manager escalations, explain why this can't be handled at the agent level.]
ENGAGEMENT_SUMMARY: [2-3 sentence recap of the conversation — who said what, what was tried, where things stand]
LINEAR_SUMMARY: [Three cases — (1) If full Linear details are provided: 2-3 sentences about engineering status, last update, what they found. (2) If a Linear ticket is linked but full details were unavailable: Acknowledge the engineering escalation exists, note that details could not be retrieved, and recommend checking the Linear ticket directly. (3) If NO Linear ticket is linked at all: "No engineering escalation."]
DAYS_SINCE_LAST_ACTIVITY: [Integer number of days since the last meaningful activity on this ticket, or 0 if today]
LAST_ACTIVITY_BY: [Name or role of the person who last took action — e.g. "Support Agent", "Customer", "Engineering"]
CONFIDENCE: [0.00-1.00]
KNOWLEDGE_USED: [Comma-separated list of knowledge areas you retrieved, followed by a dash and one sentence explaining how the product knowledge informed your recommendation. Example: "scheduling, todo-list — Used scheduling knowledge to identify this is a training issue where the provider completed documentation from the chart instead of the appointment." If you did not retrieve any knowledge, write "none".]
ACTION_OWNER: [Support Agent|Engineering|Customer|Support Manager]

Guidelines:
- Be SPECIFIC in NEXT_ACTION — vague actions like "follow up" or "check status" are useless. Say exactly what to do.
- ISSUE_SUMMARY should replace the subject line — make it more informative than the original subject.
- NEVER use individual names in NEXT_ACTION. Always use role titles: "The support team", "The CS Manager", "The Head of Client Success". Names can appear in REASONING or ENGAGEMENT_SUMMARY for context only.
- If a ticket has gone silent for days, flag it and recommend a follow-up.
- If Linear shows engineering has resolved the issue but support hasn't updated the customer, flag that communication gap.
- If the customer has been waiting more than 2 business days with no response, urgency should be at least "high".

- For documentation/TO DO confusion tickets, consider whether this is a training issue (user completed work from wrong entry point) and recommend explaining the correct workflow.
- When a customer is angry, frustrated, or threatening escalation — this is a Support Manager issue, not something to leave with the agent who may have caused the frustration.
- **INTERNAL-FIRST ESCALATION PROTOCOL**: When a ticket requires CS Manager intervention (relationship damage, frustrated customer, stalled project, process failure), the NEXT_ACTION must prescribe a two-step sequence in this order: (1) The CS Manager should FIRST hold an internal huddle with the Head of Client Success to review the situation, identify the root cause, build a concrete remediation plan, and get coaching on delivery and follow-through. (2) THEN reach out to the customer — prepared with a clear plan, specific next steps that have already been validated internally, and an apology backed by concrete commitments. The CS Manager should never go into a customer recovery call without having already aligned internally on the fix and the follow-through. The goal is to show up saying "here is our plan, we've already verified this internally, and here are the exact next steps" — not "let me look into this and get back to you."
- When a customer reports a RECURRING issue (same problem happening multiple times), flag this for the CS Manager to coordinate a retro with the engineering team lead. This is distinct from a one-time bug.
- For straightforward technical issues (sync failures, integration bugs), do NOT escalate to the Head of Client Success — the CS Manager can handle engineering coordination directly via standup or Slack.
- **CRITICAL — NEXT_ACTION must be consistent with LINEAR_SUMMARY**: If the Linear context shows engineering has already investigated and concluded the issue is NOT a system bug (or has completed their work and is waiting on support/customer), do NOT recommend escalating back to engineering. Instead, recommend the support team act on engineering's findings. Example: if engineering provides a troubleshooting checklist and is waiting for support to facilitate it, the NEXT_ACTION should be for the support team to walk the customer through the checklist (e.g., via screen share), not to re-escalate to engineering.

FOLLOW_UP_CADENCE GUIDELINES — use these rules to determine the appropriate follow-up cadence:

**Vendor-blocking issues (e.g., PracticeSuite integration):**
- The support team must get DAILY updates from the vendor's support team and relay those updates to the customer same-day.
- If the vendor is unresponsive for 48+ hours, the support team must push harder — escalate within the vendor's support hierarchy and loop in the CS Manager to apply additional pressure.
- The customer must never go more than 24 hours without a substantive update when their revenue/billing is impacted.

**Internal engineering blocking (Linear ticket open):**
- Critical/high urgency: The support team should check in with engineering DAILY for status updates.
- Medium urgency: Check in every 2-3 business days.
- If engineering has gone silent (no Linear updates in 3+ days), the CS Manager should escalate directly — message the engineering lead or raise it in standup.

**Awaiting customer information:**
- Urgent issues: If the customer hasn't responded within 3-4 hours after we requested critical information, the support team should follow up again same-day.
- Normal issues: Follow up after 24-48 hours if no response. Send a second nudge at 3 business days.
- If no response after 5 business days, the support team should attempt a different contact method (phone if email, email if phone).

**How-to / simple question answered, awaiting confirmation:**
- If the customer hasn't responded in 3-4 business days after receiving an answer, the support team should send a friendly follow-up: "Looks like you may be all set — we'll go ahead and close this ticket. Feel free to reopen if you need anything."

**Active troubleshooting in progress:**
- The support team should follow up within 24 hours after the customer tries a suggested fix, to confirm resolution.
- If the fix didn't work, respond same-day with the next troubleshooting step — don't let the customer sit overnight wondering what's next.
- **ANALYSIS STABILITY**: When a PREVIOUS ANALYSIS is provided, treat it as an anchor. If the underlying situation has NOT materially changed since the last analysis (no new customer messages, no new engineering updates, no new internal activity, and the time elapsed is within the recommended follow-up window), you should preserve the existing NEXT_ACTION, FOLLOW_UP_CADENCE, and URGENCY. Only change them when there is a concrete reason: new information arrived, a follow-up deadline was missed, a status changed, or significant time has passed beyond the cadence window. If you do change a recommendation, briefly note why in REASONING.`;
}

// --- User Prompt ---
// Kept inline (rather than delegated to buildTicketMetadataSection from
// gather-context.ts) so the byte-for-byte wire format matches the pre-refactor
// queue exactly. The previous-analysis block is injected via closure so the
// single-pass runner (which only hands the LLM a TicketContext) stays generic.

function buildUserPrompt(ctx: TicketContext, previousAnalysis: PreviousAnalysis | null): string {
  const t = ctx.ticket;
  const engagementTimeline = ctx.engagementTimeline;

  return `Triage this support ticket and determine the next action:

TICKET METADATA:
- Subject: ${t.subject || 'N/A'}
- Source: ${t.source_type || 'N/A'}
- Priority: ${t.priority || 'N/A'}
- Status: ${t.is_closed ? 'Closed' : 'Open'}
- Age: ${ctx.ageDays !== null ? `${ctx.ageDays} days` : 'Unknown'}
- Ball In Court: ${t.ball_in_court || 'N/A'}
- Software: ${t.software || 'N/A'}
- Assigned Rep: ${ctx.ownerName || 'Unassigned'}
- Co-Destiny Account: ${t.is_co_destiny ? 'YES — VIP customer requiring elevated attention' : 'No'}

COMPANY:
- Name: ${t.hs_primary_company_name || 'Unknown'}${ctx.customerContext ? `

CUSTOMER CONTEXT:
${ctx.customerContext}` : ''}

ENGAGEMENT SUMMARY:
- Emails: ${engagementTimeline.counts.emails}
- Notes: ${engagementTimeline.counts.notes}
- Calls: ${engagementTimeline.counts.calls}
- Meetings: ${engagementTimeline.counts.meetings}

CONVERSATION THREAD (${ctx.conversationMessages.length} messages):
${ctx.conversationText}

ENGAGEMENT TIMELINE (${engagementTimeline.engagements.length} items):
${ctx.engagementTimelineText}${ctx.linearContext ? `

LINEAR ENGINEERING CONTEXT:
- Linear Issue: ${ctx.linearContext.identifier} — ${ctx.linearContext.title}
- State: ${ctx.linearContext.state}
- Priority: ${ctx.linearContext.priority}
- Assignee: ${ctx.linearContext.assignee || 'Unassigned'}
- Created: ${ctx.linearContext.createdAt.split('T')[0]}
- Updated: ${ctx.linearContext.updatedAt.split('T')[0]}

Description:
${ctx.linearContext.description || '(no description)'}

Engineering Comments (${ctx.linearContext.comments.length}):
${ctx.linearContext.comments.length > 0
  ? ctx.linearContext.comments
      .map((c) => `[${c.createdAt.split('T')[0]}] ${c.author}: ${c.body}`)
      .join('\n\n')
  : 'No comments yet.'}${ctx.linearContext.relatedIssues.length > 0 ? `

Related Linear Issues (${ctx.linearContext.relatedIssues.length}):
${ctx.linearContext.relatedIssues
  .map((ri) => `- ${ri.identifier}: ${ri.title} (${ri.relationType}) — State: ${ri.state}, Priority: ${ri.priority}, Assignee: ${ri.assignee || 'Unassigned'}`)
  .join('\n')}` : ''}` : t.linear_task ? `

LINEAR ENGINEERING CONTEXT:
A Linear engineering ticket is linked to this support ticket (${t.linear_task}), confirming that an engineering escalation HAS occurred. The full Linear issue details could not be retrieved at this time, but the escalation exists. Do NOT state that there is no engineering escalation — check the Linear ticket directly for current status.` : ''}${previousAnalysis ? `

PREVIOUS ANALYSIS (from ${previousAnalysis.analyzed_at}):
- ISSUE_SUMMARY: ${previousAnalysis.issue_summary}
- NEXT_ACTION: ${previousAnalysis.next_action}
- FOLLOW_UP_CADENCE: ${previousAnalysis.follow_up_cadence || 'N/A'}
- URGENCY: ${previousAnalysis.urgency}` : ''}`;
}

// --- Response parser ---

function parseResponse(text: string, ctx: TicketContext): TicketSupportManagerAnalysis {
  const field = (name: string, fallback: string): string => {
    const m = text.match(new RegExp(`${name}:\\s*(.+?)(?=\\n[A-Z_]+:|\\n\\n|$)`, 'is'));
    return m ? m[1].trim() : fallback;
  };

  const numField = (name: string, fallback: number, max: number): number => {
    const m = text.match(new RegExp(`${name}:\\s*([\\d.]+)`, 'i'));
    return m ? Math.min(max, Math.max(0, parseFloat(m[1]))) : fallback;
  };

  const intField = (name: string, fallback: number): number => {
    const m = text.match(new RegExp(`${name}:\\s*(\\d+)`, 'i'));
    return m ? parseInt(m[1], 10) : fallback;
  };

  const issueSummary = field('ISSUE_SUMMARY', 'No summary available.');
  const nextAction = field('NEXT_ACTION', 'Review ticket.');
  const followUpCadence = field('FOLLOW_UP_CADENCE', null as unknown as string) || null;
  const urgencyRaw = field('URGENCY', 'medium').toLowerCase();
  const urgency = ['critical', 'high', 'medium', 'low'].includes(urgencyRaw) ? urgencyRaw : 'medium';

  const reasoning = field('REASONING', null as unknown as string) || null;
  const engagementSummary = field('ENGAGEMENT_SUMMARY', null as unknown as string) || null;
  const linearSummary = field('LINEAR_SUMMARY', 'No engineering escalation.');
  const daysSinceLastActivity = intField('DAYS_SINCE_LAST_ACTIVITY', 0);
  const lastActivityBy = field('LAST_ACTIVITY_BY', 'Unknown');
  const confidence = numField('CONFIDENCE', 0.5, 1);
  const knowledgeUsed = field('KNOWLEDGE_USED', null as unknown as string) || null;
  const actionOwnerRaw = field('ACTION_OWNER', 'Support Agent');
  const actionOwner = ['Support Agent', 'Engineering', 'Customer', 'Support Manager'].includes(actionOwnerRaw)
    ? actionOwnerRaw : 'Support Agent';

  return {
    hubspot_ticket_id: ctx.ticket.hubspot_ticket_id,
    issue_summary: issueSummary,
    next_action: nextAction,
    follow_up_cadence: followUpCadence,
    urgency,
    reasoning,
    engagement_summary: engagementSummary,
    linear_summary: linearSummary,
    days_since_last_activity: daysSinceLastActivity,
    last_activity_by: lastActivityBy,
    ticket_subject: ctx.ticket.subject,
    company_name: ctx.ticket.hs_primary_company_name,
    assigned_rep: ctx.ownerName,
    age_days: ctx.ageDays,
    is_closed: ctx.ticket.is_closed || false,
    has_linear: !!ctx.ticket.linear_task,
    linear_state: ctx.linearContext?.state || null,
    confidence,
    knowledge_used: knowledgeUsed,
    action_owner: actionOwner,
    analyzed_at: new Date().toISOString(),
  };
}

// --- Core Analysis Function ---

export async function analyzeSupportManagerTicket(
  ticketId: string,
  readerClient?: SupabaseClient,
): Promise<AnalyzeSupportManagerResult> {
  try {
    const supabase = readerClient || createServiceClient();

    // Fetch previous analysis for stability anchoring. This is a pre-LLM DB
    // read that's independent of the shared ticket context — the single-pass
    // runner intentionally stays generic, so we inject this via a closure.
    const { data: prevRow } = await supabase
      .from('ticket_support_manager_analyses')
      .select('next_action, follow_up_cadence, urgency, issue_summary, analyzed_at')
      .eq('hubspot_ticket_id', ticketId)
      .single();
    const previousAnalysis: PreviousAnalysis | null = prevRow || null;

    const { analysis, usage } = await runSinglePassAnalysis<TicketSupportManagerAnalysis>(ticketId, {
      buildSystemPrompt,
      buildUserPrompt: (ctx) => buildUserPrompt(ctx, previousAnalysis),
      parseResponse,
      tools: { lookupSupportKnowledge: lookupSupportKnowledgeTool },
      readerClient,
    });

    const serviceClient = createServiceClient();
    const { error: upsertError } = await serviceClient
      .from('ticket_support_manager_analyses')
      .upsert(analysis, { onConflict: 'hubspot_ticket_id' });

    if (upsertError) {
      console.error('Error upserting support manager analysis:', upsertError);
    }

    return { success: true, analysis, usage };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Ticket not found')) {
      return {
        success: false,
        error: 'Ticket not found',
        details: error.message,
        statusCode: 404,
      };
    }
    console.error('Support manager analysis error:', error);
    return {
      success: false,
      error: 'Failed to analyze ticket',
      details: error instanceof Error ? error.message : 'Unknown error',
      statusCode: 500,
    };
  }
}
