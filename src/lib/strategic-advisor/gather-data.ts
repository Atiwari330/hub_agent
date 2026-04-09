/**
 * Data gathering and serialization for the Strategic Advisor CLI.
 *
 * Fetches all Q2 pipeline data in parallel, pre-computes key ratios
 * and deltas, then serializes into labeled text for the LLM.
 * The LLM should never do arithmetic — every metric arrives pre-computed.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { computeQ2GoalTrackerData } from '@/lib/q2-goal-tracker/compute';
import { fetchQ2Deals } from '@/lib/command-center/fetch-q2-deals';
import { computePacingData } from '@/lib/command-center/compute-pacing';
import { computeInitiativeStatus } from '@/lib/command-center/compute-initiatives';
import { computeRollingForecast } from '@/lib/command-center/compute-forecast';
import { Q2_TEAM_TARGET } from '@/lib/command-center/config';
import { getQuarterInfo, getQuarterProgress } from '@/lib/utils/quarter';
import type { Q2GoalTrackerApiResponse } from '@/lib/q2-goal-tracker/types';
import type { PacingData, InitiativeStatus, DealForecastItem, ForecastSummary } from '@/lib/command-center/types';
import type { QuarterProgress } from '@/lib/utils/quarter';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StrategicDataBundle {
  goalTracker: Q2GoalTrackerApiResponse;
  pacing: PacingData;
  initiatives: InitiativeStatus[];
  forecast: ForecastSummary;
  q2Deals: DealForecastItem[];
  quarterProgress: QuarterProgress;
  strategicContext: string;
}

// ---------------------------------------------------------------------------
// Data Gathering
// ---------------------------------------------------------------------------

export async function gatherAllData(supabase: SupabaseClient): Promise<StrategicDataBundle> {
  // Load strategic context (non-blocking — empty string if missing)
  let strategicContext = '';
  try {
    const ctxPath = path.join(process.cwd(), 'src/lib/ai/knowledge/strategic/adi-context.md');
    strategicContext = fs.readFileSync(ctxPath, 'utf-8');
  } catch {
    // Knowledge file not yet populated — tool still works
  }

  // Group 1: independent fetches
  const [goalTracker, q2Deals] = await Promise.all([
    computeQ2GoalTrackerData(supabase),
    fetchQ2Deals(supabase),
  ]);

  const q2 = getQuarterInfo(2026, 2);
  const quarterProgress = getQuarterProgress(q2);

  // Compute closed-won ARR from weekly actuals
  const closedWonARR = goalTracker.weeklyActuals.reduce((s, w) => s + w.closedWonARR, 0);

  // Group 2: depends on goal tracker data
  const [pacing, initiatives, forecast] = await Promise.all([
    computePacingData(supabase, goalTracker),
    computeInitiativeStatus(supabase),
    Promise.resolve(computeRollingForecast(q2Deals, closedWonARR, Q2_TEAM_TARGET)),
  ]);

  return {
    goalTracker,
    pacing,
    initiatives,
    forecast,
    q2Deals,
    quarterProgress,
    strategicContext,
  };
}

// ---------------------------------------------------------------------------
// Serialization — pre-computed metrics for the LLM
// ---------------------------------------------------------------------------

function $(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return (n / total * 100).toFixed(1) + '%';
}

export function serializeDataForLLM(data: StrategicDataBundle): string {
  const { goalTracker: gt, pacing, initiatives, forecast, q2Deals, quarterProgress } = data;
  const today = new Date().toISOString().split('T')[0];
  const currentWeek = gt.progress.currentWeek;
  const weeksRemaining = 13 - currentWeek;
  const closedWonARR = gt.weeklyActuals.reduce((s, w) => s + w.closedWonARR, 0);
  const closedWonCount = gt.weeklyActuals.reduce((s, w) => s + w.closedWonCount, 0);
  const weeksElapsed = currentWeek;

  // Pre-compute key derived metrics
  const weeklyRunRate = weeksElapsed > 0 ? closedWonARR / weeksElapsed : 0;
  const impliedQuarterEnd = weeklyRunRate * 13;
  const gap = Math.max(0, Q2_TEAM_TARGET - closedWonARR);
  const coverageRatio = gap > 0 ? forecast.totalWeighted / gap : Infinity;
  const requiredWeeklyRate = weeksRemaining > 0 ? gap / weeksRemaining : gap;

  const lines: string[] = [];

  // ── Header ──
  lines.push(`# STRATEGIC DATA SNAPSHOT — ${today}`);
  lines.push('');

  // ── Quarter Progress ──
  lines.push(`## QUARTER PROGRESS`);
  lines.push(`- Quarter: Q2 2026 (Apr 1 – Jun 30)`);
  lines.push(`- Current week: ${currentWeek} of 13`);
  lines.push(`- Days elapsed: ${quarterProgress.daysElapsed} of ${quarterProgress.totalDays}`);
  lines.push(`- Percent complete: ${quarterProgress.percentComplete.toFixed(1)}%`);
  lines.push(`- Weeks remaining: ${weeksRemaining}`);
  lines.push('');

  // ── Team Scorecard ──
  lines.push(`## TEAM SCORECARD`);
  lines.push(`- Q2 target: ${$(Q2_TEAM_TARGET)}`);
  lines.push(`- Closed-won ARR (Q2 to date): ${$(closedWonARR)} (${pct(closedWonARR, Q2_TEAM_TARGET)} of target)`);
  lines.push(`- Closed-won deals: ${closedWonCount}`);
  lines.push(`- Gap to target: ${$(gap)}`);
  lines.push(`- Weekly closed-won run rate: ${$(weeklyRunRate)}/week`);
  lines.push(`- Implied quarter-end at current pace: ${$(impliedQuarterEnd)}`);
  lines.push(`- Required weekly rate to hit target: ${$(requiredWeeklyRate)}/week`);
  lines.push(`- Weighted pipeline (open deals): ${$(forecast.totalWeighted)}`);
  lines.push(`- Projected total (closed-won + weighted): ${$(forecast.projectedTotal)}`);
  lines.push(`- Pipeline coverage ratio (weighted pipeline / gap): ${coverageRatio === Infinity ? 'N/A (target met)' : coverageRatio.toFixed(2) + 'x'}`);
  lines.push(`- Forecast confidence: ${forecast.confidenceLevel}`);
  lines.push('');

  // ── Forecast Tier Breakdown ──
  lines.push(`## FORECAST TIERS`);
  lines.push(`| Tier | Deals | Raw ARR | Weighted ARR | Weight |`);
  lines.push(`|------|-------|---------|--------------|--------|`);
  for (const [tier, w] of Object.entries(forecast.tiers) as [string, { count: number; rawARR: number; weightedARR: number }][]) {
    const weight = { highly_likely: '85%', likely: '65%', possible: '40%', unlikely: '15%', insufficient_data: '30%' }[tier] || '';
    lines.push(`| ${tier} | ${w.count} | ${$(w.rawARR)} | ${$(w.weightedARR)} | ${weight} |`);
  }
  lines.push('');

  // ── Pacing ──
  lines.push(`## PACING`);
  lines.push(`- Total leads created (Q2): ${pacing.totalLeadsCreated} (required: ${pacing.totalLeadsRequired})`);
  lines.push(`- Total deals created (Q2): ${pacing.totalDealsCreated} (required: ${pacing.totalDealsRequired})`);
  lines.push('');
  if (pacing.sourceBreakdown.length > 0) {
    lines.push(`### Lead Source Pacing`);
    lines.push(`| Source | Created | Required | Status |`);
    lines.push(`|--------|---------|----------|--------|`);
    for (const src of pacing.sourceBreakdown) {
      lines.push(`| ${src.source} | ${src.totalCreated} | ${src.requiredTotal} | ${src.paceStatus} |`);
    }
    lines.push('');
  }

  // ── Weekly Closed-Won ──
  lines.push(`### Weekly Closed-Won ARR`);
  lines.push(`| Week | ARR | Deals |`);
  lines.push(`|------|-----|-------|`);
  for (const w of gt.weeklyActuals) {
    if (w.weekNumber > currentWeek) break;
    lines.push(`| Wk ${w.weekNumber} (${w.weekStart}) | ${$(w.closedWonARR)} | ${w.closedWonCount} |`);
  }
  lines.push('');

  // ── Initiatives ──
  if (initiatives.length > 0) {
    lines.push(`## STRATEGIC INITIATIVES`);
    for (const ini of initiatives) {
      lines.push(`### ${ini.name} (owner: ${ini.ownerLabel})`);
      lines.push(`- Leads: ${ini.leadsCreated} created vs ${ini.q2LeadTarget} target (${pct(ini.leadsCreated, ini.q2LeadTarget)})`);
      lines.push(`- Expected by now: ${ini.expectedByNow} leads`);
      lines.push(`- ARR generated: ${$(ini.arrGenerated)} vs ${$(ini.q2ArrTarget)} target`);
      lines.push(`- Closed-won ARR: ${$(ini.closedWonARR)}`);
      lines.push(`- Pace: ${ini.paceStatus}`);
      lines.push('');
    }
  }

  // ── Per-AE Performance ──
  lines.push(`## AE PERFORMANCE`);
  lines.push(`| AE | Q2 Target | Closed-Won | % to Target | Pipeline (weighted) | Best Qtr | Demo→Won | Create→Demo |`);
  lines.push(`|----|-----------|------------|-------------|---------------------|----------|----------|-------------|`);

  // Compute per-AE closed-won from closedWonDeals
  const aeClosedWon = new Map<string, number>();
  for (const d of gt.closedWonDeals) {
    const current = aeClosedWon.get(d.ownerName) || 0;
    aeClosedWon.set(d.ownerName, current + d.amount);
  }

  // Compute per-AE weighted pipeline from q2Deals
  const aePipeline = new Map<string, number>();
  for (const d of q2Deals) {
    if (!d.ownerName) continue;
    const current = aePipeline.get(d.ownerName) || 0;
    const weight = { highly_likely: 0.85, likely: 0.65, possible: 0.40, unlikely: 0.15, insufficient_data: 0.30 }[d.likelihoodTier] || 0.3;
    aePipeline.set(d.ownerName, current + d.amount * weight);
  }

  for (const ae of gt.aeData) {
    const won = aeClosedWon.get(ae.name) || 0;
    const pipe = aePipeline.get(ae.name) || 0;
    lines.push(`| ${ae.name} | ${$(ae.q2Target)} | ${$(won)} | ${pct(won, ae.q2Target)} | ${$(pipe)} | ${ae.bestQuarterLabel} (${$(ae.bestQuarterARR)}) | ${(ae.personalDemoToWon * 100).toFixed(0)}% | ${(ae.personalCreateToDemo * 100).toFixed(0)}% |`);
  }
  lines.push('');

  // ── Top Deals ──
  const sortedDeals = [...q2Deals].sort((a, b) => b.amount - a.amount);
  const topDeals = sortedDeals.slice(0, 20);

  lines.push(`## TOP 20 DEALS BY AMOUNT`);
  lines.push(`| Deal | Owner | Amount | Stage | Grade | LLM Status | Sentiment | Key Risk | Close Date | Likelihood |`);
  lines.push(`|------|-------|--------|-------|-------|------------|-----------|----------|------------|------------|`);
  for (const d of topDeals) {
    const daysToClose = d.closeDate ? Math.round((new Date(d.closeDate).getTime() - Date.now()) / 86400000) : null;
    const closeDateLabel = d.closeDate ? `${d.closeDate} (${daysToClose !== null && daysToClose < 0 ? 'OVERDUE by ' + Math.abs(daysToClose) + 'd' : daysToClose + 'd away'})` : 'No date';
    lines.push(`| ${d.dealName} | ${d.ownerName} | ${$(d.amount)} | ${d.stage} | ${d.overallGrade} (${d.overallScore}) | ${d.llmStatus || 'n/a'} | ${d.buyerSentiment || 'n/a'} | ${d.keyRisk || 'none flagged'} | ${closeDateLabel} | ${d.likelihoodTier} |`);
  }
  lines.push('');

  // ── At-Risk Deals ──
  const atRisk = q2Deals.filter(
    (d) => d.overallGrade === 'D' || d.overallGrade === 'F' || d.llmStatus === 'at_risk' || d.llmStatus === 'stalled'
  );
  if (atRisk.length > 0) {
    lines.push(`## DEALS AT RISK (${atRisk.length} deals)`);
    for (const d of atRisk) {
      lines.push(`- **${d.dealName}** (${d.ownerName}, ${$(d.amount)}): Grade ${d.overallGrade}, Status: ${d.llmStatus || 'n/a'}, Risk: ${d.keyRisk || 'none flagged'}, Action: ${d.recommendedAction || 'none'}`);
    }
    lines.push('');
  }

  // ── Historical Rates ──
  const rates = gt.historicalRates;
  lines.push(`## HISTORICAL CONVERSION RATES (Q1 2026 baseline)`);
  lines.push(`- Avg deal size: ${$(rates.avgDealSize)}`);
  lines.push(`- Demo→Won rate: ${(rates.demoToWonRate * 100).toFixed(1)}%`);
  lines.push(`- Create→Demo rate: ${(rates.createToDemoRate * 100).toFixed(1)}%`);
  lines.push(`- Avg cycle time (create→close): ${rates.avgCycleTime.toFixed(0)} days`);
  lines.push(`- Sample: ${rates.closedWonCount} closed-won deals, ${$(rates.totalWonARR)} ARR`);
  lines.push('');

  // ── Pipeline Credit ──
  const pc = gt.pipelineCredit;
  lines.push(`## PIPELINE INVENTORY`);
  lines.push(`- Post-demo (active): ${pc.postDemoCount} deals, ${$(pc.postDemoRawARR)} raw ARR`);
  lines.push(`- Pre-demo (active): ${pc.preDemoCount} deals, ${$(pc.preDemoRawARR)} raw ARR`);
  lines.push(`- Team-confirmed likely to close in Q2: ${pc.teamForecastCount} deals, ${$(pc.teamForecastARR)}`);
  if (pc.teamForecastByAE.length > 0) {
    for (const ae of pc.teamForecastByAE) {
      lines.push(`  - ${ae.name}: ${ae.count} deals, ${$(ae.arr)}`);
    }
  }
  lines.push('');

  // ── Closed-Won Deals List ──
  if (gt.closedWonDeals.length > 0) {
    lines.push(`## CLOSED-WON DEALS (Q2 to date)`);
    for (const d of gt.closedWonDeals) {
      lines.push(`- ${d.dealName} (${d.ownerName}): ${$(d.amount)}, closed week ${d.weekNumber}`);
    }
    lines.push('');
  }

  // ── Strategic Context ──
  if (data.strategicContext) {
    lines.push(`## STRATEGIC CONTEXT (Adi's org, goals, authority)`);
    lines.push(data.strategicContext);
    lines.push('');
  }

  return lines.join('\n');
}
