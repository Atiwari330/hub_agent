/**
 * Stage 1: Per-ticket feature analysis (Sonnet)
 *
 * Analyzes individual support tickets to extract feature requests,
 * pain points, product areas, and urgency signals.
 *
 * No DB persistence — returns results in-memory for ad-hoc analysis.
 */

import { getHubSpotClient } from '../../lib/hubspot/client';
import { getTicketEngagementTimeline } from '../../lib/hubspot/ticket-engagements';
import { generateText } from 'ai';
import { getModel } from '../../lib/ai/provider';
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

export interface FeatureRequest {
  description: string;
  type: 'explicit' | 'inferred';
  productArea: string;
  urgency: 'critical' | 'high' | 'medium' | 'low';
}

export interface PainPoint {
  description: string;
  productArea: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  frequencyHint: string;
}

export interface TicketFeatureAnalysis {
  ticketId: string;
  subject: string | null;
  featureRequests: FeatureRequest[];
  painPoints: PainPoint[];
  recurringThemes: string[];
  productAreas: string[];
  frustrationLevel: 'very_high' | 'high' | 'moderate' | 'low' | 'none';
  summary: string;
  confidence: number;
}

export type AnalyzeFeatureResult =
  | { success: true; analysis: TicketFeatureAnalysis }
  | { success: false; error: string };

// --- System Prompt ---

const SYSTEM_PROMPT = `You are a product intelligence analyst for Opus Behavioral Health, a healthcare SaaS company that sells EHR (Electronic Health Records), RCM (Revenue Cycle Management), and Copilot AI products to behavioral health providers.

Your job is to analyze a support ticket conversation to extract feature requests, pain points, and product intelligence signals from a specific customer.

EXTRACTION GOALS:

1. FEATURE REQUESTS — things the customer wants that don't exist yet or need improvement:
   - EXPLICIT: Customer directly asks for a feature ("Can you add...", "We need...", "It would be great if...")
   - INFERRED: Customer describes a workflow that is painful or impossible, implying a feature need
   - For each, identify: product area, urgency, description

2. PAIN POINTS — things causing friction, frustration, or inefficiency:
   - Product bugs or reliability issues
   - Workflow bottlenecks
   - Missing functionality they have to work around
   - UX/usability problems
   - For each, identify: product area, severity, frequency hint, description

3. PRODUCT AREAS — map everything to these areas (use the closest match):
   - EHR (Electronic Health Records)
   - RCM (Revenue Cycle Management)
   - Copilot AI
   - Billing
   - Scheduling
   - Reporting / Analytics
   - Integrations
   - User Management / Permissions
   - Mobile App
   - Platform / Infrastructure
   - Onboarding / Training
   - Other

4. FRUSTRATION LEVEL — infer from the customer's tone and language:
   - very_high: Threatening to leave, extremely frustrated, multiple escalations
   - high: Clearly frustrated, expressing significant displeasure
   - moderate: Some frustration but still constructive
   - low: Minor inconvenience, generally positive
   - none: No frustration evident, purely informational

IMPORTANT GUIDELINES:
- If the ticket is purely operational (password reset, simple how-to) with no feature signals, return empty lists and set confidence low.
- Focus on the CUSTOMER'S perspective, not the support rep's.
- Be specific — quote or reference exact messages when possible.
- A single ticket may contain multiple feature requests and pain points.
- Distinguish between what the customer explicitly asked for vs. what you infer from their situation.

Respond in this EXACT format (every section is required):

FEATURE_REQUESTS:
[One per line, format: TYPE:explicit|inferred | AREA:product_area | URGENCY:critical|high|medium|low | DESC:description]
[If none, write: NONE]

PAIN_POINTS:
[One per line, format: AREA:product_area | SEVERITY:critical|high|medium|low | FREQ:frequency hint | DESC:description]
[If none, write: NONE]

RECURRING_THEMES:
[Comma-separated list of recurring themes/topics, or NONE]

PRODUCT_AREAS:
[Comma-separated list of product areas mentioned/affected]

FRUSTRATION_LEVEL: [very_high|high|moderate|low|none]

SUMMARY: [2-3 sentence summary of the product intelligence from this ticket]

CONFIDENCE: [0.00-1.00]`;

// --- Core Analysis Function ---

