import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/client';
import { getEmailsByDealId, getCallsByDealId, getMeetingsByDealId } from '@/lib/hubspot/engagements';
import { SALES_PIPELINE_STAGES } from '@/lib/hubspot/stage-config';
import { TRACKED_STAGES } from '@/lib/hubspot/stage-mappings';
import { getOutcomeLabel, formatCallDuration } from '@/lib/utils/call-outcomes';
import { countCompliantCallDays, PPL_CALLS_PER_DAY } from '@/lib/utils/touch-counter';
import { generateText } from 'ai';
import { getModel } from '@/lib/ai/provider';
import { getCurrentQuarter } from '@/lib/utils/quarter';

// --- Types ---

export interface PreDemoCoachAnalysis {
  hubspot_deal_id: string;
  situation: string;
  next_action: string;
  follow_up: string | null;
  reasoning: string | null;
  confidence: number;
  call_count: number;
  email_count: number;
  meeting_count: number;
  note_count: number;
  is_ppl: boolean;
  ppl_compliance: number | null;
  ppl_compliant_days: number | null;
  ppl_total_days: number | null;
  deal_name: string | null;
  stage_name: string | null;
  days_in_stage: number | null;
  owner_id: string | null;
  owner_name: string | null;
  amount: number | null;
  lead_source: string | null;
  analyzed_at: string;
}

export type AnalyzeResult =
  | { success: true; analysis: PreDemoCoachAnalysis }
  | { success: false; error: string; details?: string; statusCode?: number };

// --- Stage ID to label map ---

const STAGE_LABEL_MAP = new Map(
  Object.values(SALES_PIPELINE_STAGES).map((s) => [s.id, s.label])
);

// --- Stage entry timestamp column mappings ---

const STAGE_ENTRY_COLUMNS: { dbColumn: string; label: string; stageId: string }[] =
  Object.values(TRACKED_STAGES).map((s) => ({
    dbColumn: s.dbColumn,
    label: s.label,
    stageId: s.id,
  }));

// --- Core Analysis Function ---

