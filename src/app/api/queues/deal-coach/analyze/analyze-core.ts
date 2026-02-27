import { createServerSupabaseClient } from '@/lib/supabase/client';
import { createServiceClient } from '@/lib/supabase/client';
import { getEmailsByDealId, getCallsByDealId, getMeetingsByDealId } from '@/lib/hubspot/engagements';
import { SALES_PIPELINE_STAGES } from '@/lib/hubspot/stage-config';
import { TRACKED_STAGES } from '@/lib/hubspot/stage-mappings';
import { getOutcomeLabel, formatCallDuration } from '@/lib/utils/call-outcomes';
import { generateText } from 'ai';
import { getModel } from '@/lib/ai/provider';
import { getCurrentQuarter, getQuarterFromDate } from '@/lib/utils/quarter';

// --- Types ---

export interface DealCoachAnalysis {
  hubspot_deal_id: string;
  status: 'needs_action' | 'on_track' | 'at_risk' | 'stalled' | 'no_action_needed' | 'nurture';
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

    // Compute quarter context for the prompt
    const currentQ = getCurrentQuarter();
    let closeQuarterLabel = 'Unknown';
    let closeQuarterRelation = '';
    if (deal.close_date) {
      const closeDate = new Date(deal.close_date);
      const closeQ = getQuarterFromDate(closeDate);
      closeQuarterLabel = closeQ.label;
      if (closeQ.year === currentQ.year && closeQ.quarter === currentQ.quarter) {
        closeQuarterRelation = 'THIS QUARTER';
      } else if (closeQ.year > currentQ.year || (closeQ.year === currentQ.year && closeQ.quarter > currentQ.quarter)) {
        closeQuarterRelation = 'FUTURE QUARTER';
      } else {
        closeQuarterRelation = 'PAST QUARTER';
      }
    }

    const PRE_DEMO_STAGE_IDS = new Set([
      SALES_PIPELINE_STAGES.MQL.id,
      SALES_PIPELINE_STAGES.SQL_DISCOVERY.id,
    ]);
    const isPreDemo = PRE_DEMO_STAGE_IDS.has(deal.deal_stage);

    const POST_DEMO_STAGE_IDS = new Set([
      SALES_PIPELINE_STAGES.DEMO_COMPLETED.id,
      SALES_PIPELINE_STAGES.QUALIFIED_VALIDATED.id,
      SALES_PIPELINE_STAGES.PROPOSAL_EVALUATING.id,
      SALES_PIPELINE_STAGES.MSA_SENT_REVIEW.id,
    ]);
    const isPostDemo = POST_DEMO_STAGE_IDS.has(deal.deal_stage);

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

    const postDemoCoachingBlock = isPostDemo ? `
POST-DEMO ENGAGEMENT COACHING (applies to this deal):
The demo has already happened. This deal is in the evaluation/negotiation phase. Do NOT recommend pre-demo tactics.

POST-DEMO TACTIC PALETTE — Choose from these relationship-maintenance and deal-progression tactics:
1. Monthly value-touch check-in — Deliver something valuable each time (industry insight, product update, relevant content). NEVER "just checking in."
2. Industry news / regulatory update sharing — Share news relevant to the buyer's organization or sector.
3. Product update / roadmap sharing — Share product updates or roadmap items relevant to the buyer's stated needs from the demo/discovery.
4. Case study (post-demo version) — Emphasize ROI, implementation timeline, and measurable outcomes from a similar organization. NOT an intro-level overview.
5. Stakeholder alignment meeting — Bring in additional decision-makers or influencers who weren't in the demo.
6. Executive sponsor introduction — Connect Opus leadership with buyer leadership for strategic alignment.
7. Reference call — Offer a call with an existing Opus customer of similar size, type, or use case.
8. Personalized gift / reciprocity play — Book, company swag, or thoughtful item for relationship-building (not demo incentive).
9. Dependency/integration progress check-in — Follow up on buyer's stated dependencies (e.g., "How's the HubSpot integration going?", "Any update on the budget approval?").
10. Webinar / event invitation — Invite the buyer to relevant Opus-hosted or industry events.

POST-DEMO TACTIC DETECTION — Scan the engagement timeline and notes for evidence of these tactics:
• Value check-in: "check-in", "touching base", "update for you", "thought you'd find this interesting"
• Industry news: "article", "news", "regulation", "compliance update", "industry report"
• Product update: "new feature", "roadmap", "product update", "release", "enhancement"
• Case study: "case study", "success story", "ROI", "implementation", "outcomes", "results"
• Stakeholder meeting: "stakeholder", "additional decision", "bring in", "multi-thread", "other contacts"
• Exec introduction: "executive", "leadership", "CEO", "VP introduction", "exec sponsor"
• Reference call: "reference", "customer call", "speak with", "similar organization"
• Gift: "gift", "book", "swag", "sent you something"
• Dependency check: "integration", "dependency", "HubSpot", "budget approval", "board", "timeline update"
• Event: "webinar", "event", "conference", "invitation"

CONSTRAINT: Do NOT recommend pre-demo tactics for post-demo deals. Specifically, do NOT recommend:
- Vidyard intro videos (the prospect already had a demo)
- Blind calendar invites for demos (they've already seen a demo)
- $50 gift card for demo attendance (demo already happened)
- Breakup emails (inappropriate for active post-demo deals unless truly stalled with no communication for 30+ days)
` : '';

