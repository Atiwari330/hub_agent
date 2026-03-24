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

export interface TicketTrainerAnalysis {
  hubspot_ticket_id: string;
  customer_ask: string;
  problem_breakdown: string;
  system_explanation: string;
  interaction_timeline: string;
  resolution_approach: string;
  coaching_tips: string;
  knowledge_areas: string | null;
  difficulty_level: string;
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

export type AnalyzeSupportTrainerResult =
  | { success: true; analysis: TicketTrainerAnalysis; usage?: { inputTokens: number; outputTokens: number; totalTokens: number } }
  | { success: false; error: string; details?: string; statusCode?: number };

// --- System Prompt ---

function buildSystemPrompt(): string {
  return `You are a senior support trainer at Opus Behavioral Health, a healthcare SaaS company that provides an EHR (Electronic Health Record) and practice management platform for behavioral health organizations. You are analyzing support tickets to create training material for new support hires.

YOUR JOB:
Read all available context for this ticket — the conversation thread, engagement timeline, and any engineering escalation in Linear — and create a comprehensive training breakdown that teaches a new support hire how to handle this type of ticket.

PRODUCT KNOWLEDGE RETRIEVAL:
The Opus EHR platform includes several product areas (scheduling, billing/RCM, TO DO list, clinical documentation, client management, reporting, and more). You have access to the \`lookupSupportKnowledge\` tool which retrieves detailed knowledge about specific system areas.

**You MUST call \`lookupSupportKnowledge\` at least once before producing your training breakdown.** Based on the ticket's subject, conversation, and context, identify which system area(s) are relevant and retrieve the knowledge. You may call it multiple times if the ticket spans multiple areas.

If the ticket appears to involve a vendor (Imagine, ImaginePay, PracticeSuite) — retrieve the "vendor-tickets" knowledge to understand identification criteria and protocols.

FOR EACH TICKET, PRODUCE:

1. **CUSTOMER_ASK**: Explain in plain, simple English what the customer is actually asking for or reporting. Strip away jargon. A brand-new hire should be able to read this and instantly understand the customer's problem. Start with "The customer is..." or "The customer wants..."

2. **PROBLEM_BREAKDOWN**: Break down the technical problem into digestible pieces. What's happening, why it might be happening, and what system components are involved. Use bullet points if helpful. Explain any acronyms or domain-specific terms.

3. **SYSTEM_EXPLANATION**: Using the knowledge base, explain how the relevant part of the system works. This is the "textbook" section — teach the new hire about the feature/workflow/module involved so they understand the context. Reference specific system behaviors, settings, or workflows.

4. **INTERACTION_TIMELINE**: Walk through the conversation chronologically. Who said what, what was tried, what worked/didn't work. Highlight key decision points and explain why the support agent took certain actions. Note any mistakes or missed opportunities as learning moments (not blame).

5. **RESOLUTION_APPROACH**: Provide a step-by-step guide for how to resolve this type of issue. Be specific — "Click X, then Y" level of detail where possible. Include troubleshooting steps, what to check first, and how to verify the fix worked.

6. **COACHING_TIPS**: Practical advice for a new hire encountering this type of ticket. Include: communication tips (how to talk to the customer), common pitfalls to avoid, when to escalate, what to document, and any "pro tips" from experienced agents. Be encouraging but honest.

7. **KNOWLEDGE_AREAS**: Comma-separated list of knowledge areas you retrieved, followed by a dash and one sentence explaining how the product knowledge informed your training breakdown. Example: "scheduling, todo-list — Used scheduling knowledge to explain the difference between appointment-based and chart-based documentation workflows." If you did not retrieve any knowledge, write "none".

8. **DIFFICULTY_LEVEL**: Rate this ticket's difficulty for a new hire:
   - **beginner** — Simple how-to question, password reset, basic navigation, or well-documented workflow. A new hire could handle this after basic training.
   - **intermediate** — Requires understanding of multiple system areas, some troubleshooting skill, or coordination with other teams. A new hire would need guidance but could learn from this.
   - **advanced** — Complex multi-system issue, requires deep product knowledge, involves engineering escalation, vendor coordination, or sensitive customer situations. A new hire should observe these before attempting.

9. **CONFIDENCE**: How confident are you in this training breakdown (0.00-1.00)?

Respond in this EXACT format (every field required):

CUSTOMER_ASK: [Plain English explanation of what the customer needs]
PROBLEM_BREAKDOWN: [Technical breakdown of the issue]
SYSTEM_EXPLANATION: [How the relevant system area works, based on knowledge base]
INTERACTION_TIMELINE: [Chronological walkthrough of the conversation]
RESOLUTION_APPROACH: [Step-by-step guide to resolve this type of issue]
COACHING_TIPS: [Practical advice for new hires]
KNOWLEDGE_AREAS: [Knowledge areas used]
DIFFICULTY_LEVEL: [beginner|intermediate|advanced]
CONFIDENCE: [0.00-1.00]

Guidelines:
- Write as if you're training someone on their first week. Be clear, thorough, and encouraging.
- Use the knowledge base extensively — the SYSTEM_EXPLANATION section should teach the new hire about the product.
- In INTERACTION_TIMELINE, highlight both good practices and learning opportunities from how the ticket was handled.
- RESOLUTION_APPROACH should be actionable enough that a new hire could follow it step-by-step.
- COACHING_TIPS should include soft skills (communication) not just technical skills.
- Be honest about difficulty — don't sugarcoat advanced tickets, but also don't intimidate about beginner ones.`;
}

// --- Core Analysis Function ---

export async function analyzeSupportTrainerTicket(
  ticketId: string,
  readerClient?: SupabaseClient
): Promise<AnalyzeSupportTrainerResult> {
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

    // 8b. Load customer-specific context (if available)
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

    // 9. Build user prompt
    const userPrompt = `Analyze this support ticket and create a training breakdown for new support hires:

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
  .join('\n')}` : ''}` : ''}`;

