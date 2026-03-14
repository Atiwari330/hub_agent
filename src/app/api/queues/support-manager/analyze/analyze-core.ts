import { createServiceClient } from '@/lib/supabase/client';
import { getHubSpotClient } from '@/lib/hubspot/client';
import { getOwnerById } from '@/lib/hubspot/owners';
import { getTicketEngagementTimeline } from '@/lib/hubspot/ticket-engagements';
import { fetchLinearIssueContext, type LinearIssueContext } from '@/lib/linear/client';
import { generateText } from 'ai';
import { getSonnetModel } from '@/lib/ai/provider';
import type { SupabaseClient } from '@supabase/supabase-js';

// --- Types ---

interface ThreadMessage {
  id: string;
  type: string;
  createdAt: string;
  text?: string;
  subject?: string;
  senders?: Array<{ name?: string; actorId?: string }>;
}

export interface TicketSupportManagerAnalysis {
  hubspot_ticket_id: string;
  issue_summary: string;
  next_action: string;
  action_owner: string;
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
  analyzed_at: string;
}

export type AnalyzeSupportManagerResult =
  | { success: true; analysis: TicketSupportManagerAnalysis }
  | { success: false; error: string; details?: string; statusCode?: number };

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

PRODUCT DOMAIN CONTEXT:
The Opus EHR platform includes:
- **TO DO List / Task System**: Clinicians see a TO DO list of required documentation based on their scheduled appointments. Each appointment is linked to specific required documents (e.g., intake assessment, progress note). The documentation requirement is satisfied ONLY when completed through the appointment or the TO DO list — NOT by creating the same document type directly from the client chart. This is a common source of user confusion: a clinician may create an intake from the client chart thinking it fulfills the TO DO requirement, but it doesn't — it creates a separate unlinked document.
- **Scheduling & Appointments**: Appointments carry the documentation requirements. The required forms are connected to the specific scheduled event.
- **Client Chart**: Contains all clinical documents for a patient. Documents created directly here are standalone and do NOT fulfill appointment-linked TO DO requirements.
- **RCM / Billing — Vendor Landscape**: Opus EHR is NOT a billing/RCM system itself — it integrates with external vendors:
  - **PracticeSuite** — The LEGACY billing vendor. Opus no longer onboards new customers to PracticeSuite and is actively migrating existing customers OFF of it. Issues involving PracticeSuite data exports, migrations, or ERA files are complex and often require the CS Manager and Head of Client Success to problem-solve together.
  - **Opus RCM / Imagine / ImaginePay** — The CURRENT billing/RCM vendor. This is a white-labeled version of the Imagine platform, branded as "Opus RCM." Imagine handles claims, ERA posting, payment processing (via ImaginePay), token generation, etc. The Opus EHR sends data to Imagine via API integrations.
- **Forms & Templates**: Clinical forms (intakes, assessments, progress notes) that can be filled from appointments, TO DO items, or the chart directly.

When analyzing tickets about "missing" or "duplicate" documents, TO DO items showing as incomplete, or confusion about where to complete documentation — consider whether the user may have completed the work from the wrong entry point (chart vs. appointment/TO DO). This is often a training issue, not a bug.

VENDOR-ORIGINATED TICKETS (Imagine/ImaginePay/PracticeSuite sending tickets to Opus):
Sometimes tickets in the queue are NOT from customers — they are from vendor partners (Imagine, ImaginePay, PracticeSuite) reporting issues back to Opus. You can identify these by:
- Company name is "Imagine Software", "ImaginePay", or similar vendor name (not a healthcare facility)
- Subject lines containing "IT-Assistant Alert", automated ticket references, or vendor ticket IDs
- Conversation content from vendor reps (e.g., Deanna Rector at ImaginePay) reporting data issues originating from the Opus EHR

These are back-channel communications where the vendor is saying: "Hey Opus, your system sent us bad data" or "Your integration is breaking something on our side."