export async function analyzePreDemoDeal(dealId: string): Promise<AnalyzeResult> {
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

    for (const entry of STAGE_ENTRY_COLUMNS) {
      if (entry.stageId === deal.deal_stage && deal[entry.dbColumn]) {
        const enteredAt = new Date(deal[entry.dbColumn]);
        daysInStage = Math.floor((now.getTime() - enteredAt.getTime()) / (1000 * 60 * 60 * 24));
        break;
      }
    }

    // 6. Compute deal age
    const dealAgeDays = deal.hubspot_created_at
      ? Math.floor((now.getTime() - new Date(deal.hubspot_created_at).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    // 7. Build stage progression timeline
    const stageTimeline: string[] = [];
    for (const entry of STAGE_ENTRY_COLUMNS) {
      if (deal[entry.dbColumn]) {
        const date = new Date(deal[entry.dbColumn]);
        stageTimeline.push(
          `${entry.label}: ${date.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })}`
        );
      }
    }

    // 8. Build engagement timeline (merge all, sort chronologically oldest-first)
    interface TimelineEntry {
      type: string;
      timestamp: Date;
      lines: string[];
    }
    const timeline: TimelineEntry[] = [];

    for (const email of emails) {
      const ts = email.timestamp ? new Date(email.timestamp) : new Date(0);
      const lines: string[] = [
        `[EMAIL] ${ts.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`,
      ];
      if (email.subject) lines.push(`Subject: ${email.subject}`);
      if (email.direction === 'OUTGOING_EMAIL') {
        lines.push('Direction: OUTBOUND (sent by AE to buyer)');
      } else if (email.direction === 'INCOMING_EMAIL') {
        lines.push('Direction: INBOUND (from buyer/prospect to AE)');
      } else if (email.fromEmail) {
        const isAE = email.fromEmail.toLowerCase().endsWith('@opusbehavioral.com');
        lines.push(`Direction: ${isAE ? 'OUTBOUND (sent by AE to buyer)' : 'INBOUND (from buyer/prospect to AE)'}`);
      }
      if (email.fromEmail) lines.push(`From: ${email.fromEmail}`);
      if (email.body) lines.push(email.body.substring(0, 500));
      timeline.push({ type: 'email', timestamp: ts, lines });
    }

    for (const call of calls) {
      const ts = call.properties.hs_timestamp ? new Date(call.properties.hs_timestamp) : new Date(0);
      const lines: string[] = [
        `[CALL] ${ts.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`,
      ];
      if (call.properties.hs_call_title) lines.push(`Title: ${call.properties.hs_call_title}`);
      if (call.properties.hs_call_direction) {
        lines.push(`Direction: ${call.properties.hs_call_direction.toUpperCase()}`);
      }
      const durationMs = call.properties.hs_call_duration ? Number(call.properties.hs_call_duration) : null;
      lines.push(`Duration: ${formatCallDuration(durationMs)}`);
      const outcomeLabel = getOutcomeLabel(call.properties.hs_call_disposition);
      lines.push(`Outcome: ${outcomeLabel === 'Unknown' ? 'No outcome recorded' : outcomeLabel}`);
      if (call.properties.hs_call_body) lines.push(call.properties.hs_call_body.substring(0, 500));
      timeline.push({ type: 'call', timestamp: ts, lines });
    }

    for (const meeting of meetings) {
      const ts = meeting.properties.hs_timestamp ? new Date(meeting.properties.hs_timestamp) : new Date(0);
      const lines: string[] = [
        `[MEETING] ${ts.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`,
      ];
      if (meeting.properties.hs_meeting_title) lines.push(`Title: ${meeting.properties.hs_meeting_title}`);
      timeline.push({ type: 'meeting', timestamp: ts, lines });
    }

    for (const note of notes) {
      const ts = note.note_timestamp ? new Date(note.note_timestamp) : new Date(0);
      const lines: string[] = [
        `[NOTE] ${ts.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`,
      ];
      if (note.author_name) lines.push(`By: ${note.author_name}`);
      if (note.note_body) lines.push(note.note_body.substring(0, 500));
      timeline.push({ type: 'note', timestamp: ts, lines });
    }

    // Sort oldest first
    timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const engagementText =
      timeline.length > 0
        ? timeline.map((e) => e.lines.join('\n')).join('\n\n---\n\n')
        : 'No engagements found for this deal.';

    // 9. PPL compliance check
    const isPpl = !!(deal.lead_source && deal.lead_source.toLowerCase().includes('paid'));
    let pplCompliance: number | null = null;
    let pplCompliantDays: number | null = null;
    let pplTotalDays: number | null = null;
    let pplComplianceText = '';

    if (isPpl && deal.hubspot_created_at) {
      const createdAt = new Date(deal.hubspot_created_at);
      const daysSinceCreation = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
      const daysToCheck = Math.min(daysSinceCreation, 7);

      if (daysToCheck > 0) {
        const endDate = new Date(createdAt);
        endDate.setDate(endDate.getDate() + daysToCheck);

        const result = countCompliantCallDays(
          calls,
          createdAt,
          endDate,
          daysToCheck,
          deal.hubspot_created_at
        );

        pplCompliance = result.compliance;
        pplCompliantDays = result.compliantDays;
        pplTotalDays = result.totalDays;

        pplComplianceText = `
PPL CALL COMPLIANCE (2 calls/day requirement):
This is a Paid Lead deal. The ${PPL_CALLS_PER_DAY}-calls-per-day compliance requirement applies during the first 7 days.
- Compliant days: ${result.compliantDays} / ${result.totalDays} (${Math.round(result.compliance * 100)}%)
- Daily breakdown: ${result.dailyBreakdown.map((d) => `${d.date}: ${d.callCount} calls ${d.compliant ? '(compliant)' : '(non-compliant)'}`).join(', ')}
Factor this compliance data into your SITUATION assessment and NEXT_ACTION recommendation. If compliance is low, the primary recommendation should address increasing call volume.`;
      }
    }

    // 10. Build prompts
    const today = new Date().toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const currentQ = getCurrentQuarter();

    const systemPrompt = `You are a pre-demo sales coaching AI for Opus Behavioral Health, a healthcare SaaS/EHR company.
You are evaluating deals in the MQL or SQL/Discovery stage. The PRIMARY OBJECTIVE for every deal is getting the prospect to RESPOND and commit to a demo.

TIERED ESCALATION FRAMEWORK — Base your tactic recommendation on the GAP between the deal entering
this stage and the last INBOUND buyer activity (or lack thereof):

TIER 1 (Days 0-10): STANDARD OUTREACH
• Email + phone cadence (multi-channel)
• Share relevant content: news articles about the prospect's org, public regulatory updates, industry stats — activates reciprocity by providing value upfront without requiring Opus-branded assets
• LinkedIn engagement: comment on the prospect's posts, react to their content, send a connection request with a personalized note — builds familiarity. This is ALWAYS supplementary, never the sole tactic.

TIER 2 (Days 10-21): PERSONALIZED ESCALATION
• Vidyard personalized video — 60-90 sec face + screen video referencing something specific about the prospect's organization
• Social proof email with case study — share a case study from a similar behavioral health provider group (match on size, service type: residential, IOP, outpatient, CCBHC). Activates social proof.

TIER 3 (Days 21-35): AGGRESSIVE RE-ENGAGEMENT
• Blind calendar invite — put a 15-30 min meeting directly on the prospect's calendar
• $50 gift card incentive — offer a $50 Amazon gift card for attending a 15-min demo. Only for decision-maker-level contacts (Director+, VP, C-suite). Card delivered AFTER attendance.
• Executive-to-executive outreach — Opus leadership reaches out directly to the prospect's decision-maker.

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
• Both recommendations must be DIFFERENT prospect-facing outreach tactics.

NEW DEAL OVERRIDE — If the deal is < ~7 days old, the AE is actively working a standard outreach cadence (calls + emails happening), and no escalation is needed yet, the SITUATION should note the deal is being actively worked and NEXT_ACTION should say "No action needed — allow AE to continue standard cadence."

CHANNEL DIVERSITY — Flag if the AE is only using one outreach channel. Effective pre-demo outreach
uses a mix of: email, phone, video, LinkedIn/social, calendar invites, and value-first content. Count
the distinct channel types in the engagement timeline and call out any gaps.

INTERPRETING THE ENGAGEMENT TIMELINE:
- Emails with "Direction: OUTBOUND" were sent BY the AE to the buyer. These are AE outreach, NOT buyer responses.
- Emails with "Direction: INBOUND" were sent BY the buyer/prospect to the AE. Only these count as evidence of buyer engagement.
- Emails from @opusbehavioral.com addresses are always from the Opus sales team.
- Calls with "Outcome: Connected" indicate an actual conversation took place.
- Calls with "Outcome: No Answer", "Busy", "Left Voicemail", or "No outcome recorded" did NOT result in a conversation with the buyer.
- Short-duration calls (<30 seconds) with no "Connected" outcome almost certainly did not reach the buyer.
- CRITICAL: Do NOT cite outbound AE emails as buyer responses.
- When assessing the situation, focus on distinguishing between AE effort and actual buyer engagement.

TOOL CONSTRAINT: Opus uses Vidyard for personalized video outreach. NEVER mention or recommend Loom.

SPECIFICITY — Each recommendation should be ONE CONCISE SENTENCE naming the tactic and why now. Put prospect-specific context (competitor mentions, past conversations, pain points) into REASONING, not the action.

Respond in this exact format:
SITUATION: [One sentence describing where this deal stands — engagement level, time in stage, buyer responsiveness]
NEXT_ACTION: [Two numbered recommendations — both must be prospect-facing outreach tactics]
1. [Primary tactic — one sentence]
2. [Alternative tactic — one sentence]
FOLLOW_UP: [Recommended follow-up cadence and timing — when should AE check back, how frequently]
REASONING: [2-4 sentences explaining your assessment, including prospect-specific context from the engagement timeline]
CONFIDENCE: [0.00-1.00]`;

    const userPrompt = `Evaluate this pre-demo deal for coaching:

DEAL METADATA:
- Deal Name: ${deal.deal_name || 'N/A'}
- Amount: ${deal.amount ? `$${Number(deal.amount).toLocaleString()}` : 'N/A'}
- Stage: ${stageName}
- Days in Stage: ${daysInStage !== null ? daysInStage : 'Unknown'}
- Deal Age: ${dealAgeDays !== null ? `${dealAgeDays} days` : 'Unknown'}
- AE: ${ownerName || 'Unassigned'}
- Lead Source: ${deal.lead_source || 'N/A'}
- Products: ${deal.products || 'N/A'}
- Next Step: ${deal.next_step || 'N/A'}
- Today's Date: ${today}
- Current Quarter: ${currentQ.label}

STAGE PROGRESSION:
${stageTimeline.length > 0 ? stageTimeline.join('\n') : 'No stage progression data available.'}

ENGAGEMENT SUMMARY:
- Emails: ${emails.length}
- Calls: ${calls.length}
- Meetings: ${meetings.length}
- Notes: ${notes.length}
${pplComplianceText}

FULL ENGAGEMENT TIMELINE (${timeline.length} items):
${engagementText}`;

    // 11. Call LLM
    const result = await generateText({
      model: getModel(),
      system: systemPrompt,
      prompt: userPrompt,
    });

    // 12. Parse response
    const text = result.text;
    const situationMatch = text.match(/SITUATION:\s*(.+?)(?=\nNEXT_ACTION:|\n\n)/is);
    const actionMatch = text.match(/NEXT_ACTION:\s*(.+?)(?=\nFOLLOW_UP:|\n\n)/is);
    const followUpMatch = text.match(/FOLLOW_UP:\s*(.+?)(?=\nREASONING:|\n\n)/is);
    const reasoningMatch = text.match(/REASONING:\s*(.+?)(?=\nCONFIDENCE:|\n\n|$)/is);
    const confidenceMatch = text.match(/CONFIDENCE:\s*([\d.]+)/i);

    const situation = situationMatch ? situationMatch[1].trim() : 'Analysis completed — review engagement timeline.';
    const nextAction = actionMatch ? actionMatch[1].trim() : 'Review deal status and engagement history.';
    const followUp = followUpMatch ? followUpMatch[1].trim() : null;
    const reasoning = reasoningMatch ? reasoningMatch[1].trim() : null;
    const confidence = confidenceMatch
      ? Math.min(1, Math.max(0, parseFloat(confidenceMatch[1])))
      : 0.5;

    // 13. Upsert into pre_demo_coach_analyses
    const analysisData = {
      hubspot_deal_id: dealId,
      situation,
      next_action: nextAction,
      follow_up: followUp,
      reasoning,
      confidence,
      call_count: calls.length,
      email_count: emails.length,
      meeting_count: meetings.length,
      note_count: notes.length,
      is_ppl: isPpl,
      ppl_compliance: pplCompliance,
      ppl_compliant_days: pplCompliantDays,
      ppl_total_days: pplTotalDays,
      deal_name: deal.deal_name,
      stage_name: stageName,
      days_in_stage: daysInStage,
      owner_id: deal.owner_id,
      owner_name: ownerName,
      amount: deal.amount ? Number(deal.amount) : null,
      lead_source: deal.lead_source,
      analyzed_at: new Date().toISOString(),
    };

    const { error: upsertError } = await serviceClient
      .from('pre_demo_coach_analyses')
      .upsert(analysisData, { onConflict: 'hubspot_deal_id' });

    if (upsertError) {
      console.error('Error upserting pre-demo coach analysis:', upsertError);
    }

    return { success: true, analysis: analysisData };
  } catch (error) {
    console.error('Pre-demo coach analysis error:', error);
    return {
      success: false,
      error: 'Failed to analyze deal',
      details: error instanceof Error ? error.message : 'Unknown error',
      statusCode: 500,
    };
  }
}
