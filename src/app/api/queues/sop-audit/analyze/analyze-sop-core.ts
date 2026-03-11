import { createServiceClient } from '@/lib/supabase/client';
import { getHubSpotClient } from '@/lib/hubspot/client';
import { getTicketEngagementTimeline } from '@/lib/hubspot/ticket-engagements';
import { generateText } from 'ai';
import { getModel } from '@/lib/ai/provider';
import { getSopReferenceText } from '../sop-content';
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

export interface TicketSopAnalysis {
  hubspot_ticket_id: string;
  sop_product_area: string;
  sop_issue_type: string;
  sop_severity: string;
  sop_recommended_routing: string;
  sop_authorization_required: string;
  classification_confidence: number;
  classification_reasoning: string;
  triage_compliance_score: number;
  triage_assessment: string;
  routing_compliance_score: number;
  routing_assessment: string;
  authorization_compliance_score: number;
  authorization_assessment: string;
  communication_compliance_score: number;
  communication_assessment: string;
  documentation_compliance_score: number;
  documentation_assessment: string;
  vendor_compliance_score: number | null;
  vendor_assessment: string | null;
  compliance_score: number;
  compliance_grade: string;
  clean_fit: boolean;
  ambiguity_flags: string | null;
  sop_gap_identified: boolean;
  sop_gap_description: string | null;
  sop_gap_severity: string | null;
  edge_case_notes: string | null;
  key_evidence: string | null;
  ticket_subject: string | null;
  company_name: string | null;
  is_closed: boolean;
  assigned_rep: string | null;
  analyzed_at: string;
}

export type AnalyzeResult =
  | { success: true; analysis: TicketSopAnalysis }
  | { success: false; error: string; details?: string; statusCode?: number };

// --- Helpers ---

