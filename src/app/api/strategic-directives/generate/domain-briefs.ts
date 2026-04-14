/**
 * Phase 2: Domain Briefs
 *
 * Six parallel Opus calls, each producing a ~500-word compressed strategic brief
 * for one operational domain. These briefs become the input to Phase 3.
 */

import { generateText } from 'ai';
import { getDeepSeekModel } from '@/lib/ai/provider';
import type { ExtractedData, DomainBrief, DomainBriefs } from './types';

// --- Brief Generation ---

const BRIEF_SYSTEM_PROMPT = `You are a senior operations analyst compressing operational data into a strategic intelligence brief for executive decision-making.

Your brief must be ruthlessly concise. Every word must carry strategic signal. No filler, no hedging, no generic observations.

Respond in this EXACT format:

===TOP_3_FINDINGS===
1. [Most important finding with specific numbers]
2. [Second most important finding]
3. [Third most important finding]

===KEY_METRICS===
[3-5 bullet points of the most important quantitative metrics]

===CRITICAL_RISKS===
[Top 2-3 risks with specific evidence. If no critical risks, write "None identified."]

===BRIGHT_SPOTS===
[Top 1-3 positive signals worth reinforcing. If none, write "None identified."]

Keep total output under 500 words. Cite specific names, IDs, and numbers from the data.`;

function parseBrief(domain: string, text: string): DomainBrief {
  const topFindings = text.match(/===TOP_3_FINDINGS===([\s\S]*?)(?====|$)/)?.[1]?.trim() || '';
  const keyMetrics = text.match(/===KEY_METRICS===([\s\S]*?)(?====|$)/)?.[1]?.trim() || '';
  const criticalRisks = text.match(/===CRITICAL_RISKS===([\s\S]*?)(?====|$)/)?.[1]?.trim() || '';
  const brightSpots = text.match(/===BRIGHT_SPOTS===([\s\S]*?)(?====|$)/)?.[1]?.trim() || '';

  return {
    domain,
    topFindings,
    keyMetrics,
    criticalRisks,
    brightSpots,
    rawText: text,
  };
}

async function generateBrief(
  domain: string,
  userPrompt: string
): Promise<DomainBrief> {
  const { text } = await generateText({
    model: getDeepSeekModel(),
    system: BRIEF_SYSTEM_PROMPT,
    prompt: userPrompt,
  });

  return parseBrief(domain, text);
}

// --- Per-Domain User Prompts ---

function buildDealPipelinePrompt(data: ExtractedData): string {
  const stats = data.domains.dealHealth.stats;
  const coachStats = data.domains.dealCoaching.stats;

  const lines = [
    'Analyze the DEAL PIPELINE health for executive strategic planning.\n',
    '=== DEAL HEALTH STATS ===',
    `Total deals: ${stats.totalDeals}`,
    `Average score: ${stats.avgScore}/100`,
    `Grade distribution: ${JSON.stringify(stats.gradeDistribution)}`,
    `Status distribution: ${JSON.stringify(stats.statusDistribution)}`,
    `At-risk deals: ${stats.atRiskCount}`,
    `Stalled deals: ${stats.stalledCount}`,
    `Total pipeline value: $${Number(stats.totalPipelineValue).toLocaleString()}`,
    '',
    '=== DEAL COACHING STATS ===',
    `Total coached: ${coachStats.totalDeals}`,
    `Urgency distribution: ${JSON.stringify(coachStats.urgencyDistribution)}`,
    `Status distribution: ${JSON.stringify(coachStats.statusDistribution)}`,
    '',
    '=== INDIVIDUAL DEALS ===',
    data.domains.dealHealth.compressed,
  ];

  return lines.join('\n');
}

function buildSupportOperationsPrompt(data: ExtractedData): string {
  const qualityStats = data.domains.supportQuality.stats;
  const sopStats = data.domains.sopCompliance.stats;
  const triageStats = data.domains.supportTriage.stats;

  const lines = [
    'Analyze SUPPORT OPERATIONS quality for executive strategic planning.\n',
    '=== QUALITY STATS ===',
    `Total tickets analyzed: ${qualityStats.totalTickets}`,
    `Average quality score: ${qualityStats.avgScore}/100`,
    `Grade distribution: ${JSON.stringify(qualityStats.gradeDistribution)}`,
    `Open: ${qualityStats.openCount}, Closed: ${qualityStats.closedCount}`,
    '',
    '=== SOP COMPLIANCE STATS ===',
    `Total SOP audits: ${sopStats.totalTickets}`,
    `Average compliance score: ${sopStats.avgScore}/100`,
    `SOP gaps identified: ${sopStats.gapCount}`,
    `Grade distribution: ${JSON.stringify(sopStats.gradeDistribution)}`,
    '',
    '=== TRIAGE STATS ===',
    `Total triaged: ${triageStats.totalTriaged}`,
    `Urgency distribution: ${JSON.stringify(triageStats.urgencyDistribution)}`,
    `Action owner distribution: ${JSON.stringify(triageStats.ownerDistribution)}`,
    `Stale tickets (>3d no activity): ${triageStats.staleCount}`,
    `With Linear escalation: ${triageStats.withLinear}`,
    '',
    '=== QUALITY ANALYSES (worst first) ===',
    data.domains.supportQuality.compressed,
    '',
    '=== TRIAGE DATA ===',
    data.domains.supportTriage.compressed,
  ];

  return lines.join('\n');
}