    const systemPrompt = `You are a deal coaching AI for Opus Behavioral Health, a healthcare SaaS/EHR company.
You are evaluating a sales deal to provide actionable coaching recommendations for the Account Executive (AE).

Analyze the deal's current stage, communication history, buyer engagement, and deal momentum to produce a coaching assessment.

${stageGuidance}
${preDemoCoachingBlock}${postDemoCoachingBlock}
Assessment criteria for each output field:

STATUS:
- needs_action: AE must take a specific action immediately (e.g., send follow-up, schedule demo, send proposal)
- on_track: Deal is progressing normally, no intervention needed
- at_risk: Deal shows warning signs (long silence, missed close date, stalled progression). Must be CONTROLLABLE problems — if the delay is buyer-driven and the buyer is still engaged, use nurture instead.
- stalled: Deal has stopped moving — no recent activity, buyer gone silent. Distinct from nurture (buyer communicated timeline) and at_risk (controllable problems).
- no_action_needed: Deal is healthy and progressing, no coaching needed right now
- nurture: Buyer is engaged but timing is customer-driven. Use when ALL of these are true: (1) Buyer has communicated a future timeline (e.g., "end of summer", "after HubSpot integration", "Q3 budget cycle", "waiting on board approval"), (2) Close date is in a future quarter and was set there deliberately by the AE, (3) There is NO indication the buyer is disengaging — they're just not ready yet. Distinct from at_risk (controllable problems the AE can fix) and stalled (buyer went dark with no communicated timeline).

URGENCY:
- critical: Close date imminent or passed, deal at serious risk of loss, buyer disengaging
- high: Warning signs present, needs attention this week
- medium: Room for improvement but not urgent
- low: Minor suggestion, deal is healthy
- NURTURE-SPECIFIC: When status is nurture, urgency should be low (future quarter close) or medium (this quarter but buyer asked to delay). NEVER assign critical or high urgency to nurture deals.

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

QUARTER CONTEXT:
- If close date is in a FUTURE QUARTER: Timing delays are expected and normal. Do NOT auto-classify as at_risk just because the deal isn't progressing aggressively. A deal with a Q3 close date in nurture mode during Q1 is normal pipeline management. If the buyer communicated a future timeline, classify as nurture.
- If close date is THIS QUARTER: Urgency should be elevated. Timing delays are more concerning because the close window is shrinking. A nurture classification is still possible if the buyer explicitly asked to delay but the close date is still this quarter — use medium urgency in that case.
- If close date is PAST: Either truly delayed (at_risk) or the AE forgot to update the close date. Check engagement recency to determine which.

TOOL CONSTRAINT: Opus uses Vidyard for personalized video outreach. NEVER mention or recommend Loom. Always say "Vidyard" when recommending video outreach.

RECOMMENDED_ACTION FORMAT:
- Provide exactly TWO numbered recommendations — both must be prospect-facing outreach tactics (e.g., Vidyard video, social proof email with case study, blind calendar invite, gift card incentive, executive-to-executive outreach, breakup email, phone call, email, LinkedIn engagement, relevant content share). No internal/operational actions (like "review the deal" or "discuss with manager").
- Each recommendation is ONE CONCISE SENTENCE — the tactic name + brief context for why now. No scripts, no example wording, no "pull up their website", no step-by-step instructions.
- Put any prospect-specific context (competitor mentions, past conversations, pain points, talking points) into the REASONING field, NOT into the action lines.
- Format:
  1. [Primary tactic — one sentence]
  2. [Alternative tactic — one sentence]
- For very new deals (< ~7 days old) where the AE is actively working a standard outreach cadence and no escalation is warranted yet, respond with ONLY: "No action needed — allow AE to continue standard cadence." Do NOT manufacture recommendations for new deals that are being properly worked.
- NURTURE DEALS: When status is nurture, recommended actions should be LOW-EFFORT, RELATIONSHIP-MAINTENANCE tactics — NOT aggressive outreach. Appropriate nurture tactics: monthly value-touch check-in (deliver something each time, not "just checking in"), share industry news or regulatory updates, product update or roadmap sharing relevant to buyer's stated needs, check on their dependency/integration progress (e.g., "How's the HubSpot integration going?"), personalized gift (book, company swag — relationship-building), webinar or event invitation. Do NOT recommend pre-demo aggressive tactics (Vidyard intro videos, blind calendar invites for demos, demo gift card incentives, breakup emails) for nurture deals.

Respond in this exact format:
STATUS: [needs_action|on_track|at_risk|stalled|no_action_needed|nurture]
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
- Current Quarter: ${currentQ.label}${deal.close_date ? `\n- Deal Close Quarter: ${closeQuarterLabel} (${closeQuarterRelation})` : ''}

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
    const statusMatch = text.match(/STATUS:\s*(needs_action|on_track|at_risk|stalled|no_action_needed|nurture)/i);
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
PRIMARY GOAL: Maintain post-demo momentum and advance toward qualification/proposal.

SCENARIO A — Active Progression:
- Follow-up email sent within 24-48 hours of demo, buyer responded positively.
- Next steps were clearly defined (proposal, stakeholder meeting, pricing discussion).
- Buyer is actively engaged and asking questions.
- STATUS: on_track. Focus on ensuring the AE is executing agreed next steps.

SCENARIO B — Customer-Driven Timing Delay:
- Buyer communicated a future timeline after the demo (e.g., "we'll revisit end of summer", "waiting on internal approval", "depends on HubSpot integration").
- Last interaction was positive — buyer expressed interest but not urgency.
- AE set close date to a future quarter reflecting the buyer's stated timeline.
- STATUS: nurture. Recommend low-effort relationship maintenance (monthly value-touch, industry news, product updates, dependency check-in).

SCENARIO C — Going Dark Post-Demo:
- No buyer response after the demo despite AE follow-up attempts.
- Check the timeline: How many days since the demo? How many follow-up attempts?
- 0-7 days: Too early to worry — standard follow-up cadence. STATUS: on_track or needs_action (if no follow-up sent).
- 7-14 days: Buyer may be busy or evaluating. Recommend a value-touch or stakeholder alignment meeting. STATUS: needs_action.
- 14-28 days: Concerning silence. Recommend exec introduction, reference call, or direct ask about timeline. STATUS: at_risk.
- 28+ days: Buyer has likely gone dark. STATUS: stalled.

SCENARIO D — Objection or Competitive Risk:
- Buyer raised concerns during or after the demo (pricing, features, competition, implementation).
- STATUS: at_risk or needs_action depending on severity.
- Recommend: address objections directly, provide ROI analysis, offer reference call with similar customer, competitive differentiation.

TACTIC PRIORITIES: post-demo follow-up summary, case study (ROI-focused for similar org), stakeholder alignment meeting, executive sponsor introduction, reference call, dependency check-in.`,

