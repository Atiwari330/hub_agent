/**
 * Prompts for Phase 3: Cross-Domain Strategic Synthesis
 */

import type {
  DomainBriefs,
  CrossDomainCorrelations,
  StrategicFocus,
} from './types';

// --- Company Context ---

const COMPANY_CONTEXT = `
Organization: Opus Behavioral Health — a healthcare SaaS company serving behavioral health practices.

Key Roles:
- VP of RevOps (Adi): Revenue operations, cross-functional process optimization, strategic direction
- VP of Support: Support strategy, escalation authority, SLA accountability
- Support Manager: Day-to-day ticket triage, team workload, process enforcement
- Support Engineers: Front-line ticket resolution, customer communication
- Account Executives (AEs): Deal progression, pipeline management, customer acquisition
  - Chris Garraffa, Jill Rice, Adi Tiwari
- Customer Success Managers (CSMs): Account health, renewal management, expansion
- Engineering Team: Bug fixes, feature requests, technical escalations (via Linear)

Revenue Model: SaaS — ARR-based with monthly/annual contracts. Includes EHR platform + RCM billing services.

Key Products: EHR (scheduling, clinical documentation, TO DO lists), RCM (claims, billing, remittance), Practice Management.
`.trim();

// --- System Prompt ---

export function buildStrategicSystemPrompt(): string {
  return `You are the strategic intelligence engine for a revenue operations organization. You have been given compressed intelligence briefs from every operational domain — deals, support, customers, team performance, pipeline velocity, and billing/RCM.

${COMPANY_CONTEXT}

Your job is to synthesize these briefs into STRATEGIC DIRECTIVES — not summaries, not observations, but prioritized, sequenced, actionable commands that a VP of RevOps would execute to maximize organizational performance.

Think like a brilliant executive who can see everything simultaneously. Your directives should:
1. Identify root causes that span multiple domains (a support quality issue affecting deal progression, a team performance gap driving churn risk)
2. Sequence actions by dependency and ROI (what must happen first to unlock downstream improvements)
3. Assign specific owners and deadlines
4. Estimate revenue impact where possible
5. Surface patterns only visible when looking across ALL domains together

Respond in the following structured format. Use the EXACT section headers and delimiters shown.

===DIRECTIVES===
List 5-10 strategic directives, one per block, separated by blank lines:

RANK: [1-10]
TITLE: [Short imperative, e.g., "Rescue the Acme Corp relationship"]
DOMAIN: [deals|support|company_health|team|process|cross_domain]
URGENCY: [immediate|this_week|this_month|this_quarter]
REV_IMPACT: [e.g., "$50K ARR at risk" or "Unlock $120K pipeline"]
ROOT_CAUSE: [2-3 sentences on WHY this matters, connecting evidence across domains]
ACTIONS:
  1. [Specific action] | OWNER: [Role or name] | BY: [deadline]
  2. [Specific action] | OWNER: [Role or name] | BY: [deadline]
  3. [Specific action] | OWNER: [Role or name] | BY: [deadline]
EVIDENCE: [Specific ticket IDs, deal names, company names, metrics]
DEPENDS_ON: [Comma-separated ranks of directives this depends on, or "none"]
SUCCESS_METRIC: [How to know this directive succeeded]

===CROSS_DOMAIN_INSIGHTS===
List 3-5 cross-domain insights, one per line:
INSIGHT: [Pattern or connection] | DOMAINS: [comma-separated domains involved] | EVIDENCE: [specific data points] | IMPLICATION: [so what — what should change]

===SCORECARD===
DEAL_PIPELINE: GRADE: [A-F] | TREND: [improving|stable|declining] | SUMMARY: [1 sentence]
SUPPORT_QUALITY: GRADE: [A-F] | TREND: [improving|stable|declining] | SUMMARY: [1 sentence]
CUSTOMER_HEALTH: GRADE: [A-F] | TREND: [improving|stable|declining] | SUMMARY: [1 sentence]
TEAM_PERFORMANCE: GRADE: [A-F] | TREND: [improving|stable|declining] | SUMMARY: [1 sentence]
PROCESS_COMPLIANCE: GRADE: [A-F] | TREND: [improving|stable|declining] | SUMMARY: [1 sentence]

===STRATEGIC_HORIZON===
30D_THEME: [theme]
30D_OBJECTIVES: [objective 1]; [objective 2]; [objective 3]
30D_KEY_RESULTS: [KR 1]; [KR 2]; [KR 3]
60D_THEME: [theme]
60D_OBJECTIVES: [objective 1]; [objective 2]; [objective 3]
60D_KEY_RESULTS: [KR 1]; [KR 2]; [KR 3]
90D_THEME: [theme]
90D_OBJECTIVES: [objective 1]; [objective 2]; [objective 3]
90D_KEY_RESULTS: [KR 1]; [KR 2]; [KR 3]

Guidelines:
- Be SPECIFIC — cite actual ticket IDs, deal names, company names, rep names, dollar amounts
- Every directive must have evidence from the briefs
- Cross-domain insights are the highest-value output — these are patterns NO SINGLE domain analysis can see
- Sequence matters: if Directive #2 depends on #1, say so explicitly
- Revenue impact should be grounded in actual ARR/pipeline data, not guesses
- The 30/60/90 strategy should build progressively — 30d is tactical, 60d is operational, 90d is strategic`;
}

