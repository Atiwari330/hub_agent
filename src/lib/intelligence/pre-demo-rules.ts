/**
 * Pre-Demo AE Effort Rules Engine
 *
 * Scores AE effort on pre-demo deals (MQL → Demo Scheduled) across 4 dimensions:
 *   - Call Cadence (25%): frequency, hour diversity, day-of-week diversity
 *   - Follow-up Regularity (25%): max gap between touchpoints, recency
 *   - Tactic/Channel Diversity (30%): channels used (call/email/meeting/note)
 *   - Discipline (20%): next step compliance + giftology bonus
 *
 * Uses same A-F grading scale as deal health.
 */

import type { HubSpotCall, HubSpotEmail, HubSpotMeeting } from '@/lib/hubspot/engagements';
import { checkNextStepCompliance, type NextStepCheckInput } from '@/lib/utils/queue-detection';
import { computeGrade } from './deal-rules';

// --- Types ---

export interface PreDemoEngagements {
  calls: HubSpotCall[];
  emails: HubSpotEmail[];
  meetings: HubSpotMeeting[];
}

export interface PreDemoDealInput {
  hubspot_deal_id: string;
  hubspot_created_at: string | null;
  next_step: string | null;
  next_step_due_date: string | null;
  next_step_status: string | null;
  next_step_last_updated_at: string | null;
  sent_gift_or_incentive: string | null;
  [key: string]: unknown;
}

export interface PreDemoScoreResult {
  // Dimension scores (0-100)
  call_cadence_score: number;
  followup_regularity_score: number;
  tactic_diversity_score: number;
  discipline_score: number;
  overall_score: number;
  overall_grade: string;

  // Raw metrics
  total_calls: number;
  connected_calls: number;
  total_outbound_emails: number;
  avg_call_gap_days: number | null;
  max_call_gap_days: number | null;
  distinct_call_hours: number;
  distinct_call_days: number;
  sent_gift: boolean;
  max_touchpoint_gap_days: number | null;
  days_in_pre_demo: number;

  // Dimension sub-scores for DB
  call_frequency_score: number;
  call_spacing_score: number;
  giftology_score: number;
}

// --- Constants ---

const DIMENSION_WEIGHTS = {
  callCadence: 0.25,
  followupRegularity: 0.25,
  tacticDiversity: 0.30,
  discipline: 0.20,
};

const EXPECTED_CALLS_PER_WEEK = 3;

// --- Helper functions ---

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

function getCallTimestamps(calls: HubSpotCall[]): Date[] {
  return calls
    .map(c => c.properties.hs_timestamp)
    .filter((ts): ts is string => !!ts)
    .map(ts => new Date(ts))
    .sort((a, b) => a.getTime() - b.getTime());
}

function getEmailTimestamps(emails: HubSpotEmail[]): Date[] {
  return emails
    .filter(e => e.direction === 'OUTBOUND' || e.direction === 'outbound')
    .map(e => e.timestamp)
    .filter((ts): ts is string => !!ts)
    .map(ts => new Date(ts))
    .sort((a, b) => a.getTime() - b.getTime());
}

function getMeetingTimestamps(meetings: HubSpotMeeting[]): Date[] {
  return meetings
    .map(m => m.properties.hs_timestamp)
    .filter((ts): ts is string => !!ts)
    .map(ts => new Date(ts))
    .sort((a, b) => a.getTime() - b.getTime());
}

function computeGaps(timestamps: Date[]): number[] {
  if (timestamps.length < 2) return [];
  const gaps: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    gaps.push(daysBetween(timestamps[i], timestamps[i - 1]));
  }
  return gaps;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

// --- Dimension Scoring ---

