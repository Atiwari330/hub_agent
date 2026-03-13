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

export interface TicketRcmAnalysis {
  hubspot_ticket_id: string;
  is_rcm_related: boolean;
  rcm_system: string | null;
  issue_category: string | null;
  issue_summary: string | null;
  problems: string[] | null;
  severity: string | null;
  current_status: string | null;
  vendor_blamed: boolean | null;
  confidence: number;
  ticket_subject: string | null;
  company_name: string | null;
  assigned_rep: string | null;
  is_closed: boolean;
  analyzed_at: string;
}

export type AnalyzeRcmResult =
  | { success: true; analysis: TicketRcmAnalysis }
  | { success: false; error: string; details?: string; statusCode?: number };

// --- System Prompt ---

function buildSystemPrompt(): string {
  return `You are an RCM (Revenue Cycle Management) and billing operations analyst for Opus Behavioral Health, a healthcare SaaS company.

DOMAIN CONTEXT:

Opus Behavioral Health uses TWO billing/RCM systems:

1. **Practice Suite** — The legacy practice management and billing platform. Handles:
   - Insurance/payer entry and eligibility
   - Claim submission and tracking
   - ERA (Electronic Remittance Advice) posting
   - Payment posting
   - Patient billing
   - CPT/NPI configuration
   - Billing rules and modifiers

2. **Opus RCM / Imagine** — The newer RCM platform (sometimes called "Opus RCM" or "Imagine"). Handles:
   - Encounter syncing from the EHR
   - Automated claim generation
   - Denial management workflows
   - Billing rule engine
   - Reporting and analytics

Common RCM issues include:
- **Claim Denials**: Claims rejected by payers due to coding errors, authorization issues, timely filing, etc.
- **Encounter Sync**: Encounters not flowing correctly from the EHR to the billing system
- **ERA/Remittance**: Electronic remittance advices not posting correctly, payment mismatches
- **Insurance Entry**: Incorrect payer information, eligibility issues, coordination of benefits
- **CPT/NPI Configuration**: Incorrect procedure codes, provider NPI mapping issues
- **Billing Rules**: Modifier logic, place-of-service rules, authorization requirements
- **Payment Posting**: Payments not applied correctly, balance discrepancies
- **Vendor Issues**: Problems originating from third-party vendors (clearinghouses, payers, etc.)

YOUR JOB:
1. Determine if this ticket is RCM/billing related
2. If YES: classify the RCM system, issue category, summarize problems, assess severity and status
3. If NO: mark as not RCM-related with minimal output

Respond in this EXACT format (every field required):

IS_RCM_RELATED: [true|false]
RCM_SYSTEM: [practice_suite|opus_rcm|unknown|both|N/A]
ISSUE_CATEGORY: [claim_denial|encounter_sync|era_remittance|insurance_entry|cpt_npi_config|billing_rules|payment_posting|vendor_issue|other|N/A]
ISSUE_SUMMARY: [1-2 sentence summary of the billing/RCM issue, or "N/A"]
PROBLEMS: [bullet1 | bullet2 | bullet3 — pipe-separated list of specific problems identified, or "N/A"]
SEVERITY: [critical|high|medium|low|N/A]
CURRENT_STATUS: [active|stalled|waiting_vendor|waiting_customer|resolved|N/A]
VENDOR_BLAMED: [true|false|N/A]
CONFIDENCE: [0.00-1.00]

Guidelines:
- A ticket is RCM-related if it involves billing, claims, payments, insurance, ERA, encounters flowing to billing, CPT codes, or revenue cycle processes
- Tickets about purely clinical EHR features, scheduling, or general IT are NOT RCM-related
- For non-RCM tickets: set IS_RCM_RELATED=false, all other fields to N/A except CONFIDENCE
- SEVERITY: critical = revenue directly blocked (claims can't submit, payments not posting); high = significant billing delays; medium = workaround exists; low = cosmetic or minor
- CURRENT_STATUS: assess based on the latest activity — is someone actively working it, or has it stalled?
- VENDOR_BLAMED: true if the root cause appears to be a third-party vendor (clearinghouse, payer, Practice Suite vendor, etc.)`;
}

// --- Core Analysis Function ---