// --- User Prompt ---

export function buildStrategicUserPrompt(
  briefs: DomainBriefs,
  correlations: CrossDomainCorrelations,
  focus?: StrategicFocus
): string {
  const lines: string[] = [];

  if (focus) {
    lines.push(`STRATEGIC FOCUS: The VP has asked you to particularly focus on "${focus}" in your analysis. Weight your directives and insights accordingly, but do not ignore critical issues in other areas.\n`);
  }

  lines.push('Below are intelligence briefs from all operational domains, followed by cross-domain correlation data.\n');

  // Domain briefs
  lines.push('============================================================');
  lines.push('DOMAIN BRIEF: DEAL PIPELINE');
  lines.push('============================================================');
  lines.push(briefs.dealPipeline.rawText);
  lines.push('');

  lines.push('============================================================');
  lines.push('DOMAIN BRIEF: SUPPORT OPERATIONS');
  lines.push('============================================================');
  lines.push(briefs.supportOperations.rawText);
  lines.push('');

  lines.push('============================================================');
  lines.push('DOMAIN BRIEF: RCM & BILLING');
  lines.push('============================================================');
  lines.push(briefs.rcmBilling.rawText);
  lines.push('');

  lines.push('============================================================');
  lines.push('DOMAIN BRIEF: CUSTOMER HEALTH');
  lines.push('============================================================');
  lines.push(briefs.customerHealth.rawText);
  lines.push('');

  lines.push('============================================================');
  lines.push('DOMAIN BRIEF: TEAM PERFORMANCE');
  lines.push('============================================================');
  lines.push(briefs.teamPerformance.rawText);
  lines.push('');

  lines.push('============================================================');
  lines.push('DOMAIN BRIEF: PIPELINE VELOCITY & TRENDS');
  lines.push('============================================================');
  lines.push(briefs.pipelineVelocity.rawText);
  lines.push('');

  // Cross-domain correlations
  lines.push('============================================================');
  lines.push('CROSS-DOMAIN: COMPANY ROLLUPS');
  lines.push('============================================================');
  lines.push('Company | Tickets | AvgQuality | OpenTickets | Critical | HealthScore | ARR | ContractStatus | ContractEnd');
  for (const r of correlations.companyRollups.slice(0, 30)) {
    lines.push(
      `${r.companyName} | ${r.ticketCount} | ${r.avgQualityScore ?? 'N/A'} | ${r.openTickets} | ${r.criticalTickets} | ${r.healthScore || 'N/A'} | $${Number(r.arr || 0).toLocaleString()} | ${r.contractStatus || 'N/A'} | ${r.contractEnd || 'N/A'}`
    );
  }
  lines.push('');

  lines.push('============================================================');
  lines.push('CROSS-DOMAIN: OWNER/REP ROLLUPS');
  lines.push('============================================================');
  lines.push('Owner | Deals | DealGrade | AtRisk | Tickets | AvgQuality | FollowUp');
  for (const r of correlations.ownerRollups) {
    lines.push(
      `${r.ownerName} | ${r.dealCount} | ${r.avgDealGrade || 'N/A'} | ${r.atRiskDeals} | ${r.ticketCount} | ${r.avgTicketQuality ?? 'N/A'} | ${r.followUpCompliance || 'N/A'}`
    );
  }
  lines.push('');

  // Temporal trends (last 8 weeks)
  if (correlations.temporalTrends.length > 0) {
    lines.push('============================================================');
    lines.push('CROSS-DOMAIN: WEEKLY TRENDS');
    lines.push('============================================================');
    lines.push('Week | NewTickets | ClosedTickets | DealsClosed');
    for (const t of correlations.temporalTrends.slice(-8)) {
      lines.push(`${t.week} | ${t.newTickets} | ${t.closedTickets} | ${t.dealsClosed}`);
    }
    lines.push('');
  }

  lines.push('============================================================');
  lines.push('Produce your strategic directives now.');
  lines.push('============================================================');

  return lines.join('\n');
}
