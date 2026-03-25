/**
 * Strategic Directives Engine — CLI Runner
 *
 * Three-phase pipeline that analyzes all operational domains and produces
 * cross-domain strategic directives for executive decision-making.
 *
 * Usage:
 *   npx tsx src/scripts/run-strategic-directives.ts [options]
 *
 * Options:
 *   --time-range=30d       Time window for data: 7d, 30d, 90d (default: 30d)
 *   --focus=revenue        Strategic focus: revenue, churn, efficiency (optional)
 *   --phase1-only          Run only Phase 1 (data extraction, no LLM calls)
 *   --phase2-only          Run Phase 1 + 2 (extraction + domain briefs, no final synthesis)
 *   --output=FILE          Write markdown + JSON report to file
 *   --thinking-budget=N    Extended thinking token budget (default: 32000)
 *   --verbose              Print domain briefs and thinking output
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/client';
import { extractAllDomains } from '../app/api/strategic-directives/generate/domain-extractors';
import { generateAllBriefs } from '../app/api/strategic-directives/generate/domain-briefs';
import { runCrossDomainSynthesis } from '../app/api/strategic-directives/generate/cross-domain-synthesis';
import type {
  StrategicDirectivesReport,
  StrategicFocus,
  TimeRange,
} from '../app/api/strategic-directives/generate/types';
import * as fs from 'fs';

// --- Arg Parsing ---

interface Args {
  timeRange: TimeRange;
  focus?: StrategicFocus;
  phase1Only: boolean;
  phase2Only: boolean;
  output?: string;
  thinkingBudget: number;
  verbose: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    timeRange: '30d',
    phase1Only: false,
    phase2Only: false,
    thinkingBudget: 32000,
    verbose: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--time-range=')) {
      const val = arg.split('=')[1] as TimeRange;
      if (['7d', '30d', '90d'].includes(val)) args.timeRange = val;
    } else if (arg.startsWith('--focus=')) {
      const val = arg.split('=')[1] as StrategicFocus;
      if (['revenue', 'churn', 'efficiency'].includes(val)) args.focus = val;
    } else if (arg === '--phase1-only') {
      args.phase1Only = true;
    } else if (arg === '--phase2-only') {
      args.phase2Only = true;
    } else if (arg.startsWith('--output=')) {
      args.output = arg.split('=')[1];
    } else if (arg.startsWith('--thinking-budget=')) {
      args.thinkingBudget = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--verbose') {
      args.verbose = true;
    }
  }

  return args;
}

// --- Report Formatting ---

function formatReport(report: StrategicDirectivesReport): string {
  const lines: string[] = [];

  lines.push('# Strategic Directives Report');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Total pipeline time: ${(report.totalDurationMs / 1000).toFixed(1)}s (Phase 1: ${(report.phase1DurationMs / 1000).toFixed(1)}s, Phase 2: ${(report.phase2DurationMs / 1000).toFixed(1)}s, Phase 3: ${(report.phase3DurationMs / 1000).toFixed(1)}s)`);
  lines.push('');

  // Data sources
  lines.push('## Data Sources');
  for (const ds of report.dataSources) {
    lines.push(`- **${ds.domain}**: ${ds.recordCount} records (${ds.dateRange})`);
  }
  lines.push('');

  // Operational Scorecard
  lines.push('## Operational Scorecard');
  lines.push('| Domain | Grade | Trend | Summary |');
  lines.push('|--------|-------|-------|---------|');
  const sc = report.operationalScorecard;
  lines.push(`| Deal Pipeline | ${sc.dealPipelineHealth.grade} | ${sc.dealPipelineHealth.trend} | ${sc.dealPipelineHealth.summary} |`);
  lines.push(`| Support Quality | ${sc.supportQuality.grade} | ${sc.supportQuality.trend} | ${sc.supportQuality.summary} |`);
  lines.push(`| Customer Health | ${sc.customerHealth.grade} | ${sc.customerHealth.trend} | ${sc.customerHealth.summary} |`);
  lines.push(`| Team Performance | ${sc.teamPerformance.grade} | ${sc.teamPerformance.trend} | ${sc.teamPerformance.summary} |`);
  lines.push(`| Process Compliance | ${sc.processCompliance.grade} | ${sc.processCompliance.trend} | ${sc.processCompliance.summary} |`);
  lines.push('');

  // Strategic Directives
  lines.push('## Strategic Directives');
  lines.push('');
  for (const d of report.directives) {
    lines.push(`### #${d.rank}: ${d.title}`);
    lines.push(`**Domain:** ${d.domain} | **Urgency:** ${d.urgency} | **Rev Impact:** ${d.estimatedRevImpact}`);
    if (d.dependsOn.length > 0) {
      lines.push(`**Depends on:** Directive(s) #${d.dependsOn.join(', #')}`);
    }
    lines.push('');
    lines.push(`**Root Cause:** ${d.rootCause}`);
    lines.push('');
    lines.push('**Actions:**');
    for (const a of d.actions) {
      lines.push(`${a.step}. ${a.action} — **${a.owner}** (by ${a.deadline})`);
    }
    lines.push('');
    if (d.evidence.length > 0) {
      lines.push(`**Evidence:** ${d.evidence.join(', ')}`);
    }
    lines.push(`**Success Metric:** ${d.successMetric}`);
    lines.push('');
  }

  // Cross-Domain Insights
  if (report.crossDomainInsights.length > 0) {
    lines.push('## Cross-Domain Insights');
    for (const ci of report.crossDomainInsights) {
      lines.push(`- **${ci.insight}**`);
      lines.push(`  - Domains: ${ci.domains.join(', ')}`);
      lines.push(`  - Evidence: ${ci.evidence}`);
      lines.push(`  - Implication: ${ci.implication}`);
    }
    lines.push('');
  }

  // Strategic Horizon
  lines.push('## Strategic Horizon (30/60/90)');
  lines.push('');
  const sh = report.strategicHorizon;

  lines.push(`### 30-Day: ${sh.thirtyDay.theme}`);
  lines.push('**Objectives:**');
  for (const obj of sh.thirtyDay.objectives) lines.push(`- ${obj}`);
  lines.push('**Key Results:**');
  for (const kr of sh.thirtyDay.keyResults) lines.push(`- ${kr}`);
  lines.push('');

  lines.push(`### 60-Day: ${sh.sixtyDay.theme}`);
  lines.push('**Objectives:**');
  for (const obj of sh.sixtyDay.objectives) lines.push(`- ${obj}`);
  lines.push('**Key Results:**');
  for (const kr of sh.sixtyDay.keyResults) lines.push(`- ${kr}`);
  lines.push('');

  lines.push(`### 90-Day: ${sh.ninetyDay.theme}`);
  lines.push('**Objectives:**');
  for (const obj of sh.ninetyDay.objectives) lines.push(`- ${obj}`);
  lines.push('**Key Results:**');
  for (const kr of sh.ninetyDay.keyResults) lines.push(`- ${kr}`);
  lines.push('');

  return lines.join('\n');
}

// --- Main ---

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const serviceClient = createServiceClient();

  console.log('\n========================================================');
  console.log('  Strategic Directives Engine');
  console.log('========================================================\n');
  console.log(`Time range: ${args.timeRange}`);
  if (args.focus) console.log(`Strategic focus: ${args.focus}`);
  if (args.phase1Only) console.log('Phase 1 only (data extraction)');
  if (args.phase2Only) console.log('Phase 1+2 only (extraction + domain briefs)');
  console.log(`Thinking budget: ${args.thinkingBudget} tokens`);
  console.log('');

  // --- Phase 1 ---
  console.log('=== Phase 1: Domain Extraction ===\n');
  const phase1Start = Date.now();

  const extractedData = await extractAllDomains(serviceClient, {
    timeRange: args.timeRange,
  });

  const phase1Ms = Date.now() - phase1Start;

  console.log('Data sources:');
  for (const ds of extractedData.dataSources) {
    console.log(`  ${ds.domain}: ${ds.recordCount} records (${ds.dateRange})`);
  }
  console.log(`  Company rollups: ${extractedData.correlations.companyRollups.length}`);
  console.log(`  Owner rollups: ${extractedData.correlations.ownerRollups.length}`);
  console.log(`  Temporal trends: ${extractedData.correlations.temporalTrends.length} weeks`);
  console.log(`\nPhase 1 completed in ${(phase1Ms / 1000).toFixed(1)}s\n`);

  if (args.phase1Only) {
    console.log('Phase 1 only — stopping here.');
    if (args.verbose) {
      console.log('\n--- Company Rollups (top 10) ---');
      for (const r of extractedData.correlations.companyRollups.slice(0, 10)) {
        console.log(`  ${r.companyName}: Tickets=${r.ticketCount} AvgQuality=${r.avgQualityScore ?? 'N/A'} Health=${r.healthScore || 'N/A'} ARR=$${Number(r.arr || 0).toLocaleString()}`);
      }
      console.log('\n--- Owner Rollups ---');
      for (const r of extractedData.correlations.ownerRollups) {
        console.log(`  ${r.ownerName}: Deals=${r.dealCount} Grade=${r.avgDealGrade || 'N/A'} AtRisk=${r.atRiskDeals} Tickets=${r.ticketCount} Quality=${r.avgTicketQuality ?? 'N/A'}`);
      }
    }
    process.exit(0);
  }

  // --- Phase 2 ---
  console.log('=== Phase 2: Domain Briefs (6 parallel Opus calls) ===\n');
  const phase2Start = Date.now();

  const briefs = await generateAllBriefs(extractedData);

  const phase2Ms = Date.now() - phase2Start;

  for (const [key, brief] of Object.entries(briefs)) {
    const wordCount = brief.rawText.split(/\s+/).length;
    console.log(`  ${key}: ${wordCount} words`);
  }
  console.log(`\nPhase 2 completed in ${(phase2Ms / 1000).toFixed(1)}s\n`);

  if (args.verbose) {
    for (const [key, brief] of Object.entries(briefs)) {
      console.log(`\n--- BRIEF: ${key} ---`);
      console.log(brief.rawText);
    }
    console.log('');
  }

  if (args.phase2Only) {
    console.log('Phase 2 only — stopping here.');
    process.exit(0);
  }

  // --- Phase 3 ---
  console.log('=== Phase 3: Cross-Domain Synthesis (Opus + Extended Thinking) ===\n');
  console.log('Running strategic synthesis with extended thinking...\n');

  const report = await runCrossDomainSynthesis(
    briefs,
    extractedData.correlations,
    extractedData.dataSources,
    { phase1Ms, phase2Ms },
    {
      focus: args.focus,
      thinkingBudget: args.thinkingBudget,
    }
  );

  console.log(`Phase 3 completed in ${(report.phase3DurationMs / 1000).toFixed(1)}s`);
  console.log(`Total pipeline: ${(report.totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`Directives: ${report.directives.length}`);
  console.log(`Cross-domain insights: ${report.crossDomainInsights.length}\n`);

  if (args.verbose && report.thinkingOutput) {
    console.log('--- Extended Thinking Output ---');
    console.log(report.thinkingOutput);
    console.log('');
  }

  // Print report
  const formatted = formatReport(report);
  console.log(formatted);

  // Write to file
  if (args.output) {
    fs.writeFileSync(args.output, formatted, 'utf-8');
    console.log(`\nReport written to: ${args.output}`);

    const jsonPath = args.output.replace(/\.md$/, '.json');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`JSON data written to: ${jsonPath}`);
  }

  // Store in DB
  try {
    await serviceClient.from('strategic_directives').insert({
      report,
      directive_count: report.directives.length,
      overall_deal_grade: report.operationalScorecard.dealPipelineHealth.grade,
      overall_support_grade: report.operationalScorecard.supportQuality.grade,
      overall_customer_grade: report.operationalScorecard.customerHealth.grade,
      trigger_type: 'cli',
      thinking_output: report.thinkingOutput,
      data_snapshot: report.dataSources,
      phase1_duration_ms: report.phase1DurationMs,
      phase2_duration_ms: report.phase2DurationMs,
      phase3_duration_ms: report.phase3DurationMs,
      total_duration_ms: report.totalDurationMs,
    });
    console.log('Report stored in database.');
  } catch (dbErr) {
    console.error('Warning: Failed to store report in database:', dbErr instanceof Error ? dbErr.message : dbErr);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
