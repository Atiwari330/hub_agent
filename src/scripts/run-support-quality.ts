/**
 * Support Ticket Quality Analysis Pipeline
 *
 * Two-stage LLM analysis:
 *   Stage 1: Per-ticket quality analysis (Sonnet) — rep competence, communication,
 *            resolution quality, efficiency, customer sentiment
 *   Stage 2: Aggregate synthesis (Opus) — strategic recommendations for SOPs,
 *            training, policies, focus areas
 *
 * Usage:
 *   npx tsx src/scripts/run-support-quality.ts [options]
 *
 * Options:
 *   --mode=open        Analyze open tickets only (default)
 *   --mode=last200     Analyze 200 most recent tickets
 *   --mode=all         Analyze all tickets in DB
 *   --max=N            Limit to N tickets for Stage 1
 *   --skip-existing    Skip tickets that already have quality analyses
 *   --stage1-only      Run only Stage 1 (per-ticket analysis), skip synthesis
 *   --stage2-only      Run only Stage 2 (aggregate synthesis from existing analyses)
 *   --output=FILE      Write final report to a markdown file
 *   --delay=MS         Delay between LLM calls in ms (default: 200)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/client';
import { analyzeTicketQuality } from '../app/api/queues/support-quality/analyze/analyze-core';
import { runSynthesis } from '../app/api/queues/support-quality/synthesize/route';
import type { SynthesisReport } from '../app/api/queues/support-quality/synthesize/route';
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

function formatReport(report: SynthesisReport): string {
  const lines: string[] = [];

  lines.push('# Support Quality Analysis Report');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  // Stats summary
  lines.push('## Summary Statistics');
  lines.push(`- **Total Tickets Analyzed:** ${report.stats.totalTickets}`);
  lines.push(`- **Average Quality Score:** ${report.stats.avgScore}/100`);
  const gd = report.stats.gradeDistribution;
  lines.push(`- **Grade Distribution:** A:${gd.A || 0} B:${gd.B || 0} C:${gd.C || 0} D:${gd.D || 0} F:${gd.F || 0}`);
  const dims = report.stats.avgDimensions;
  lines.push(`- **Avg Dimensions:** Rep Competence: ${dims.repCompetence}/10, Communication: ${dims.communication}/10, Resolution: ${dims.resolution}/10, Efficiency: ${dims.efficiency}/10`);
  lines.push('');

  // Executive Summary
  lines.push('## Executive Summary');
  lines.push(report.executiveSummary);
  lines.push('');

  // Category Breakdown
  if (report.categoryBreakdown.length > 0) {
    lines.push('## Category Breakdown');
    lines.push('| Category | Count | % | Avg Score | Top Issue |');
    lines.push('|----------|-------|---|-----------|-----------|');
    for (const cat of report.categoryBreakdown) {
      lines.push(`| ${cat.category} | ${cat.count} | ${cat.pct} | ${cat.avgScore} | ${cat.topIssue} |`);
    }
    lines.push('');
  }

  // Rep Performance
  if (report.repPerformance.length > 0) {
    lines.push('## Rep Performance');
    lines.push('| Rep | Tickets | Avg Score | Grade | Strengths | Weaknesses |');
    lines.push('|-----|---------|-----------|-------|-----------|------------|');
    for (const rep of report.repPerformance) {
      lines.push(`| ${rep.rep} | ${rep.tickets} | ${rep.avgScore} | ${rep.grade} | ${rep.strengths} | ${rep.weaknesses} |`);
    }
    lines.push('');
  }

  // Quality Patterns
  if (report.qualityPatterns.length > 0) {
    lines.push('## Quality Patterns');
    for (const pat of report.qualityPatterns) {
      lines.push(`- **${pat.pattern}** (${pat.frequency}, Impact: ${pat.impact})`);
      if (pat.evidence) lines.push(`  - Evidence: ${pat.evidence}`);
    }
    lines.push('');
  }

  // Training Recommendations
  if (report.trainingRecommendations.length > 0) {
    lines.push('## Training Recommendations');
    for (const rec of report.trainingRecommendations) {
      lines.push(`### [${rec.priority.toUpperCase()}] ${rec.recommendation}`);
      lines.push(`- **Target:** ${rec.target}`);
      if (rec.evidence) lines.push(`- **Evidence:** ${rec.evidence}`);
      if (rec.expectedImpact) lines.push(`- **Expected Impact:** ${rec.expectedImpact}`);
      lines.push('');
    }
  }

  // SOP Recommendations
  if (report.sopRecommendations.length > 0) {
    lines.push('## SOP Recommendations');
    for (const sop of report.sopRecommendations) {
      lines.push(`### [${sop.priority.toUpperCase()}] ${sop.sop}`);
      if (sop.gap) lines.push(`- **Gap:** ${sop.gap}`);
      if (sop.evidence) lines.push(`- **Evidence:** ${sop.evidence}`);
      lines.push('');
    }
  }

  // Policy Gaps
  if (report.policyGaps.length > 0) {
    lines.push('## Policy Gaps');
    for (const gap of report.policyGaps) {
      lines.push(`- **${gap.gap}**`);
      if (gap.impact) lines.push(`  - Impact: ${gap.impact}`);
      if (gap.evidence) lines.push(`  - Evidence: ${gap.evidence}`);
      if (gap.recommendation) lines.push(`  - Recommendation: ${gap.recommendation}`);
    }
    lines.push('');
  }

  // Focus Areas
  if (report.focusAreas.length > 0) {
    lines.push('## Focus Areas (30/60/90 Day)');
    for (const focus of report.focusAreas) {
      lines.push(`### ${focus.timeframe} — ${focus.focus}`);
      if (focus.why) lines.push(`- **Why:** ${focus.why}`);
      if (focus.metric) lines.push(`- **Metric:** ${focus.metric}`);
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
  console.log('  Support Quality Analysis Pipeline');
  console.log('========================================\n');
  console.log(`Mode: ${args.mode}`);
  if (args.max) console.log(`Max tickets: ${args.max}`);
  if (args.skipExisting) console.log('Skipping already-analyzed tickets');
  if (args.stage1Only) console.log('Stage 1 only (no synthesis)');
  if (args.stage2Only) console.log('Stage 2 only (synthesis from existing analyses)');
  console.log('');

  // --- Stage 1: Per-ticket analysis ---
  if (!args.stage2Only) {
    // Fetch tickets
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

    // Optionally skip already-analyzed
    if (args.skipExisting) {
      const { data: existing } = await serviceClient
        .from('ticket_quality_analyses')
        .select('hubspot_ticket_id');

      const existingIds = new Set((existing || []).map((e) => e.hubspot_ticket_id));
      ticketsToAnalyze = ticketsToAnalyze.filter(
        (t) => !existingIds.has(t.hubspot_ticket_id)
      );
      console.log(`Skipping ${tickets.length - ticketsToAnalyze.length} already-analyzed tickets`);
    }

    // Apply max limit
    if (args.max && ticketsToAnalyze.length > args.max) {
      ticketsToAnalyze = ticketsToAnalyze.slice(0, args.max);
    }

    console.log(`\n=== STAGE 1: Analyzing ${ticketsToAnalyze.length} tickets ===\n`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < ticketsToAnalyze.length; i++) {
      const ticket = ticketsToAnalyze[i];
      const subject = ticket.subject || 'No subject';
      const truncatedSubject = subject.length > 60 ? subject.slice(0, 57) + '...' : subject;

      process.stdout.write(
        `  [${String(i + 1).padStart(3)}/${ticketsToAnalyze.length}] ${truncatedSubject}...`
      );

      try {
        const result = await analyzeTicketQuality(ticket.hubspot_ticket_id, serviceClient);

        if (result.success) {
          console.log(
            ` Grade:${result.analysis.quality_grade} Score:${result.analysis.overall_quality_score} Sentiment:${result.analysis.customer_sentiment}`
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

      // Rate limit delay
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
  console.log('=== STAGE 2: Aggregate Synthesis (Opus) ===\n');
  console.log('Fetching quality analyses and running synthesis...\n');

  try {
    const synthesisMode = args.mode === 'open' ? 'open' : 'all';
    const report = await runSynthesis(serviceClient, { mode: synthesisMode as 'open' | 'all' });

    // Print report to console
    const formatted = formatReport(report);
    console.log(formatted);

    // Optionally write to file
    if (args.output) {
      fs.writeFileSync(args.output, formatted, 'utf-8');
      console.log(`\nReport written to: ${args.output}`);
    }

    // Also write JSON report alongside markdown
    if (args.output) {
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
