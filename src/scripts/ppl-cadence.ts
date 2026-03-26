import { config } from 'dotenv';
config({ path: '.env.local' });

import { getDealsByOwnerId, getDealById } from '../lib/hubspot/deals';
import { getOwnerByEmail, listAllOwners } from '../lib/hubspot/owners';
import { getAllPipelines } from '../lib/hubspot/pipelines';
import { SALES_PIPELINE_ID } from '../lib/hubspot/stage-mappings';
import { ALL_OPEN_STAGE_IDS } from '../lib/hubspot/stage-config';
import { SYNC_CONFIG } from '../lib/hubspot/sync-config';
import { batchFetchDealEngagements } from '../lib/hubspot/batch-engagements';
import {
  getNotesByDealIdWithAuthor,
  getTasksByDealId,
} from '../lib/hubspot/engagements';
import {
  countTouchesInRange,
  analyzeWeek1Touches,
  isAfter5pmEST,
} from '../lib/utils/touch-counter';
import { generateText } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import fs from 'fs';
import type { HubSpotDeal } from '../types/hubspot';
import type { HubSpotEmail, HubSpotCall, HubSpotMeeting, HubSpotTask } from '../lib/hubspot/engagements';
import type { HubSpotNoteWithAuthor } from '../types/exception-context';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

function getCadenceModel() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY is not configured');
  const deepseek = createDeepSeek({ apiKey, baseURL: 'https://ai-gateway.vercel.sh/v1' });
  return deepseek('deepseek/deepseek-v3.2');
}

// ---------------------------------------------------------------------------
// Business day utilities
// ---------------------------------------------------------------------------

/** Get EST day-of-week (0=Sun, 6=Sat) for a date string */
function getESTDayOfWeek(dateStr: string): number {
  const d = new Date(dateStr);
  const estStr = d.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return dayMap[estStr] ?? d.getDay();
}

/** Get EST day name for a date string */
function getESTDayName(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long' });
}

/**
 * Calculate the end of N business days from a start date.
 * If the deal was created after 5pm EST on a Friday, business day 1 = Monday.
 * Returns the end of the Nth business day (23:59:59.999).
 */
function getBusinessDayEnd(createDate: string, numBusinessDays: number): Date {
  const start = new Date(createDate);
  const lateCreation = isAfter5pmEST(createDate);
  const dayOfWeek = getESTDayOfWeek(createDate);
  const isFriday = dayOfWeek === 5;
  const isSaturday = dayOfWeek === 6;
  const isSunday = dayOfWeek === 0;

  // Determine effective start: if late Friday or weekend, start counting from Monday
  const cursor = new Date(start);
  if (lateCreation && isFriday) {
    // Skip to Monday
    cursor.setDate(cursor.getDate() + 3);
  } else if (isSaturday) {
    cursor.setDate(cursor.getDate() + 2);
  } else if (isSunday) {
    cursor.setDate(cursor.getDate() + 1);
  } else if (lateCreation) {
    // Late on a weekday other than Friday → start next business day
    cursor.setDate(cursor.getDate() + 1);
    // Skip weekend if that lands on Sat/Sun
    const newDow = cursor.getDay();
    if (newDow === 6) cursor.setDate(cursor.getDate() + 2);
    else if (newDow === 0) cursor.setDate(cursor.getDate() + 1);
  }

  // cursor is now at the first business day start. Count numBusinessDays from here.
  cursor.setHours(0, 0, 0, 0);
  let counted = 1; // current day counts as day 1
  while (counted < numBusinessDays) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) counted++;
  }

  // Return end of that business day
  cursor.setHours(23, 59, 59, 999);
  return cursor;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProspectEngagement = 'ENGAGED_PASSIVE' | 'SOME_INTEREST' | 'LOW_INTEREST' | 'NO_DATA';

export interface EmailEngagementMetrics {
  totalOutboundEmails: number;
  emailsOpened: number; // unique outbound emails with openCount > 0
  totalOpenCount: number; // sum of all openCount
  totalClickCount: number;
  openRate: number; // emailsOpened / totalOutboundEmails (0-1)
  lastOpenDate: string | null;
  daysSinceLastOpen: number | null;
  signal: ProspectEngagement;
  nurtureWindowWeeks: number; // 3, 3.5, or 4
}

export interface CadenceMetrics {
  // Speed to lead
  firstCallTimestamp: string | null;
  speedToLeadMinutes: number | null;
  speedToLeadRating: 'FAST' | 'ACCEPTABLE' | 'SLOW' | 'NO_CALL';

  // 3-day call count (business days)
  callsIn3BusinessDays: number;
  businessDay3End: string;

  // 5-day multi-channel touches
  touchesIn5BusinessDays: number;
  businessDay5End: string;
  channelsUsed: string[];
  channelDiversity: number;

  // Post-week-1 nurture
  postWeek1TouchesPerWeek: number | null;
  postWeek1Assessment: 'COMPLIANT' | 'PARTIAL' | 'NON_COMPLIANT' | 'TOO_EARLY';

  // Totals
  totalFollowUpAttempts: number;
  totalCallAttempts: number;
  totalOutboundEmails: number;

  // Meeting outcome
  meetingBooked: boolean;
  meetingBookedDate: string | null;

  // Business day awareness
  createdAfter5pmEST: boolean;
  createdDayOfWeek: string;

  // Email engagement
  emailEngagement: EmailEngagementMetrics;
}

export interface CadenceContext {
  deal: HubSpotDeal;
  dealId: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  ownerName: string;
  closeDate: string | null;
  createDate: string;
  dealAgeDays: number;
  leadSource: string;
  calls: HubSpotCall[];
  emails: HubSpotEmail[];
  meetings: HubSpotMeeting[];
  tasks: HubSpotTask[];
  notes: HubSpotNoteWithAuthor[];
  metrics: CadenceMetrics;
}