export async function analyzeRcmTicket(
  ticketId: string,
  readerClient?: SupabaseClient
): Promise<AnalyzeRcmResult> {
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

    // 2. Resolve owner name
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

    // 5. Build conversation text
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

    // 6. Build engagement timeline text
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

    // 7. Ticket age
    const createdAt = ticket.hubspot_created_at ? new Date(ticket.hubspot_created_at) : null;
    const ageDays = createdAt
      ? Math.round((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    // 8. Build user prompt
    const userPrompt = `Analyze this support ticket for RCM/billing relevance and issues:

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
${engagementTimelineText}`;

    // 9. Call LLM
    const result = await generateText({
      model: getModel(),
      system: buildSystemPrompt(),
      prompt: userPrompt,
    });

    // 10. Parse structured response
    const text = result.text;

    const field = (name: string, fallback: string): string => {
      const m = text.match(new RegExp(`${name}:\\s*(.+?)(?=\\n[A-Z_]+:|\\n\\n|$)`, 'is'));
      return m ? m[1].trim() : fallback;
    };

    const numField = (name: string, fallback: number, max: number): number => {
      const m = text.match(new RegExp(`${name}:\\s*([\\d.]+)`, 'i'));
      return m ? Math.min(max, Math.max(0, parseFloat(m[1]))) : fallback;
    };

    const isRcmRelatedRaw = field('IS_RCM_RELATED', 'false').toLowerCase();
    const isRcmRelated = isRcmRelatedRaw === 'true';
    const confidence = numField('CONFIDENCE', 0.5, 1);

    if (!isRcmRelated) {
      // Non-RCM ticket: minimal row
      const analysisData: TicketRcmAnalysis = {
        hubspot_ticket_id: ticketId,
        is_rcm_related: false,
        rcm_system: null,
        issue_category: null,
        issue_summary: null,
        problems: null,
        severity: null,
        current_status: null,
        vendor_blamed: null,
        confidence,
        ticket_subject: ticket.subject,
        company_name: ticket.hs_primary_company_name,
        assigned_rep: ownerName,
        is_closed: ticket.is_closed || false,
        analyzed_at: new Date().toISOString(),
      };

      const { error: upsertError } = await serviceClient
        .from('ticket_rcm_analyses')
        .upsert(analysisData, { onConflict: 'hubspot_ticket_id' });

      if (upsertError) {
        console.error('Error upserting RCM analysis:', upsertError);
      }

      return { success: true, analysis: analysisData };
    }

    // Full RCM analysis
    const rcmSystemRaw = field('RCM_SYSTEM', 'unknown').toLowerCase();
    const rcmSystem = ['practice_suite', 'opus_rcm', 'unknown', 'both'].includes(rcmSystemRaw)
      ? rcmSystemRaw : 'unknown';

    const issueCategoryRaw = field('ISSUE_CATEGORY', 'other').toLowerCase();
    const validCategories = [
      'claim_denial', 'encounter_sync', 'era_remittance', 'insurance_entry',
      'cpt_npi_config', 'billing_rules', 'payment_posting', 'vendor_issue', 'other',
    ];
    const issueCategory = validCategories.includes(issueCategoryRaw) ? issueCategoryRaw : 'other';

    const issueSummary = field('ISSUE_SUMMARY', 'No summary available.');

    const problemsRaw = field('PROBLEMS', 'N/A');
    const problems = problemsRaw.toLowerCase() === 'n/a'
      ? []
      : problemsRaw.split('|').map((p) => p.trim()).filter(Boolean);

    const severityRaw = field('SEVERITY', 'medium').toLowerCase();
    const severity = ['critical', 'high', 'medium', 'low'].includes(severityRaw) ? severityRaw : 'medium';

    const statusRaw = field('CURRENT_STATUS', 'active').toLowerCase();
    const validStatuses = ['active', 'stalled', 'waiting_vendor', 'waiting_customer', 'resolved'];
    const currentStatus = validStatuses.includes(statusRaw) ? statusRaw : 'active';

    const vendorBlamedRaw = field('VENDOR_BLAMED', 'false').toLowerCase();
    const vendorBlamed = vendorBlamedRaw === 'true';

    // 11. Upsert into ticket_rcm_analyses
    const analysisData: TicketRcmAnalysis = {
      hubspot_ticket_id: ticketId,
      is_rcm_related: true,
      rcm_system: rcmSystem,
      issue_category: issueCategory,
      issue_summary: issueSummary,
      problems,
      severity,
      current_status: currentStatus,
      vendor_blamed: vendorBlamed,
      confidence,
      ticket_subject: ticket.subject,
      company_name: ticket.hs_primary_company_name,
      assigned_rep: ownerName,
      is_closed: ticket.is_closed || false,
      analyzed_at: new Date().toISOString(),
    };

    const { error: upsertError } = await serviceClient
      .from('ticket_rcm_analyses')
      .upsert(analysisData, { onConflict: 'hubspot_ticket_id' });

    if (upsertError) {
      console.error('Error upserting RCM analysis:', upsertError);
    }

    return { success: true, analysis: analysisData };
  } catch (error) {
    console.error('RCM analysis error:', error);
    return {
      success: false,
      error: 'Failed to analyze RCM ticket',
      details: error instanceof Error ? error.message : 'Unknown error',
      statusCode: 500,
    };
  }
}
