/**
 * Parsers for Phase 3 output — structured extraction from LLM response
 */

import type {
  Directive,
  DirectiveDomain,
  DirectiveUrgency,
  CrossDomainInsight,
  OperationalScorecard,
  ScorecardEntry,
  StrategicHorizonEntry,
  StrategicDirectivesReport,
  DomainBriefs,
  DomainDataSource,
} from './types';

// --- Directive Parser ---

function parseDirectives(text: string): Directive[] {
  const section = text.match(/===DIRECTIVES===([\s\S]*?)(?====[A-Z]|$)/)?.[1]?.trim();
  if (!section) return [];

  const directives: Directive[] = [];
  // Split by RANK: to get individual directive blocks
  const blocks = section.split(/(?=RANK:\s*\d)/);

  for (const block of blocks) {
    if (!block.trim()) continue;

    const rankM = block.match(/RANK:\s*(\d+)/);
    const titleM = block.match(/TITLE:\s*(.+)/);
    const domainM = block.match(/DOMAIN:\s*(\w+)/);
    const urgencyM = block.match(/URGENCY:\s*(\w+)/);
    const revM = block.match(/REV_IMPACT:\s*(.+)/);
    const rootM = block.match(/ROOT_CAUSE:\s*([\s\S]*?)(?=ACTIONS:|$)/);
    const evidenceM = block.match(/EVIDENCE:\s*(.+)/);
    const dependsM = block.match(/DEPENDS_ON:\s*(.+)/);
    const metricM = block.match(/SUCCESS_METRIC:\s*(.+)/);

    // Parse actions
    const actionsSection = block.match(/ACTIONS:\s*([\s\S]*?)(?=EVIDENCE:|$)/)?.[1] || '';
    const actionLines = actionsSection
      .split('\n')
      .filter((l) => l.trim().match(/^\d+\./));

    const actions = actionLines.map((line, i) => {
      const actionText = line.replace(/^\s*\d+\.\s*/, '');
      const ownerM = actionText.match(/OWNER:\s*([^|]+)/i);
      const byM = actionText.match(/BY:\s*(.+)/i);
      const action = actionText
        .replace(/\|?\s*OWNER:.*$/i, '')
        .trim();

      return {
        step: i + 1,
        action,
        owner: ownerM?.[1]?.trim() || 'TBD',
        deadline: byM?.[1]?.trim() || 'TBD',
      };
    });

    // Parse depends_on
    const dependsOnStr = dependsM?.[1]?.trim() || '';
    const dependsOn =
      dependsOnStr.toLowerCase() === 'none' || !dependsOnStr
        ? []
        : dependsOnStr
            .split(',')
            .map((s) => parseInt(s.trim()))
            .filter((n) => !isNaN(n));

    // Validate domain
    const validDomains: DirectiveDomain[] = [
      'deals',
      'support',
      'company_health',
      'team',
      'process',
      'cross_domain',
    ];
    const domain = validDomains.includes(domainM?.[1] as DirectiveDomain)
      ? (domainM![1] as DirectiveDomain)
      : 'cross_domain';

    // Validate urgency
    const validUrgencies: DirectiveUrgency[] = [
      'immediate',
      'this_week',
      'this_month',
      'this_quarter',
    ];
    const urgency = validUrgencies.includes(urgencyM?.[1] as DirectiveUrgency)
      ? (urgencyM![1] as DirectiveUrgency)
      : 'this_month';

    if (rankM && titleM) {
      directives.push({
        rank: parseInt(rankM[1]),
        title: titleM[1].trim(),
        domain,
        urgency,
        estimatedRevImpact: revM?.[1]?.trim() || 'Not estimated',
        rootCause: rootM?.[1]?.trim() || '',
        actions,
        evidence: evidenceM?.[1]
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean) || [],
        dependsOn,
        successMetric: metricM?.[1]?.trim() || '',
      });
    }
  }

  return directives.sort((a, b) => a.rank - b.rank);
}

// --- Cross-Domain Insights Parser ---

