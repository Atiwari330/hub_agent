/**
 * RCM/Billing Ticket Audit Pipeline
 *
 * Two-stage LLM analysis:
 *   Stage 1: Per-ticket RCM classification + issue analysis (Sonnet)
 *   Stage 2: Aggregate RCM audit synthesis (Opus)
 *
 * Usage:
 *   npx tsx src/scripts/run-rcm-audit.ts [options]
 *
 * Options:
 *   --mode=open        Analyze open tickets only (default)
 *   --mode=last200     Analyze 200 most recent tickets
 *   --mode=all         Analyze all tickets in DB
 *   --max=N            Limit to N tickets for Stage 1
 *   --skip-existing    Skip tickets that already have RCM analyses
 *   --stage1-only      Run only Stage 1, skip synthesis
 *   --stage2-only      Run only Stage 2 from existing analyses
 *   --output=FILE.md   Write report (also generates .json)
 *   --delay=MS         Delay between LLM calls (default: 200)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/client';
import { analyzeRcmTicket } from '../app/api/queues/rcm-audit/analyze/analyze-rcm-core';
import { runRcmSynthesis } from '../app/api/queues/rcm-audit/synthesize/synthesize-rcm-core';
import type { RcmAuditReport } from '../app/api/queues/rcm-audit/synthesize/synthesize-rcm-core';
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

function formatReport(report: RcmAuditReport): string {
  const lines: string[] = [];

  lines.push('# RCM/Billing Ticket Audit Report');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  // Stats
  lines.push('## Summary Statistics');
  lines.push(`- **Total Tickets Analyzed:** ${report.stats.totalAnalyzed}`);
  lines.push(`- **RCM-Related:** ${report.stats.rcmRelated} (${report.stats.rcmPct})`);
  lines.push(`- **Vendor-Blamed:** ${report.stats.vendorBlamedCount} (${report.stats.vendorBlamedPct})`);
  lines.push('');

  lines.push('### By Severity');
  lines.push('| Severity | Count | % |');
  lines.push('|----------|-------|---|');
  for (const item of report.stats.bySeverity) {
    lines.push(`| ${item.name} | ${item.count} | ${item.pct} |`);
  }
  lines.push('');

  lines.push('### By Category');
  lines.push('| Category | Count | % |');
  lines.push('|----------|-------|---|');
  for (const item of report.stats.byCategory) {
    lines.push(`| ${item.name} | ${item.count} | ${item.pct} |`);
  }
  lines.push('');

  lines.push('### By Status');
  lines.push('| Status | Count | % |');
  lines.push('|--------|-------|---|');
  for (const item of report.stats.byStatus) {
    lines.push(`| ${item.name} | ${item.count} | ${item.pct} |`);
  }
  lines.push('');

  // Executive Summary
  lines.push('## Executive Summary');
  lines.push(report.executiveSummary);
  lines.push('');

  // Urgent Items
  if (report.urgentItems.length > 0) {
    lines.push('## Urgent Items');
    for (const item of report.urgentItems) {
      lines.push(`- **[${item.severity.toUpperCase()}] Ticket ${item.ticketId}** — ${item.subject || 'N/A'} (${item.company || 'Unknown'})`);
      if (item.summary) lines.push(`  - ${item.summary}`);
    }
    lines.push('');
  }

  // System Breakdown
  lines.push('## System Breakdown');
  for (const sys of report.systemBreakdown) {
    lines.push(`### ${sys.system} — ${sys.count} tickets (${sys.pct})`);
    if (sys.categories.length > 0) {
      for (const cat of sys.categories) {
        lines.push(`- ${cat.name}: ${cat.count}`);
      }
    }
    lines.push('');
  }

  // Patterns
  if (report.patterns.length > 0) {
    lines.push('## Patterns Identified');
    for (const pattern of report.patterns) {
      lines.push(`- ${pattern}`);
    }
    lines.push('');
  }

  // Per-ticket summaries grouped by system
  lines.push('## Ticket Details');
  const bySystem: Record<string, typeof report.ticketSummaries> = {};
  for (const t of report.ticketSummaries) {
    const sys = t.rcmSystem || 'unknown';
    if (!bySystem[sys]) bySystem[sys] = [];
    bySystem[sys].push(t);
  }

  for (const [system, tickets] of Object.entries(bySystem)) {
    lines.push(`### ${system} (${tickets.length} tickets)`);
    lines.push('');
    for (const t of tickets) {
      const sevTag = t.severity ? `[${t.severity.toUpperCase()}]` : '';
      lines.push(`**${sevTag} ${t.ticketId}** — ${t.subject || 'No subject'}`);
      lines.push(`- Company: ${t.company || 'Unknown'} | Rep: ${t.rep || 'Unassigned'} | Status: ${t.status || 'N/A'} | Vendor: ${t.vendorBlamed ? 'yes' : 'no'}`);
      if (t.summary) lines.push(`- ${t.summary}`);
      if (t.problems.length > 0) {
        for (const p of t.problems) {
          lines.push(`  - ${p}`);
        }
      }
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
  console.log('  RCM/Billing Ticket Audit');
  console.log('========================================\n');
  console.log(`Mode: ${args.mode}`);
  if (args.max) console.log(`Max tickets: ${args.max}`);
  if (args.skipExisting) console.log('Skipping already-analyzed tickets');
  if (args.stage1Only) console.log('Stage 1 only (no synthesis)');
  if (args.stage2Only) console.log('Stage 2 only (synthesis from existing analyses)');
  console.log('');

  // --- Stage 1: Per-ticket RCM analysis ---
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
        .from('ticket_rcm_analyses')
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
    let rcmCount = 0;

    for (let i = 0; i < ticketsToAnalyze.length; i++) {
      const ticket = ticketsToAnalyze[i];
      const subject = ticket.subject || 'No subject';
      const truncatedSubject = subject.length > 50 ? subject.slice(0, 47) + '...' : subject;

      process.stdout.write(
        `  [${String(i + 1).padStart(3)}/${ticketsToAnalyze.length}] ${truncatedSubject}...`
      );

      try {
        const result = await analyzeRcmTicket(ticket.hubspot_ticket_id, serviceClient);

        if (result.success) {
          const a = result.analysis;
          if (a.is_rcm_related) {
            rcmCount++;
            console.log(
              ` RCM:yes System:${(a.rcm_system || 'unk').slice(0, 15)} Cat:${(a.issue_category || 'unk').slice(0, 15)} Sev:${a.severity || 'N/A'}`
            );
          } else {
            console.log(` RCM:no (confidence:${a.confidence.toFixed(2)})`);
          }
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

    console.log(`\nStage 1 complete: ${successCount} success (${rcmCount} RCM-related), ${failCount} failed\n`);

    if (args.stage1Only) {
      console.log('Stage 1 only mode — skipping synthesis.');
      process.exit(0);
    }

    if (rcmCount === 0) {
      console.log('No RCM-related tickets found — skipping synthesis.');
      process.exit(0);
    }
  }

  // --- Stage 2: Aggregate synthesis ---
  console.log('=== STAGE 2: Aggregate RCM Audit Analysis (Opus) ===\n');
  console.log('Fetching RCM analyses and running synthesis...\n');

  try {
    const synthesisMode = args.mode === 'open' ? 'open' : 'all';
    const report = await runRcmSynthesis(serviceClient, { mode: synthesisMode as 'open' | 'all' });

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
