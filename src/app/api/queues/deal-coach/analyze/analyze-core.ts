import { createServerSupabaseClient } from '@/lib/supabase/client';
import { createServiceClient } from '@/lib/supabase/client';
import { getEmailsByDealId, getCallsByDealId, getMeetingsByDealId } from '@/lib/hubspot/engagements';
import { SALES_PIPELINE_STAGES } from '@/lib/hubspot/stage-config';
import { TRACKED_STAGES } from '@/lib/hubspot/stage-mappings';
import { getOutcomeLabel, formatCallDuration } from '@/lib/utils/call-outcomes';
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

export interface DealCoachAnalysis {
  hubspot_deal_id: string;
  status: 'needs_action' | 'on_track' | 'at_risk' | 'stalled' | 'no_action_needed';
  urgency: 'critical' | 'high' | 'medium' | 'low';
  buyer_sentiment: string | null;
  deal_momentum: string | null;
  recommended_action: string;
  reasoning: string;
  confidence: number;
  key_risk: string | null;
  deal_name: string | null;
  stage_name: string | null;
  days_in_stage: number | null;
  owner_id: string | null;
  owner_name: string | null;
  amount: number | null;
  close_date: string | null;
  email_count: number;
  call_count: number;
  meeting_count: number;
  note_count: number;
  analyzed_at: string;
}

export type AnalyzeResult = {
  success: true;
  analysis: DealCoachAnalysis;
} | {
  success: false;
  error: string;
  details?: string;
  statusCode?: number;
};

// --- Stage ID to label map ---

const STAGE_LABEL_MAP = new Map(
  Object.values(SALES_PIPELINE_STAGES).map((s) => [s.id, s.label])
);

// --- Stage entry timestamp column mappings ---

const STAGE_ENTRY_COLUMNS: { dbColumn: string; label: string; stageId: string }[] = Object.values(TRACKED_STAGES).map((s) => ({
  dbColumn: s.dbColumn,
  label: s.label,
  stageId: s.id,
}));

// --- Core Analysis Function ---