function buildRcmBillingPrompt(data: ExtractedData): string {
  const stats = data.domains.rcmAudit.stats;

  const lines = [
    'Analyze RCM & BILLING issues for executive strategic planning.\n',
    '=== RCM STATS ===',
    `Total RCM-related tickets: ${stats.totalRcmTickets}`,
    `Severity distribution: ${JSON.stringify(stats.severityDistribution)}`,
    `System distribution: ${JSON.stringify(stats.systemDistribution)}`,
    `Category distribution: ${JSON.stringify(stats.categoryDistribution)}`,
    `Vendor-blamed issues: ${stats.vendorBlamedCount}`,
    '',
    '=== RCM TICKET DETAILS ===',
    data.domains.rcmAudit.compressed,
  ];

  return lines.join('\n');
}

function buildCustomerHealthPrompt(data: ExtractedData): string {
  const stats = data.domains.companyHealth.stats;

  const lines = [
    'Analyze CUSTOMER HEALTH for executive strategic planning. Focus on churn risk, expansion opportunities, and relationship patterns.\n',
    '=== COMPANY STATS ===',
    `Total companies: ${stats.totalCompanies}`,
    `Total ARR: $${Number(stats.totalArr).toLocaleString()}`,
    `At-risk companies: ${stats.atRiskCount}`,
    `Health distribution: ${JSON.stringify(stats.healthDistribution)}`,
    `Contract status distribution: ${JSON.stringify(stats.contractDistribution)}`,
    '',
    '=== COMPANY DETAILS (by ARR descending) ===',
    data.domains.companyHealth.compressed,
  ];

  return lines.join('\n');
}

function buildTeamPerformancePrompt(data: ExtractedData): string {
  const rollups = data.correlations.ownerRollups;

  const lines = [
    'Analyze TEAM PERFORMANCE across all operational domains for executive strategic planning.\n',
    `Total team members tracked: ${rollups.length}`,
    '',
    '=== CROSS-DOMAIN TEAM PERFORMANCE ===',
  ];

  for (const r of rollups) {
    lines.push(
      `${r.ownerName} | Deals:${r.dealCount} AvgGrade:${r.avgDealGrade || 'N/A'} AtRisk:${r.atRiskDeals} | Tickets:${r.ticketCount} AvgQuality:${r.avgTicketQuality ?? 'N/A'} | FollowUp:${r.followUpCompliance || 'N/A'}`
    );
  }

  return lines.join('\n');
}

function buildPipelineVelocityPrompt(data: ExtractedData): string {
  const trends = data.correlations.temporalTrends;
  const stats = data.domains.dealHealth.stats;

  const lines = [
    'Analyze PIPELINE VELOCITY and temporal trends for executive strategic planning.\n',
    '=== DEAL PIPELINE OVERVIEW ===',
    `Total pipeline value: $${Number(stats.totalPipelineValue).toLocaleString()}`,
    `Total deals: ${stats.totalDeals}`,
    `At-risk: ${stats.atRiskCount}, Stalled: ${stats.stalledCount}`,
    '',
    '=== WEEKLY TRENDS ===',
    'Week | New Tickets | Closed Tickets | Deals Closed',
  ];

  for (const t of trends.slice(-12)) {
    lines.push(`${t.week} | ${t.newTickets} | ${t.closedTickets} | ${t.dealsClosed}`);
  }

  lines.push('');
  lines.push('=== FOLLOW-UP COMPLIANCE ===');
  const fuStats = data.domains.followUps.stats;
  lines.push(`Total follow-ups tracked: ${fuStats.totalFollowUps}`);
  lines.push(`Urgency distribution: ${JSON.stringify(fuStats.urgencyDistribution)}`);
  lines.push(`Confirmed violations: ${fuStats.confirmedCount}`);
  lines.push(`Violation types: ${JSON.stringify(fuStats.violationDistribution)}`);

  return lines.join('\n');
}

// --- Main Brief Generator ---

export async function generateAllBriefs(data: ExtractedData): Promise<DomainBriefs> {
  const [dealPipeline, supportOperations, rcmBilling, customerHealth, teamPerformance, pipelineVelocity] =
    await Promise.all([
      generateBrief('deal_pipeline', buildDealPipelinePrompt(data)),
      generateBrief('support_operations', buildSupportOperationsPrompt(data)),
      generateBrief('rcm_billing', buildRcmBillingPrompt(data)),
      generateBrief('customer_health', buildCustomerHealthPrompt(data)),
      generateBrief('team_performance', buildTeamPerformancePrompt(data)),
      generateBrief('pipeline_velocity', buildPipelineVelocityPrompt(data)),
    ]);

  return {
    dealPipeline,
    supportOperations,
    rcmBilling,
    customerHealth,
    teamPerformance,
    pipelineVelocity,
  };
}