function scoreToGrade(score: number): string {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

function computeComplianceScore(
  triage: number,
  routing: number,
  authorization: number,
  communication: number,
  documentation: number,
  vendor: number | null
): number {
  // Weights: Triage 20%, Routing 25%, Authorization 20%, Communication 15%, Documentation 10%, Vendor 10%
  if (vendor !== null) {
    const score = Math.round(
      triage * 2.0 + routing * 2.5 + authorization * 2.0 +
      communication * 1.5 + documentation * 1.0 + vendor * 1.0
    );
    return Math.min(100, Math.max(0, score));
  }
  // Vendor N/A: redistribute 10% proportionally across other 5 (total 90% → scale to 100%)
  const rawScore = triage * 2.0 + routing * 2.5 + authorization * 2.0 +
    communication * 1.5 + documentation * 1.0;
  const score = Math.round((rawScore / 90) * 100);
  return Math.min(100, Math.max(0, score));
}

// --- System Prompt ---

function buildSystemPrompt(): string {
  const sopRef = getSopReferenceText();

  return `You are an SOP compliance auditor for Opus Behavioral Health, a healthcare SaaS company.

You have been given the company's complete Support SOP framework below. Your job is to:
1. CLASSIFY the ticket per the SOP framework
2. ASSESS COMPLIANCE — compare what the SOP says should happen vs what the rep actually did
3. FLAG GAPS — identify if this ticket reveals something the SOPs don't cover

${sopRef}

INSTRUCTIONS:

CLASSIFICATION:
- Choose the BEST product area from the 13 options. If the ticket spans multiple, choose the primary one and note others in AMBIGUITY_FLAGS.
- Choose the BEST issue type from the 7 options.
- Assign severity (sev_1, sev_2, sev_3, or needs_triage) based on the SOP criteria — actual operational impact, not customer wording.
- Choose the recommended routing path from the 9 options.
- Determine if authorization was required (yes/no/unclear) per the authority matrix.

COMPLIANCE ASSESSMENT:
Score each dimension 0-10 based on how well the rep followed the SOP:
- TRIAGE: Did the rep complete the 12-item first-pass triage checklist? Did they classify before acting?
- ROUTING: Was the ticket routed to the correct path per SOP? Were handoffs appropriate?
- AUTHORIZATION: If auth was required, was it obtained properly? If not required, was the rep appropriately cautious?
- COMMUNICATION: Did the rep follow the communication standard? Ownership language? Proactive updates? Set expectations?
- DOCUMENTATION: Is the ticket documented well enough for handoff, escalation, and management review?
- VENDOR (only if vendor involvement exists or was needed): Did the rep follow vendor coordination policy? Pre-vendor triage? Ownership? Active follow-up?

If conversation data is insufficient to assess a compliance dimension, score it 5/10 and note the data limitation.

COVERAGE/GAP ANALYSIS:
- CLEAN_FIT: Does this ticket map cleanly to the SOP categories? (true/false)
- A gap is something the SOPs genuinely don't address — not just a difficult classification.
- Only flag a gap if you can describe what's missing and why it matters.

Respond in this EXACT format (every field is required):
SOP_PRODUCT_AREA: [one of the 13 product areas]
SOP_ISSUE_TYPE: [one of the 7 issue types]
SOP_SEVERITY: [sev_1|sev_2|sev_3|needs_triage]
SOP_RECOMMENDED_ROUTING: [one of the 9 routing paths]
SOP_AUTHORIZATION_REQUIRED: [yes|no|unclear]
CLASSIFICATION_CONFIDENCE: [0.00-1.00]
CLASSIFICATION_REASONING: [1-3 sentences explaining your classification choices]
TRIAGE_COMPLIANCE_SCORE: [0-10]
TRIAGE_ASSESSMENT: [1-2 sentences with specific evidence]
ROUTING_COMPLIANCE_SCORE: [0-10]
ROUTING_ASSESSMENT: [1-2 sentences with specific evidence]
AUTHORIZATION_COMPLIANCE_SCORE: [0-10]
AUTHORIZATION_ASSESSMENT: [1-2 sentences with specific evidence]
COMMUNICATION_COMPLIANCE_SCORE: [0-10]
COMMUNICATION_ASSESSMENT: [1-2 sentences with specific evidence]
DOCUMENTATION_COMPLIANCE_SCORE: [0-10]
DOCUMENTATION_ASSESSMENT: [1-2 sentences with specific evidence]
VENDOR_COMPLIANCE_SCORE: [0-10 or N/A]
VENDOR_ASSESSMENT: [1-2 sentences or N/A]
CLEAN_FIT: [true|false]
AMBIGUITY_FLAGS: [description of category overlaps, or "None"]
SOP_GAP_IDENTIFIED: [true|false]
SOP_GAP_DESCRIPTION: [what's missing from the SOPs, or "None"]
SOP_GAP_SEVERITY: [critical|high|medium|low|N/A]
EDGE_CASE_NOTES: [any edge case observations, or "None"]
KEY_EVIDENCE: [2-3 key pieces of evidence from the conversation that informed your assessment]`;
}

// --- Core Analysis Function ---

export async function analyzeSopCompliance(
  ticketId: string,
  readerClient?: SupabaseClient
): Promise<AnalyzeResult> {
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

    // 2. Fetch existing categorization for context
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
        const messagesData = (await messagesResponse.json()) as { results?: ThreadMessage[] };
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
    const categorizationBlock = categorization
      ? `\nEXISTING CATEGORIZATION:\n- Category: ${categorization.primary_category}\n- Subcategory: ${categorization.subcategory || 'N/A'}\n- Issue Type: ${categorization.issue_type}\n- Severity: ${categorization.severity}\n- Root Cause Hint: ${categorization.root_cause_hint || 'N/A'}\n`
      : '';

    const userPrompt = `Analyze SOP compliance and classification for this ticket:

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

    const sopProductArea = field('SOP_PRODUCT_AREA', 'Unknown / Needs Triage');
    const sopIssueType = field('SOP_ISSUE_TYPE', 'Unknown / Needs Investigation');
    const sopSeverityRaw = field('SOP_SEVERITY', 'needs_triage').toLowerCase();
    const sopSeverity = ['sev_1', 'sev_2', 'sev_3', 'needs_triage'].includes(sopSeverityRaw)
      ? sopSeverityRaw : 'needs_triage';
    const sopRouting = field('SOP_RECOMMENDED_ROUTING', 'Senior Support');
    const sopAuthRaw = field('SOP_AUTHORIZATION_REQUIRED', 'unclear').toLowerCase();
    const sopAuth = ['yes', 'no', 'unclear'].includes(sopAuthRaw) ? sopAuthRaw : 'unclear';
    const classificationConfidence = numField('CLASSIFICATION_CONFIDENCE', 0.5, 1);
    const classificationReasoning = field('CLASSIFICATION_REASONING', 'Unable to determine from available data.');

    const triageScore = Math.round(numField('TRIAGE_COMPLIANCE_SCORE', 5, 10));
    const triageAssessment = field('TRIAGE_ASSESSMENT', 'Insufficient data to assess triage compliance.');
    const routingScore = Math.round(numField('ROUTING_COMPLIANCE_SCORE', 5, 10));
    const routingAssessment = field('ROUTING_ASSESSMENT', 'Insufficient data to assess routing compliance.');
    const authScore = Math.round(numField('AUTHORIZATION_COMPLIANCE_SCORE', 5, 10));
    const authAssessment = field('AUTHORIZATION_ASSESSMENT', 'Insufficient data to assess authorization compliance.');
    const commScore = Math.round(numField('COMMUNICATION_COMPLIANCE_SCORE', 5, 10));
    const commAssessment = field('COMMUNICATION_ASSESSMENT', 'Insufficient data to assess communication compliance.');
    const docScore = Math.round(numField('DOCUMENTATION_COMPLIANCE_SCORE', 5, 10));
    const docAssessment = field('DOCUMENTATION_ASSESSMENT', 'Insufficient data to assess documentation compliance.');

    const vendorScoreRaw = field('VENDOR_COMPLIANCE_SCORE', 'N/A');
    const vendorScore = vendorScoreRaw.toLowerCase() === 'n/a' ? null : Math.round(numField('VENDOR_COMPLIANCE_SCORE', 5, 10));
    const vendorAssessmentRaw = field('VENDOR_ASSESSMENT', 'N/A');
    const vendorAssessment = vendorAssessmentRaw.toLowerCase() === 'n/a' ? null : vendorAssessmentRaw;

    const complianceScore = computeComplianceScore(triageScore, routingScore, authScore, commScore, docScore, vendorScore);
    const complianceGrade = scoreToGrade(complianceScore);

    const cleanFitRaw = field('CLEAN_FIT', 'true').toLowerCase();
    const cleanFit = cleanFitRaw === 'true';
    const ambiguityFlagsRaw = field('AMBIGUITY_FLAGS', 'None');
    const ambiguityFlags = ambiguityFlagsRaw.toLowerCase() === 'none' ? null : ambiguityFlagsRaw;
    const gapIdentifiedRaw = field('SOP_GAP_IDENTIFIED', 'false').toLowerCase();
    const gapIdentified = gapIdentifiedRaw === 'true';
    const gapDescRaw = field('SOP_GAP_DESCRIPTION', 'None');
    const gapDescription = gapDescRaw.toLowerCase() === 'none' ? null : gapDescRaw;
    const gapSevRaw = field('SOP_GAP_SEVERITY', 'N/A').toLowerCase();
    const gapSeverity = ['critical', 'high', 'medium', 'low'].includes(gapSevRaw) ? gapSevRaw : null;
    const edgeCaseRaw = field('EDGE_CASE_NOTES', 'None');
    const edgeCaseNotes = edgeCaseRaw.toLowerCase() === 'none' ? null : edgeCaseRaw;
    const keyEvidence = field('KEY_EVIDENCE', null as unknown as string) || null;

    // 12. Upsert into ticket_sop_analyses
    const analysisData = {
      hubspot_ticket_id: ticketId,
      sop_product_area: sopProductArea,
      sop_issue_type: sopIssueType,
      sop_severity: sopSeverity,
      sop_recommended_routing: sopRouting,
      sop_authorization_required: sopAuth,
      classification_confidence: classificationConfidence,
      classification_reasoning: classificationReasoning,
      triage_compliance_score: triageScore,
      triage_assessment: triageAssessment,
      routing_compliance_score: routingScore,
      routing_assessment: routingAssessment,
      authorization_compliance_score: authScore,
      authorization_assessment: authAssessment,
      communication_compliance_score: commScore,
      communication_assessment: commAssessment,
      documentation_compliance_score: docScore,
      documentation_assessment: docAssessment,
      vendor_compliance_score: vendorScore,
      vendor_assessment: vendorAssessment,
      compliance_score: complianceScore,
      compliance_grade: complianceGrade,
      clean_fit: cleanFit,
      ambiguity_flags: ambiguityFlags,
      sop_gap_identified: gapIdentified,
      sop_gap_description: gapDescription,
      sop_gap_severity: gapSeverity,
      edge_case_notes: edgeCaseNotes,
      key_evidence: keyEvidence,
      ticket_subject: ticket.subject,
      company_name: ticket.hs_primary_company_name,
      is_closed: ticket.is_closed || false,
      assigned_rep: ownerName,
      analyzed_at: new Date().toISOString(),
    };

    const { error: upsertError } = await serviceClient
      .from('ticket_sop_analyses')
      .upsert(analysisData, { onConflict: 'hubspot_ticket_id' });

    if (upsertError) {
      console.error('Error upserting SOP analysis:', upsertError);
    }

    return { success: true, analysis: analysisData as TicketSopAnalysis };
  } catch (error) {
    console.error('SOP analysis error:', error);
    return {
      success: false,
      error: 'Failed to analyze SOP compliance',
      details: error instanceof Error ? error.message : 'Unknown error',
      statusCode: 500,
    };
  }
}
