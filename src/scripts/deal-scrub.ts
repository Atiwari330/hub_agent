import { config } from 'dotenv';
config({ path: '.env.local' });

import { getDealsByOwnerId, getDealById, getDealWithNextStepHistory } from '../lib/hubspot/deals';
import { getOwnerByEmail, listAllOwners } from '../lib/hubspot/owners';
import { getStageNameMap, getAllPipelines } from '../lib/hubspot/pipelines';
import { SALES_PIPELINE_ID, TRACKED_STAGES } from '../lib/hubspot/stage-mappings';
import {
  getNotesByDealIdWithAuthor,
  getEmailsByDealId,
  getCallsByDealId,
  getMeetingsByDealId,
  getTasksByDealId,
} from '../lib/hubspot/engagements';
import { generateText } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import fs from 'fs';
import type { HubSpotDeal } from '../types/hubspot';
import type { HubSpotEmail, HubSpotCall, HubSpotMeeting, HubSpotTask } from '../lib/hubspot/engagements';
import type { HubSpotNoteWithAuthor } from '../types/exception-context';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

function getScrubModel() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY is not configured');
  const deepseek = createDeepSeek({ apiKey, baseURL: 'https://ai-gateway.vercel.sh/v1' });
  return deepseek('deepseek/deepseek-v3.2');
}

// ---------------------------------------------------------------------------
// Stage filter map
// ---------------------------------------------------------------------------

