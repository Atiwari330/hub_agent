import { createServerSupabaseClient } from '@/lib/supabase/client';
import { createServiceClient } from '@/lib/supabase/client';
import { getEmailsByDealId, getCallsByDealId, getMeetingsByDealId } from '@/lib/hubspot/engagements';
import { SALES_PIPELINE_STAGES } from '@/lib/hubspot/stage-config';
import { TRACKED_STAGES } from '@/lib/hubspot/stage-mappings';
import { getOutcomeLabel, formatCallDuration } from '@/lib/utils/call-outcomes';
import { generateText } from 'ai';
import { getModel } from '@/lib/ai/provider';

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

    const PRE_DEMO_STAGE_IDS = new Set([
      SALES_PIPELINE_STAGES.MQL.id,
      SALES_PIPELINE_STAGES.SQL_DISCOVERY.id,
    ]);
    const isPreDemo = PRE_DEMO_STAGE_IDS.has(deal.deal_stage);

    const preDemoCoachingBlock = isPreDemo ? `
PRE-DEMO ENGAGEMENT COACHING (applies to this deal):
The PRIMARY OBJECTIVE for this deal is getting the prospect to RESPOND and commit to a demo.

TIERED ESCALATION FRAMEWORK — Base your tactic recommendation on the GAP between the deal entering
this stage and the last INBOUND buyer activity (or lack thereof):

TIER 1 (Days 0-10): STANDARD OUTREACH
• Email + phone cadence (multi-channel)
• Share relevant content: news articles about the prospect's org, public regulatory updates, industry stats — activates reciprocity by providing value upfront without requiring Opus-branded assets
• LinkedIn engagement: comment on the prospect's posts, react to their content, send a connection request with a personalized note — builds familiarity (Cialdini's liking principle). This is ALWAYS supplementary, never the sole tactic.

TIER 2 (Days 10-21): PERSONALIZED ESCALATION
• Vidyard personalized video — 60-90 sec face + screen video referencing something specific about the prospect's organization
• Social proof email with case study — share a case study from a similar behavioral health provider group (match on size, service type: residential, IOP, outpatient, CCBHC). Activates Cialdini's social proof ("similar others did this"). 93% of B2B buyers rate case studies as influential.

TIER 3 (Days 21-35): AGGRESSIVE RE-ENGAGEMENT
• Blind calendar invite — put a 15-30 min meeting directly on the prospect's calendar
• $50 gift card incentive — offer a $50 Amazon gift card for attending a 15-min demo. Only for decision-maker-level contacts (Director+, VP, C-suite). Card delivered AFTER attendance, not at booking. Research shows 145% increase in meeting acceptance with prepaid incentives (Cialdini's reciprocity).
• Executive-to-executive outreach — Opus leadership reaches out directly to the prospect's decision-maker. Warm intros are 5x more successful than cold outreach (Cialdini's authority principle).

TIER 4 (Days 35+): FINAL TACTIC
• Breakup email — a polite, final message giving the prospect an easy out. If no response, deprioritize.
• Before recommending breakup, check if the AE skipped any Tier 2 or Tier 3 tactics and recommend those first.

TACTIC DETECTION — Scan the engagement timeline and notes for evidence of these tactics:
• Video: "video", "vidyard", "recorded", "screen recording", "personalized video"
• Calendar invite: "calendar invite", "blind invite", "booked time", "putting time on your calendar"
• Breakup email: "breakup", "break-up", "final email", "closing the loop", "last attempt"
• Case study / social proof: "case study", "success story", "customer story", "similar organization", "reference"
• Gift card: "gift card", "amazon card", "incentive", "$50", "demo incentive"
• Executive outreach: "CEO outreach", "executive outreach", "exec-to-exec", "leadership outreach"
• LinkedIn: "linkedin", "social selling", "commented on", "connected on linkedin", "InMail"
• Relevant content: "article", "report", "news", "resource", "content share", "regulatory update"

TIER-BASED SEQUENCING LOGIC — always recommend from the appropriate tier based on days since last buyer response:
• Within each tier, pick the HIGHEST-IMPACT untried tactic as the primary recommendation.
• Tier 1: Default is email+phone. Relevant content sharing recommended for larger orgs or when AE has done zero value-add outreach. LinkedIn is always supplementary (second recommendation or REASONING mention, never primary).
• Tier 2: Vidyard is the primary tactic. Social proof email is the alternative — especially effective when the prospect engaged initially but then went silent (case study re-activates interest).
• Tier 3: Calendar invite is the default primary. Gift card for decision-maker-level contacts. Exec outreach for any stalled deal. Pick the best fit based on contact seniority and deal context.
• Tier 4: Breakup email, but ONLY after confirming Tier 2 and Tier 3 tactics were attempted. If skipped, recommend those first.
• Both recommendations must be DIFFERENT prospect-facing outreach tactics.

NEW DEAL OVERRIDE — If the deal is < ~7 days old, the AE is actively working a standard outreach cadence (calls + emails happening), and no escalation is needed yet, respond with "No action needed — allow AE to continue standard cadence." EXCEPTION: Even for new deals, you may suggest low-urgency content sharing or LinkedIn engagement as supplementary if the AE hasn't started those yet.

CHANNEL DIVERSITY — Flag if the AE is only using one outreach channel. Effective pre-demo outreach
uses a mix of: email, phone, video, LinkedIn/social, calendar invites, and value-first content. Count
the distinct channel types in the engagement timeline and call out any gaps.

SPECIFICITY IN RECOMMENDATIONS — For pre-demo deals, each RECOMMENDED_ACTION line should be ONE CONCISE SENTENCE naming the tactic and why now. Put any prospect-specific context (competitor mentions, past conversations, specific pain points, talking points) into the REASONING field, not the action. No scripts, no example wording, no step-by-step instructions in the action lines.
` : '';

    const systemPrompt = `You are a deal coaching AI for Opus Behavioral Health, a healthcare SaaS/EHR company.
You are evaluating a sales deal to provide actionable coaching recommendations for the Account Executive (AE).

Analyze the deal's current stage, communication history, buyer engagement, and deal momentum to produce a coaching assessment.

${stageGuidance}
${preDemoCoachingBlock}
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

TOOL CONSTRAINT: Opus uses Vidyard for personalized video outreach. NEVER mention or recommend Loom. Always say "Vidyard" when recommending video outreach.

RECOMMENDED_ACTION FORMAT:
- Provide exactly TWO numbered recommendations — both must be prospect-facing outreach tactics (e.g., Vidyard video, social proof email with case study, blind calendar invite, gift card incentive, executive-to-executive outreach, breakup email, phone call, email, LinkedIn engagement, relevant content share). No internal/operational actions (like "review the deal" or "discuss with manager").
- Each recommendation is ONE CONCISE SENTENCE — the tactic name + brief context for why now. No scripts, no example wording, no "pull up their website", no step-by-step instructions.
- Put any prospect-specific context (competitor mentions, past conversations, pain points, talking points) into the REASONING field, NOT into the action lines.
- Format:
  1. [Primary tactic — one sentence]
  2. [Alternative tactic — one sentence]
- For very new deals (< ~7 days old) where the AE is actively working a standard outreach cadence and no escalation is warranted yet, respond with ONLY: "No action needed — allow AE to continue standard cadence." Do NOT manufacture recommendations for new deals that are being properly worked.

Respond in this exact format:
STATUS: [needs_action|on_track|at_risk|stalled|no_action_needed]
URGENCY: [critical|high|medium|low]
BUYER_SENTIMENT: [positive|engaged|neutral|unresponsive|negative]
DEAL_MOMENTUM: [accelerating|steady|slowing|stalled]
RECOMMENDED_ACTION: [two numbered actions OR "No action needed" — see format above]
REASONING: [2-3 sentences explaining your assessment, including any prospect-specific context that informs the recommendations]
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
    const result = await generateText({
      model: getModel(),
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
PRIMARY GOAL: Get the prospect to RESPOND and commit to a demo.

ENGAGEMENT ESCALATION PLAYBOOK — base your recommendation on the time gap since the deal entered MQL and the buyer's response (or lack thereof):

WEEK 1 (Days 0-7) — TIER 1: STANDARD OUTREACH:
- Standard outreach cadence is expected: a mix of calls and emails.
- Check that the AE is using BOTH phone and email (not just one channel).
- Look for any INBOUND buyer response (reply email, returned call, form fill). If the buyer has responded, shift focus to qualification quality (see below).
- If no contact has been attempted yet, this is the primary issue — recommend immediate multi-channel outreach.
- RELEVANT CONTENT: Check if the AE has shared any value-add content — news articles about the prospect's organization, public regulatory updates affecting behavioral health, industry statistics. Scan for keywords: "article", "report", "news", "resource", "content share", "regulatory update". If not done, recommend as a low-effort way to add value and activate reciprocity early.
- LINKEDIN: Check if the AE has started LinkedIn engagement (connection request, commenting on prospect's posts, reacting to content). Scan for keywords: "linkedin", "social selling", "commented on", "connected on linkedin", "InMail". If not started, recommend as a supplementary tactic alongside standard outreach. LinkedIn is NEVER the primary recommendation — always supplementary.

WEEK 1.5-3 (Days 10-21, NO buyer response) — TIER 2: PERSONALIZED ESCALATION:
- PRIMARY TACTIC: Recommend a personalized video outreach (Vidyard).
- The AE should record a 60-90 second face + screen video: pull up the prospect's website, reference something specific about their organization, and deliver a concise pitch on how Opus addresses their likely pain point.
- Check if the AE has ALREADY sent a video by scanning engagement timeline and notes for keywords: "video", "vidyard", "recorded", "screen recording", "personalized video". If already done, acknowledge it and recommend the next tactic.
- ALTERNATIVE TACTIC: Social proof email with a case study from a similar behavioral health organization. Key matching criteria: similar size, similar service type (residential, IOP, outpatient, CCBHC). This is especially effective when the prospect engaged initially but then went silent — a case study can re-activate interest by showing what similar organizations achieved.
- Check if case study has been shared: scan for keywords "case study", "success story", "customer story", "similar organization", "reference".
- Also check: has the AE tried calling at different times of day? Has LinkedIn been used? Has relevant content been shared?

WEEK 3-5 (Days 21-35, STILL no buyer response) — TIER 3: AGGRESSIVE RE-ENGAGEMENT:
- PRIMARY TACTIC: Recommend a blind calendar invite.
- The AE should put a 15-30 minute meeting directly on the prospect's calendar with a clear, non-pushy title (e.g., "Quick intro — Opus + [Company]") and a brief note explaining why.
- Check if the AE has ALREADY tried this by scanning for keywords: "calendar invite", "blind invite", "booked time", "putting time on", "sent invite".
- ALTERNATIVE A — GIFT CARD INCENTIVE: Offer a $50 Amazon gift card for attending a 15-min demo. Only recommend for decision-maker-level contacts (Director+, VP, C-suite). Card is delivered AFTER attendance, not at booking. Check for keywords: "gift card", "amazon card", "incentive", "$50", "demo incentive".
- ALTERNATIVE B — EXECUTIVE-TO-EXECUTIVE OUTREACH: Opus leadership reaches out directly to the prospect's decision-maker. Warm intros carry authority and cut through noise. Check for keywords: "CEO outreach", "executive outreach", "exec-to-exec", "leadership outreach".
- If video AND calendar invite have both been tried, recommend gift card incentive or exec outreach before moving to breakup.

WEEK 5+ (Days 35+, NO buyer response at all) — TIER 4: FINAL TACTIC:
- Before recommending a breakup email, check if the AE skipped Tier 2 or Tier 3 tactics. If video, case study, calendar invite, gift card, or exec outreach haven't been tried, recommend those first.
- FINAL TACTIC: Send a breakup email — a polite, final message giving the prospect an easy out ("I don't want to keep bothering you..."). This often triggers a response from prospects who are interested but busy.
- If the breakup email gets no response, deprioritize the deal and flag for manager discussion.

CHANNEL DIVERSITY CHECK:
- Flag if the AE is stuck in a single channel (email-only or call-only outreach).
- Effective pre-demo outreach uses a MIX of: email, phone, video, LinkedIn/social, calendar invites, and value-first content.
- If you see 5+ outbound emails with zero calls (or vice versa), explicitly call this out.

IF THE BUYER IS RESPONDING:
- Shift focus to qualification quality: has the AE gathered BANT info (Budget, Authority, Need, Timeline)?
- Is the AE moving toward scheduling a discovery call or demo?
- Recommend progression to SQL/Discovery if basic qualification criteria are met.`,

    'SQL/Discovery': `STAGE CONTEXT — SQL/Discovery:
PRIMARY GOAL: Complete discovery AND get the prospect to commit to a demo.

This prospect has been qualified but hasn't committed to a demo yet. Two scenarios apply:

SCENARIO A — Discovery call has NOT happened yet:
Apply the same engagement escalation playbook as MQL, but with ADDED URGENCY since this lead was already qualified:

WEEK 1 (Days 0-7 in this stage) — TIER 1: STANDARD OUTREACH:
- Standard outreach to schedule the discovery call. Check for multi-channel approach (calls + emails).
- Look for any INBOUND buyer response.
- RELEVANT CONTENT: Check if the AE has shared value-add content (news articles about the prospect's org, regulatory updates, industry stats). Since this lead is qualified, content should be more targeted to likely pain points. Scan for keywords: "article", "report", "news", "resource", "content share", "regulatory update".
- LINKEDIN: Check for LinkedIn engagement — more appropriate here since the lead is qualified and likely researching solutions. Scan for keywords: "linkedin", "social selling", "commented on", "connected on linkedin", "InMail". Always supplementary, never the sole tactic.

WEEK 1.5-3 (Days 10-21, NO buyer response) — TIER 2: PERSONALIZED ESCALATION:
- PRIMARY TACTIC: Recommend personalized video outreach (Vidyard).
- The video should reference the qualifying info gathered during MQL and propose a specific discovery conversation topic.
- Check for existing video outreach: keywords "video", "vidyard", "recorded", "screen recording", "personalized video".
- ALTERNATIVE TACTIC: Social proof email with case study from a similar BH organization. Case studies should emphasize outcomes matching the prospect's likely pain points based on their org type and size. Scan for keywords: "case study", "success story", "customer story", "similar organization", "reference".

WEEK 3-5 (Days 21-35, STILL no buyer response) — TIER 3: AGGRESSIVE RE-ENGAGEMENT:
- PRIMARY TACTIC: Recommend blind calendar invite for a 15-30 min discovery call.
- Check for existing calendar tactics: keywords "calendar invite", "blind invite", "booked time", "putting time on", "sent invite".
- ALTERNATIVE A — GIFT CARD INCENTIVE: $50 Amazon gift card for attending a 15-min demo. Only for decision-maker-level contacts (Director+, VP, C-suite). Delivered after attendance. Check for keywords: "gift card", "amazon card", "incentive", "$50", "demo incentive".
- ALTERNATIVE B — EXECUTIVE-TO-EXECUTIVE OUTREACH: Opus leadership reaches out to prospect's decision-maker. A qualified lead going dark warrants authority-level intervention. Check for keywords: "CEO outreach", "executive outreach", "exec-to-exec", "leadership outreach".

WEEK 5+ (Days 35+, NO buyer response) — TIER 4: FINAL TACTIC:
- Before breakup, check if the AE skipped Tier 2 or Tier 3 tactics. If video, case study, calendar invite, gift card, or exec outreach haven't been tried, recommend those first. A qualified lead going dark for 5+ weeks is a serious red flag.
- FINAL TACTIC: Send a breakup email — a polite, final message giving the prospect an easy out.
- If the breakup email gets no response, deprioritize the deal and flag for manager discussion.

SCENARIO B — Discovery call WAS completed but prospect went silent:
This is MORE URGENT than Scenario A because the AE has already invested discovery time.
- Check: Were clear next steps (especially a demo) agreed upon during the discovery call?
- Check: Did the AE send a follow-up email summarizing the discovery call and proposing a demo?

COMPRESSED ESCALATION TIMELINE for post-discovery silence:
- Days 0-7 post-silence: Standard follow-up email/call + social proof email with case study matching the pain points identified during discovery. Scan for "case study", "success story", "customer story", "similar organization", "reference".
- Days 7-14 post-silence: Vidyard video leveraging specific pain points from discovery OR social proof email if video already sent. Also recommend LinkedIn engagement if not started.
- Days 14-21 post-silence: Blind calendar invite OR gift card incentive (for Director+ contacts) OR executive-to-executive outreach. Pick the highest-impact untried tactic based on contact seniority.
- Days 21+ post-silence: Breakup email — but only after confirming Tier 2 and Tier 3 tactics were attempted. If skipped, recommend those first.

CHANNEL DIVERSITY CHECK:
- Flag if the AE is stuck in a single channel (email-only or call-only outreach).
- Effective pre-demo outreach uses a MIX of: email, phone, video, LinkedIn/social, calendar invites, and value-first content.
- If you see 5+ outbound emails with zero calls (or vice versa), explicitly call this out.

IF DISCOVERY IS COMPLETE AND BUYER IS ENGAGED:
- Focus on demo scheduling: has a specific date/time been proposed?
- Check that the right stakeholders are being invited to the demo.
- Recommend progression to Demo Scheduled once confirmed.`,

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