    // 10. Call LLM with knowledge retrieval tools
    const result = await generateText({
      model: getSonnetModel(),
      system: buildSystemPrompt(),
      prompt: userPrompt,
      tools: {
        lookupSupportKnowledge: lookupSupportKnowledgeTool,
      },
      stopWhen: stepCountIs(5),
    });

    // 11. Parse structured response
    const text = result.text || result.steps[result.steps.length - 1]?.text || '';

    const field = (name: string, fallback: string): string => {
      const m = text.match(new RegExp(`${name}:\\s*(.+?)(?=\\n[A-Z_]+:|\\n\\n|$)`, 'is'));
      return m ? m[1].trim() : fallback;
    };

    const numField = (name: string, fallback: number, max: number): number => {
      const m = text.match(new RegExp(`${name}:\\s*([\\d.]+)`, 'i'));
      return m ? Math.min(max, Math.max(0, parseFloat(m[1]))) : fallback;
    };

    const customerAsk = field('CUSTOMER_ASK', 'No summary available.');
    const problemBreakdown = field('PROBLEM_BREAKDOWN', 'No breakdown available.');
    const systemExplanation = field('SYSTEM_EXPLANATION', 'No system explanation available.');
    const interactionTimeline = field('INTERACTION_TIMELINE', 'No timeline available.');
    const resolutionApproach = field('RESOLUTION_APPROACH', 'No resolution approach available.');
    const coachingTips = field('COACHING_TIPS', 'No coaching tips available.');
    const knowledgeAreas = field('KNOWLEDGE_AREAS', null as unknown as string) || null;
    const difficultyRaw = field('DIFFICULTY_LEVEL', 'intermediate').toLowerCase();
    const difficultyLevel = ['beginner', 'intermediate', 'advanced'].includes(difficultyRaw) ? difficultyRaw : 'intermediate';
    const confidence = numField('CONFIDENCE', 0.5, 1);

    // 12. Upsert into ticket_trainer_analyses
    const analysisData: TicketTrainerAnalysis = {
      hubspot_ticket_id: ticketId,
      customer_ask: customerAsk,
      problem_breakdown: problemBreakdown,
      system_explanation: systemExplanation,
      interaction_timeline: interactionTimeline,
      resolution_approach: resolutionApproach,
      coaching_tips: coachingTips,
      knowledge_areas: knowledgeAreas,
      difficulty_level: difficultyLevel,
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
      .from('ticket_trainer_analyses')
      .upsert(analysisData, { onConflict: 'hubspot_ticket_id' });

    if (upsertError) {
      console.error('Error upserting trainer analysis:', upsertError);
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
    console.error('Support trainer analysis error:', error);
    return {
      success: false,
      error: 'Failed to analyze ticket',
      details: error instanceof Error ? error.message : 'Unknown error',
      statusCode: 500,
    };
  }
}