function scoreCallCadence(
  calls: HubSpotCall[],
  daysInPreDemo: number
): { score: number; frequencyScore: number; spacingScore: number; totalCalls: number; connectedCalls: number; distinctHours: number; distinctDays: number; avgGap: number | null; maxGap: number | null } {
  const timestamps = getCallTimestamps(calls);
  const totalCalls = timestamps.length;

  // Connected calls: disposition indicates connected
  const connectedCalls = calls.filter(c => {
    const disp = c.properties.hs_call_disposition;
    return disp && ['connected', 'f240bbac-87c9-4f6e-bf70-924b57d47db7', '9d9162e7-6cf3-4944-bf63-4dff82258764'].includes(disp.toLowerCase());
  }).length;

  if (totalCalls === 0) {
    return { score: 0, frequencyScore: 0, spacingScore: 0, totalCalls: 0, connectedCalls: 0, distinctHours: 0, distinctDays: 0, avgGap: null, maxGap: null };
  }

  // Frequency sub-score: actual vs expected
  const weeksInPreDemo = Math.max(1, daysInPreDemo / 7);
  const expectedCalls = weeksInPreDemo * EXPECTED_CALLS_PER_WEEK;
  const frequencyRatio = totalCalls / expectedCalls;
  const frequencyScore = clamp(frequencyRatio * 100);

  // Spacing sub-score: variety of hours and days tried
  const hours = new Set(timestamps.map(ts => ts.getHours()));
  const days = new Set(timestamps.map(ts => ts.getDay()));
  const distinctHours = hours.size;
  const distinctDays = days.size;
  // Ideal: 3+ distinct hours, 3+ distinct days
  const hourScore = clamp((distinctHours / 3) * 100);
  const dayScore = clamp((distinctDays / 3) * 100);
  const spacingScore = clamp(Math.round((hourScore + dayScore) / 2));

  // Gaps
  const gaps = computeGaps(timestamps);
  const avgGap = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
  const maxGap = gaps.length > 0 ? Math.max(...gaps) : null;

  // Combined score: 60% frequency, 40% spacing
  const score = clamp(Math.round(frequencyScore * 0.6 + spacingScore * 0.4));

  return { score, frequencyScore, spacingScore, totalCalls, connectedCalls, distinctHours, distinctDays, avgGap, maxGap };
}

function scoreFollowupRegularity(
  calls: HubSpotCall[],
  emails: HubSpotEmail[],
  meetings: HubSpotMeeting[],
  daysInPreDemo: number
): { score: number; maxTouchpointGap: number | null } {
  // Merge all touchpoint timestamps
  const allTimestamps = [
    ...getCallTimestamps(calls),
    ...getEmailTimestamps(emails),
    ...getMeetingTimestamps(meetings),
  ].sort((a, b) => a.getTime() - b.getTime());

  if (allTimestamps.length === 0) {
    return { score: 0, maxTouchpointGap: null };
  }

  const gaps = computeGaps(allTimestamps);
  const maxGap = gaps.length > 0 ? Math.max(...gaps) : 0;

  // Also consider recency: days since last touchpoint
  const lastTouch = allTimestamps[allTimestamps.length - 1];
  const daysSinceLast = daysBetween(new Date(), lastTouch);

  // Max gap scoring: ideal < 3 days, acceptable < 7, poor > 14
  let gapScore: number;
  if (maxGap <= 2) gapScore = 100;
  else if (maxGap <= 4) gapScore = 80;
  else if (maxGap <= 7) gapScore = 60;
  else if (maxGap <= 14) gapScore = 35;
  else gapScore = 10;

  // Recency penalty
  let recencyPenalty = 0;
  if (daysSinceLast > 7) recencyPenalty = 20;
  else if (daysSinceLast > 4) recencyPenalty = 10;
  else if (daysSinceLast > 2) recencyPenalty = 5;

  // Touchpoint density bonus: more touchpoints per week = better
  const weeksInPreDemo = Math.max(1, daysInPreDemo / 7);
  const touchpointsPerWeek = allTimestamps.length / weeksInPreDemo;
  let densityBonus = 0;
  if (touchpointsPerWeek >= 5) densityBonus = 15;
  else if (touchpointsPerWeek >= 3) densityBonus = 10;
  else if (touchpointsPerWeek >= 2) densityBonus = 5;

  const score = clamp(gapScore - recencyPenalty + densityBonus);

  return { score, maxTouchpointGap: gaps.length > 0 ? Math.round(maxGap * 10) / 10 : null };
}

function scoreTacticDiversity(
  calls: HubSpotCall[],
  emails: HubSpotEmail[],
  meetings: HubSpotMeeting[],
  noteCount: number
): { score: number } {
  // Rules baseline: count distinct channels used
  const channelsUsed: string[] = [];
  if (calls.length > 0) channelsUsed.push('call');
  if (emails.filter(e => e.direction === 'OUTBOUND' || e.direction === 'outbound').length > 0) channelsUsed.push('email');
  if (meetings.length > 0) channelsUsed.push('meeting');
  if (noteCount > 0) channelsUsed.push('note');

  // Score based on channel count (1=25, 2=50, 3=75, 4=100)
  const score = clamp(channelsUsed.length * 25);

  return { score };
}