export interface CadenceResult {
  dealId: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  ownerName: string;
  closeDate: string | null;
  createDate: string;
  dealAgeDays: number;
  metrics: CadenceMetrics;
  // LLM outputs
  timeline: string;
  threeCompliance: string;
  threeRationale: string;
  twoCompliance: string;
  twoRationale: string;
  oneCompliance: string;
  oneRationale: string;
  speedRating: string;
  speedRationale: string;
  channelDiversityRating: string;
  prospectEngagement: string;
  nurtureWindow: string;
  engagementInsight: string;
  verdict: string;
  coaching: string;
  riskFlag: boolean;
  engagementRisk: boolean;
  executiveSummary: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Metric computation
// ---------------------------------------------------------------------------

function isOutboundEmail(email: HubSpotEmail): boolean {
  return (
    email.direction === 'OUTGOING_EMAIL' ||
    (email.direction === 'EMAIL' && !!email.fromEmail?.endsWith('@opusbehavioral.com'))
  );
}

function computeEmailEngagement(emails: HubSpotEmail[]): EmailEngagementMetrics {
  const outbound = emails.filter(isOutboundEmail);
  const totalOutboundEmails = outbound.length;

  if (totalOutboundEmails === 0) {
    return {
      totalOutboundEmails: 0,
      emailsOpened: 0,
      totalOpenCount: 0,
      totalClickCount: 0,
      openRate: 0,
      lastOpenDate: null,
      daysSinceLastOpen: null,
      signal: 'NO_DATA',
      nurtureWindowWeeks: 3,
    };
  }

  const emailsOpened = outbound.filter((e) => e.openCount > 0).length;
  const totalOpenCount = outbound.reduce((sum, e) => sum + e.openCount, 0);
  const totalClickCount = outbound.reduce((sum, e) => sum + e.clickCount, 0);
  const openRate = emailsOpened / totalOutboundEmails;

  // Find most recent open date
  let lastOpenDate: string | null = null;
  let daysSinceLastOpen: number | null = null;
  for (const e of outbound) {
    if (e.lastOpenDate) {
      if (!lastOpenDate || new Date(e.lastOpenDate) > new Date(lastOpenDate)) {
        lastOpenDate = e.lastOpenDate;
      }
    }
  }
  if (lastOpenDate) {
    daysSinceLastOpen = Math.floor(
      (Date.now() - new Date(lastOpenDate).getTime()) / (1000 * 60 * 60 * 24)
    );
  }

  // Determine signal
  let signal: ProspectEngagement;
  const recentOpen = daysSinceLastOpen !== null && daysSinceLastOpen <= 7;
  if (openRate >= 0.5 || totalClickCount > 0 || recentOpen) {
    signal = 'ENGAGED_PASSIVE';
  } else if (openRate >= 0.25 || emailsOpened >= 2) {
    signal = 'SOME_INTEREST';
  } else {
    signal = 'LOW_INTEREST';
  }

  const nurtureWindowWeeks = signal === 'ENGAGED_PASSIVE' ? 4 : signal === 'SOME_INTEREST' ? 3.5 : 3;

  return {
    totalOutboundEmails,
    emailsOpened,
    totalOpenCount,
    totalClickCount,
    openRate,
    lastOpenDate,
    daysSinceLastOpen,
    signal,
    nurtureWindowWeeks,
  };
}

function detectChannels(
  calls: HubSpotCall[],
  emails: HubSpotEmail[],
  meetings: HubSpotMeeting[],
  tasks: HubSpotTask[],
  notes: HubSpotNoteWithAuthor[]
): string[] {
  const channels: Set<string> = new Set();

  if (calls.length > 0) channels.add('Phone');
  if (emails.filter(isOutboundEmail).length > 0) channels.add('Email');
  if (meetings.length > 0) channels.add('Meeting');

  // Detect SMS/text from call bodies, task subjects, or notes
  const textKeywords = /\b(text|sms|texted)\b/i;
  for (const call of calls) {
    if (call.properties.hs_call_body && textKeywords.test(call.properties.hs_call_body)) {
      channels.add('Text/SMS');
      break;
    }
  }
  for (const task of tasks) {
    if (task.properties.hs_task_subject && textKeywords.test(task.properties.hs_task_subject)) {
      channels.add('Text/SMS');
      break;
    }
  }

  // Detect LinkedIn from notes or tasks
  const linkedinKeywords = /\b(linkedin|inmail|\bLI\b|linked in)\b/i;
  for (const note of notes) {
    if (note.properties.hs_note_body && linkedinKeywords.test(note.properties.hs_note_body)) {
      channels.add('LinkedIn');
      break;
    }
  }
  for (const task of tasks) {
    if (task.properties.hs_task_subject && linkedinKeywords.test(task.properties.hs_task_subject)) {
      channels.add('LinkedIn');
      break;
    }
  }

  return Array.from(channels);
}

export function computeCadenceMetrics(
  createDate: string,
  calls: HubSpotCall[],
  emails: HubSpotEmail[],
  meetings: HubSpotMeeting[],
  tasks: HubSpotTask[],
  notes: HubSpotNoteWithAuthor[]
): CadenceMetrics {
  const now = new Date();
  const created = new Date(createDate);
  const dealAgeDays = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));

  // Speed to lead: time from deal creation to first call
  let firstCallTimestamp: string | null = null;
  for (const call of calls) {
    const ts = call.properties.hs_timestamp;
    if (ts) {
      if (!firstCallTimestamp || new Date(ts) < new Date(firstCallTimestamp)) {
        firstCallTimestamp = ts;
      }
    }
  }

  let speedToLeadMinutes: number | null = null;
  let speedToLeadRating: 'FAST' | 'ACCEPTABLE' | 'SLOW' | 'NO_CALL' = 'NO_CALL';
  if (firstCallTimestamp) {
    speedToLeadMinutes = Math.round(
      (new Date(firstCallTimestamp).getTime() - created.getTime()) / (1000 * 60)
    );
    if (speedToLeadMinutes < 0) speedToLeadMinutes = 0;
    if (speedToLeadMinutes <= 5) speedToLeadRating = 'FAST';
    else if (speedToLeadMinutes <= 30) speedToLeadRating = 'ACCEPTABLE';
    else speedToLeadRating = 'SLOW';
  }

  // 3-day and 5-day business day windows
  const bday3End = getBusinessDayEnd(createDate, 3);
  const bday5End = getBusinessDayEnd(createDate, 5);

  // Count calls in first 3 business days
  const callsIn3BD = calls.filter((c) => {
    const ts = c.properties.hs_timestamp;
    if (!ts) return false;
    const t = new Date(ts).getTime();
    return t >= created.getTime() && t <= bday3End.getTime();
  }).length;

  // Count touches in first 5 business days
  const touchesIn5BD = countTouchesInRange(calls, emails, created, bday5End);

  // Channels used in first 5 business days
  const calls5 = calls.filter((c) => {
    const ts = c.properties.hs_timestamp;
    return ts && new Date(ts).getTime() <= bday5End.getTime();
  });
  const emails5 = emails.filter((e) => {
    return e.timestamp && new Date(e.timestamp).getTime() <= bday5End.getTime();
  });
  const meetings5 = meetings.filter((m) => {
    const ts = m.properties.hs_createdate || m.properties.hs_timestamp;
    return ts && new Date(ts).getTime() <= bday5End.getTime();
  });
  const channelsUsed = detectChannels(calls5, emails5, meetings5, tasks, notes);

  // Post-week-1 nurture assessment
  let postWeek1TouchesPerWeek: number | null = null;
  let postWeek1Assessment: 'COMPLIANT' | 'PARTIAL' | 'NON_COMPLIANT' | 'TOO_EARLY' = 'TOO_EARLY';

  if (dealAgeDays > 7) {
    const week1End = new Date(created);
    week1End.setDate(week1End.getDate() + 7);
    week1End.setHours(23, 59, 59, 999);

    const weeksAfterWeek1 = Math.max(1, Math.floor((dealAgeDays - 7) / 7));
    const postWeek1Touches = countTouchesInRange(calls, emails, week1End, now);

    postWeek1TouchesPerWeek = postWeek1Touches.total / weeksAfterWeek1;

    if (postWeek1TouchesPerWeek >= 1) postWeek1Assessment = 'COMPLIANT';
    else if (postWeek1TouchesPerWeek >= 0.5) postWeek1Assessment = 'PARTIAL';
    else postWeek1Assessment = 'NON_COMPLIANT';
  }

  // Total follow-up attempts
  const allTimeTouches = countTouchesInRange(
    calls, emails, new Date('2020-01-01'), new Date('2030-12-31')
  );

  // Meeting booked
  const week1Analysis = analyzeWeek1Touches(calls, emails, createDate, 6, meetings);

  // Email engagement
  const emailEngagement = computeEmailEngagement(emails);

  return {
    firstCallTimestamp,
    speedToLeadMinutes,
    speedToLeadRating,
    callsIn3BusinessDays: callsIn3BD,
    businessDay3End: bday3End.toISOString(),
    touchesIn5BusinessDays: touchesIn5BD.total,
    businessDay5End: bday5End.toISOString(),
    channelsUsed,
    channelDiversity: channelsUsed.length,
    postWeek1TouchesPerWeek,
    postWeek1Assessment,
    totalFollowUpAttempts: allTimeTouches.total,
    totalCallAttempts: calls.length,
    totalOutboundEmails: emails.filter(isOutboundEmail).length,
    meetingBooked: week1Analysis.meetingBooked,
    meetingBookedDate: week1Analysis.meetingBookedDate,
    createdAfter5pmEST: isAfter5pmEST(createDate),
    createdDayOfWeek: getESTDayName(createDate),
    emailEngagement,
  };
}

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const TIMELINE_SYSTEM_PROMPT = `You are analyzing the outreach cadence for a Paid Per Lead (PPL) deal at a healthcare SaaS company (behavioral health EHR and RCM). Your job is to produce a chronological timeline of ALL outreach activities, with special attention to cadence rhythm, channel mix, and email engagement signals.

RULES:
- Every entry MUST include a date (YYYY-MM-DD) and time if available (HH:MM).
- Tag each activity: PHONE, EMAIL, TEXT, LINKEDIN, MEETING, NOTE, or TASK.
- For PHONE: note connected/voicemail/no answer, duration, and any notes. A 0-second call = no answer.
- For EMAIL: note OUTBOUND or INBOUND, subject, and TRACKING DATA if available (opens, clicks). Format: "OPENED Xx (last: YYYY-MM-DD)" or "NOT OPENED". This is critical for understanding prospect engagement.
- For MEETING: note if booked/scheduled/completed.
- Flag business-day gaps: if 2+ business days passed with zero outreach, note "--- BUSINESS DAY GAP: X days (Day N to Day N) ---"
- Weekends are NOT gaps. A Friday outreach followed by Monday outreach = no gap.
- Note the QUALITY: Are calls connected conversations or all voicemails? Are emails personalized or templates?
- Note any PROSPECT RESPONSES: inbound emails, returned calls, meeting accepted, email opens/clicks.

Today's date is ${new Date().toISOString().split('T')[0]}.

Output format:
TIMELINE:
[YYYY-MM-DD HH:MM] PHONE: <description>
[YYYY-MM-DD] EMAIL: <outbound/inbound, subject> — <OPENED Xx / NOT OPENED>
--- BUSINESS DAY GAP: X days (Day N to Day N) ---

SPEED_TO_LEAD: <minutes from deal creation to first call, or "NO CALL">
CHANNEL_MIX: <comma-separated list of distinct channels used>
FIRST_WEEK_RHYTHM: <1-2 sentence summary of outreach pattern in first 5 business days>
EMAIL_ENGAGEMENT_SUMMARY: <1 sentence on prospect email behavior — opens, clicks, patterns>`;

