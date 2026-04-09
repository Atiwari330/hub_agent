/**
 * Markdown report formatter for the Strategic Advisor CLI.
 *
 * The Key Metrics Dashboard is computed deterministically from raw data
 * (not LLM-generated) to ensure accuracy. LLM prose goes in subsequent sections.
 */

import { Q2_TEAM_TARGET } from '@/lib/command-center/config';
import type { StrategicDataBundle } from './gather-data';

function $(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return (n / total * 100).toFixed(1) + '%';
}

export function formatStrategicReport(
  situationAssessment: string,
  opportunitiesAndThreats: string | null,
  actionPlan: string | null,
  executiveBriefing: string,
  data: StrategicDataBundle,
  options: { verbose: boolean; focus: string | null; brief: boolean },
): string {
  const today = new Date().toISOString().split('T')[0];
  const { goalTracker: gt, forecast, pacing, q2Deals } = data;
  const currentWeek = gt.progress.currentWeek;
  const closedWonARR = gt.weeklyActuals.reduce((s, w) => s + w.closedWonARR, 0);
  const gap = Math.max(0, Q2_TEAM_TARGET - closedWonARR);
  const weeksElapsed = currentWeek;
  const weeklyRunRate = weeksElapsed > 0 ? closedWonARR / weeksElapsed : 0;

  const lines: string[] = [];

  // ── Header ──
  lines.push(`# Strategic Advisor Report`);
  lines.push(`**Date:** ${today} | **Quarter:** Week ${currentWeek}/13 (${gt.progress.percentComplete.toFixed(0)}%) | **Focus:** ${options.focus || 'Full Analysis'} | **Mode:** ${options.brief ? 'Brief' : 'Deep'}`);
  lines.push('');

  // ── Key Metrics Dashboard (deterministic) ──
  lines.push(`## Key Metrics Dashboard`);
  lines.push('');
  lines.push(`| Metric | Value | Target | Progress |`);
  lines.push(`|--------|-------|--------|----------|`);
  lines.push(`| Closed-Won ARR | ${$(closedWonARR)} | ${$(Q2_TEAM_TARGET)} | ${pct(closedWonARR, Q2_TEAM_TARGET)} |`);
  lines.push(`| Weighted Pipeline | ${$(forecast.totalWeighted)} | — | — |`);
  lines.push(`| Projected Total | ${$(forecast.projectedTotal)} | ${$(Q2_TEAM_TARGET)} | ${pct(forecast.projectedTotal, Q2_TEAM_TARGET)} |`);
  lines.push(`| Gap to Target | ${$(gap)} | — | — |`);
  lines.push(`| Weekly Run Rate | ${$(weeklyRunRate)}/wk | — | — |`);
  lines.push(`| Forecast Confidence | ${forecast.confidenceLevel} | — | — |`);
  lines.push(`| Leads Created | ${pacing.totalLeadsCreated} | ${pacing.totalLeadsRequired} | ${pct(pacing.totalLeadsCreated, pacing.totalLeadsRequired)} |`);
  lines.push('');

  // ── Per-AE Performance ──
  const aeClosedWon = new Map<string, number>();
  for (const d of gt.closedWonDeals) {
    aeClosedWon.set(d.ownerName, (aeClosedWon.get(d.ownerName) || 0) + d.amount);
  }

  lines.push(`### AE Performance`);
  lines.push(`| AE | Target | Closed-Won | % to Target | Pipeline (weighted) |`);
  lines.push(`|----|--------|------------|-------------|---------------------|`);

  const aePipeline = new Map<string, number>();
  for (const d of q2Deals) {
    if (!d.ownerName) continue;
    const weight = { highly_likely: 0.85, likely: 0.65, possible: 0.40, unlikely: 0.15, insufficient_data: 0.30 }[d.likelihoodTier] || 0.3;
    aePipeline.set(d.ownerName, (aePipeline.get(d.ownerName) || 0) + d.amount * weight);
  }

  for (const ae of gt.aeData) {
    const won = aeClosedWon.get(ae.name) || 0;
    const pipe = aePipeline.get(ae.name) || 0;
    lines.push(`| ${ae.name} | ${$(ae.q2Target)} | ${$(won)} | ${pct(won, ae.q2Target)} | ${$(pipe)} |`);
  }
  lines.push('');

  // ── LLM Analysis Sections ──
  lines.push(`---`);
  lines.push('');

  lines.push(`## Situation Assessment`);
  lines.push('');
  lines.push(situationAssessment);
  lines.push('');

  if (actionPlan) {
    lines.push(`---`);
    lines.push('');
    lines.push(`## Strategic Action Plan`);
    lines.push('');
    lines.push(actionPlan);
    lines.push('');
  }

  if (opportunitiesAndThreats) {
    lines.push(`---`);
    lines.push('');
    lines.push(`## Opportunities & Threats`);
    lines.push('');
    lines.push(opportunitiesAndThreats);
    lines.push('');
  }

  lines.push(`---`);
  lines.push('');
  lines.push(`## Executive Briefing & Career Positioning`);
  lines.push('');
  lines.push(executiveBriefing);
  lines.push('');

  // ── Verbose: raw data appendix ──
  if (options.verbose) {
    lines.push(`---`);
    lines.push('');
    lines.push(`## Appendix: Raw Data`);
    lines.push('');

    lines.push(`### All Q2 Deals (${q2Deals.length})`);
    lines.push(`| Deal | Owner | Amount | Stage | Grade | Likelihood | Close Date |`);
    lines.push(`|------|-------|--------|-------|-------|------------|------------|`);
    for (const d of [...q2Deals].sort((a, b) => b.amount - a.amount)) {
      lines.push(`| ${d.dealName} | ${d.ownerName} | ${$(d.amount)} | ${d.stage} | ${d.overallGrade} | ${d.likelihoodTier} | ${d.closeDate || 'n/a'} |`);
    }
    lines.push('');

    lines.push(`### Weekly Pacing`);
    lines.push(`| Week | Start | Leads | Demos | Closed-Won ARR |`);
    lines.push(`|------|-------|-------|-------|----------------|`);
    for (const w of data.pacing.weeklyRows) {
      lines.push(`| ${w.weekNumber} | ${w.weekStart} | ${w.leadsCreated} | ${w.dealsToDemo} | ${$(w.closedWonARR)} |`);
    }
    lines.push('');

    lines.push(`### Forecast Tier Detail`);
    for (const [tier, info] of Object.entries(forecast.tiers)) {
      if (info.count === 0) continue;
      lines.push(`**${tier}** (${info.count} deals, ${$(info.rawARR)} raw, ${$(info.weightedARR)} weighted)`);
      const tierDeals = q2Deals.filter((d) => d.likelihoodTier === tier).sort((a, b) => b.amount - a.amount);
      for (const d of tierDeals) {
        lines.push(`- ${d.dealName} (${d.ownerName}): ${$(d.amount)} — ${d.stage}, grade ${d.overallGrade}`);
      }
      lines.push('');
    }
  }

  lines.push(`---`);
  lines.push(`*Generated by Strategic Advisor CLI on ${today} using Claude Opus 4.6*`);

  return lines.join('\n');
}