    'Qualified/Validated': `STAGE CONTEXT — Qualified/Validated:
PRIMARY GOAL: Advance toward proposal. Budget, authority, need, and timeline should be confirmed or nearly confirmed.

SCENARIO A — Active Progression:
- Budget confirmed or discussed, decision-makers identified and engaged.
- AE has multi-threaded the deal (multiple contacts engaged).
- Proposal or pricing discussion is imminent.
- STATUS: on_track. Focus on proposal preparation and stakeholder alignment.

SCENARIO B — Customer-Driven Timing Delay:
- Buyer has communicated a specific future timeline (e.g., "end of summer", "after our HubSpot integration", "Q3 budget cycle", "waiting on board approval").
- AE moved close date to a future quarter to reflect the buyer's stated timeline.
- Last buyer interaction was positive — no signs of disengagement.
- The buyer is NOT ignoring the AE — they've communicated their timeline clearly.
- STATUS: nurture. This is NORMAL pipeline management, not a risk signal.
- Recommend: monthly value-touch check-in, share industry news, check on their dependency/integration progress, product updates relevant to their needs.
- URGENCY: low (future quarter) or medium (this quarter but buyer asked to delay).

SCENARIO C — Stalled at Validation:
- Budget unclear or not discussed after multiple conversations.
- Decision-maker not engaged or not identified.
- AE cannot get a pricing conversation started.
- STATUS: at_risk or needs_action depending on duration.
- Recommend: direct budget conversation, stakeholder alignment meeting, exec sponsor introduction to establish authority.

SCENARIO D — Competitive Threat:
- Buyer mentioned evaluating alternatives or has gone quiet after competitor engagement.
- STATUS: at_risk.
- Recommend: competitive differentiation, reference call, ROI analysis vs. alternatives, exec-to-exec outreach.

TACTIC PRIORITIES: proposal preparation, pricing discussion, multi-threading stakeholders, competitive differentiation, monthly nurture cadence (for timing delays), reference call, exec sponsor introduction.`,