const COMPLIANCE_SYSTEM_PROMPT = `You are assessing a sales rep's compliance with the "3-2-1 Method" for handling Paid Per Lead (PPL) deals at a healthcare SaaS company.

THE 3-2-1 METHOD:
- "3": Call 6 times within the first 3 business days after receiving the lead
- "2": 6-7 touchpoints within the first 5 business days across different channels (phone, text, email, LinkedIn). Use 3+ distinct channels.
- "1": After the first week, move non-responders to a lighter nurture cadence of 1-2 touches per week, with 7+ total follow-up attempts

ADDITIONAL RULES:
- Speed to lead: Call within 5 minutes of receiving the lead
- Multi-channel: Use 3+ touchpoints across different channels (~28% higher conversion vs phone-only)
- 7+ total follow-up attempts (81% of sellers stop at 5 or fewer)

You will receive the reconstructed timeline AND pre-computed metrics. The metrics are FLOOR VALUES computed deterministically — trust them for counts. Your job is to assess the SPIRIT of compliance beyond raw numbers.

JUDGMENT GUIDELINES:
- 5 connected calls in 3 days where conversations happened > 6 zero-second dials in the same hour
- If a rep made 6 calls in 1 minute, that's GAMING — mark NON_COMPLIANT
- Speed to lead: NO_CALL is the worst possible outcome
- Channel diversity: Phone + Email = 2 channels. Need 3+ for COMPLIANT on this dimension.
- Post-week-1: If deal is <7 days old → TOO_EARLY. If prospect responded and meeting was booked → N/A (cadence worked).
- If a meeting was booked within week 1, the cadence WORKED — be generous on sub-metrics.

EMAIL ENGAGEMENT INTELLIGENCE:
- If prospect is opening emails (50%+ open rate, or clicks, or opens in last 7 days) → ENGAGED_PASSIVE. They're interested but something about the approach isn't converting. Extend nurture to 4 weeks.
- If prospect opened some emails (25%+ open rate or 2+ unique emails opened) → SOME_INTEREST. Standard+ window of 3.5 weeks.
- If prospect barely opened emails (0-1 emails opened, no clicks) → LOW_INTEREST. Cut off nurture at 3 weeks.
- If no outbound emails were sent → NO_DATA.
- Prospect opening emails but never responding suggests timing or messaging needs adjustment. Note this.

Output EXACTLY:
THREE_COMPLIANCE: <COMPLIANT|PARTIAL|NON_COMPLIANT>
THREE_RATIONALE: <1 sentence>
TWO_COMPLIANCE: <COMPLIANT|PARTIAL|NON_COMPLIANT>
TWO_RATIONALE: <1 sentence>
ONE_COMPLIANCE: <COMPLIANT|PARTIAL|NON_COMPLIANT|TOO_EARLY>
ONE_RATIONALE: <1 sentence>
SPEED_RATING: <FAST|ACCEPTABLE|SLOW|NO_CALL>
SPEED_RATIONALE: <1 sentence>
CHANNEL_DIVERSITY_RATING: <HIGH|ADEQUATE|LOW>
PROSPECT_ENGAGEMENT: <ENGAGED_PASSIVE|SOME_INTEREST|LOW_INTEREST|NO_DATA>
NURTURE_WINDOW: <3wk|3.5wk|4wk>
ENGAGEMENT_INSIGHT: <1 sentence on what email opens/clicks suggest about timing, messaging, or prospect interest>`;

