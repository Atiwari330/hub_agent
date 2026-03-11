import { createServerSupabaseClient } from '@/lib/supabase/client';
import { createServiceClient } from '@/lib/supabase/client';
import { getHubSpotClient } from '@/lib/hubspot/client';
import { getTicketEngagementTimeline } from '@/lib/hubspot/ticket-engagements';
import { generateText } from 'ai';
import { getModel } from '@/lib/ai/provider';
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

export interface TicketQualityAnalysis {
  hubspot_ticket_id: string;
  overall_quality_score: number;
  quality_grade: string;
  rep_competence_score: number;
  communication_score: number;
  resolution_score: number;
  efficiency_score: number;
  customer_sentiment: string;
  resolution_status: string;
  handling_quality: string;
  rep_assessment: string;
  communication_assessment: string;
  resolution_assessment: string;
  efficiency_assessment: string;
  key_observations: string;
  improvement_areas: string | null;
  email_count: number;
  note_count: number;
  call_count: number;
  meeting_count: number;
  touch_count: number;
  ticket_subject: string | null;
  company_id: string | null;
  company_name: string | null;
  ticket_created_at: string | null;
  is_closed: boolean;
  primary_category: string | null;
  severity: string | null;
  assigned_rep: string | null;
  confidence: number;
  analyzed_at: string;
}

export type AnalyzeResult =
  | { success: true; analysis: TicketQualityAnalysis }
  | { success: false; error: string; details?: string; statusCode?: number };

// --- Helpers ---

function computeOverallScore(rep: number, comm: number, res: number, eff: number): number {
  // Weighted: Communication 30%, Resolution 30%, Rep Competence 25%, Efficiency 15%
  const score = Math.round(rep * 2.5 + comm * 3.0 + res * 3.0 + eff * 1.5);
  return Math.min(100, Math.max(0, score));
}