export async function analyzeTicketFeatures(
  ticketId: string,
  supabase: SupabaseClient
): Promise<AnalyzeFeatureResult> {
  const hsClient = getHubSpotClient();

  try {
    // 1. Fetch ticket metadata from support_tickets table
    const { data: ticket, error: ticketError } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('hubspot_ticket_id', ticketId)
      .single();

    if (ticketError || !ticket) {
      return { success: false, error: `Ticket not found in DB: ${ticketError?.message || ticketId}` };
    }

    // 2. Fetch conversation thread from HubSpot
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

    // 3. Fetch engagement timeline
    let engagementTimeline;
    try {
      engagementTimeline = await getTicketEngagementTimeline(ticketId);
    } catch (err) {
      console.warn(`Could not fetch engagement timeline for ticket ${ticketId}:`, err);
      engagementTimeline = { engagements: [], counts: { emails: 0, notes: 0, calls: 0, meetings: 0, total: 0 } };
    }

    // 4. Build conversation text
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

    // 5. Build engagement timeline text
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

    // 6. Build user prompt
    const userPrompt = `Analyze this support ticket for feature requests, pain points, and product intelligence:

TICKET METADATA:
- Subject: ${ticket.subject || 'N/A'}
- Source: ${ticket.source_type || 'N/A'}
- Priority: ${ticket.priority || 'N/A'}
- Status: ${ticket.is_closed ? 'Closed' : 'Open'}
- Software: ${ticket.software || 'N/A'}
- Ticket Type: ${ticket.ticket_type || 'N/A'}

COMPANY:
- Name: ${ticket.hs_primary_company_name || 'Unknown'}

CONVERSATION THREAD (${conversationMessages.length} messages):
${conversationText}

ENGAGEMENT TIMELINE (${engagementTimeline.engagements.length} items):
${engagementTimelineText}`;

    // 7. Call LLM
    const result = await generateText({
      model: getModel(),
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
    });

    // 8. Parse response
    const text = result.text;

    // Parse feature requests
    const featureRequests: FeatureRequest[] = [];
    const frSection = text.match(/FEATURE_REQUESTS:\s*([\s\S]*?)(?=\nPAIN_POINTS:)/i);
    if (frSection && !frSection[1].trim().startsWith('NONE')) {
      const lines = frSection[1].trim().split('\n').filter((l) => l.trim());
      for (const line of lines) {
        const typeM = line.match(/TYPE:\s*(explicit|inferred)/i);
        const areaM = line.match(/AREA:\s*([^|]+)/i);
        const urgM = line.match(/URGENCY:\s*(critical|high|medium|low)/i);
        const descM = line.match(/DESC:\s*(.+)/i);
        if (descM) {
          featureRequests.push({
            description: descM[1].trim(),
            type: (typeM?.[1]?.toLowerCase() as 'explicit' | 'inferred') || 'inferred',
            productArea: areaM?.[1]?.trim() || 'Other',
            urgency: (urgM?.[1]?.toLowerCase() as 'critical' | 'high' | 'medium' | 'low') || 'medium',
          });
        }
      }
    }

    // Parse pain points
    const painPoints: PainPoint[] = [];
    const ppSection = text.match(/PAIN_POINTS:\s*([\s\S]*?)(?=\nRECURRING_THEMES:)/i);
    if (ppSection && !ppSection[1].trim().startsWith('NONE')) {
      const lines = ppSection[1].trim().split('\n').filter((l) => l.trim());
      for (const line of lines) {
        const areaM = line.match(/AREA:\s*([^|]+)/i);
        const sevM = line.match(/SEVERITY:\s*(critical|high|medium|low)/i);
        const freqM = line.match(/FREQ:\s*([^|]+)/i);
        const descM = line.match(/DESC:\s*(.+)/i);
        if (descM) {
          painPoints.push({
            description: descM[1].trim(),
            productArea: areaM?.[1]?.trim() || 'Other',
            severity: (sevM?.[1]?.toLowerCase() as 'critical' | 'high' | 'medium' | 'low') || 'medium',
            frequencyHint: freqM?.[1]?.trim() || 'unknown',
          });
        }
      }
    }

    // Parse recurring themes
    const themesMatch = text.match(/RECURRING_THEMES:\s*(.+)/i);
    const recurringThemes = themesMatch && themesMatch[1].trim() !== 'NONE'
      ? themesMatch[1].split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    // Parse product areas
    const areasMatch = text.match(/PRODUCT_AREAS:\s*(.+)/i);
    const productAreas = areasMatch
      ? areasMatch[1].split(',').map((a) => a.trim()).filter(Boolean)
      : [];

    // Parse frustration level
    const frustrationMatch = text.match(/FRUSTRATION_LEVEL:\s*(very_high|high|moderate|low|none)/i);
    const frustrationLevel = (frustrationMatch?.[1]?.toLowerCase() as TicketFeatureAnalysis['frustrationLevel']) || 'low';

    // Parse summary
    const summaryMatch = text.match(/SUMMARY:\s*([\s\S]*?)(?=\nCONFIDENCE:)/i);
    const summary = summaryMatch?.[1]?.trim() || 'No product intelligence signals detected.';

    // Parse confidence
    const confMatch = text.match(/CONFIDENCE:\s*([\d.]+)/i);
    const confidence = confMatch ? Math.min(1, Math.max(0, parseFloat(confMatch[1]))) : 0.5;

    return {
      success: true,
      analysis: {
        ticketId,
        subject: ticket.subject || null,
        featureRequests,
        painPoints,
        recurringThemes,
        productAreas,
        frustrationLevel,
        summary,
        confidence,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