const VERDICT_SYSTEM_PROMPT = `You are a VP of Revenue Operations coaching an AE on their PPL (Paid Per Lead) lead handling cadence at a healthcare SaaS company.

Given the reconstructed timeline, compliance assessment, and deal metadata, produce a verdict and coaching point.

VERDICT (one of four):
- EXEMPLARY: Exceeded the 3-2-1 method across all dimensions. Fast speed to lead, diverse channels, consistent follow-up, good email engagement tracking. This is what good looks like.
- COMPLIANT: Met the spirit of the 3-2-1 method. May have minor gaps but overall solid execution.
- NEEDS_IMPROVEMENT: Some effort visible but significant gaps. Missed 2+ components or showed inconsistent cadence.
- NON_COMPLIANT: Did not follow the 3-2-1 method. Minimal outreach, single channel, long gaps, or near-zero effort.

COACHING: Provide ONE specific, actionable coaching point. NOT a list. ONE thing.
- If EXEMPLARY: What specifically they did well (so they repeat it)
- If COMPLIANT: The one thing that would make them exemplary
- If NEEDS_IMPROVEMENT: The highest-impact change
- If NON_COMPLIANT: The most critical gap

RISK FLAGS:
- RISK_FLAG: TRUE if prospect has gone completely dark AND the rep has stopped trying (no outreach in 7+ days)
- ENGAGEMENT_RISK: TRUE if prospect IS opening/clicking emails but the rep has stopped calling or reaching out. This is the worst kind of waste — a warm lead going cold. This should be flagged with HIGH URGENCY.

IMPORTANT:
- If a meeting was booked, weight verdict toward COMPLIANT/EXEMPLARY regardless of exact numbers.
- If email engagement shows ENGAGED_PASSIVE but rep has stopped outreach, ENGAGEMENT_RISK must be TRUE.
- One coaching point forces you to prioritize. What is the SINGLE highest-leverage change?

Output EXACTLY:
VERDICT: <EXEMPLARY|COMPLIANT|NEEDS_IMPROVEMENT|NON_COMPLIANT>
COACHING: <1-2 sentences, specific and actionable>
RISK_FLAG: <TRUE|FALSE>
ENGAGEMENT_RISK: <TRUE|FALSE>`;

const EXEC_SUMMARY_SYSTEM_PROMPT = `Write a 1-2 sentence executive summary of this PPL deal's cadence compliance that a VP of RevOps can scan in 3 seconds.

Include: the verdict, the ONE most important signal (positive or negative), and the "so what" (what needs to happen or why it matters).

If the prospect is opening emails but the rep stopped reaching out, lead with that — it's the highest-priority insight.

Do NOT repeat the deal name, amount, or stage — those are displayed separately.
Do NOT use bullet points or headers. Write in plain, direct sentences.
Be blunt. "Zero calls in 3 days. Paid lead wasted." is better than "This lead may benefit from increased outreach velocity."

Output ONLY the summary text, nothing else.`;

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function formatCurrency(amount: number | null): string {
  if (amount === null) return 'Not set';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

function truncate(text: string | null | undefined, maxLen: number): string {
  if (!text) return '';
  const clean = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen) + '...';
}

