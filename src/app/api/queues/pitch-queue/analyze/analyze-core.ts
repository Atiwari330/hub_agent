import { createServerSupabaseClient } from '@/lib/supabase/client';
import { createServiceClient } from '@/lib/supabase/client';
import { getHubSpotClient } from '@/lib/hubspot/client';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { PitchAnalysis } from '../../pitch-queue/route';

// --- Anthropic provider (same pattern as agent.ts) ---

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

interface ThreadMessage {
  id: string;
  type: string;
  createdAt: string;
  text?: string;
  subject?: string;
  senders?: Array<{ name?: string; actorId?: string }>;
}

export type AnalyzeResult = {
  success: true;
  analysis: PitchAnalysis;
} | {
  success: false;
  error: string;
  details?: string;
  statusCode?: number;
};

// --- Core Analysis Function ---

export async function analyzePitchTicket(ticketId: string): Promise<AnalyzeResult> {
  const supabase = await createServerSupabaseClient();
  const serviceClient = createServiceClient();
  const client = getHubSpotClient();

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

    // 2. Fetch conversation thread from HubSpot
    let conversationMessages: ThreadMessage[] = [];
    try {
      const hsTicket = await client.crm.tickets.basicApi.getById(ticketId, [
        'subject',
        'hs_conversations_originating_thread_id',
        'content',
      ]);
      const threadId = hsTicket.properties.hs_conversations_originating_thread_id;

      if (threadId) {
        const messagesResponse = await client.apiRequest({
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

    // 3. Fetch contact info via HubSpot associations
    let contactName: string | null = null;
    let contactEmail: string | null = null;
    try {
      const assocResponse = await client.apiRequest({
        method: 'GET',
        path: `/crm/v4/objects/tickets/${ticketId}/associations/contacts`,
      });
      const assocData = (await assocResponse.json()) as {
        results?: Array<{ toObjectId: number }>;
      };

      if (assocData.results && assocData.results.length > 0) {
        const contactId = String(assocData.results[0].toObjectId);
        try {
          const contact = await client.crm.contacts.basicApi.getById(contactId, [
            'firstname',
            'lastname',
            'email',
          ]);
          const first = contact.properties.firstname || '';
          const last = contact.properties.lastname || '';
          contactName = `${first} ${last}`.trim() || null;
          contactEmail = contact.properties.email || null;
        } catch {
          // Contact fetch failed
        }
      }
    } catch {
      // Association fetch failed
    }

    // 4. Fetch company info from Supabase companies table
    let companyName: string | null = ticket.hs_primary_company_name;
    let companyArr: number | null = null;
    if (ticket.hs_primary_company_id) {
      const { data: company } = await supabase
        .from('companies')
        .select('name, arr')
        .eq('hubspot_company_id', ticket.hs_primary_company_id)
        .single();

      if (company) {
        companyName = company.name || companyName;
        companyArr = company.arr;
      }
    }

    // 5. Build prompt and call LLM
    const conversationText = conversationMessages.length > 0
      ? conversationMessages
          .slice(0, 15)
          .map((msg) => {
            const sender = msg.senders?.map((s) => s.name || s.actorId).join(', ') || 'Unknown';
            const text = msg.text || '(no text)';
            return `[${msg.createdAt}] ${sender}: ${text}`;
          })
          .join('\n\n')
      : 'No conversation thread available.';

    const ageDays = ticket.hubspot_created_at
      ? Math.floor(
          (Date.now() - new Date(ticket.hubspot_created_at).getTime()) / (1000 * 60 * 60 * 24)
        )
      : null;

    const systemPrompt = `You are an expert support-to-sales analyst for Opus Behavioral Health, a healthcare SaaS company that sells EHR, RCM, and Copilot AI products.

Your job is to evaluate whether a support ticket interaction represents a good opportunity for the support team to pitch an upsell (additional product or service) to the customer.

Evaluation criteria for a PITCH opportunity:
- Customer sentiment is positive or at least neutral
- The support issue has been resolved or is being resolved satisfactorily
- The conversation reveals a need that could be addressed by another Opus product
- The customer is engaged and responsive
- The company has room for expansion (doesn't already have all products)

Evaluation criteria for SKIP:
- Customer is frustrated or upset
- The issue is unresolved and the customer is unhappy
- It would be tone-deaf to pitch during this interaction
- The ticket is about billing disputes or contract issues

Evaluation criteria for MAYBE:
- Mixed signals — some positive, some negative
- The issue is in progress but trending positively
- Need more context to make a firm recommendation

Always provide your response in this exact format:
RECOMMENDATION: [pitch|skip|maybe]
CONFIDENCE: [0.00-1.00]
TALKING_POINTS: [If pitch or maybe, suggest 1-2 specific angles the rep could use. If skip, write "N/A"]
REASONING: [2-3 sentences explaining your assessment]
CUSTOMER_SENTIMENT: [positive|neutral|negative]`;

    const userPrompt = `Analyze this support ticket for upsell opportunity:

TICKET DETAILS:
- Subject: ${ticket.subject || 'N/A'}
- Source: ${ticket.source_type || 'N/A'}
- Category: ${ticket.category || 'N/A'}
- Priority: ${ticket.priority || 'N/A'}
- Age: ${ageDays !== null ? `${ageDays} days` : 'N/A'}
- Ball In Court: ${ticket.ball_in_court || 'N/A'}
- Software: ${ticket.software || 'N/A'}

COMPANY:
- Name: ${companyName || 'Unknown'}
- ARR: ${companyArr ? `$${companyArr.toLocaleString()}` : 'Unknown'}

CONTACT:
- Name: ${contactName || 'Unknown'}
- Email: ${contactEmail || 'Unknown'}

CONVERSATION THREAD:
${conversationText}`;

    const anthropic = getAnthropicProvider();
    const result = await generateText({
      model: anthropic('claude-sonnet-4-20250514'),
      system: systemPrompt,
      prompt: userPrompt,
    });

    // 6. Parse response
    const text = result.text;
    const recommendationMatch = text.match(/RECOMMENDATION:\s*(pitch|skip|maybe)/i);
    const confidenceMatch = text.match(/CONFIDENCE:\s*([\d.]+)/i);
    const talkingPointsMatch = text.match(/TALKING_POINTS:\s*(.+?)(?=REASONING:|$)/is);
    const reasoningMatch = text.match(/REASONING:\s*(.+?)(?=CUSTOMER_SENTIMENT:|$)/is);
    const sentimentMatch = text.match(/CUSTOMER_SENTIMENT:\s*(positive|neutral|negative)/i);

    const recommendation = recommendationMatch
      ? (recommendationMatch[1].toLowerCase() as 'pitch' | 'skip' | 'maybe')
      : 'maybe';
    const confidence = confidenceMatch
      ? Math.min(1, Math.max(0, parseFloat(confidenceMatch[1])))
      : 0.5;
    const talkingPoints = talkingPointsMatch ? talkingPointsMatch[1].trim() : null;
    const reasoning = reasoningMatch ? reasoningMatch[1].trim() : null;
    const customerSentiment = sentimentMatch
      ? (sentimentMatch[1].toLowerCase() as 'positive' | 'neutral' | 'negative')
      : null;

    // 7. Upsert into pitch_analyses (use service client for write)
    const analysisData = {
      hubspot_ticket_id: ticketId,
      company_id: ticket.hs_primary_company_id,
      company_name: companyName,
      contact_name: contactName,
      contact_email: contactEmail,
      ticket_subject: ticket.subject,
      recommendation,
      confidence,
      talking_points: talkingPoints,
      reasoning,
      customer_sentiment: customerSentiment,
      analyzed_at: new Date().toISOString(),
    };

    const { error: upsertError } = await serviceClient
      .from('pitch_analyses')
      .upsert(analysisData, { onConflict: 'hubspot_ticket_id' });

    if (upsertError) {
      console.error('Error upserting pitch analysis:', upsertError);
    }

    const analysis: PitchAnalysis = {
      hubspot_ticket_id: ticketId,
      company_id: ticket.hs_primary_company_id,
      company_name: companyName,
      contact_name: contactName,
      contact_email: contactEmail,
      ticket_subject: ticket.subject,
      recommendation,
      confidence,
      talking_points: talkingPoints,
      reasoning,
      customer_sentiment: customerSentiment,
      analyzed_at: analysisData.analyzed_at,
    };

    return { success: true, analysis };
  } catch (error) {
    console.error('Pitch analysis error:', error);
    return {
      success: false,
      error: 'Failed to analyze ticket',
      details: error instanceof Error ? error.message : 'Unknown error',
      statusCode: 500,
    };
  }
}
