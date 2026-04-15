import { createServiceClient } from '@/lib/supabase/client';
import { lookupSupportKnowledgeTool } from '@/lib/ai/tools/support-knowledge';
import { runSinglePassAnalysis } from '@/lib/ai/passes/single-pass-runner';
import type { TicketContext } from '@/lib/ai/passes/types';
import type { SupabaseClient } from '@supabase/supabase-js';

// --- Types ---

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

// --- User Prompt ---
// Kept inline (rather than delegated to buildTicketMetadataSection from
// gather-context.ts) so the byte-for-byte wire format matches the pre-refactor
// queue exactly. Drift here would directly alter LLM output quality.

function buildUserPrompt(ctx: TicketContext): string {
  const t = ctx.ticket;
  const engagementTimeline = ctx.engagementTimeline;

  return `Analyze this support ticket and create a training breakdown for new support hires:

TICKET METADATA:
- Subject: ${t.subject || 'N/A'}
- Source: ${t.source_type || 'N/A'}
- Priority: ${t.priority || 'N/A'}
- Status: ${t.is_closed ? 'Closed' : 'Open'}
- Age: ${ctx.ageDays !== null ? `${ctx.ageDays} days` : 'Unknown'}
- Ball In Court: ${t.ball_in_court || 'N/A'}
- Software: ${t.software || 'N/A'}
- Assigned Rep: ${ctx.ownerName || 'Unassigned'}
- Co-Destiny Account: ${t.is_co_destiny ? 'YES — VIP customer' : 'No'}

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
  .join('\n')}` : ''}` : ''}`;
}

// --- Response parser ---

function parseResponse(text: string, ctx: TicketContext): TicketTrainerAnalysis {
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

  return {
    hubspot_ticket_id: ctx.ticket.hubspot_ticket_id,
    customer_ask: customerAsk,
    problem_breakdown: problemBreakdown,
    system_explanation: systemExplanation,
    interaction_timeline: interactionTimeline,
    resolution_approach: resolutionApproach,
    coaching_tips: coachingTips,
    knowledge_areas: knowledgeAreas,
    difficulty_level: difficultyLevel,
    ticket_subject: ctx.ticket.subject,
    company_name: ctx.ticket.hs_primary_company_name,
    assigned_rep: ctx.ownerName,
    age_days: ctx.ageDays,
    is_closed: ctx.ticket.is_closed || false,
    has_linear: !!ctx.ticket.linear_task,
    linear_state: ctx.linearContext?.state || null,
    confidence,
    analyzed_at: new Date().toISOString(),
  };
}

// --- Core Analysis Function ---

export async function analyzeSupportTrainerTicket(
  ticketId: string,
  readerClient?: SupabaseClient,
): Promise<AnalyzeSupportTrainerResult> {
  try {
    const { analysis, usage } = await runSinglePassAnalysis<TicketTrainerAnalysis>(ticketId, {
      buildSystemPrompt,
      buildUserPrompt,
      parseResponse,
      tools: { lookupSupportKnowledge: lookupSupportKnowledgeTool },
      readerClient,
    });

    const serviceClient = createServiceClient();
    const { error: upsertError } = await serviceClient
      .from('ticket_trainer_analyses')
      .upsert(analysis, { onConflict: 'hubspot_ticket_id' });

    if (upsertError) {
      console.error('Error upserting trainer analysis:', upsertError);
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
    console.error('Support trainer analysis error:', error);
    return {
      success: false,
      error: 'Failed to analyze ticket',
      details: error instanceof Error ? error.message : 'Unknown error',
      statusCode: 500,
    };
  }
}