function formatSpeedToLead(minutes: number | null): string {
  if (minutes === null) return 'NO CALL';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function buildMetadataSection(ctx: CadenceContext): string {
  const m = ctx.metrics;
  return `DEAL METADATA:
- Deal Name: ${ctx.dealName}
- Amount: ${formatCurrency(ctx.amount)}
- Stage: ${ctx.stageName}
- Close Date: ${ctx.closeDate || 'Not set'}
- Created: ${ctx.createDate.split('T')[0]} (${m.createdDayOfWeek})${m.createdAfter5pmEST ? ' — AFTER 5PM EST' : ''}
- Deal Age: ${ctx.dealAgeDays} days
- Lead Source: ${ctx.leadSource}
- AE: ${ctx.ownerName}
- Meeting Booked: ${m.meetingBooked ? `YES (${m.meetingBookedDate?.split('T')[0]})` : 'No'}`;
}

function buildMetricsBlock(m: CadenceMetrics): string {
  const ee = m.emailEngagement;
  return `PRE-COMPUTED METRICS (trust these counts):
- Speed to Lead: ${formatSpeedToLead(m.speedToLeadMinutes)} (${m.speedToLeadRating})
- First Call: ${m.firstCallTimestamp ? m.firstCallTimestamp.split('T')[0] + ' ' + m.firstCallTimestamp.split('T')[1]?.slice(0, 5) : 'NONE'}
- Calls in First 3 Business Days: ${m.callsIn3BusinessDays} / 6 target (window ends ${m.businessDay3End.split('T')[0]})
- Touches in First 5 Business Days: ${m.touchesIn5BusinessDays} / 6 target (window ends ${m.businessDay5End.split('T')[0]})
- Channels Used (5-day): ${m.channelsUsed.join(', ') || 'None'} (${m.channelDiversity} distinct)
- Post-Week-1 Touches/Week: ${m.postWeek1TouchesPerWeek !== null ? m.postWeek1TouchesPerWeek.toFixed(1) : 'N/A'} (${m.postWeek1Assessment})
- Total Follow-Up Attempts: ${m.totalFollowUpAttempts} (${m.totalCallAttempts} calls, ${m.totalOutboundEmails} outbound emails)
- Meeting Booked in Week 1: ${m.meetingBooked ? 'YES' : 'No'}
- Created After 5pm EST: ${m.createdAfter5pmEST ? 'YES' : 'No'} (${m.createdDayOfWeek})
- EMAIL TRACKING:
  - Outbound Emails Sent: ${ee.totalOutboundEmails}
  - Emails Opened by Prospect: ${ee.emailsOpened} / ${ee.totalOutboundEmails} (${(ee.openRate * 100).toFixed(0)}% open rate)
  - Total Opens: ${ee.totalOpenCount} | Total Clicks: ${ee.totalClickCount}
  - Last Opened: ${ee.lastOpenDate ? ee.lastOpenDate.split('T')[0] + ` (${ee.daysSinceLastOpen}d ago)` : 'Never'}
  - Prospect Engagement Signal: ${ee.signal}
  - Recommended Nurture Window: ${ee.nurtureWindowWeeks} weeks`;
}

function buildEngagementSection(ctx: CadenceContext): string {
  let section = '';

  // Notes
  if (ctx.notes.length > 0) {
    section += `\n\nAE NOTES (${ctx.notes.length}):`;
    for (const note of ctx.notes) {
      const date = note.properties.hs_timestamp?.split('T')[0] || 'unknown';
      const author = note.authorName || 'Unknown';
      const body = truncate(note.properties.hs_note_body, 400);
      section += `\n[${date}] by ${author}: ${body}`;
    }
  } else {
    section += '\n\nAE NOTES: None';
  }

  // Emails (with tracking)
  if (ctx.emails.length > 0) {
    section += `\n\nEMAILS (${ctx.emails.length}):`;
    for (const email of ctx.emails) {
      const date = email.timestamp?.split('T')[0] || 'unknown';
      const dir = isOutboundEmail(email) ? 'OUTBOUND' : 'INBOUND';
      const from = email.fromEmail || 'unknown';
      const subject = email.subject || 'No subject';
      const body = truncate(email.body, 250);
      let tracking = '';
      if (dir === 'OUTBOUND') {
        if (email.openCount > 0) {
          tracking = ` — OPENED ${email.openCount}x`;
          if (email.lastOpenDate) tracking += ` (last: ${email.lastOpenDate.split('T')[0]})`;
          if (email.clickCount > 0) tracking += `, ${email.clickCount} clicks`;
        } else {
          tracking = ' — NOT OPENED';
        }
      }
      section += `\n[${date}] ${dir} from ${from} — "${subject}"${tracking}`;
      if (body) section += `\n  ${body}`;
    }
  } else {
    section += '\n\nEMAILS: None';
  }

  // Calls
  if (ctx.calls.length > 0) {
    section += `\n\nCALLS (${ctx.calls.length}):`;
    for (const call of ctx.calls) {
      const ts = call.properties.hs_timestamp;
      const date = ts?.split('T')[0] || 'unknown';
      const time = ts?.split('T')[1]?.slice(0, 5) || '';
      const dir = call.properties.hs_call_direction || 'unknown';
      const duration = call.properties.hs_call_duration
        ? `${Math.round(parseInt(call.properties.hs_call_duration, 10) / 1000)}s`
        : 'unknown duration';
      const disposition = call.properties.hs_call_disposition || 'unknown';
      const body = truncate(call.properties.hs_call_body, 250);
      section += `\n[${date} ${time}] ${dir} call — ${duration}, disposition: ${disposition}`;
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
      const occDate = meeting.properties.hs_timestamp?.split('T')[0] || 'unknown';
      const bookedDate = meeting.properties.hs_createdate?.split('T')[0] || 'unknown';
      const title = meeting.properties.hs_meeting_title || 'Untitled';
      const isFuture = meeting.properties.hs_timestamp
        ? new Date(meeting.properties.hs_timestamp) > today
        : false;
      section += `\n[${occDate}] "${title}" (booked ${bookedDate}) — ${isFuture ? 'UPCOMING' : 'COMPLETED'}`;
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

function buildTimelineUserPrompt(ctx: CadenceContext): string {
  let prompt = buildMetadataSection(ctx);
  prompt += buildEngagementSection(ctx);
  return prompt;
}

function buildComplianceUserPrompt(ctx: CadenceContext, timeline: string): string {
  let prompt = buildMetadataSection(ctx);
  prompt += `\n\n${buildMetricsBlock(ctx.metrics)}`;
  prompt += `\n\nRECONSTRUCTED ACTIVITY TIMELINE:\n${timeline}`;
  return prompt;
}

function buildVerdictUserPrompt(ctx: CadenceContext, timeline: string, complianceText: string): string {
  let prompt = buildMetadataSection(ctx);
  prompt += `\n\n3-2-1 COMPLIANCE ASSESSMENT:\n${complianceText}`;
  prompt += `\n\nRECONSTRUCTED ACTIVITY TIMELINE:\n${timeline}`;
  return prompt;
}

function buildExecSummaryUserPrompt(
  ctx: CadenceContext,
  timeline: string,
  complianceText: string,
  verdictText: string
): string {
  let prompt = buildMetadataSection(ctx);
  prompt += `\n\n3-2-1 COMPLIANCE ASSESSMENT:\n${complianceText}`;
  prompt += `\n\nVERDICT & COACHING:\n${verdictText}`;
  prompt += `\n\nACTIVITY TIMELINE:\n${timeline}`;
  return prompt;
}

// ---------------------------------------------------------------------------
// Result parsers
// ---------------------------------------------------------------------------

function parseComplianceResult(text: string) {
  const get = (label: string) => {
    const m = text.match(new RegExp(`${label}:\\s*(.+)`, 'i'));
    return m?.[1]?.trim() || 'UNKNOWN';
  };
  return {
    threeCompliance: get('THREE_COMPLIANCE'),
    threeRationale: get('THREE_RATIONALE'),
    twoCompliance: get('TWO_COMPLIANCE'),
    twoRationale: get('TWO_RATIONALE'),
    oneCompliance: get('ONE_COMPLIANCE'),
    oneRationale: get('ONE_RATIONALE'),
    speedRating: get('SPEED_RATING'),
    speedRationale: get('SPEED_RATIONALE'),
    channelDiversityRating: get('CHANNEL_DIVERSITY_RATING'),
    prospectEngagement: get('PROSPECT_ENGAGEMENT'),
    nurtureWindow: get('NURTURE_WINDOW'),
    engagementInsight: get('ENGAGEMENT_INSIGHT'),
  };
}

function parseVerdictResult(text: string) {
  const get = (label: string) => {
    const m = text.match(new RegExp(`${label}:\\s*(.+)`, 'i'));
    return m?.[1]?.trim() || '';
  };
  return {
    verdict: get('VERDICT') || 'UNKNOWN',
    coaching: get('COACHING') || 'Review deal manually.',
    riskFlag: get('RISK_FLAG').toUpperCase() === 'TRUE',
    engagementRisk: get('ENGAGEMENT_RISK').toUpperCase() === 'TRUE',
  };
}

// ---------------------------------------------------------------------------
// Per-deal analysis
// ---------------------------------------------------------------------------

export async function analyzeCadence(
  ctx: CadenceContext
): Promise<CadenceResult> {
  const model = getCadenceModel();

  // Pass 1: Activity Timeline
  const timelineResult = await generateText({
    model,
    system: TIMELINE_SYSTEM_PROMPT,
    prompt: buildTimelineUserPrompt(ctx),
  });
  const timeline = timelineResult.text;

  // Pass 2: 3-2-1 Compliance Assessment
  const complianceResult = await generateText({
    model,
    system: COMPLIANCE_SYSTEM_PROMPT,
    prompt: buildComplianceUserPrompt(ctx, timeline),
  });
  const complianceText = complianceResult.text;
  const compliance = parseComplianceResult(complianceText);

  // Pass 3: Verdict & Coaching
  const verdictResult = await generateText({
    model,
    system: VERDICT_SYSTEM_PROMPT,
    prompt: buildVerdictUserPrompt(ctx, timeline, complianceText),
  });
  const verdictText = verdictResult.text;
  const verdict = parseVerdictResult(verdictText);

  // Pass 4: Executive Summary
  const execResult = await generateText({
    model,
    system: EXEC_SUMMARY_SYSTEM_PROMPT,
    prompt: buildExecSummaryUserPrompt(ctx, timeline, complianceText, verdictText),
  });
  const executiveSummary = execResult.text.trim();

  return {
    dealId: ctx.dealId,
    dealName: ctx.dealName,
    amount: ctx.amount,
    stageName: ctx.stageName,
    ownerName: ctx.ownerName,
    closeDate: ctx.closeDate,
    createDate: ctx.createDate,
    dealAgeDays: ctx.dealAgeDays,
    metrics: ctx.metrics,
    timeline,
    ...compliance,
    ...verdict,
    executiveSummary,
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

export const VERDICT_DISPLAY: Record<string, string> = {
  NON_COMPLIANT: 'Non-Compliant',
  NEEDS_IMPROVEMENT: 'Needs Improvement',
  COMPLIANT: 'Compliant',
  EXEMPLARY: 'Exemplary',
  UNKNOWN: 'Unknown',
};

export const VERDICT_ORDER = ['NON_COMPLIANT', 'NEEDS_IMPROVEMENT', 'COMPLIANT', 'EXEMPLARY', 'UNKNOWN'];

export function formatReport(
  results: CadenceResult[],
  filters: string,
  verbose: boolean
): string {
  const today = new Date().toISOString().split('T')[0];
  const successes = results.filter((r) => !r.error);
  const failures = results.filter((r) => r.error);

  // Summary stats
  const totalValue = successes.reduce((sum, r) => sum + (r.amount || 0), 0);
  const verdictCounts: Record<string, number> = {};
  for (const r of successes) {
    verdictCounts[r.verdict] = (verdictCounts[r.verdict] || 0) + 1;
  }

  const riskCount = successes.filter((r) => r.riskFlag).length;
  const engRiskCount = successes.filter((r) => r.engagementRisk).length;

  // Average speed to lead
  const speedDeals = successes.filter((r) => r.metrics.speedToLeadMinutes !== null);
  const avgSpeed = speedDeals.length > 0
    ? Math.round(speedDeals.reduce((s, r) => s + r.metrics.speedToLeadMinutes!, 0) / speedDeals.length)
    : null;

  // Average channel diversity
  const avgChannels = successes.length > 0
    ? (successes.reduce((s, r) => s + r.metrics.channelDiversity, 0) / successes.length).toFixed(1)
    : '0';

  // 3-day call compliance rate
  const threeCompliantCount = successes.filter((r) => r.threeCompliance === 'COMPLIANT').length;
  const threeComplianceRate = successes.length > 0
    ? Math.round((threeCompliantCount / successes.length) * 100)
    : 0;

  // Average email open rate
  const emailDeals = successes.filter((r) => r.metrics.emailEngagement.totalOutboundEmails > 0);
  const avgOpenRate = emailDeals.length > 0
    ? Math.round(emailDeals.reduce((s, r) => s + r.metrics.emailEngagement.openRate * 100, 0) / emailDeals.length)
    : null;

  // Build AE map for per-AE summary
  const aeMap = new Map<string, CadenceResult[]>();
  for (const r of successes) {
    const existing = aeMap.get(r.ownerName) || [];
    existing.push(r);
    aeMap.set(r.ownerName, existing);
  }

  let report = `# PPL 3-2-1 Cadence Report — ${today}\n\n`;
  report += `**Filter:** ${filters}\n\n`;

  report += `## Summary\n`;
  report += `- **${results.length}** PPL deals analyzed`;
  if (failures.length > 0) report += ` (${failures.length} failed)`;
  report += ` | **${formatCurrency(totalValue)}** total pipeline\n`;

  for (const v of VERDICT_ORDER) {
    if (verdictCounts[v]) {
      report += `- ${verdictCounts[v]} ${VERDICT_DISPLAY[v] || v}\n`;
    }
  }

  if (riskCount > 0) report += `- **${riskCount} deals** with risk flag (prospect dark + rep stopped)\n`;
  if (engRiskCount > 0) report += `- **${engRiskCount} deals** with engagement risk (prospect opening emails, rep stopped reaching out)\n`;

  report += `- Avg speed to lead: ${avgSpeed !== null ? formatSpeedToLead(avgSpeed) : 'N/A'}`;
  report += ` | Avg channels: ${avgChannels}`;
  report += ` | 3-day call compliance: ${threeComplianceRate}%`;
  if (avgOpenRate !== null) report += ` | Avg email open rate: ${avgOpenRate}%`;
  report += '\n';

  const urgentCount = riskCount + engRiskCount;
  if (urgentCount > 0) {
    report += `\n> **${urgentCount} deal${urgentCount === 1 ? '' : 's'} need${urgentCount === 1 ? 's' : ''} immediate attention**\n`;
  }

  // Sort by verdict order, then by amount descending
  const sorted = [...successes].sort((a, b) => {
    const vDiff = VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict);
    if (vDiff !== 0) return vDiff;
    return (b.amount || 0) - (a.amount || 0);
  });

  // Group by verdict
  let currentVerdict = '';
  for (const r of sorted) {
    if (r.verdict !== currentVerdict) {
      currentVerdict = r.verdict;
      report += `\n---\n\n## ${VERDICT_DISPLAY[r.verdict] || r.verdict}\n`;
    }

    const m = r.metrics;
    const ee = m.emailEngagement;
    const flags: string[] = [];
    if (r.riskFlag) flags.push('RISK');
    if (r.engagementRisk) flags.push('ENGAGEMENT RISK');
    const flagStr = flags.length > 0 ? `  ${flags.map((f) => `**[${f}]**`).join(' ')}` : '';

    report += `\n### ${r.dealName} — ${formatCurrency(r.amount)}${flagStr}\n`;
    report += `**Stage:** ${r.stageName} | **Age:** ${r.dealAgeDays}d | **Created:** ${r.createDate.split('T')[0]} (${m.createdDayOfWeek})${m.createdAfter5pmEST ? ' after 5pm EST' : ''}\n`;
    report += `**Speed:** ${formatSpeedToLead(m.speedToLeadMinutes)} (${r.speedRating}) | **3-Day Calls:** ${m.callsIn3BusinessDays}/6 | **5-Day Touches:** ${m.touchesIn5BusinessDays}/6 | **Channels:** ${m.channelsUsed.join(', ') || 'None'}\n`;
    report += `**3-2-1:** THREE=${r.threeCompliance} | TWO=${r.twoCompliance} | ONE=${r.oneCompliance}`;
    if (ee.totalOutboundEmails > 0) {
      report += ` | **Email:** ${ee.emailsOpened}/${ee.totalOutboundEmails} opened (${r.prospectEngagement}, ${r.nurtureWindow} nurture)`;
    }
    report += '\n';
    if (r.engagementInsight && r.engagementInsight !== 'UNKNOWN') {
      report += `**Email Insight:** ${r.engagementInsight}\n`;
    }
    report += `**Coaching:** ${r.coaching}\n`;
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

  // Per-AE comparison table (only if multiple AEs)
  if (aeMap.size > 1) {
    report += `\n---\n\n## AE Comparison\n\n`;
    const aeNames = Array.from(aeMap.keys()).sort();
    report += `| Metric | ${aeNames.join(' | ')} |\n`;
    report += `|--------|${aeNames.map(() => '------').join('|')}|\n`;

    // Deals analyzed
    report += `| Deals | ${aeNames.map((n) => aeMap.get(n)!.length).join(' | ')} |\n`;

    // Verdict breakdown
    for (const v of VERDICT_ORDER.filter((v) => v !== 'UNKNOWN')) {
      report += `| ${VERDICT_DISPLAY[v]} | ${aeNames.map((n) => {
        const deals = aeMap.get(n)!;
        const count = deals.filter((d) => d.verdict === v).length;
        const pct = deals.length > 0 ? Math.round((count / deals.length) * 100) : 0;
        return `${count} (${pct}%)`;
      }).join(' | ')} |\n`;
    }

    // Avg speed to lead
    report += `| Avg Speed to Lead | ${aeNames.map((n) => {
      const deals = aeMap.get(n)!.filter((d) => d.metrics.speedToLeadMinutes !== null);
      if (deals.length === 0) return 'N/A';
      const avg = Math.round(deals.reduce((s, d) => s + d.metrics.speedToLeadMinutes!, 0) / deals.length);
      return formatSpeedToLead(avg);
    }).join(' | ')} |\n`;

    // Avg channels
    report += `| Avg Channels | ${aeNames.map((n) => {
      const deals = aeMap.get(n)!;
      return (deals.reduce((s, d) => s + d.metrics.channelDiversity, 0) / deals.length).toFixed(1);
    }).join(' | ')} |\n`;

    // Avg email open rate
    report += `| Avg Email Open Rate | ${aeNames.map((n) => {
      const deals = aeMap.get(n)!.filter((d) => d.metrics.emailEngagement.totalOutboundEmails > 0);
      if (deals.length === 0) return 'N/A';
      const avg = Math.round(deals.reduce((s, d) => s + d.metrics.emailEngagement.openRate * 100, 0) / deals.length);
      return `${avg}%`;
    }).join(' | ')} |\n`;

    // Risk flags
    report += `| Risk Flags | ${aeNames.map((n) => aeMap.get(n)!.filter((d) => d.riskFlag).length).join(' | ')} |\n`;
    report += `| Engagement Risks | ${aeNames.map((n) => aeMap.get(n)!.filter((d) => d.engagementRisk).length).join(' | ')} |\n`;
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
  let concurrency = 3;
  let verbose = false;
  let output: string | null = null;
  let dealId: string | null = null;
  let minAge = 0;
  let maxAge = Infinity;

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--owner=')) {
      owner = args[i].split('=')[1];
    } else if (args[i] === '--owner' && args[i + 1]) {
      owner = args[++i];
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
    } else if (args[i].startsWith('--min-age=')) {
      minAge = parseInt(args[i].split('=')[1], 10) || 0;
    } else if (args[i] === '--min-age' && args[i + 1]) {
      minAge = parseInt(args[++i], 10) || 0;
    } else if (args[i].startsWith('--max-age=')) {
      maxAge = parseInt(args[i].split('=')[1], 10) || Infinity;
    } else if (args[i] === '--max-age' && args[i + 1]) {
      maxAge = parseInt(args[++i], 10) || Infinity;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Usage: npx tsx src/scripts/ppl-cadence.ts [options]

Analyzes PPL (Paid Lead) deals for 3-2-1 method cadence compliance.
Uses DeepSeek multi-pass LLM analysis to assess the spirit of compliance,
not just raw numbers.

Options:
  --owner=EMAIL        Filter to specific AE (default: all target AEs)
  --deal=DEAL_ID       Analyze a single deal (overrides owner filter)
  --concurrency=N      Max parallel LLM analyses (default: 3)
  --verbose            Include full timeline per deal in report
  --min-age=DAYS       Only include deals at least N days old (default: 0)
  --max-age=DAYS       Only include deals created within last N days
  --output=FILE        Custom output path (default: ppl-cadence-{date}.md)
  --help, -h           Show this help

Examples:
  npx tsx src/scripts/ppl-cadence.ts
  npx tsx src/scripts/ppl-cadence.ts --owner=cgarraffa@opusbehavioral.com
  npx tsx src/scripts/ppl-cadence.ts --deal=12345678901 --verbose
  npx tsx src/scripts/ppl-cadence.ts --min-age=7
`);
      process.exit(0);
    }
  }

  return { owner, concurrency, verbose, output, dealId, minAge, maxAge };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  const today = new Date().toISOString().split('T')[0];

  // Determine which AEs to analyze
  const targetEmails = args.owner
    ? [args.owner]
    : SYNC_CONFIG.TARGET_AE_EMAILS.filter((e) => e !== 'atiwari@opusbehavioral.com');

  // Resolve owners
  const allOwners = await listAllOwners();
  const ownerMap = new Map<string, string>();
  for (const o of allOwners) {
    const name = [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email;
    ownerMap.set(o.id, name);
  }

  // Get stage name map
  const pipelines = await getAllPipelines();
  const stageNameMap = new Map<string, string>();
  const salesPipeline = pipelines.find((p) => p.id === SALES_PIPELINE_ID);
  if (salesPipeline) {
    for (const stage of salesPipeline.stages) {
      stageNameMap.set(stage.id, stage.label);
    }
  }

  // Collect PPL deals
  let allDeals: { deal: HubSpotDeal; ownerName: string }[] = [];

  if (args.dealId) {
    // Single deal mode
    const deal = await getDealById(args.dealId);
    if (!deal) {
      console.error(`Deal not found: ${args.dealId}`);
      process.exit(1);
    }
    const ownerName = deal.properties.hubspot_owner_id
      ? ownerMap.get(deal.properties.hubspot_owner_id) || 'Unknown'
      : 'Unknown';
    allDeals = [{ deal, ownerName }];
  } else {
    // Multi-owner mode
    for (const email of targetEmails) {
      const owner = await getOwnerByEmail(email);
      if (!owner) {
        console.warn(`Owner not found: ${email}, skipping`);
        continue;
      }
      const ownerName = [owner.firstName, owner.lastName].filter(Boolean).join(' ') || email;
      console.log(`Fetching deals for ${ownerName}...`);
      const deals = await getDealsByOwnerId(owner.id);

      // Filter: sales pipeline, PPL, open stages
      const pplDeals = deals.filter((d) => {
        const props = d.properties;
        if (props.pipeline !== SALES_PIPELINE_ID) return false;
        if (!ALL_OPEN_STAGE_IDS.includes(props.dealstage || '')) return false;
        // PPL filter: lead_source contains 'Paid Lead'
        const leadSource = props.lead_source || props['lead_source__sync_'] || '';
        if (leadSource !== 'Paid Lead') return false;
        return true;
      });

      console.log(`  ${pplDeals.length} PPL deals in open stages`);
      for (const deal of pplDeals) {
        allDeals.push({ deal, ownerName });
      }
    }
  }

  // Apply min-age filter
  if (args.minAge > 0) {
    const cutoff = Date.now() - args.minAge * 24 * 60 * 60 * 1000;
    allDeals = allDeals.filter((d) => {
      const created = d.deal.properties.createdate;
      return created && new Date(created).getTime() <= cutoff;
    });
    console.log(`After min-age filter (${args.minAge}d): ${allDeals.length} deals`);
  }

  // Apply max-age filter (deals created within the last N days)
  if (args.maxAge !== Infinity) {
    const cutoff = Date.now() - args.maxAge * 24 * 60 * 60 * 1000;
    allDeals = allDeals.filter((d) => {
      const created = d.deal.properties.createdate;
      return created && new Date(created).getTime() >= cutoff;
    });
    console.log(`After max-age filter (${args.maxAge}d): ${allDeals.length} deals`);
  }

  // Filter out deals with no creation date
  allDeals = allDeals.filter((d) => d.deal.properties.createdate);

  if (allDeals.length === 0) {
    console.log('\nNo PPL deals found matching filters.');
    process.exit(0);
  }

  console.log(`\nAnalyzing ${allDeals.length} PPL deal${allDeals.length === 1 ? '' : 's'} (concurrency: ${args.concurrency})...\n`);

  // Phase A: Batch-fetch engagements for all deals at once
  console.log('Batch-fetching engagements from HubSpot...');
  const hubspotDealIds = allDeals
    .map((d) => d.deal.id)
    .filter(Boolean);

  let engagementMap = new Map<string, { calls: HubSpotCall[]; emails: HubSpotEmail[]; meetings: HubSpotMeeting[] }>();
  if (hubspotDealIds.length > 0) {
    try {
      engagementMap = await batchFetchDealEngagements(hubspotDealIds);
      console.log(`  Fetched engagements for ${engagementMap.size} deals\n`);
    } catch (error) {
      console.warn('  Batch engagement fetch failed, will fetch per-deal\n');
    }
  }

  const startTime = Date.now();
  let completed = 0;

  const results = await processWithConcurrency(
    allDeals,
    args.concurrency,
    async ({ deal, ownerName }) => {
      try {
        const dealId = deal.id;
        const props = deal.properties;
        const createDate = props.createdate!;

        // Get engagements from batch or empty
        const batchEngagements = engagementMap.get(dealId) || { calls: [], emails: [], meetings: [] };

        // Fetch notes and tasks per-deal (not in batch)
        const [notes, tasks] = await Promise.all([
          getNotesByDealIdWithAuthor(dealId, ownerMap),
          getTasksByDealId(dealId),
        ]);

        const { calls, emails, meetings } = batchEngagements;
        const stageId = props.dealstage || '';
        const stageName = stageNameMap.get(stageId) || stageId;
        const dealAgeDays = Math.floor(
          (Date.now() - new Date(createDate).getTime()) / (1000 * 60 * 60 * 24)
        );

        // Compute metrics
        const metrics = computeCadenceMetrics(createDate, calls, emails, meetings, tasks, notes);

        const ctx: CadenceContext = {
          deal,
          dealId,
          dealName: props.dealname || 'Unnamed Deal',
          amount: props.amount ? parseFloat(props.amount) : null,
          stageName,
          ownerName,
          closeDate: props.closedate || null,
          createDate,
          dealAgeDays,
          leadSource: props.lead_source || props['lead_source__sync_'] || 'Paid Lead',
          calls,
          emails,
          meetings,
          tasks,
          notes,
          metrics,
        };

        const result = await analyzeCadence(ctx);
        completed++;
        const flags = [
          result.riskFlag ? 'RISK' : '',
          result.engagementRisk ? 'ENG_RISK' : '',
        ].filter(Boolean).join(', ');
        console.log(
          `  [${completed}/${allDeals.length}] ✓ ${ctx.dealName} → ${result.verdict}${flags ? ` [${flags}]` : ''}`
        );
        return result;
      } catch (err) {
        completed++;
        const errMsg = err instanceof Error ? err.message : String(err);
        const dealName = deal.properties.dealname || 'Unknown';
        console.log(
          `  [${completed}/${allDeals.length}] ✗ ${dealName} → ERROR: ${errMsg}`
        );
        return {
          dealId: deal.id,
          dealName,
          amount: deal.properties.amount ? parseFloat(deal.properties.amount) : null,
          stageName: stageNameMap.get(deal.properties.dealstage || '') || 'Unknown',
          ownerName,
          closeDate: deal.properties.closedate || null,
          createDate: deal.properties.createdate || '',
          dealAgeDays: 0,
          metrics: {} as CadenceMetrics,
          timeline: '',
          threeCompliance: 'UNKNOWN',
          threeRationale: '',
          twoCompliance: 'UNKNOWN',
          twoRationale: '',
          oneCompliance: 'UNKNOWN',
          oneRationale: '',
          speedRating: 'UNKNOWN',
          speedRationale: '',
          channelDiversityRating: 'UNKNOWN',
          prospectEngagement: 'UNKNOWN',
          nurtureWindow: 'UNKNOWN',
          engagementInsight: '',
          verdict: 'UNKNOWN',
          coaching: '',
          riskFlag: false,
          engagementRisk: false,
          executiveSummary: '',
          error: errMsg,
        } as CadenceResult;
      }
    }
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successes = results.filter((r) => !r.error).length;
  const failures = results.filter((r) => r.error).length;

  console.log(`\nDone in ${elapsed}s — ${successes} analyzed, ${failures} failed\n`);

  // Generate report
  const filters = args.owner
    ? `AE: ${args.owner}, Paid Lead, Open Stages`
    : `All Target AEs, Paid Lead, Open Stages`;
  const report = formatReport(results, filters, args.verbose);

  // Write to file
  const outputFile = args.output || `ppl-cadence-${today}.md`;
  fs.writeFileSync(outputFile, report, 'utf-8');
  console.log(`Report written to ${outputFile}\n`);

  // Print to stdout
  console.log(report);
}

// Only run CLI when executed directly (not when imported)
const isDirectRun = process.argv[1]?.replace(/\\/g, '/').includes('ppl-cadence');
if (isDirectRun) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
