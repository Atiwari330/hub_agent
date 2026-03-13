/**
 * SOP Compliance & Coverage Audit Pipeline
 *
 * Two-stage LLM analysis:
 *   Stage 1: Per-ticket SOP classification + compliance scoring (Sonnet)
 *   Stage 2: Aggregate SOP effectiveness analysis (Opus)
 *
 * Usage:
 *   npx tsx src/scripts/run-sop-audit.ts [options]
 *
 * Options:
 *   --mode=open        Analyze open tickets only (default)
 *   --mode=last200     Analyze 200 most recent tickets
 *   --mode=all         Analyze all tickets in DB
 *   --max=N            Limit to N tickets for Stage 1
 *   --skip-existing    Skip tickets that already have SOP analyses
 *   --stage1-only      Run only Stage 1, skip synthesis
 *   --stage2-only      Run only Stage 2 from existing analyses
 *   --output=FILE.md   Write report (also generates .json)
 *   --delay=MS         Delay between LLM calls (default: 200)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/client';
import { analyzeSopCompliance } from '../app/api/queues/sop-audit/analyze/analyze-sop-core';
import { runSopSynthesis } from '../app/api/queues/sop-audit/synthesize/synthesize-sop-core';
import type { SopAuditReport } from '../app/api/queues/sop-audit/synthesize/synthesize-sop-core';
import * as fs from 'fs';

// --- Arg Parsing ---

interface Args {
  mode: 'open' | 'last200' | 'all';
  max?: number;
  skipExisting: boolean;
  stage1Only: boolean;
  stage2Only: boolean;
  output?: string;
  delay: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    mode: 'open',
    skipExisting: false,
    stage1Only: false,
    stage2Only: false,
    delay: 200,
  };

  for (const arg of argv) {
    if (arg.startsWith('--mode=')) {
      const mode = arg.split('=')[1];
      if (mode === 'open' || mode === 'last200' || mode === 'all') {
        args.mode = mode;
      }
    } else if (arg.startsWith('--max=')) {
      args.max = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--skip-existing') {
      args.skipExisting = true;
    } else if (arg === '--stage1-only') {
      args.stage1Only = true;
    } else if (arg === '--stage2-only') {
      args.stage2Only = true;
    } else if (arg.startsWith('--output=')) {
      args.output = arg.split('=')[1];
    } else if (arg.startsWith('--delay=')) {
      args.delay = parseInt(arg.split('=')[1], 10);
    }
  }

  return args;
}

// --- Report Formatting ---

function formatReport(report: SopAuditReport): string {
  const lines: string[] = [];

  lines.push('# SOP Compliance & Coverage Audit Report');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  // Stats summary
  lines.push('## Summary Statistics');
  lines.push(`- **Total Tickets Analyzed:** ${report.stats.totalTickets}`);
  lines.push(`- **Average Compliance Score:** ${report.stats.avgComplianceScore}/100`);
  lines.push(`- **Average Classification Confidence:** ${report.stats.avgConfidence}`);
  lines.push(`- **SOP Gap Rate:** ${report.stats.gapRate}`);
  lines.push(`- **Clean Fit Rate:** ${report.stats.cleanFitRate}`);
  const gd = report.stats.gradeDistribution;
  lines.push(`- **Grade Distribution:** A:${gd.A || 0} B:${gd.B || 0} C:${gd.C || 0} D:${gd.D || 0} F:${gd.F || 0}`);
  lines.push('');

  // Executive Summary
  lines.push('## Executive Summary');
  lines.push(report.executiveSummary);
  lines.push('');

  // Classification Distribution
  lines.push('## Classification Distribution');
  lines.push('');

  lines.push('### Product Area');
  lines.push('| Product Area | Count | % |');
  lines.push('|-------------|-------|---|');
  for (const item of report.classificationDistribution.productArea) {
    lines.push(`| ${item.name} | ${item.count} | ${item.pct} |`);
  }
  lines.push('');

  lines.push('### Issue Type');
  lines.push('| Issue Type | Count | % |');
  lines.push('|-----------|-------|---|');
  for (const item of report.classificationDistribution.issueType) {
    lines.push(`| ${item.name} | ${item.count} | ${item.pct} |`);
  }
  lines.push('');

  lines.push('### Severity');
  lines.push('| Severity | Count | % |');
  lines.push('|----------|-------|---|');
  for (const item of report.classificationDistribution.severity) {
    lines.push(`| ${item.name} | ${item.count} | ${item.pct} |`);
  }
  lines.push('');

  lines.push('### Routing');
  lines.push('| Routing Path | Count | % |');
  lines.push('|-------------|-------|---|');
  for (const item of report.classificationDistribution.routing) {
    lines.push(`| ${item.name} | ${item.count} | ${item.pct} |`);
  }
  lines.push('');

  // Confidence Analysis
  lines.push('## Confidence Analysis');
  lines.push(`- **High (>=0.8):** ${report.confidenceAnalysis.highConfidence}`);
  lines.push(`- **Medium (0.5-0.8):** ${report.confidenceAnalysis.mediumConfidence}`);
  lines.push(`- **Low (<0.5):** ${report.confidenceAnalysis.lowConfidence}`);
  lines.push('');

  if (report.confidenceAnalysis.hardToClassify.length > 0) {
    lines.push('### Hard to Classify');
    lines.push('| Ticket | Subject | Confidence | Reasoning |');
    lines.push('|--------|---------|------------|-----------|');
    for (const item of report.confidenceAnalysis.hardToClassify) {
      lines.push(`| ${item.ticketId} | ${item.subject || 'N/A'} | ${item.confidence} | ${item.reasoning.slice(0, 100)} |`);
    }
    lines.push('');
  }

  // SOP Coverage
  lines.push('## SOP Coverage');
  lines.push(`- **Clean Fit:** ${report.sopCoverage.cleanFitCount}/${report.sopCoverage.totalTickets} (${report.sopCoverage.cleanFitPct})`);
  lines.push('');

  if (report.sopCoverage.gaps.length > 0) {
    lines.push('### Gap Inventory');
    for (const gap of report.sopCoverage.gaps) {
      lines.push(`- **[${gap.severity.toUpperCase()}]** ${gap.description}`);
      lines.push(`  - Tickets: ${gap.ticketIds.join(', ')}`);
    }
    lines.push('');
  }

  if (report.sopCoverage.ambiguities.length > 0) {
    lines.push('### Classification Ambiguities');
    for (const amb of report.sopCoverage.ambiguities) {
      lines.push(`- ${amb.description} (${amb.ticketIds.length} tickets)`);
    }
    lines.push('');
  }

  // Compliance Scorecard
  lines.push('## Compliance Scorecard');
  lines.push(`**Overall Average:** ${report.complianceScorecard.overallAvg}/100 (${report.complianceScorecard.overallGrade})`);
  lines.push('');

  lines.push('### By Dimension');
  lines.push('| Dimension | Avg Score (/10) |');
  lines.push('|-----------|----------------|');
  for (const dim of report.complianceScorecard.byDimension) {
    lines.push(`| ${dim.dimension} | ${dim.avg} |`);
  }
  lines.push('');

  if (report.complianceScorecard.byRep.length > 0) {
    lines.push('### By Rep');
    lines.push('| Rep | Tickets | Avg Score | Grade | Strengths | Weaknesses |');
    lines.push('|-----|---------|-----------|-------|-----------|------------|');
    for (const rep of report.complianceScorecard.byRep) {
      lines.push(`| ${rep.rep} | ${rep.tickets} | ${rep.avgScore} | ${rep.grade} | ${rep.strengths} | ${rep.weaknesses} |`);
    }
    lines.push('');
  }

  // Worst Violations
  if (report.complianceScorecard.worstViolations.length > 0) {
    lines.push('### Worst Violations');
    for (const v of report.complianceScorecard.worstViolations) {
      lines.push(`- **[${v.grade}] Ticket ${v.ticketId}** — ${v.subject || 'N/A'} (Rep: ${v.rep || 'Unknown'}, Score: ${v.score})`);
      lines.push(`  - ${v.issue}`);
    }
    lines.push('');
  }

  // SOP Revision Recommendations
  if (report.sopRevisionRecommendations.length > 0) {
    lines.push('## SOP Revision Recommendations');
    for (const rec of report.sopRevisionRecommendations) {
      lines.push(`### [${rec.priority.toUpperCase()}] ${rec.sopDocument} — ${rec.section}`);
      lines.push(`- **Recommendation:** ${rec.recommendation}`);
      if (rec.evidence) lines.push(`- **Evidence:** ${rec.evidence}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// --- Main ---

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const serviceClient = createServiceClient();

  console.log('\n========================================');
  console.log('  SOP Compliance & Coverage Audit');
  console.log('========================================\n');
  console.log(`Mode: ${args.mode}`);
  if (args.max) console.log(`Max tickets: ${args.max}`);
  if (args.skipExisting) console.log('Skipping already-analyzed tickets');
  if (args.stage1Only) console.log('Stage 1 only (no synthesis)');
  if (args.stage2Only) console.log('Stage 2 only (synthesis from existing analyses)');
  console.log('');

  // --- Stage 1: Per-ticket SOP analysis ---
  if (!args.stage2Only) {
    let ticketQuery = serviceClient
      .from('support_tickets')
      .select('hubspot_ticket_id, subject, is_closed, hubspot_created_at')
      .order('hubspot_created_at', { ascending: false });

    if (args.mode === 'open') {
      ticketQuery = ticketQuery.eq('is_closed', false);
    } else if (args.mode === 'last200') {
      ticketQuery = ticketQuery.limit(200);
    }

    const { data: tickets, error: ticketError } = await ticketQuery;

    if (ticketError) {
      console.error('Error fetching tickets:', ticketError.message);
      process.exit(1);
    }

    if (!tickets || tickets.length === 0) {
      console.log('No tickets found matching the criteria.');
      process.exit(0);
    }

    let ticketsToAnalyze = tickets;

    if (args.skipExisting) {
      const { data: existing } = await serviceClient
        .from('ticket_sop_analyses')
        .select('hubspot_ticket_id');

      const existingIds = new Set((existing || []).map((e) => e.hubspot_ticket_id));
      ticketsToAnalyze = ticketsToAnalyze.filter(
        (t) => !existingIds.has(t.hubspot_ticket_id)
      );
      console.log(`Skipping ${tickets.length - ticketsToAnalyze.length} already-analyzed tickets`);
    }

    if (args.max && ticketsToAnalyze.length > args.max) {
      ticketsToAnalyze = ticketsToAnalyze.slice(0, args.max);
    }

    console.log(`\n=== STAGE 1: Analyzing ${ticketsToAnalyze.length} tickets ===\n`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < ticketsToAnalyze.length; i++) {
      const ticket = ticketsToAnalyze[i];
      const subject = ticket.subject || 'No subject';
      const truncatedSubject = subject.length > 50 ? subject.slice(0, 47) + '...' : subject;

      process.stdout.write(
        `  [${String(i + 1).padStart(3)}/${ticketsToAnalyze.length}] ${truncatedSubject}...`
      );

      try {
        const result = await analyzeSopCompliance(ticket.hubspot_ticket_id, serviceClient);

        if (result.success) {
          const a = result.analysis;
          console.log(
            ` Product:${a.sop_product_area.slice(0, 15)} Type:${a.sop_issue_type.slice(0, 15)} Compliance:${a.compliance_grade}(${a.compliance_score}) Gap:${a.sop_gap_identified ? 'yes' : 'no'}`
          );
          successCount++;
        } else {
          console.log(` ERROR: ${result.error}`);
          failCount++;
        }
      } catch (err) {
        console.log(` ERROR: ${err instanceof Error ? err.message : 'Unknown'}`);
        failCount++;
      }

      if (i < ticketsToAnalyze.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, args.delay));
      }
    }

    console.log(`\nStage 1 complete: ${successCount} success, ${failCount} failed\n`);

    if (args.stage1Only) {
      console.log('Stage 1 only mode — skipping synthesis.');
      process.exit(0);
    }

    if (successCount === 0) {
      console.log('No successful analyses — skipping synthesis.');
      process.exit(1);
    }
  }

  // --- Stage 2: Aggregate synthesis ---
  console.log('=== STAGE 2: Aggregate SOP Effectiveness Analysis (Opus) ===\n');
  console.log('Fetching SOP analyses and running synthesis...\n');

  try {
    const synthesisMode = args.mode === 'open' ? 'open' : 'all';
    const report = await runSopSynthesis(serviceClient, { mode: synthesisMode as 'open' | 'all' });

    const formatted = formatReport(report);
    console.log(formatted);

    if (args.output) {
      fs.writeFileSync(args.output, formatted, 'utf-8');
      console.log(`\nReport written to: ${args.output}`);

      const jsonPath = args.output.replace(/\.md$/, '.json');
      fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
      console.log(`JSON data written to: ${jsonPath}`);
    }

    console.log('\nDone.');
  } catch (err) {
    console.error('Synthesis error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
