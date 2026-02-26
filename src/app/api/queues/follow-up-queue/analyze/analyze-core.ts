import { createServerSupabaseClient } from '@/lib/supabase/client';
import { createServiceClient } from '@/lib/supabase/client';
import { getTicketEngagementTimeline } from '@/lib/hubspot/ticket-engagements';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';

// --- Anthropic provider ---

function getAnthropicProvider() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new Error('AI_GATEWAY_API_KEY is not configured');
  }
  return createAnthropic({
    apiKey,
    baseURL: 'https://ai-gateway.vercel.sh/v1',
  });
}

// --- Types ---

export interface ViolationContext {
  violationType: 'no_response' | 'customer_hanging' | 'customer_dark';
  violationLabel: string;
  severity: 'critical' | 'warning' | 'watch';
  gapHours: number;
  gapDisplay: string;
  ownerName: string | null;
  ownerId: string | null;
}

export interface FollowUpAnalysis {
  hubspot_ticket_id: string;
  status: 'confirmed' | 'false_positive' | 'monitoring';
  urgency: 'critical' | 'high' | 'medium' | 'low';
  customer_sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated' | null;
  recommended_action: string;
  reasoning: string;
  last_meaningful_contact: string | null;
  confidence: number;
  violation_type: string | null;
  original_severity: string | null;
  gap_hours: number | null;
  ticket_subject: string | null;
  company_id: string | null;
  company_name: string | null;
  owner_id: string | null;
  owner_name: string | null;
  engagement_count: number;
  analyzed_at: string;
}

export type AnalyzeResult = {
  success: true;
  analysis: FollowUpAnalysis;
} | {
  success: false;
  error: string;
  details?: string;
  statusCode?: number;
};

// --- Core Analysis Function ---