function scoreToGrade(score: number): string {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

function avgToHandlingQuality(rep: number, comm: number, res: number, eff: number): string {
  const avg = (rep + comm + res + eff) / 4;
  if (avg >= 8) return 'excellent';
  if (avg >= 6) return 'good';
  if (avg >= 4) return 'adequate';
  if (avg >= 2) return 'poor';
  return 'very_poor';
}

// --- System Prompt ---

const SYSTEM_PROMPT = `You are a support quality analyst for Opus Behavioral Health, a healthcare SaaS company that sells EHR (Electronic Health Records), RCM (Revenue Cycle Management), and Copilot AI products to behavioral health providers.

Your job is to deeply analyze the quality of support provided on a specific ticket by evaluating the conversation thread, engagement timeline, and ticket metadata.

EVALUATION DIMENSIONS:

1. REP COMPETENCE (score 0-10):
   - Does the rep demonstrate product knowledge?
   - Do they understand the customer's problem correctly?
   - Are they organized in their troubleshooting approach?
   - Do they escalate appropriately when needed?
   - 0-3: Confused, incorrect information, no troubleshooting structure
   - 4-6: Adequate knowledge, some misses, decent structure
   - 7-10: Expert knowledge, methodical approach, proactive

2. COMMUNICATION QUALITY (score 0-10):
   - Is communication clear, professional, and empathetic?
   - Does the rep set expectations and provide timelines?
   - Are follow-ups timely?
   - Is tone appropriate given the customer's emotional state?
   - 0-3: Unclear, unprofessional, or dismissive
   - 4-6: Adequate but impersonal or inconsistent
   - 7-10: Excellent — clear, empathetic, proactive communication

3. RESOLUTION QUALITY (score 0-10):
   - Was the issue actually resolved or just closed?
   - Was the root cause addressed or just symptoms?
   - Did the customer confirm resolution?
   - 0-3: Unresolved, incorrect fix, or customer abandoned
   - 4-6: Workaround provided, partial fix, or resolution unclear
   - 7-10: Root cause fixed, customer confirmed, issue fully addressed

4. HANDLING EFFICIENCY (score 0-10):
   - Was the ticket routed correctly initially?
   - How many touches/handoffs before resolution?
   - Was time wasted on wrong paths?
   - Were SLA commitments met?
   - 0-3: Multiple misroutes, excessive handoffs, SLA breached
   - 4-6: Some inefficiency but reasonable overall
   - 7-10: Efficient resolution path, minimal handoffs

CUSTOMER SENTIMENT — infer from the customer's messages:
- very_negative: Angry, threatening to churn, explicit dissatisfaction
- negative: Frustrated, expressing displeasure
- neutral: Matter-of-fact, no strong emotion
- positive: Appreciative, satisfied with progress
- very_positive: Effusively thankful, praising the rep

RESOLUTION STATUS:
- fully_resolved: Issue confirmed fixed by customer or clear evidence of resolution
- partially_resolved: Main issue addressed but side effects or related issues remain
- workaround: Not a real fix — a temporary solution provided
- unresolved: Issue not resolved at ticket close/current state
- escalated: Handed off to engineering or another team, pending resolution
- pending: Ticket still open and being actively worked

IMPORTANT GUIDELINES:
- If the conversation thread is empty or very short, analyze what you can from metadata and engagement timeline. Set confidence lower (<0.5) and note the data limitation in KEY_OBSERVATIONS.
- Focus on SPECIFIC evidence from the conversation — quote or reference exact messages when assessing.
- Be fair but honest. If the rep did well, say so. If they struggled, explain why.
- Consider the difficulty of the ticket when scoring — a complex bug that required engineering escalation handled professionally still deserves good communication and competence scores even if resolution is pending.

Respond in this EXACT format (every field is required):
REP_COMPETENCE_SCORE: [0-10]
REP_ASSESSMENT: [1-2 sentences assessing rep's competence, with specific evidence from the conversation]
COMMUNICATION_SCORE: [0-10]
COMMUNICATION_ASSESSMENT: [1-2 sentences on communication quality, citing specific examples]
RESOLUTION_SCORE: [0-10]
RESOLUTION_ASSESSMENT: [1-2 sentences on resolution quality and completeness]
EFFICIENCY_SCORE: [0-10]
EFFICIENCY_ASSESSMENT: [1-2 sentences on handling efficiency, noting handoffs, delays, misroutes]
CUSTOMER_SENTIMENT: [very_negative|negative|neutral|positive|very_positive]
RESOLUTION_STATUS: [fully_resolved|partially_resolved|workaround|unresolved|escalated|pending]
KEY_OBSERVATIONS: [2-3 bullet points, each on its own line starting with "- "]
IMPROVEMENT_AREAS: [1-2 specific actionable improvements, or "None" if handling was excellent]
CONFIDENCE: [0.00-1.00]`;

// --- Core Analysis Function ---

export async function analyzeTicketQuality(
  ticketId: string,
  readerClient?: SupabaseClient
): Promise<AnalyzeResult> {
  const supabase = readerClient || (await createServerSupabaseClient());
  const serviceClient = createServiceClient();
  const hsClient = getHubSpotClient();

  try {
    // 1. Fetch ticket metadata from support_tickets table
    const { data: ticket, error: ticketError } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('hubspot_ticket_id', ticketId)
      .single();

    if (ticketError || !ticket) {
      return {
        success: false,
        error: 'Ticket not found',
        details: ticketError?.message,
        statusCode: 404,
      };
    }

    // 2. Fetch existing categorization (if available) for context
    const { data: categorization } = await supabase
      .from('ticket_categorizations')
      .select('primary_category, subcategory, issue_type, severity, root_cause_hint')
      .eq('hubspot_ticket_id', ticketId)
      .single();

    // 3. Resolve owner name
    let ownerName: string | null = null;
    if (ticket.hubspot_owner_id) {
      const { data: owner } = await supabase
        .from('owners')
        .select('first_name, last_name, email')
        .eq('hubspot_owner_id', ticket.hubspot_owner_id)
        .single();
      if (owner) {
        ownerName = [owner.first_name, owner.last_name].filter(Boolean).join(' ') || owner.email || null;
      }
    }

    // 4. Fetch conversation thread from HubSpot
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
        const messagesData = (await messagesResponse.json()) as {
          results?: ThreadMessage[];
        };
        conversationMessages = messagesData.results || [];
      }
    } catch (err) {
      console.warn(`Could not fetch conversation thread for ticket ${ticketId}:`, err);
    }

    // 5. Fetch engagement timeline
    let engagementTimeline;
    try {
      engagementTimeline = await getTicketEngagementTimeline(ticketId);
    } catch (err) {
      console.warn(`Could not fetch engagement timeline for ticket ${ticketId}:`, err);
      engagementTimeline = { engagements: [], counts: { emails: 0, notes: 0, calls: 0, meetings: 0, total: 0 } };
    }

    // 6. Build the conversation text (from thread)
    const conversationText =
      conversationMessages.length > 0
        ? conversationMessages
            .slice(0, 20)
            .map((msg) => {
              const sender =
                msg.senders?.map((s) => s.name || s.actorId).join(', ') || 'Unknown';
              const text = msg.text || '(no text)';
              return `[${msg.createdAt}] ${sender}: ${text}`;
            })
            .join('\n\n')
        : 'No conversation thread available.';

    // 7. Build the engagement timeline text
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

    // 8. Calculate ticket age
    const createdAt = ticket.hubspot_created_at ? new Date(ticket.hubspot_created_at) : null;
    const ageDays = createdAt
      ? Math.round((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    // 9. Build user prompt
    const categorizationBlock = categorization
      ? `\nEXISTING CATEGORIZATION:\n- Category: ${categorization.primary_category}\n- Subcategory: ${categorization.subcategory || 'N/A'}\n- Issue Type: ${categorization.issue_type}\n- Severity: ${categorization.severity}\n- Root Cause Hint: ${categorization.root_cause_hint || 'N/A'}\n`
      : '';

    const userPrompt = `Analyze the support quality on this ticket:

TICKET METADATA:
- Subject: ${ticket.subject || 'N/A'}
- Source: ${ticket.source_type || 'N/A'}
- Priority: ${ticket.priority || 'N/A'}
- Status: ${ticket.is_closed ? 'Closed' : 'Open'}
- Age: ${ageDays !== null ? `${ageDays} days` : 'Unknown'}
- Ball In Court: ${ticket.ball_in_court || 'N/A'}
- Software: ${ticket.software || 'N/A'}
- SLA FRT Breached: ${ticket.frt_sla_breached ? 'YES' : 'No'}
- SLA NRT Breached: ${ticket.nrt_sla_breached ? 'YES' : 'No'}
- Assigned Rep: ${ownerName || 'Unassigned'}

COMPANY:
- Name: ${ticket.hs_primary_company_name || 'Unknown'}
${categorizationBlock}
ENGAGEMENT SUMMARY:
- Emails: ${engagementTimeline.counts.emails}
- Notes: ${engagementTimeline.counts.notes}
- Calls: ${engagementTimeline.counts.calls}
- Meetings: ${engagementTimeline.counts.meetings}

CONVERSATION THREAD (${conversationMessages.length} messages):
${conversationText}

ENGAGEMENT TIMELINE (${engagementTimeline.engagements.length} items):
${engagementTimelineText}`;

    // 10. Call LLM
    const result = await generateText({
      model: getModel(),
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
    });

    // 11. Parse structured response
    const text = result.text;

    const repScoreMatch = text.match(/REP_COMPETENCE_SCORE:\s*(\d+)/i);
    const repAssessMatch = text.match(/REP_ASSESSMENT:\s*(.+?)(?=\nCOMMUNICATION_SCORE:|\n\n|$)/is);
    const commScoreMatch = text.match(/COMMUNICATION_SCORE:\s*(\d+)/i);
    const commAssessMatch = text.match(/COMMUNICATION_ASSESSMENT:\s*(.+?)(?=\nRESOLUTION_SCORE:|\n\n|$)/is);
    const resScoreMatch = text.match(/RESOLUTION_SCORE:\s*(\d+)/i);
    const resAssessMatch = text.match(/RESOLUTION_ASSESSMENT:\s*(.+?)(?=\nEFFICIENCY_SCORE:|\n\n|$)/is);
    const effScoreMatch = text.match(/EFFICIENCY_SCORE:\s*(\d+)/i);
    const effAssessMatch = text.match(/EFFICIENCY_ASSESSMENT:\s*(.+?)(?=\nCUSTOMER_SENTIMENT:|\n\n|$)/is);
    const sentimentMatch = text.match(
      /CUSTOMER_SENTIMENT:\s*(very_negative|negative|neutral|positive|very_positive)/i
    );
    const resStatusMatch = text.match(
      /RESOLUTION_STATUS:\s*(fully_resolved|partially_resolved|workaround|unresolved|escalated|pending)/i
    );
    const obsMatch = text.match(/KEY_OBSERVATIONS:\s*([\s\S]+?)(?=\nIMPROVEMENT_AREAS:|\n\n(?=[A-Z]))/i);
    const improvMatch = text.match(/IMPROVEMENT_AREAS:\s*([\s\S]+?)(?=\nCONFIDENCE:|\n\n(?=[A-Z]))/i);
    const confMatch = text.match(/CONFIDENCE:\s*([\d.]+)/i);

    const repScore = repScoreMatch ? Math.min(10, Math.max(0, parseInt(repScoreMatch[1]))) : 5;
    const commScore = commScoreMatch ? Math.min(10, Math.max(0, parseInt(commScoreMatch[1]))) : 5;
    const resScore = resScoreMatch ? Math.min(10, Math.max(0, parseInt(resScoreMatch[1]))) : 5;
    const effScore = effScoreMatch ? Math.min(10, Math.max(0, parseInt(effScoreMatch[1]))) : 5;

    const overallScore = computeOverallScore(repScore, commScore, resScore, effScore);
    const qualityGrade = scoreToGrade(overallScore);
    const handlingQuality = avgToHandlingQuality(repScore, commScore, resScore, effScore);

    const customerSentiment = sentimentMatch ? sentimentMatch[1].toLowerCase() : 'neutral';
    const resolutionStatus = resStatusMatch ? resStatusMatch[1].toLowerCase() : 'pending';

    const repAssessment = repAssessMatch ? repAssessMatch[1].trim() : 'Unable to assess rep competence from available data.';
    const commAssessment = commAssessMatch ? commAssessMatch[1].trim() : 'Unable to assess communication quality from available data.';
    const resAssessment = resAssessMatch ? resAssessMatch[1].trim() : 'Unable to assess resolution quality from available data.';
    const effAssessment = effAssessMatch ? effAssessMatch[1].trim() : 'Unable to assess handling efficiency from available data.';
    const keyObservations = obsMatch ? obsMatch[1].trim() : '- Insufficient data for detailed observations';
    const improvementAreas = improvMatch
      ? improvMatch[1].trim() === 'None'
        ? null
        : improvMatch[1].trim()
      : null;
    const confidence = confMatch
      ? Math.min(1, Math.max(0, parseFloat(confMatch[1])))
      : 0.5;

    // Total touches: sum of all engagement activities
    const touchCount =
      engagementTimeline.counts.emails +
      engagementTimeline.counts.notes +
      engagementTimeline.counts.calls +
      engagementTimeline.counts.meetings;

    // 12. Upsert into ticket_quality_analyses
    const analysisData = {
      hubspot_ticket_id: ticketId,
      overall_quality_score: overallScore,
      quality_grade: qualityGrade,
      rep_competence_score: repScore,
      communication_score: commScore,
      resolution_score: resScore,
      efficiency_score: effScore,
      customer_sentiment: customerSentiment,
      resolution_status: resolutionStatus,
      handling_quality: handlingQuality,
      rep_assessment: repAssessment,
      communication_assessment: commAssessment,
      resolution_assessment: resAssessment,
      efficiency_assessment: effAssessment,
      key_observations: keyObservations,
      improvement_areas: improvementAreas,
      email_count: engagementTimeline.counts.emails,
      note_count: engagementTimeline.counts.notes,
      call_count: engagementTimeline.counts.calls,
      meeting_count: engagementTimeline.counts.meetings,
      touch_count: touchCount,
      ticket_subject: ticket.subject,
      company_id: ticket.hs_primary_company_id,
      company_name: ticket.hs_primary_company_name,
      ticket_created_at: ticket.hubspot_created_at,
      is_closed: ticket.is_closed || false,
      primary_category: categorization?.primary_category || null,
      severity: categorization?.severity || null,
      assigned_rep: ownerName,
      confidence,
      analyzed_at: new Date().toISOString(),
    };

    const { error: upsertError } = await serviceClient
      .from('ticket_quality_analyses')
      .upsert(analysisData, { onConflict: 'hubspot_ticket_id' });

    if (upsertError) {
      console.error('Error upserting ticket quality analysis:', upsertError);
    }

    return { success: true, analysis: analysisData as TicketQualityAnalysis };
  } catch (error) {
    console.error('Ticket quality analysis error:', error);
    return {
      success: false,
      error: 'Failed to analyze ticket quality',
      details: error instanceof Error ? error.message : 'Unknown error',
      statusCode: 500,
    };
  }
}