    'Proposal/Evaluating': `STAGE CONTEXT — Proposal/Evaluating:
PRIMARY GOAL: Close the deal. Proposal should be sent and actively being evaluated.

SCENARIO A — Active Negotiation:
- Proposal sent, buyer is reviewing, asking questions, requesting modifications.
- Positive signals: buyer discussing implementation timeline, asking about onboarding.
- STATUS: on_track. Focus on responsiveness and objection handling.

SCENARIO B — Buyer Silence After Proposal:
- Proposal was sent but buyer has gone quiet.
- 0-7 days: Normal review time. STATUS: on_track.
- 7-14 days: Follow up with a value-touch or ask for feedback. STATUS: needs_action.
- 14-21 days: Concerning — recommend exec escalation or reference call. STATUS: at_risk.
- 21+ days: Likely stalled. STATUS: stalled. Recommend direct conversation about deal status.

SCENARIO C — Pricing/Scope Objections:
- Buyer pushed back on pricing, scope, or terms.
- STATUS: needs_action.
- Recommend: address objections with ROI analysis, adjust scope/pricing if appropriate, reference call to validate value.

SCENARIO D — Budget or Timing Hold:
- Buyer communicated a budget freeze, timing delay, or internal approval requirement (e.g., "waiting on new fiscal year", "board approval needed", "budget doesn't open until Q3").
- STATUS: nurture if timeline is communicated and buyer is still engaged.
- Recommend: monthly check-in, track their budget cycle, prepare for quick execution when budget opens.

TACTIC PRIORITIES: objection handling, ROI analysis, reference call, MSA preparation, close date confirmation, exec escalation for stalled proposals, competitive differentiation.`,

    'MSA Sent/Review': `STAGE CONTEXT — MSA Sent/Review:
PRIMARY GOAL: Get the contract signed. This deal is in the final stage before close.

SCENARIO A — Legal Review Progressing:
- MSA sent, buyer's legal team is reviewing, timeline is clear.
- Regular updates from the buyer on review progress.
- STATUS: on_track. Focus on maintaining momentum and being responsive to legal questions.

SCENARIO B — Redlines or Changes Requested:
- Buyer's legal team has sent back redlines or requested modifications.
- STATUS: needs_action.
- Recommend: prompt redline review, involve Opus legal, negotiate reasonable terms, set a resolution timeline.

SCENARIO C — Legal Review Stalled:
- MSA sent but no response from buyer's legal team.
- 0-7 days: Normal legal review time. STATUS: on_track.
- 7-14 days: Follow up with buyer contact to check on legal status. STATUS: needs_action.
- 14-21 days: Escalate — ask for direct legal contact, offer to join a call. STATUS: at_risk.
- 21+ days: Significant delay. STATUS: at_risk. Recommend exec-to-exec escalation to unblock.

SCENARIO D — Budget/Approval Hold:
- Contract is ready but waiting on final budget approval, board vote, or new fiscal year.
- Buyer has communicated the reason for delay and a timeline.
- STATUS: nurture. This is administrative delay, not disengagement.
- Recommend: monthly check-in on approval progress, prepare for rapid signature when approved, maintain relationship warmth.

TACTIC PRIORITIES: legal follow-up, redline resolution, signature timeline, exec escalation for procurement delays, dependency check-in for approval holds.`,
  };

  return guidance[stageName] || `STAGE CONTEXT — ${stageName}:
Evaluate the deal based on general sales best practices. Check engagement recency, buyer responsiveness, and deal progression.`;
}