function scoreDiscipline(
  deal: PreDemoDealInput
): { score: number; giftologyScore: number } {
  // Next step compliance
  const nextStepInput: NextStepCheckInput = {
    next_step: deal.next_step,
    next_step_due_date: deal.next_step_due_date,
    next_step_status: deal.next_step_status,
    next_step_last_updated_at: deal.next_step_last_updated_at,
  };

  const nextStepResult = checkNextStepCompliance(nextStepInput);

  let nextStepScore: number;
  switch (nextStepResult.status) {
    case 'compliant': nextStepScore = 80; break;
    case 'stale': nextStepScore = 50; break;
    case 'overdue': nextStepScore = 30; break;
    case 'missing': nextStepScore = 20; break;
    default: nextStepScore = 50;
  }

  // Giftology bonus
  const sentGift = !!(deal.sent_gift_or_incentive && deal.sent_gift_or_incentive.trim().length > 0
    && deal.sent_gift_or_incentive.toLowerCase() !== 'no'
    && deal.sent_gift_or_incentive.toLowerCase() !== 'false');
  const giftologyScore = sentGift ? 20 : 0;

  const score = clamp(nextStepScore + giftologyScore);

  return { score, giftologyScore };
}

// --- Main Computation ---

export function computePreDemoEffortScore(
  deal: PreDemoDealInput,
  engagements: PreDemoEngagements,
  noteCount: number = 0
): PreDemoScoreResult {
  const createdAt = deal.hubspot_created_at ? new Date(deal.hubspot_created_at) : new Date();
  const daysInPreDemo = Math.max(1, Math.round(daysBetween(new Date(), createdAt)));

  const callResult = scoreCallCadence(engagements.calls, daysInPreDemo);
  const followupResult = scoreFollowupRegularity(engagements.calls, engagements.emails, engagements.meetings, daysInPreDemo);
  const tacticResult = scoreTacticDiversity(engagements.calls, engagements.emails, engagements.meetings, noteCount);
  const disciplineResult = scoreDiscipline(deal);

  const overallScore = clamp(Math.round(
    callResult.score * DIMENSION_WEIGHTS.callCadence +
    followupResult.score * DIMENSION_WEIGHTS.followupRegularity +
    tacticResult.score * DIMENSION_WEIGHTS.tacticDiversity +
    disciplineResult.score * DIMENSION_WEIGHTS.discipline
  ));

  const overallGrade = computeGrade(overallScore);

  const outboundEmails = engagements.emails.filter(
    e => e.direction === 'OUTBOUND' || e.direction === 'outbound'
  );

  const sentGift = !!(deal.sent_gift_or_incentive && deal.sent_gift_or_incentive.trim().length > 0
    && deal.sent_gift_or_incentive.toLowerCase() !== 'no'
    && deal.sent_gift_or_incentive.toLowerCase() !== 'false');

  return {
    call_cadence_score: callResult.score,
    followup_regularity_score: followupResult.score,
    tactic_diversity_score: tacticResult.score,
    discipline_score: disciplineResult.score,
    overall_score: overallScore,
    overall_grade: overallGrade,

    total_calls: callResult.totalCalls,
    connected_calls: callResult.connectedCalls,
    total_outbound_emails: outboundEmails.length,
    avg_call_gap_days: callResult.avgGap !== null ? Math.round(callResult.avgGap * 10) / 10 : null,
    max_call_gap_days: callResult.maxGap !== null ? Math.round(callResult.maxGap * 10) / 10 : null,
    distinct_call_hours: callResult.distinctHours,
    distinct_call_days: callResult.distinctDays,
    sent_gift: sentGift,
    max_touchpoint_gap_days: followupResult.maxTouchpointGap,
    days_in_pre_demo: daysInPreDemo,

    call_frequency_score: callResult.frequencyScore,
    call_spacing_score: callResult.spacingScore,
    giftology_score: disciplineResult.giftologyScore,
  };
}

/**
 * Batch-compute pre-demo effort scores for multiple deals.
 */
export function computePreDemoEffortScores(
  deals: PreDemoDealInput[],
  engagementsMap: Map<string, PreDemoEngagements>,
  noteCountMap: Map<string, number>
): Map<string, PreDemoScoreResult> {
  const results = new Map<string, PreDemoScoreResult>();
  for (const deal of deals) {
    const engagements = engagementsMap.get(deal.hubspot_deal_id) || { calls: [], emails: [], meetings: [] };
    const noteCount = noteCountMap.get(deal.hubspot_deal_id) || 0;
    results.set(deal.hubspot_deal_id, computePreDemoEffortScore(deal, engagements, noteCount));
  }
  return results;
}