function parseCrossDomainInsights(text: string): CrossDomainInsight[] {
  const section = text.match(
    /===CROSS_DOMAIN_INSIGHTS===([\s\S]*?)(?====[A-Z]|$)/
  )?.[1]?.trim();
  if (!section) return [];

  const insights: CrossDomainInsight[] = [];
  const lines = section.split('\n').filter((l) => l.trim());

  for (const line of lines) {
    const insightM = line.match(/INSIGHT:\s*([^|]+)/i);
    const domainsM = line.match(/DOMAINS:\s*([^|]+)/i);
    const evidenceM = line.match(/EVIDENCE:\s*([^|]+)/i);
    const implM = line.match(/IMPLICATION:\s*(.+)/i);

    if (insightM) {
      insights.push({
        insight: insightM[1].trim(),
        domains: domainsM?.[1]
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean) || [],
        evidence: evidenceM?.[1]?.trim() || '',
        implication: implM?.[1]?.trim() || '',
      });
    }
  }

  return insights;
}

// --- Scorecard Parser ---

function parseScorecardEntry(line: string): ScorecardEntry {
  const gradeM = line.match(/GRADE:\s*([A-F])/i);
  const trendM = line.match(/TREND:\s*(improving|stable|declining)/i);
  const summaryM = line.match(/SUMMARY:\s*(.+)/i);

  return {
    grade: gradeM?.[1] || 'C',
    trend: (trendM?.[1] as ScorecardEntry['trend']) || 'stable',
    summary: summaryM?.[1]?.trim() || '',
  };
}

function parseScorecard(text: string): OperationalScorecard {
  const section = text.match(
    /===SCORECARD===([\s\S]*?)(?====[A-Z]|$)/
  )?.[1]?.trim();

  const lines = (section || '').split('\n').filter((l) => l.trim());

  const findLine = (prefix: string) =>
    lines.find((l) => l.startsWith(prefix)) || '';

  return {
    dealPipelineHealth: parseScorecardEntry(findLine('DEAL_PIPELINE:')),
    supportQuality: parseScorecardEntry(findLine('SUPPORT_QUALITY:')),
    customerHealth: parseScorecardEntry(findLine('CUSTOMER_HEALTH:')),
    teamPerformance: parseScorecardEntry(findLine('TEAM_PERFORMANCE:')),
    processCompliance: parseScorecardEntry(findLine('PROCESS_COMPLIANCE:')),
  };
}

// --- Strategic Horizon Parser ---

function parseHorizonEntry(
  text: string,
  prefix: string
): StrategicHorizonEntry {
  const section = text.match(
    /===STRATEGIC_HORIZON===([\s\S]*?)(?====[A-Z]|$)/
  )?.[1]?.trim() || '';

  const themeM = section.match(new RegExp(`${prefix}_THEME:\\s*(.+)`, 'i'));
  const objM = section.match(new RegExp(`${prefix}_OBJECTIVES:\\s*(.+)`, 'i'));
  const krM = section.match(new RegExp(`${prefix}_KEY_RESULTS:\\s*(.+)`, 'i'));

  return {
    theme: themeM?.[1]?.trim() || '',
    objectives: objM?.[1]
      ?.split(';')
      .map((s) => s.trim())
      .filter(Boolean) || [],
    keyResults: krM?.[1]
      ?.split(';')
      .map((s) => s.trim())
      .filter(Boolean) || [],
  };
}

// --- Main Parser ---

export function parseStrategicResponse(
  text: string,
  reasoning: string,
  briefs: DomainBriefs,
  dataSources: DomainDataSource[],
  timings: { phase1Ms: number; phase2Ms: number; phase3Ms: number }
): StrategicDirectivesReport {
  const directives = parseDirectives(text);
  const crossDomainInsights = parseCrossDomainInsights(text);
  const operationalScorecard = parseScorecard(text);

  const strategicHorizon = {
    thirtyDay: parseHorizonEntry(text, '30D'),
    sixtyDay: parseHorizonEntry(text, '60D'),
    ninetyDay: parseHorizonEntry(text, '90D'),
  };

  const domainBriefs: Record<string, string> = {
    deal_pipeline: briefs.dealPipeline.rawText,
    support_operations: briefs.supportOperations.rawText,
    rcm_billing: briefs.rcmBilling.rawText,
    customer_health: briefs.customerHealth.rawText,
    team_performance: briefs.teamPerformance.rawText,
    pipeline_velocity: briefs.pipelineVelocity.rawText,
  };

  return {
    generatedAt: new Date().toISOString(),
    dataSources,
    thinkingOutput: reasoning,
    directives,
    crossDomainInsights,
    operationalScorecard,
    strategicHorizon,
    domainBriefs,
    phase1DurationMs: timings.phase1Ms,
    phase2DurationMs: timings.phase2Ms,
    phase3DurationMs: timings.phase3Ms,
    totalDurationMs: timings.phase1Ms + timings.phase2Ms + timings.phase3Ms,
  };
}