export async function analyzeDealCoach(dealId: string): Promise<AnalyzeResult> {
  const supabase = await createServerSupabaseClient();
  const serviceClient = createServiceClient();

  try {
    // 1. Fetch deal from Supabase
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('*')
      .eq('hubspot_deal_id', dealId)
      .single();

    if (dealError || !deal) {
      return {
        success: false,
        error: 'Deal not found',
        details: dealError?.message,
        statusCode: 404,
      };
    }

    // 2. Resolve stage name
    const stageName = STAGE_LABEL_MAP.get(deal.deal_stage) || deal.deal_stage || 'Unknown';

    // 3. Fetch owner name
    let ownerName: string | null = null;
    if (deal.owner_id) {
      const { data: owner } = await supabase
        .from('owners')
        .select('first_name, last_name')
        .eq('id', deal.owner_id)
        .single();

      if (owner) {
        ownerName = [owner.first_name, owner.last_name].filter(Boolean).join(' ') || null;
      }
    }

    // 4. Fetch engagements from HubSpot + cached notes from Supabase (in parallel)
    const [emails, calls, meetings, notesResult] = await Promise.all([
      getEmailsByDealId(dealId).catch(() => []),
      getCallsByDealId(dealId).catch(() => []),
      getMeetingsByDealId(dealId).catch(() => []),
      supabase
        .from('deal_notes')
        .select('note_body, note_timestamp, author_name')
        .eq('deal_id', deal.id)
        .order('note_timestamp', { ascending: false }),
    ]);

    const notes = notesResult.data || [];

    // 5. Compute days in current stage
    let daysInStage: number | null = null;
    const now = new Date();

    // Find the entry timestamp for the current stage
    for (const entry of STAGE_ENTRY_COLUMNS) {
      if (entry.stageId === deal.deal_stage && deal[entry.dbColumn]) {
        const enteredAt = new Date(deal[entry.dbColumn]);
        daysInStage = Math.floor((now.getTime() - enteredAt.getTime()) / (1000 * 60 * 60 * 24));
        break;
      }
    }

    // 6. Compute other context
    const daysUntilClose = deal.close_date
      ? Math.floor((new Date(deal.close_date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    const dealAgeDays = deal.hubspot_created_at
      ? Math.floor((now.getTime() - new Date(deal.hubspot_created_at).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    // 7. Build stage progression timeline
    const stageTimeline: string[] = [];
    for (const entry of STAGE_ENTRY_COLUMNS) {
      if (deal[entry.dbColumn]) {
        const date = new Date(deal[entry.dbColumn]);
        stageTimeline.push(`${entry.label}: ${date.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })}`);
      }
    }

    // 8. Build engagement timeline (merge all, sort chronologically oldest-first)
    interface TimelineEntry { type: string; timestamp: Date; lines: string[] }
    const timeline: TimelineEntry[] = [];

    for (const email of emails) {
      const ts = email.timestamp ? new Date(email.timestamp) : new Date(0);
      const lines: string[] = [`[EMAIL] ${ts.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`];
      if (email.subject) lines.push(`Subject: ${email.subject}`);
      // Resolve direction to clear labels so LLM knows who sent the email
      if (email.direction === 'OUTGOING_EMAIL') {
        lines.push('Direction: OUTBOUND (sent by AE to buyer)');
      } else if (email.direction === 'INCOMING_EMAIL') {
        lines.push('Direction: INBOUND (from buyer/prospect to AE)');
      } else if (email.fromEmail) {
        // Fallback: infer direction from sender domain
        const isAE = email.fromEmail.toLowerCase().endsWith('@opusbehavioral.com');
        lines.push(`Direction: ${isAE ? 'OUTBOUND (sent by AE to buyer)' : 'INBOUND (from buyer/prospect to AE)'}`);
      }
      if (email.fromEmail) lines.push(`From: ${email.fromEmail}`);
      if (email.body) lines.push(email.body.substring(0, 500));
      timeline.push({ type: 'email', timestamp: ts, lines });
    }

    for (const call of calls) {
      const ts = call.properties.hs_timestamp ? new Date(call.properties.hs_timestamp) : new Date(0);
      const lines: string[] = [`[CALL] ${ts.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`];
      if (call.properties.hs_call_title) lines.push(`Title: ${call.properties.hs_call_title}`);
      // Direction (INBOUND/OUTBOUND)
      if (call.properties.hs_call_direction) {
        lines.push(`Direction: ${call.properties.hs_call_direction.toUpperCase()}`);
      }
      // Duration: convert ms to readable format
      const durationMs = call.properties.hs_call_duration ? Number(call.properties.hs_call_duration) : null;
      lines.push(`Duration: ${formatCallDuration(durationMs)}`);
      // Outcome: always show, even when null, so LLM knows there's no data
      const outcomeLabel = getOutcomeLabel(call.properties.hs_call_disposition);
      lines.push(`Outcome: ${outcomeLabel === 'Unknown' ? 'No outcome recorded' : outcomeLabel}`);
      if (call.properties.hs_call_body) lines.push(call.properties.hs_call_body.substring(0, 500));
      timeline.push({ type: 'call', timestamp: ts, lines });
    }

    for (const meeting of meetings) {
      const ts = meeting.properties.hs_timestamp ? new Date(meeting.properties.hs_timestamp) : new Date(0);
      const lines: string[] = [`[MEETING] ${ts.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`];
      if (meeting.properties.hs_meeting_title) lines.push(`Title: ${meeting.properties.hs_meeting_title}`);
      timeline.push({ type: 'meeting', timestamp: ts, lines });
    }

    for (const note of notes) {
      const ts = note.note_timestamp ? new Date(note.note_timestamp) : new Date(0);
      const lines: string[] = [`[NOTE] ${ts.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`];
      if (note.author_name) lines.push(`By: ${note.author_name}`);
      if (note.note_body) lines.push(note.note_body.substring(0, 500));
      timeline.push({ type: 'note', timestamp: ts, lines });
    }

    // Sort oldest first
    timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const engagementText = timeline.length > 0
      ? timeline.map((e) => e.lines.join('\n')).join('\n\n---\n\n')
      : 'No engagements found for this deal.';

    // 9. Build prompts
    const today = new Date().toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const stageGuidance = getStageGuidance(stageName);

    const systemPrompt = `You are a deal coaching AI for Opus Behavioral Health, a healthcare SaaS/EHR company.
You are evaluating a sales deal to provide actionable coaching recommendations for the Account Executive (AE).

Analyze the deal's current stage, communication history, buyer engagement, and deal momentum to produce a coaching assessment.

${stageGuidance}

Assessment criteria for each output field:

STATUS:
- needs_action: AE must take a specific action immediately (e.g., send follow-up, schedule demo, send proposal)
- on_track: Deal is progressing normally, no intervention needed
- at_risk: Deal shows warning signs (long silence, missed close date, stalled progression)
- stalled: Deal has stopped moving — no recent activity, buyer gone silent
- no_action_needed: Deal is healthy and progressing, no coaching needed right now

URGENCY:
- critical: Close date imminent or passed, deal at serious risk of loss, buyer disengaging
- high: Warning signs present, needs attention this week
- medium: Room for improvement but not urgent
- low: Minor suggestion, deal is healthy

BUYER_SENTIMENT:
- positive: Buyer actively engaged, responsive, enthusiastic
- engaged: Buyer participating but not enthusiastic
- neutral: Buyer responsive but noncommittal
- unresponsive: Buyer not replying, going dark
- negative: Buyer pushing back, expressing concerns

DEAL_MOMENTUM:
- accelerating: Deal moving faster than typical, progressing through stages quickly
- steady: Normal pace, consistent engagement
- slowing: Gaps growing between interactions, pace declining
- stalled: No meaningful activity for an extended period

INTERPRETING THE ENGAGEMENT TIMELINE:
- Emails with "Direction: OUTBOUND" were sent BY the AE to the buyer. These are AE outreach, NOT buyer responses.
- Emails with "Direction: INBOUND" were sent BY the buyer/prospect to the AE. Only these count as evidence of buyer engagement.
- Emails from @opusbehavioral.com addresses are always from the Opus sales team.
- Calls with "Outcome: Connected" indicate an actual conversation took place.
- Calls with "Outcome: No Answer", "Busy", "Left Voicemail", or "No outcome recorded" did NOT result in a conversation with the buyer.
- Short-duration calls (<30 seconds) with no "Connected" outcome almost certainly did not reach the buyer.
- CRITICAL: Do NOT cite outbound AE emails as buyer responses. Do NOT assume calls resulted in conversations unless the outcome explicitly says "Connected".
- When assessing BUYER_SENTIMENT, focus exclusively on inbound activity from the buyer. Outbound AE activity shows AE effort, not buyer interest.

IMPORTANT: Your recommended action MUST be SPECIFIC and ACTIONABLE, referencing actual content from the engagement timeline. Bad: "Follow up with the buyer." Good: "Send a follow-up email referencing the pricing discussion from the Jan 15 call, addressing their concern about implementation timeline."

Respond in this exact format:
STATUS: [needs_action|on_track|at_risk|stalled|no_action_needed]
URGENCY: [critical|high|medium|low]
BUYER_SENTIMENT: [positive|engaged|neutral|unresponsive|negative]
DEAL_MOMENTUM: [accelerating|steady|slowing|stalled]
RECOMMENDED_ACTION: [specific action text]
REASONING: [2-3 sentences explaining your assessment]
KEY_RISK: [specific risk or "none"]
CONFIDENCE: [0.00-1.00]`;

    const userPrompt = `Evaluate this sales deal for coaching:

DEAL METADATA:
- Deal Name: ${deal.deal_name || 'N/A'}
- Amount: ${deal.amount ? `$${Number(deal.amount).toLocaleString()}` : 'N/A'}
- Stage: ${stageName}
- Days in Stage: ${daysInStage !== null ? daysInStage : 'Unknown'}
- Close Date: ${deal.close_date || 'N/A'}${daysUntilClose !== null ? ` (${daysUntilClose > 0 ? `${daysUntilClose} days away` : daysUntilClose === 0 ? 'TODAY' : `${Math.abs(daysUntilClose)} days overdue`})` : ''}
- Deal Age: ${dealAgeDays !== null ? `${dealAgeDays} days` : 'Unknown'}
- AE: ${ownerName || 'Unassigned'}
- Lead Source: ${deal.lead_source || 'N/A'}
- Products: ${deal.products || 'N/A'}
- Next Step: ${deal.next_step || 'N/A'}
- Substage: ${deal.deal_substage || 'N/A'}
- Today's Date: ${today}

STAGE PROGRESSION:
${stageTimeline.length > 0 ? stageTimeline.join('\n') : 'No stage progression data available.'}

ENGAGEMENT SUMMARY:
- Emails: ${emails.length}
- Calls: ${calls.length}
- Meetings: ${meetings.length}
- Notes: ${notes.length}

FULL ENGAGEMENT TIMELINE (${timeline.length} items):
${engagementText}`;

    // 10. Call LLM
    const anthropic = getAnthropicProvider();
    const result = await generateText({
      model: anthropic('claude-sonnet-4-20250514'),
      system: systemPrompt,
      prompt: userPrompt,
    });

    // 11. Parse response
    const text = result.text;
    const statusMatch = text.match(/STATUS:\s*(needs_action|on_track|at_risk|stalled|no_action_needed)/i);
    const urgencyMatch = text.match(/URGENCY:\s*(critical|high|medium|low)/i);
    const sentimentMatch = text.match(/BUYER_SENTIMENT:\s*(positive|engaged|neutral|unresponsive|negative)/i);
    const momentumMatch = text.match(/DEAL_MOMENTUM:\s*(accelerating|steady|slowing|stalled)/i);
    const actionMatch = text.match(/RECOMMENDED_ACTION:\s*(.+?)(?=\nREASONING:|\n\n|$)/is);
    const reasoningMatch = text.match(/REASONING:\s*(.+?)(?=\nKEY_RISK:|\n\n|$)/is);
    const riskMatch = text.match(/KEY_RISK:\s*(.+?)(?=\nCONFIDENCE:|\n\n|$)/is);
    const confidenceMatch = text.match(/CONFIDENCE:\s*([\d.]+)/i);

    const status = statusMatch ? statusMatch[1].toLowerCase() as DealCoachAnalysis['status'] : 'needs_action';
    const urgency = urgencyMatch ? urgencyMatch[1].toLowerCase() as DealCoachAnalysis['urgency'] : 'medium';
    const buyerSentiment = sentimentMatch ? sentimentMatch[1].toLowerCase() : null;
    const dealMomentum = momentumMatch ? momentumMatch[1].toLowerCase() : null;
    const recommendedAction = actionMatch ? actionMatch[1].trim() : 'Review deal status';
    const reasoning = reasoningMatch ? reasoningMatch[1].trim() : 'Analysis completed';
    const keyRiskRaw = riskMatch ? riskMatch[1].trim() : null;
    const keyRisk = keyRiskRaw && keyRiskRaw.toLowerCase() !== 'none' ? keyRiskRaw : null;
    const confidence = confidenceMatch
      ? Math.min(1, Math.max(0, parseFloat(confidenceMatch[1])))
      : 0.5;

    // 12. Upsert into deal_coach_analyses
    const analysisData = {
      hubspot_deal_id: dealId,
      status,
      urgency,
      buyer_sentiment: buyerSentiment,
      deal_momentum: dealMomentum,
      recommended_action: recommendedAction,
      reasoning,
      confidence,
      key_risk: keyRisk,
      deal_name: deal.deal_name,
      stage_name: stageName,
      days_in_stage: daysInStage,
      owner_id: deal.owner_id,
      owner_name: ownerName,
      amount: deal.amount ? Number(deal.amount) : null,
      close_date: deal.close_date,
      email_count: emails.length,
      call_count: calls.length,
      meeting_count: meetings.length,
      note_count: notes.length,
      analyzed_at: new Date().toISOString(),
    };

    const { error: upsertError } = await serviceClient
      .from('deal_coach_analyses')
      .upsert(analysisData, { onConflict: 'hubspot_deal_id' });

    if (upsertError) {
      console.error('Error upserting deal coach analysis:', upsertError);
    }

    const analysis: DealCoachAnalysis = {
      ...analysisData,
    };

    return { success: true, analysis };
  } catch (error) {
    console.error('Deal coach analysis error:', error);
    return {
      success: false,
      error: 'Failed to analyze deal',
      details: error instanceof Error ? error.message : 'Unknown error',
      statusCode: 500,
    };
  }
}

// --- Stage-specific coaching guidance ---

function getStageGuidance(stageName: string): string {
  const guidance: Record<string, string> = {
    'MQL': `STAGE CONTEXT — MQL (Marketing Qualified Lead):
Focus on qualification. Is this lead worth pursuing? Check if:
- The AE has made initial contact
- There's evidence of buyer interest (responded to outreach, downloaded content)
- Key qualifying info has been gathered (budget, authority, need, timeline)
Recommend: outreach if no contact, qualification call if initial contact made, progression to Discovery if qualified.`,

    'SQL/Discovery': `STAGE CONTEXT — SQL/Discovery:
Focus on discovery quality. Check if:
- The AE has conducted a proper discovery call
- Pain points and needs have been identified
- Decision-making process is understood
- A demo has been or should be scheduled
Recommend: discovery call if not done, demo scheduling if discovery is complete.`,

    'Demo - Scheduled': `STAGE CONTEXT — Demo Scheduled:
Focus on demo preparation. Check if:
- The demo is confirmed and approaching
- The AE has done pre-demo prep (understanding needs from discovery)
- Key stakeholders are invited
- The AE has sent prep materials or agenda
Recommend: confirmation email, stakeholder identification, pre-demo prep if not done.`,

    'Demo - Completed': `STAGE CONTEXT — Demo Completed:
Focus on post-demo momentum. Check if:
- Follow-up was sent after the demo
- Next steps were clearly defined
- Buyer showed positive signals during/after demo
- Proposal or evaluation phase is being set up
Recommend: immediate follow-up if not done, proposal preparation if buyer is engaged.`,

    'Qualified/Validated': `STAGE CONTEXT — Qualified/Validated:
Focus on deal validation and progression. Check if:
- Budget has been confirmed
- Decision maker engagement is strong
- Competitive landscape is understood
- Proposal or pricing discussion is imminent
Recommend: proposal preparation, pricing discussion, stakeholder alignment.`,

    'Proposal/Evaluating': `STAGE CONTEXT — Proposal/Evaluating:
Focus on closing momentum. Check if:
- Proposal has been sent and reviewed
- Buyer objections have been addressed
- Legal/procurement process has started
- Close date is realistic
Recommend: objection handling, MSA preparation, close date confirmation.`,

    'MSA Sent/Review': `STAGE CONTEXT — MSA Sent/Review:
Focus on contract execution. Check if:
- MSA has been sent and is being reviewed
- Legal review is progressing
- Any redlines or changes requested
- Signature timeline is clear
Recommend: follow-up on review status, address legal concerns, push for signature.`,
  };

  return guidance[stageName] || `STAGE CONTEXT — ${stageName}:
Evaluate the deal based on general sales best practices. Check engagement recency, buyer responsiveness, and deal progression.`;
}