export async function analyzeFollowUpTicket(
  ticketId: string,
  violation: ViolationContext
): Promise<AnalyzeResult> {
  const supabase = await createServerSupabaseClient();
  const serviceClient = createServiceClient();

  try {
    // 1. Fetch ticket metadata from support_tickets
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

    // 2. Fetch engagement timeline
    const timeline = await getTicketEngagementTimeline(ticketId);

    // 3. Format engagements chronologically (oldest-first for natural reading)
    const sortedEngagements = [...timeline.engagements].reverse();

    const engagementText = sortedEngagements.length > 0
      ? sortedEngagements.map((eng) => {
          const dateStr = eng.timestamp.toLocaleString('en-US', {
            timeZone: 'America/New_York',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          });

          const lines: string[] = [`[${eng.type.toUpperCase()}] ${dateStr}`];

          if (eng.subject) lines.push(`Subject: ${eng.subject}`);
          if (eng.direction) lines.push(`Direction: ${eng.direction}`);
          if (eng.fromEmail) lines.push(`From: ${eng.fromEmail}`);
          if (eng.toEmail) lines.push(`To: ${eng.toEmail}`);
          if (eng.author) lines.push(`By: ${eng.author}`);
          if (eng.duration !== undefined) {
            lines.push(`Duration: ${eng.duration}s${eng.disposition ? ` | Disposition: ${eng.disposition}` : ''}`);
          }
          if (eng.body) lines.push(eng.body);

          return lines.join('\n');
        }).join('\n\n---\n\n')
      : 'No engagements found for this ticket.';

    // 4. Build prompts
    const today = new Date().toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const ageDays = ticket.hubspot_created_at
      ? Math.floor((Date.now() - new Date(ticket.hubspot_created_at).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    const systemPrompt = `You are a support operations analyst for Opus Behavioral Health, a healthcare SaaS company.
You are evaluating a support ticket flagged by an automated system for a communication gap.

Read the FULL engagement timeline (emails, notes, calls, meetings) and determine:

1. Is the gap REAL? Common false positives:
   - Customer said "thank you" or "all set" — no reply needed
   - Agent called the customer (logged as call) but email timestamp didn't update
   - Internal note shows issue is being worked on
   - Meeting was scheduled that addresses the concern
   - Ticket waiting on external dependency (engineering fix, Linear task)

2. Customer emotional state from the actual content:
   - positive / neutral / negative / frustrated

3. What specific action should the agent take RIGHT NOW?
   - Be specific: "Reply to customer's API documentation question from Feb 13"
   - Reference actual content from the conversation
   - If no action needed: "No action needed — [reason]"

4. How urgent based on content?
   - critical: Billing dispute, system down, patient safety, escalation threat
   - high: Major workflow blocked, customer frustrated, high-priority ticket
   - medium: Standard question awaiting response, moderate impact
   - low: Cosmetic request, low-impact, or false positive

IMPORTANT: Your assessment should OVERRIDE the automated severity when appropriate.

Respond in this exact format:
STATUS: [confirmed|false_positive|monitoring]
URGENCY: [critical|high|medium|low]
CUSTOMER_SENTIMENT: [positive|neutral|negative|frustrated]
RECOMMENDED_ACTION: [specific action text]
REASONING: [2-3 sentences explaining your assessment]
LAST_MEANINGFUL_CONTACT: [description, e.g. "Agent sent API docs on Feb 13"]
CONFIDENCE: [0.00-1.00]`;

    const userPrompt = `Evaluate this flagged support ticket:

AUTOMATED DETECTION:
- Violation Type: ${violation.violationType} (${violation.violationLabel})
- Automated Severity: ${violation.severity}
- Communication Gap: ${violation.gapDisplay} (${Math.round(violation.gapHours)} hours)

TICKET METADATA:
- Subject: ${ticket.subject || 'N/A'}
- Company: ${ticket.hs_primary_company_name || 'Unknown'}
- Priority: ${ticket.priority || 'N/A'}
- Owner: ${violation.ownerName || 'Unassigned'}
- Category: ${ticket.category || 'N/A'}
- Ball In Court: ${ticket.ball_in_court || 'N/A'}
- Software: ${ticket.software || 'N/A'}
- Age: ${ageDays} days
- Today's Date: ${today}

FULL ENGAGEMENT TIMELINE (${timeline.counts.total} items: ${timeline.counts.emails} emails, ${timeline.counts.notes} notes, ${timeline.counts.calls} calls, ${timeline.counts.meetings} meetings):
${engagementText}`;

    // 5. Call LLM
    const anthropic = getAnthropicProvider();
    const result = await generateText({
      model: anthropic('claude-sonnet-4-20250514'),
      system: systemPrompt,
      prompt: userPrompt,
    });

    // 6. Parse response
    const text = result.text;
    const statusMatch = text.match(/STATUS:\s*(confirmed|false_positive|monitoring)/i);
    const urgencyMatch = text.match(/URGENCY:\s*(critical|high|medium|low)/i);
    const sentimentMatch = text.match(/CUSTOMER_SENTIMENT:\s*(positive|neutral|negative|frustrated)/i);
    const actionMatch = text.match(/RECOMMENDED_ACTION:\s*(.+?)(?=\nREASONING:|\n\n|$)/is);
    const reasoningMatch = text.match(/REASONING:\s*(.+?)(?=\nLAST_MEANINGFUL_CONTACT:|\n\n|$)/is);
    const contactMatch = text.match(/LAST_MEANINGFUL_CONTACT:\s*(.+?)(?=\nCONFIDENCE:|\n\n|$)/is);
    const confidenceMatch = text.match(/CONFIDENCE:\s*([\d.]+)/i);

    const status = statusMatch ? statusMatch[1].toLowerCase() as 'confirmed' | 'false_positive' | 'monitoring' : 'confirmed';
    const urgency = urgencyMatch ? urgencyMatch[1].toLowerCase() as 'critical' | 'high' | 'medium' | 'low' : 'medium';
    const customerSentiment = sentimentMatch
      ? sentimentMatch[1].toLowerCase() as 'positive' | 'neutral' | 'negative' | 'frustrated'
      : null;
    const recommendedAction = actionMatch ? actionMatch[1].trim() : 'Review ticket';
    const reasoning = reasoningMatch ? reasoningMatch[1].trim() : 'Analysis completed';
    const lastMeaningfulContact = contactMatch ? contactMatch[1].trim() : null;
    const confidence = confidenceMatch
      ? Math.min(1, Math.max(0, parseFloat(confidenceMatch[1])))
      : 0.5;

    // 7. Upsert into follow_up_analyses
    const analysisData = {
      hubspot_ticket_id: ticketId,
      status,
      urgency,
      customer_sentiment: customerSentiment,
      recommended_action: recommendedAction,
      reasoning,
      last_meaningful_contact: lastMeaningfulContact,
      confidence,
      violation_type: violation.violationType,
      original_severity: violation.severity,
      gap_hours: Math.round(violation.gapHours * 100) / 100,
      ticket_subject: ticket.subject,
      company_id: ticket.hs_primary_company_id,
      company_name: ticket.hs_primary_company_name,
      owner_id: violation.ownerId,
      owner_name: violation.ownerName,
      engagement_count: timeline.counts.total,
      analyzed_at: new Date().toISOString(),
    };

    const { error: upsertError } = await serviceClient
      .from('follow_up_analyses')
      .upsert(analysisData, { onConflict: 'hubspot_ticket_id' });

    if (upsertError) {
      console.error('Error upserting follow-up analysis:', upsertError);
    }

    const analysis: FollowUpAnalysis = {
      ...analysisData,
    };

    return { success: true, analysis };
  } catch (error) {
    console.error('Follow-up analysis error:', error);
    return {
      success: false,
      error: 'Failed to analyze ticket',
      details: error instanceof Error ? error.message : 'Unknown error',
      statusCode: 500,
    };
  }
}
