import { createServerSupabaseClient } from '@/lib/supabase/client';
import { createServiceClient } from '@/lib/supabase/client';
import { getHubSpotClient } from '@/lib/hubspot/client';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';

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

export interface TicketCategorization {
  hubspot_ticket_id: string;
  primary_category: string;
  subcategory: string | null;
  affected_module: string | null;
  issue_type: string;
  severity: string;
  customer_impact: string | null;
  root_cause_hint: string | null;
  summary: string;
  tags: string[] | null;
  ticket_subject: string | null;
  company_id: string | null;
  company_name: string | null;
  ticket_created_at: string | null;
  is_closed: boolean;
  confidence: number;
  analyzed_at: string;
}

export type AnalyzeResult = {
  success: true;
  categorization: TicketCategorization;
} | {
  success: false;
  error: string;
  details?: string;
  statusCode?: number;
};

// --- Core Analysis Function ---

export async function categorizeTicket(ticketId: string): Promise<AnalyzeResult> {
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

    // 3. Fetch company info
    const companyName: string | null = ticket.hs_primary_company_name;
    const companyId: string | null = ticket.hs_primary_company_id;

    // 4. Build prompt and call LLM
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

    const systemPrompt = `You are a support ticket analyst for Opus Behavioral Health, a healthcare SaaS company that sells EHR (Electronic Health Records), RCM (Revenue Cycle Management), and Copilot AI products to behavioral health providers.

Your job is to read a support ticket and its conversation thread, then categorize the issue with a structured taxonomy.

CATEGORY GUIDELINES (use these exact names when applicable):
- Scheduling & Appointments
- Clinical Documentation
- Billing & Claims (RCM)
- User Access & Permissions
- Reporting & Analytics
- Integrations & Data Exchange
- System Performance
- Data Issues & Corrections
- Workflow Configuration
- Training & How-To
- Telehealth
- Prescriptions & ePrescribing
- Patient Portal
- Copilot AI
- Custom Work Request
- Account Setup & Onboarding

If the issue doesn't fit any of these, create a concise new category name.

ISSUE TYPE must be one of: bug, feature_request, how_to, configuration, data_issue, access_issue, integration, performance

SEVERITY based on customer impact:
- critical: System down, data loss, patient safety concern, affects all users
- high: Major workflow blocked, workaround exists but painful, affects many users
- medium: Partial disruption, reasonable workaround available
- low: Cosmetic, minor inconvenience, nice-to-have improvement

Respond in this exact format:
PRIMARY_CATEGORY: [category name]
SUBCATEGORY: [specific sub-issue]
AFFECTED_MODULE: [which product area]
ISSUE_TYPE: [bug|feature_request|how_to|configuration|data_issue|access_issue|integration|performance]
SEVERITY: [critical|high|medium|low]
CUSTOMER_IMPACT: [one sentence about how this affects the customer's operations]
ROOT_CAUSE_HINT: [your assessment of likely root cause, or "Insufficient context" if unclear]
SUMMARY: [one-sentence summary of the issue]
TAGS: [comma-separated additional tags, e.g. "recurring,multi-tenant,sla-breach"]
CONFIDENCE: [0.00-1.00]`;

    const userPrompt = `Analyze and categorize this support ticket:

TICKET DETAILS:
- Subject: ${ticket.subject || 'N/A'}
- Source: ${ticket.source_type || 'N/A'}
- Category: ${ticket.category || 'N/A'}
- Priority: ${ticket.priority || 'N/A'}
- Status: ${ticket.is_closed ? 'Closed' : 'Open'}
- Ball In Court: ${ticket.ball_in_court || 'N/A'}
- Software: ${ticket.software || 'N/A'}

COMPANY:
- Name: ${companyName || 'Unknown'}

CONVERSATION THREAD:
${conversationText}`;

    const anthropic = getAnthropicProvider();
    const result = await generateText({
      model: anthropic('claude-sonnet-4-20250514'),
      system: systemPrompt,
      prompt: userPrompt,
    });

    // 5. Parse response
    const text = result.text;
    const categoryMatch = text.match(/PRIMARY_CATEGORY:\s*(.+?)(?=\nSUBCATEGORY:|\n|$)/i);
    const subcategoryMatch = text.match(/SUBCATEGORY:\s*(.+?)(?=\nAFFECTED_MODULE:|\n|$)/i);
    const moduleMatch = text.match(/AFFECTED_MODULE:\s*(.+?)(?=\nISSUE_TYPE:|\n|$)/i);
    const issueTypeMatch = text.match(/ISSUE_TYPE:\s*(bug|feature_request|how_to|configuration|data_issue|access_issue|integration|performance)/i);
    const severityMatch = text.match(/SEVERITY:\s*(critical|high|medium|low)/i);
    const impactMatch = text.match(/CUSTOMER_IMPACT:\s*(.+?)(?=\nROOT_CAUSE_HINT:|\n|$)/i);
    const rootCauseMatch = text.match(/ROOT_CAUSE_HINT:\s*(.+?)(?=\nSUMMARY:|\n|$)/i);
    const summaryMatch = text.match(/SUMMARY:\s*(.+?)(?=\nTAGS:|\n|$)/i);
    const tagsMatch = text.match(/TAGS:\s*(.+?)(?=\nCONFIDENCE:|\n|$)/i);
    const confidenceMatch = text.match(/CONFIDENCE:\s*([\d.]+)/i);

    const primaryCategory = categoryMatch ? categoryMatch[1].trim() : 'Uncategorized';
    const subcategory = subcategoryMatch ? subcategoryMatch[1].trim() : null;
    const affectedModule = moduleMatch ? moduleMatch[1].trim() : null;
    const issueType = issueTypeMatch ? issueTypeMatch[1].toLowerCase() : 'bug';
    const severity = severityMatch ? severityMatch[1].toLowerCase() : 'medium';
    const customerImpact = impactMatch ? impactMatch[1].trim() : null;
    const rootCauseHint = rootCauseMatch ? rootCauseMatch[1].trim() : null;
    const summary = summaryMatch ? summaryMatch[1].trim() : ticket.subject || 'No summary available';
    const tags = tagsMatch
      ? tagsMatch[1].split(',').map((t: string) => t.trim()).filter(Boolean)
      : null;
    const confidence = confidenceMatch
      ? Math.min(1, Math.max(0, parseFloat(confidenceMatch[1])))
      : 0.5;

    // 6. Upsert into ticket_categorizations (use service client for write)
    const categorizationData = {
      hubspot_ticket_id: ticketId,
      primary_category: primaryCategory,
      subcategory: subcategory,
      affected_module: affectedModule,
      issue_type: issueType,
      severity: severity,
      customer_impact: customerImpact,
      root_cause_hint: rootCauseHint,
      summary: summary,
      tags: tags,
      ticket_subject: ticket.subject,
      company_id: companyId,
      company_name: companyName,
      ticket_created_at: ticket.hubspot_created_at,
      is_closed: ticket.is_closed || false,
      confidence: confidence,
      analyzed_at: new Date().toISOString(),
    };

    const { error: upsertError } = await serviceClient
      .from('ticket_categorizations')
      .upsert(categorizationData, { onConflict: 'hubspot_ticket_id' });

    if (upsertError) {
      console.error('Error upserting ticket categorization:', upsertError);
    }

    const categorization: TicketCategorization = {
      ...categorizationData,
    };

    return { success: true, categorization };
  } catch (error) {
    console.error('Ticket categorization error:', error);
    return {
      success: false,
      error: 'Failed to categorize ticket',
      details: error instanceof Error ? error.message : 'Unknown error',
      statusCode: 500,
    };
  }
}