**Protocol for vendor-originated tickets:**
1. **Immediate action**: The support team must ensure a Linear ticket exists for the engineering team. If no Linear ticket is linked, creating one is the #1 priority — engineering needs to know about this.
2. **Support owns the tracking**: The support team is responsible for keeping this ticket alive and tracking engineering progress. They must check the Linear ticket regularly for updates.
3. **Engineering accountability timeline**:
   - Days 0-3: Engineering should be actively investigating. Support monitors the Linear ticket for updates.
   - Days 3-7 with no Linear updates: The support team should ping engineering on the Linear ticket: "This vendor ticket is aging — what's the status?"
   - Days 7-10 with no progress: Escalate urgency. The support team should push harder on engineering and flag it in standup.
   - Days 10+ with no resolution: The CS Manager must bring this up in the morning sync with the engineering team directly. This is now a manager-level escalation.
4. **Systemic risk awareness**: Vendor-reported data issues (like impossible balances, broken token generation, sync failures) often affect MULTIPLE customer accounts, not just the one mentioned. Flag this systemic risk in the analysis.
5. **Closure**: The ticket cannot be closed until the Linear ticket is resolved AND the vendor confirms the fix on their end.

YOUR JOB:
Read all available context for this ticket — the conversation thread, engagement timeline, and any engineering escalation in Linear — and determine:
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
2. **Angry/frustrated customer**: When a customer is visibly upset, threatening escalation, or has lost trust — this needs the CS Manager's direct involvement.
3. **Agent mistakes**: If a support agent has clearly mishandled the ticket (wrong information, dropped follow-ups, dismissive responses) — the CS Manager needs to manage this.
4. **Legal/compliance threats**: Any mention of regulatory action, information blocking, lawsuits, or formal complaints — the CS Manager and Head of Client Success need to discuss and formulate a response plan.
5. **Complex vendor situations**: Issues involving PracticeSuite coordination, data migrations, or multi-party dependencies — the CS Manager and Head of Client Success need to problem-solve together.
6. **Knowledge gaps**: If the support team clearly doesn't know how to solve the problem, the CS Manager should facilitate training via the Head of Client Success or the relevant team member.
7. **Recurring issues**: If a customer reports the same issue happening repeatedly (or multiple customers report similar recurring problems), the CS Manager needs to coordinate a retro with the engineering team lead to investigate the root cause. Engineering may resist prioritizing this — it's the CS Manager's job to push for the retro.

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
ACTION_OWNER: [Support Agent|Engineering|Customer|Support Manager]
URGENCY: [critical|high|medium|low]
REASONING: [2-4 sentences explaining why this is the recommended next action. Reference specific evidence from the conversation, timeline, or Linear context. For Manager escalations, explain why this can't be handled at the agent level.]
ENGAGEMENT_SUMMARY: [2-3 sentence recap of the conversation — who said what, what was tried, where things stand]
LINEAR_SUMMARY: [If Linear context exists: 2-3 sentences about engineering status, last update, what they found. If no Linear context: "No engineering escalation."]
DAYS_SINCE_LAST_ACTIVITY: [Integer number of days since the last meaningful activity on this ticket, or 0 if today]
LAST_ACTIVITY_BY: [Name or role of the person who last took action — e.g. "Support Agent", "Customer", "Engineering"]
CONFIDENCE: [0.00-1.00]

Guidelines:
- Be SPECIFIC in NEXT_ACTION — vague actions like "follow up" or "check status" are useless. Say exactly what to do.
- ISSUE_SUMMARY should replace the subject line — make it more informative than the original subject.
- NEVER use individual names in NEXT_ACTION. Always use role titles: "The support team", "The CS Manager", "The Head of Client Success". Names can appear in REASONING or ENGAGEMENT_SUMMARY for context only.
- If a ticket has gone silent for days, flag it and recommend a follow-up.
- If Linear shows engineering has resolved the issue but support hasn't updated the customer, flag that communication gap.
- If the customer has been waiting more than 2 business days with no response, urgency should be at least "high".
- For tickets older than 60 days: ACTION_OWNER should almost always be "Support Manager" — these need the CS Manager's intervention regardless of what the issue is.
- For documentation/TO DO confusion tickets, consider whether this is a training issue (user completed work from wrong entry point) and recommend explaining the correct workflow.
- When a customer is angry, frustrated, or threatening escalation — this is a Support Manager issue, not something to leave with the agent who may have caused the frustration.
- When a customer reports a RECURRING issue (same problem happening multiple times), flag this for the CS Manager to coordinate a retro with the engineering team lead. This is distinct from a one-time bug.
- For straightforward technical issues (sync failures, integration bugs), do NOT escalate to the Head of Client Success — the CS Manager can handle engineering coordination directly via standup or Slack.`;
}

// --- Core Analysis Function ---

export async function analyzeSupportManagerTicket(
  ticketId: string,
  readerClient?: SupabaseClient
): Promise<AnalyzeSupportManagerResult> {
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

    // 2. Resolve owner name (try DB first, fall back to HubSpot API for support-only agents)
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
        // Owner not in DB (e.g. support-only agents) — fetch from HubSpot directly
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

    // 9. Build user prompt
    const userPrompt = `Triage this support ticket and determine the next action:

TICKET METADATA:
- Subject: ${ticket.subject || 'N/A'}
- Source: ${ticket.source_type || 'N/A'}
- Priority: ${ticket.priority || 'N/A'}
- Status: ${ticket.is_closed ? 'Closed' : 'Open'}
- Age: ${ageDays !== null ? `${ageDays} days` : 'Unknown'}
- Ball In Court: ${ticket.ball_in_court || 'N/A'}
- Software: ${ticket.software || 'N/A'}
- Assigned Rep: ${ownerName || 'Unassigned'}

COMPANY:
- Name: ${ticket.hs_primary_company_name || 'Unknown'}

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
  : 'No comments yet.'}` : ''}`;

    // 10. Call LLM
    const result = await generateText({
      model: getSonnetModel(),
      system: buildSystemPrompt(),
      prompt: userPrompt,
    });

    // 11. Parse structured response
    const text = result.text;

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
    const actionOwnerRaw = field('ACTION_OWNER', 'Support Agent');
    const validOwners = ['Support Agent', 'Engineering', 'Customer', 'Support Manager'];
    const actionOwner = validOwners.includes(actionOwnerRaw) ? actionOwnerRaw : 'Support Agent';

    const urgencyRaw = field('URGENCY', 'medium').toLowerCase();
    const urgency = ['critical', 'high', 'medium', 'low'].includes(urgencyRaw) ? urgencyRaw : 'medium';

    const reasoning = field('REASONING', null as unknown as string) || null;
    const engagementSummary = field('ENGAGEMENT_SUMMARY', null as unknown as string) || null;
    const linearSummary = field('LINEAR_SUMMARY', 'No engineering escalation.');
    const daysSinceLastActivity = intField('DAYS_SINCE_LAST_ACTIVITY', 0);
    const lastActivityBy = field('LAST_ACTIVITY_BY', 'Unknown');
    const confidence = numField('CONFIDENCE', 0.5, 1);

    // 12. Upsert into ticket_support_manager_analyses
    const analysisData: TicketSupportManagerAnalysis = {
      hubspot_ticket_id: ticketId,
      issue_summary: issueSummary,
      next_action: nextAction,
      action_owner: actionOwner,
      urgency,
      reasoning,
      engagement_summary: engagementSummary,
      linear_summary: linearSummary,
      days_since_last_activity: daysSinceLastActivity,
      last_activity_by: lastActivityBy,
      ticket_subject: ticket.subject,
      company_name: ticket.hs_primary_company_name,
      assigned_rep: ownerName,
      age_days: ageDays,
      is_closed: ticket.is_closed || false,
      has_linear: !!ticket.linear_task,
      linear_state: linearContext?.state || null,
      confidence,
      analyzed_at: new Date().toISOString(),
    };

    const { error: upsertError } = await serviceClient
      .from('ticket_support_manager_analyses')
      .upsert(analysisData, { onConflict: 'hubspot_ticket_id' });

    if (upsertError) {
      console.error('Error upserting support manager analysis:', upsertError);
    }

    return { success: true, analysis: analysisData };
  } catch (error) {
    console.error('Support manager analysis error:', error);
    return {
      success: false,
      error: 'Failed to analyze ticket',
      details: error instanceof Error ? error.message : 'Unknown error',
      statusCode: 500,
    };
  }
}