const STAGE_FILTER_MAP: Record<string, string[]> = {
  mql: [TRACKED_STAGES.MQL.id],
  discovery: [TRACKED_STAGES.DISCOVERY.id],
  'demo-scheduled': [TRACKED_STAGES.DEMO_SCHEDULED.id],
  'demo-completed': [TRACKED_STAGES.DEMO_COMPLETED.id],
  proposal: [TRACKED_STAGES.PROPOSAL.id],
  'closed-won': [TRACKED_STAGES.CLOSED_WON.id],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DealContext {
  deal: HubSpotDeal;
  dealId: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  stageId: string;
  closeDate: string | null;
  createDate: string | null;
  lastModified: string | null;
  nextStep: string | null;
  nextStepUpdatedAt: string | null;
  leadSource: string | null;
  products: string | null;
  substage: string | null;
  dealAgeDays: number;
  daysInCurrentStage: number | null;
  daysUntilClose: number | null;
  ownerName: string;
  notes: HubSpotNoteWithAuthor[];
  emails: HubSpotEmail[];
  calls: HubSpotCall[];
  meetings: HubSpotMeeting[];
  tasks: HubSpotTask[];
}

export interface ScrubResult {
  dealId: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  closeDate: string | null;
  dealAgeDays: number;
  daysInCurrentStage: number | null;
  daysUntilClose: number | null;
  ownerName: string;
  activityLevel: string;
  customerEngagement: string;
  aeEffort: string;
  dealMomentum: string;
  recommendation: string;
  recommendationRationale: string;
  executiveSummary: string;
  timeline: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const TIMELINE_SYSTEM_PROMPT = `You are analyzing a sales deal's full engagement history for a healthcare SaaS company (behavioral health EHR and RCM). Your job is to produce a clean, chronological timeline of ALL significant activities: calls, emails, meetings, notes, and tasks.

RULES:
- Every entry MUST include a date (YYYY-MM-DD).
- Merge all engagement types into ONE chronological sequence sorted by date.
- For emails, note: direction (inbound from prospect / outbound from AE), from whom, and a 1-sentence summary of substance. Flag if the email is a generic template vs. personalized outreach.
- For calls, note: duration, disposition (connected/no answer/voicemail/left message), and summary of what was discussed if notes exist. A 0-second or very short call with no notes likely means no answer.
- For meetings, note: title and whether it's in the future (upcoming) or past (completed) relative to today.
- For notes left by the AE, note: author and key content — these are the AE's internal deal notes.
- Flag gaps: if 5+ business days passed between events with no activity, explicitly note "--- GAP: ~X business days of silence ---"
- Note the QUALITY of interactions: Are emails substantive and personalized, or generic templates? Are calls connected with real conversations, or all voicemails? Is there evidence of two-way engagement?
- End with CURRENT_STATE and ENGAGEMENT_COUNT lines.

Today's date is ${new Date().toISOString().split('T')[0]}.

Output format:
TIMELINE:
[YYYY-MM-DD] <CALL|EMAIL|MEETING|NOTE|TASK> <description>
--- GAP: ~X business days ---
[YYYY-MM-DD] <type> <description>

CURRENT_STATE: <last activity date, type, who initiated, what happened>
ENGAGEMENT_COUNT: <X calls (Y connected), Z emails (W inbound responses), M meetings, N notes in last 30 days>`;

const HEALTH_SYSTEM_PROMPT = `You are a Chief Revenue Officer assessing the health of a sales deal for a healthcare SaaS company (behavioral health EHR and RCM). You will receive the deal's metadata and a reconstructed activity timeline.

Assess EXACTLY these four dimensions:

1. ACTIVITY_LEVEL — How actively is this deal being worked RIGHT NOW?
   - ACTIVE: Multiple touchpoints per week, consistent cadence of outreach
   - SLOWING: Activity has dropped off — was active but gaps of 7-14 days are emerging
   - STALE: No meaningful activity in 14-30 days
   - DEAD: No activity in 30+ days, or only automated/generic touches

2. CUSTOMER_ENGAGEMENT — How is the prospect actually responding?
   - ENGAGED: Responding to emails, attending meetings, asking questions, showing buying signals
   - LUKEWARM: Occasional responses but not driving forward, may be rescheduling or giving vague answers
   - UNRESPONSIVE: Multiple outreach attempts with no response in 14+ days
   - NO_CONTACT: No evidence of any two-way communication ever on this deal

3. AE_EFFORT — Quality and strategy of the AE's work on this deal
   - STRONG: Multi-channel outreach (calls + emails + meetings), personalized messaging, good follow-up cadence, creative approaches
   - ADEQUATE: Regular touches but could be more strategic or personalized
   - WEAK: Sporadic outreach, generic messaging, poor follow-up, single-channel only
   - ABSENT: No meaningful AE activity in recent history

4. DEAL_MOMENTUM — Is this deal progressing toward close?
   - ADVANCING: Recently moved to a later stage, demos completed, proposals sent, clear forward motion
   - FLAT: Stuck in current stage with no progression signals, same status for weeks
   - DECLINING: Missed close date, rescheduled demos, going backwards, or close date pushed repeatedly

CRITICAL: Base your assessment on EVIDENCE from the timeline. Don't guess — if the timeline shows 3 voicemails and 2 unanswered emails, that's UNRESPONSIVE, not LUKEWARM. If there's been zero activity in 40 days, that's DEAD, not STALE.

Output EXACTLY:
ACTIVITY_LEVEL: <value>
CUSTOMER_ENGAGEMENT: <value>
AE_EFFORT: <value>
DEAL_MOMENTUM: <value>
RATIONALE: <2-3 sentences explaining the key signals you observed>`;

const RECOMMENDATION_SYSTEM_PROMPT = `You are a CRO making a pipeline hygiene decision on a healthcare SaaS deal. Given the deal's health assessment, timeline, and metadata, produce ONE recommendation.

Choose EXACTLY ONE:
- KEEP_WORKING — Deal has real momentum. There is evidence of customer engagement AND forward stage progression. The AE should continue the current approach.
- CHANGE_APPROACH — Deal is alive (some engagement exists) but the current strategy isn't working. Be SPECIFIC about what to change: different stakeholder to target, different value prop, different channel, need to multi-thread into the account, bring in a clinical champion, etc.
- ESCALATE — Deal needs executive involvement or additional resources. The amount or strategic value justifies the investment. Specify what kind of escalation: CRO intro, executive sponsor call, clinical reference, on-site visit, etc.
- MOVE_TO_NURTURE — Prospect isn't ready to buy now but isn't dead. Evidence: they were engaged at one point but went quiet, or explicitly said "not now" or "next quarter." Park in automated nurture sequence, set a 90-day re-engagement checkpoint.
- CLOSE_OUT — Deal is dead. Stop investing time. Evidence: no response after 5+ attempts over 30+ days, contact left company, deal is 2x past close date with no activity, or the company is clearly not a fit.

RULES:
- Consider deal AMOUNT: a $200K deal at risk deserves more aggressive action (ESCALATE) than a $15K deal (CLOSE_OUT faster).
- Consider CLOSE DATE: past-due close dates with no recent activity are strong CLOSE_OUT or MOVE_TO_NURTURE signals.
- Consider STAGE: early-stage deals (MQL/Discovery) with no activity should CLOSE_OUT faster. Late-stage deals (Demo Completed/Proposal) with some engagement deserve more patience.
- Consider DEAL AGE vs stage: a deal that's been in MQL for 90 days with no progression is very different from a deal in Proposal stage for 90 days with active negotiation.
- Be SPECIFIC in your rationale — reference dates, engagement counts, and patterns from the timeline.

Output EXACTLY:
RECOMMENDATION: <one of the five values above>
RATIONALE: <2-4 sentences with specific evidence from the timeline and deal data>`;

const EXECUTIVE_SUMMARY_SYSTEM_PROMPT = `Write a 2-3 sentence executive summary of this sales deal that a CRO can scan in 5 seconds during a pipeline review.

Include: the ONE key signal (positive or negative), the deal's trajectory, and the "so what" (what needs to happen or why it matters to revenue).

Do NOT repeat the deal name, amount, or stage — those are displayed separately.
Do NOT use bullet points or headers. Write in plain, direct sentences.
Be blunt. "This deal is dead" is better than "This deal may benefit from re-evaluation."

Output ONLY the summary text, nothing else.`;

// ---------------------------------------------------------------------------
// Context gathering
// ---------------------------------------------------------------------------

async function gatherDealContext(
  deal: HubSpotDeal,
  stageNameMap: Map<string, string>,
  ownerMap: Map<string, string>,
  ownerName: string
): Promise<DealContext> {
  const [nextStepData, notes, emails, calls, meetings, tasks] = await Promise.all([
    getDealWithNextStepHistory(deal.id).catch(() => null),
    getNotesByDealIdWithAuthor(deal.id, ownerMap),
    getEmailsByDealId(deal.id),
    getCallsByDealId(deal.id),
    getMeetingsByDealId(deal.id),
    getTasksByDealId(deal.id),
  ]);

  const props = deal.properties;
  const stageId = props.dealstage || '';
  const stageName = stageNameMap.get(stageId) || stageId;
  const createDate = props.createdate || null;
  const closeDate = props.closedate || null;
  const now = new Date();

  // Deal age
  const dealAgeDays = createDate
    ? Math.floor((now.getTime() - new Date(createDate).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // Days in current stage — find the matching TRACKED_STAGES entry
  let daysInCurrentStage: number | null = null;
  for (const stage of Object.values(TRACKED_STAGES)) {
    if (stage.id === stageId) {
      const enteredAt = props[stage.property as keyof typeof props] as string | null | undefined;
      if (enteredAt) {
        daysInCurrentStage = Math.floor(
          (now.getTime() - new Date(enteredAt).getTime()) / (1000 * 60 * 60 * 24)
        );
      }
      break;
    }
  }

  // Days until close
  let daysUntilClose: number | null = null;
  if (closeDate) {
    daysUntilClose = Math.floor(
      (new Date(closeDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
  }

  return {
    deal,
    dealId: deal.id,
    dealName: props.dealname || 'Unnamed Deal',
    amount: props.amount ? parseFloat(props.amount) : null,
    stageName,
    stageId,
    closeDate,
    createDate,
    lastModified: props.hs_lastmodifieddate || null,
    nextStep: nextStepData?.nextStepValue || props.hs_next_step || null,
    nextStepUpdatedAt: nextStepData?.nextStepUpdatedAt || null,
    leadSource: props.lead_source || null,
    products: props.product_s || null,
    substage: props.proposal_stage || null,
    dealAgeDays,
    daysInCurrentStage,
    daysUntilClose,
    ownerName,
    notes,
    emails,
    calls,
    meetings,
    tasks,
  };
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function formatCurrency(amount: number | null): string {
  if (amount === null) return 'Not set';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

function truncate(text: string | null | undefined, maxLen: number): string {
  if (!text) return '';
  // Strip HTML tags
  const clean = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen) + '...';
}

function buildDealMetadataSection(ctx: DealContext): string {
  const closeDateStatus = ctx.daysUntilClose !== null
    ? ctx.daysUntilClose < 0
      ? `(${Math.abs(ctx.daysUntilClose)} days PAST DUE)`
      : `(in ${ctx.daysUntilClose} days)`
    : '';

  return `DEAL METADATA:
- Deal Name: ${ctx.dealName}
- Amount: ${formatCurrency(ctx.amount)}
- Stage: ${ctx.stageName}
- Close Date: ${ctx.closeDate || 'Not set'} ${closeDateStatus}
- Deal Age: ${ctx.dealAgeDays} days (created ${ctx.createDate?.split('T')[0] || 'unknown'})
- Days in Current Stage: ${ctx.daysInCurrentStage !== null ? ctx.daysInCurrentStage : 'Unknown'}
- AE: ${ctx.ownerName}
- Next Step: ${ctx.nextStep || 'Not set'}${ctx.nextStepUpdatedAt ? ` (last updated: ${String(ctx.nextStepUpdatedAt).split('T')[0]})` : ''}
- Lead Source: ${ctx.leadSource || 'Unknown'}
- Products: ${ctx.products || 'Not set'}
- Substage: ${ctx.substage || 'N/A'}
- Last Modified: ${ctx.lastModified?.split('T')[0] || 'Unknown'}`;
}

function buildEngagementSection(ctx: DealContext): string {
  let section = '';

  // Notes
  if (ctx.notes.length > 0) {
    section += `\n\nAE NOTES (${ctx.notes.length}):`;
    for (const note of ctx.notes) {
      const date = note.properties.hs_timestamp?.split('T')[0] || 'unknown';
      const author = note.authorName || 'Unknown';
      const body = truncate(note.properties.hs_note_body, 500);
      section += `\n[${date}] by ${author}: ${body}`;
    }
  } else {
    section += '\n\nAE NOTES: None';
  }

  // Emails
  if (ctx.emails.length > 0) {
    section += `\n\nEMAILS (${ctx.emails.length}):`;
    for (const email of ctx.emails) {
      const date = email.timestamp?.split('T')[0] || 'unknown';
      const dir = email.direction === 'INCOMING_EMAIL' ? 'INBOUND' : 'OUTBOUND';
      const from = email.fromEmail || 'unknown';
      const subject = email.subject || 'No subject';
      const body = truncate(email.body, 300);
      section += `\n[${date}] ${dir} from ${from} — "${subject}"`;
      if (body) section += `\n  ${body}`;
    }
  } else {
    section += '\n\nEMAILS: None';
  }

  // Calls
  if (ctx.calls.length > 0) {
    section += `\n\nCALLS (${ctx.calls.length}):`;
    for (const call of ctx.calls) {
      const date = call.properties.hs_timestamp?.split('T')[0] || 'unknown';
      const dir = call.properties.hs_call_direction || 'unknown';
      const duration = call.properties.hs_call_duration
        ? `${Math.round(parseInt(call.properties.hs_call_duration, 10) / 1000)}s`
        : 'unknown duration';
      const disposition = call.properties.hs_call_disposition || 'unknown';
      const title = call.properties.hs_call_title || '';
      const body = truncate(call.properties.hs_call_body, 300);
      section += `\n[${date}] ${dir} call — ${duration}, disposition: ${disposition}${title ? `, "${title}"` : ''}`;
      if (body) section += `\n  ${body}`;
    }
  } else {
    section += '\n\nCALLS: None';
  }

  // Meetings
  if (ctx.meetings.length > 0) {
    section += `\n\nMEETINGS (${ctx.meetings.length}):`;
    const today = new Date();
    for (const meeting of ctx.meetings) {
      const occurrenceDate = meeting.properties.hs_timestamp?.split('T')[0] || 'unknown';
      const bookedDate = meeting.properties.hs_createdate?.split('T')[0] || 'unknown';
      const title = meeting.properties.hs_meeting_title || 'Untitled';
      const isFuture = meeting.properties.hs_timestamp
        ? new Date(meeting.properties.hs_timestamp) > today
        : false;
      section += `\n[${occurrenceDate}] "${title}" (booked ${bookedDate}) — ${isFuture ? 'UPCOMING' : 'COMPLETED'}`;
    }
  } else {
    section += '\n\nMEETINGS: None';
  }

  // Tasks
  if (ctx.tasks.length > 0) {
    section += `\n\nTASKS (${ctx.tasks.length}):`;
    for (const task of ctx.tasks) {
      const dueDate = task.properties.hs_timestamp?.split('T')[0] || 'unknown';
      const status = task.properties.hs_task_status || 'unknown';
      const subject = task.properties.hs_task_subject || 'Untitled';
      section += `\n[due ${dueDate}] "${subject}" — ${status}`;
    }
  } else {
    section += '\n\nTASKS: None';
  }

  return section;
}

function buildTimelineUserPrompt(ctx: DealContext): string {
  let prompt = buildDealMetadataSection(ctx);
  prompt += buildEngagementSection(ctx);
  return prompt;
}

function buildHealthUserPrompt(ctx: DealContext, timeline: string): string {
  let prompt = buildDealMetadataSection(ctx);
  prompt += `\n\nRECONSTRUCTED ACTIVITY TIMELINE:\n${timeline}`;
  return prompt;
}

function buildRecommendationUserPrompt(ctx: DealContext, timeline: string, healthText: string): string {
  let prompt = buildDealMetadataSection(ctx);
  prompt += `\n\nHEALTH ASSESSMENT:\n${healthText}`;
  prompt += `\n\nRECONSTRUCTED ACTIVITY TIMELINE:\n${timeline}`;
  return prompt;
}

function buildExecSummaryUserPrompt(
  ctx: DealContext,
  timeline: string,
  healthText: string,
  recommendationText: string
): string {
  let prompt = buildDealMetadataSection(ctx);
  prompt += `\n\nHEALTH ASSESSMENT:\n${healthText}`;
  prompt += `\n\nRECOMMENDATION:\n${recommendationText}`;
  prompt += `\n\nACTIVITY TIMELINE:\n${timeline}`;
  return prompt;
}

// ---------------------------------------------------------------------------
// Result parsers
// ---------------------------------------------------------------------------

function parseHealthResult(text: string) {
  const activityMatch = text.match(/ACTIVITY_LEVEL:\s*(.+)/i);
  const engagementMatch = text.match(/CUSTOMER_ENGAGEMENT:\s*(.+)/i);
  const effortMatch = text.match(/AE_EFFORT:\s*(.+)/i);
  const momentumMatch = text.match(/DEAL_MOMENTUM:\s*(.+)/i);
  const rationaleMatch = text.match(/RATIONALE:\s*([\s\S]+?)$/i);
  return {
    activityLevel: activityMatch?.[1]?.trim() || 'UNKNOWN',
    customerEngagement: engagementMatch?.[1]?.trim() || 'UNKNOWN',
    aeEffort: effortMatch?.[1]?.trim() || 'UNKNOWN',
    dealMomentum: momentumMatch?.[1]?.trim() || 'UNKNOWN',
    healthRationale: rationaleMatch?.[1]?.trim() || 'Could not determine health.',
  };
}

function parseRecommendationResult(text: string) {
  const recMatch = text.match(/RECOMMENDATION:\s*(.+)/i);
  const rationaleMatch = text.match(/RATIONALE:\s*([\s\S]+?)$/i);
  return {
    recommendation: recMatch?.[1]?.trim() || 'UNKNOWN',
    rationale: rationaleMatch?.[1]?.trim() || 'Review deal manually.',
  };
}

// ---------------------------------------------------------------------------
// Per-deal scrub
// ---------------------------------------------------------------------------

export async function scrubDeal(
  deal: HubSpotDeal,
  stageNameMap: Map<string, string>,
  ownerMap: Map<string, string>,
  ownerName: string
): Promise<ScrubResult> {
  const model = getScrubModel();
  const ctx = await gatherDealContext(deal, stageNameMap, ownerMap, ownerName);

  // Pass 1: Activity Timeline
  const timelineResult = await generateText({
    model,
    system: TIMELINE_SYSTEM_PROMPT,
    prompt: buildTimelineUserPrompt(ctx),
  });
  const timeline = timelineResult.text;

  // Pass 2: Deal Health Assessment
  const healthResult = await generateText({
    model,
    system: HEALTH_SYSTEM_PROMPT,
    prompt: buildHealthUserPrompt(ctx, timeline),
  });
  const healthText = healthResult.text;
  const { activityLevel, customerEngagement, aeEffort, dealMomentum } = parseHealthResult(healthText);

  // Pass 3: Recommendation
  const recResult = await generateText({
    model,
    system: RECOMMENDATION_SYSTEM_PROMPT,
    prompt: buildRecommendationUserPrompt(ctx, timeline, healthText),
  });
  const recText = recResult.text;
  const { recommendation, rationale } = parseRecommendationResult(recText);

  // Pass 4: Executive Summary
  const execResult = await generateText({
    model,
    system: EXECUTIVE_SUMMARY_SYSTEM_PROMPT,
    prompt: buildExecSummaryUserPrompt(ctx, timeline, healthText, recText),
  });
  const executiveSummary = execResult.text.trim();

  return {
    dealId: ctx.dealId,
    dealName: ctx.dealName,
    amount: ctx.amount,
    stageName: ctx.stageName,
    closeDate: ctx.closeDate,
    dealAgeDays: ctx.dealAgeDays,
    daysInCurrentStage: ctx.daysInCurrentStage,
    daysUntilClose: ctx.daysUntilClose,
    ownerName: ctx.ownerName,
    activityLevel,
    customerEngagement,
    aeEffort,
    dealMomentum,
    recommendation,
    recommendationRationale: rationale,
    executiveSummary,
    timeline,
  };
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

export async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

export const RECOMMENDATION_DISPLAY: Record<string, string> = {
  CLOSE_OUT: 'Close Out',
  MOVE_TO_NURTURE: 'Move to Nurture',
  CHANGE_APPROACH: 'Change Approach',
  ESCALATE: 'Escalate',
  KEEP_WORKING: 'Keep Working',
  UNKNOWN: 'Unknown',
};

export const RECOMMENDATION_ORDER = [
  'CLOSE_OUT',
  'MOVE_TO_NURTURE',
  'CHANGE_APPROACH',
  'ESCALATE',
  'KEEP_WORKING',
  'UNKNOWN',
];

export function formatReport(
  results: ScrubResult[],
  ownerName: string,
  filters: string,
  verbose: boolean
): string {
  const today = new Date().toISOString().split('T')[0];
  const successes = results.filter((r) => !r.error);
  const failures = results.filter((r) => r.error);

  // Summary stats
  const totalValue = successes.reduce((sum, r) => sum + (r.amount || 0), 0);
  const recCounts: Record<string, { count: number; value: number }> = {};
  for (const r of successes) {
    if (!recCounts[r.recommendation]) recCounts[r.recommendation] = { count: 0, value: 0 };
    recCounts[r.recommendation].count++;
    recCounts[r.recommendation].value += r.amount || 0;
  }

  const atRiskValue =
    (recCounts['CLOSE_OUT']?.value || 0) + (recCounts['MOVE_TO_NURTURE']?.value || 0);

  let report = `# Deal Scrub Report — ${today}\n\n`;
  report += `**AE:** ${ownerName} | **Filters:** ${filters}\n\n`;

  report += `## Executive Summary\n`;
  report += `- **${results.length}** deals analyzed`;
  if (failures.length > 0) report += ` (${failures.length} failed)`;
  report += ` | **${formatCurrency(totalValue)}** total pipeline\n`;

  for (const rec of RECOMMENDATION_ORDER) {
    if (recCounts[rec]) {
      report += `- ${recCounts[rec].count} ${RECOMMENDATION_DISPLAY[rec] || rec} (${formatCurrency(recCounts[rec].value)})\n`;
    }
  }

  if (atRiskValue > 0) {
    report += `\n> **${formatCurrency(atRiskValue)} pipeline at risk** (Close Out + Move to Nurture)\n`;
  }

  const attentionCount = (recCounts['CLOSE_OUT']?.count || 0) + (recCounts['ESCALATE']?.count || 0);
  if (attentionCount > 0) {
    report += `\n> **${attentionCount} deals need immediate CRO attention**\n`;
  }

  // Sort by recommendation order, then by amount descending
  const sorted = [...successes].sort((a, b) => {
    const recDiff =
      RECOMMENDATION_ORDER.indexOf(a.recommendation) -
      RECOMMENDATION_ORDER.indexOf(b.recommendation);
    if (recDiff !== 0) return recDiff;
    return (b.amount || 0) - (a.amount || 0);
  });

  // Group by recommendation
  let currentRec = '';
  for (const r of sorted) {
    if (r.recommendation !== currentRec) {
      currentRec = r.recommendation;
      report += `\n---\n\n## ${RECOMMENDATION_DISPLAY[r.recommendation] || r.recommendation}\n`;
    }

    const closeDateStatus = r.daysUntilClose !== null
      ? r.daysUntilClose < 0
        ? `${Math.abs(r.daysUntilClose)}d past due`
        : `in ${r.daysUntilClose}d`
      : 'not set';

    report += `\n### ${r.dealName} — ${formatCurrency(r.amount)}\n`;
    report += `**Stage:** ${r.stageName}`;
    if (r.daysInCurrentStage !== null) report += ` (${r.daysInCurrentStage}d in stage)`;
    report += ` | **Age:** ${r.dealAgeDays}d | **Close Date:** ${r.closeDate?.split('T')[0] || 'Not set'} (${closeDateStatus})\n`;
    report += `**Activity:** ${r.activityLevel} | **Customer:** ${r.customerEngagement} | **AE Effort:** ${r.aeEffort} | **Momentum:** ${r.dealMomentum}\n`;
    report += `**Recommendation:** ${r.recommendationRationale}\n`;
    report += `\n> ${r.executiveSummary}\n`;

    if (verbose) {
      report += `\n<details><summary>Full Activity Timeline</summary>\n\n\`\`\`\n${r.timeline}\n\`\`\`\n\n</details>\n`;
    }
  }

  // Failures
  if (failures.length > 0) {
    report += `\n---\n\n## Errors\n`;
    for (const r of failures) {
      report += `\n### ${r.dealName} — ${formatCurrency(r.amount)}\n`;
      report += `**ERROR:** ${r.error}\n`;
    }
  }

  report += `\n---\n\n*Generated at ${new Date().toISOString()} — ${successes.length} analyzed, ${failures.length} failed*\n`;

  return report;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  let owner: string | null = null;
  let stage: string[] | null = null;
  let concurrency = 3;
  let verbose = false;
  let output: string | null = null;
  let dealId: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--owner=')) {
      owner = args[i].split('=')[1];
    } else if (args[i] === '--owner' && args[i + 1]) {
      owner = args[++i];
    } else if (args[i].startsWith('--stage=')) {
      stage = args[i].split('=')[1].split(',');
    } else if (args[i] === '--stage' && args[i + 1]) {
      stage = args[++i].split(',');
    } else if (args[i].startsWith('--concurrency=')) {
      concurrency = parseInt(args[i].split('=')[1], 10) || 3;
    } else if (args[i] === '--concurrency' && args[i + 1]) {
      concurrency = parseInt(args[++i], 10) || 3;
    } else if (args[i] === '--verbose') {
      verbose = true;
    } else if (args[i].startsWith('--output=')) {
      output = args[i].split('=')[1];
    } else if (args[i] === '--output' && args[i + 1]) {
      output = args[++i];
    } else if (args[i].startsWith('--deal=')) {
      dealId = args[i].split('=')[1];
    } else if (args[i] === '--deal' && args[i + 1]) {
      dealId = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Usage: npx tsx src/scripts/deal-scrub.ts --owner=EMAIL [options]

Analyzes open deals for an AE and produces a pipeline scrub report with
health assessments and CRO recommendations for each deal.

Options:
  --owner=EMAIL        Required. AE email to analyze deals for
  --stage=SLUG[,SLUG]  Filter to stage(s): mql, discovery, demo-scheduled,
                       demo-completed, proposal, closed-won (comma-separated)
  --deal=DEAL_ID       Analyze a single deal (overrides owner/stage)
  --concurrency=N      Max parallel deals (default: 3)
  --verbose            Include full activity timeline per deal
  --output=FILE        Custom output path (default: deal-scrub-{name}-{date}.md)
  --help, -h           Show this help

Examples:
  npx tsx src/scripts/deal-scrub.ts --owner=cgarraffa@opusbehavioral.com
  npx tsx src/scripts/deal-scrub.ts --owner=cgarraffa@opusbehavioral.com --stage=demo-completed --verbose
  npx tsx src/scripts/deal-scrub.ts --deal=12345678901 --verbose
`);
      process.exit(0);
    }
  }

  if (!owner && !dealId) {
    console.error('Error: --owner=EMAIL is required (or use --deal=ID for single deal mode)');
    process.exit(1);
  }

  return { owner, stage, concurrency, verbose, output, dealId };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  const today = new Date().toISOString().split('T')[0];

  // Resolve owner
  let ownerName = 'Unknown';
  let ownerHubSpotId: string | null = null;

  if (args.owner) {
    const owner = await getOwnerByEmail(args.owner);
    if (!owner) {
      console.error(`Owner not found in HubSpot: ${args.owner}`);
      process.exit(1);
    }
    ownerName = [owner.firstName, owner.lastName].filter(Boolean).join(' ') || args.owner;
    ownerHubSpotId = owner.id;
    console.log(`\nResolved owner: ${ownerName} (HubSpot ID: ${owner.id})`);
  }

  // Build owner map and stage name map in parallel
  const [allOwners, stageNameMap, pipelines] = await Promise.all([
    listAllOwners(),
    getStageNameMap(),
    getAllPipelines(),
  ]);

  const ownerMap = new Map<string, string>();
  for (const o of allOwners) {
    const name = [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email;
    ownerMap.set(o.id, name);
  }

  // Build closed stage ID set
  const closedStageIds = new Set<string>();
  for (const pipeline of pipelines) {
    for (const stage of pipeline.stages) {
      if (stage.metadata.isClosed) {
        closedStageIds.add(stage.id);
      }
    }
  }

  // Fetch deals
  let deals: HubSpotDeal[];

  if (args.dealId) {
    const deal = await getDealById(args.dealId);
    if (!deal) {
      console.error(`Deal not found: ${args.dealId}`);
      process.exit(1);
    }
    deals = [deal];
    // For single deal mode, resolve owner name from the deal
    if (!args.owner && deal.properties.hubspot_owner_id) {
      ownerName = ownerMap.get(deal.properties.hubspot_owner_id) || 'Unknown';
    }
  } else {
    console.log('Fetching deals from HubSpot...');
    deals = await getDealsByOwnerId(ownerHubSpotId!);
    console.log(`  Found ${deals.length} total deals`);

    // Filter to sales pipeline
    deals = deals.filter((d) => d.properties.pipeline === SALES_PIPELINE_ID);
    console.log(`  ${deals.length} in sales pipeline`);

    // Exclude closed stages (unless user explicitly asked for closed-won)
    if (!args.stage?.includes('closed-won')) {
      deals = deals.filter((d) => !closedStageIds.has(d.properties.dealstage || ''));
      console.log(`  ${deals.length} open (excluding closed stages)`);
    }

    // Apply stage filter
    if (args.stage) {
      const allStageIds: string[] = [];
      for (const slug of args.stage) {
        const stageIds = STAGE_FILTER_MAP[slug];
        if (!stageIds) {
          console.error(`Unknown stage slug: ${slug}. Valid: ${Object.keys(STAGE_FILTER_MAP).join(', ')}`);
          process.exit(1);
        }
        allStageIds.push(...stageIds);
      }
      deals = deals.filter((d) => d.properties.dealstage && allStageIds.includes(d.properties.dealstage));
      console.log(`  ${deals.length} in stage(s): ${args.stage.join(', ')}`);
    }
  }

  if (deals.length === 0) {
    console.log('\nNo deals found matching filters.');
    process.exit(0);
  }

  console.log(`\nAnalyzing ${deals.length} deal${deals.length === 1 ? '' : 's'} for ${ownerName} (concurrency: ${args.concurrency})...\n`);

  const startTime = Date.now();
  let completed = 0;

  const results = await processWithConcurrency(
    deals,
    args.concurrency,
    async (deal, _index) => {
      try {
        const result = await scrubDeal(deal, stageNameMap, ownerMap, ownerName);
        completed++;
        console.log(
          `  [${completed}/${deals.length}] ✓ ${deal.properties.dealname} → ${result.recommendation}`
        );
        return result;
      } catch (err) {
        completed++;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.log(
          `  [${completed}/${deals.length}] ✗ ${deal.properties.dealname} → ERROR: ${errMsg}`
        );
        return {
          dealId: deal.id,
          dealName: deal.properties.dealname || 'Unknown',
          amount: deal.properties.amount ? parseFloat(deal.properties.amount) : null,
          stageName: stageNameMap.get(deal.properties.dealstage || '') || deal.properties.dealstage || 'Unknown',
          closeDate: deal.properties.closedate || null,
          dealAgeDays: 0,
          daysInCurrentStage: null,
          daysUntilClose: null,
          ownerName,
          activityLevel: 'UNKNOWN',
          customerEngagement: 'UNKNOWN',
          aeEffort: 'UNKNOWN',
          dealMomentum: 'UNKNOWN',
          recommendation: 'UNKNOWN',
          recommendationRationale: '',
          executiveSummary: '',
          timeline: '',
          error: errMsg,
        } as ScrubResult;
      }
    }
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successes = results.filter((r) => !r.error).length;
  const failures = results.filter((r) => r.error).length;

  console.log(`\nDone in ${elapsed}s — ${successes} analyzed, ${failures} failed\n`);

  // Generate report
  const filters = args.stage ? `Stage: ${args.stage.join(', ')}` : 'All open stages';
  const report = formatReport(results, ownerName, filters, args.verbose);

  // Write to file
  const ownerSlug = ownerName.split(' ').pop()?.toLowerCase() || 'unknown';
  const outputFile = args.output || `deal-scrub-${ownerSlug}-${today}.md`;
  fs.writeFileSync(outputFile, report, 'utf-8');
  console.log(`Report written to ${outputFile}\n`);

  // Print to stdout
  console.log(report);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
