/**
 * Company Feature Analysis Pipeline
 *
 * Two-stage LLM analysis for a specific company:
 *   Stage 1: Per-ticket feature extraction (Sonnet) — feature requests, pain points,
 *            product areas, frustration level
 *   Stage 2: Aggregate synthesis (Opus) — deduplicated features, ranked pain points,
 *            product area themes, recommendations, customer health
 *
 * Usage:
 *   npx tsx src/scripts/run-company-feature-analysis.ts [options]
 *
 * Options:
 *   --company-id=ID     HubSpot company ID
 *   --domain=DOMAIN     Company domain (alternative to --company-id)
 *   --max=N             Limit to N tickets for Stage 1
 *   --stage1-only       Run only Stage 1, skip synthesis
 *   --output=FILE       Write final report to a markdown file
 *   --delay=MS          Delay between LLM calls in ms (default: 200)
 *   --fresh             Fetch tickets from HubSpot API instead of Supabase cache
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/client';
import { getCompanyById, searchCompanyByDomain } from '../lib/hubspot/companies';
import { getTicketsByCompanyId } from '../lib/hubspot/tickets';
import { analyzeTicketFeatures } from './company-feature-analysis/analyze-features';
import { synthesizeFeatureReport } from './company-feature-analysis/synthesize-features';
import type { TicketFeatureAnalysis } from './company-feature-analysis/analyze-features';
import type { CompanyFeatureReport } from './company-feature-analysis/synthesize-features';
import * as fs from 'fs';
import * as path from 'path';

// --- Arg Parsing ---

interface Args {
  companyId?: string;
  domain?: string;
  max?: number;
  stage1Only: boolean;
  output?: string;
  delay: number;
  fresh: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    stage1Only: false,
    delay: 200,
    fresh: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--company-id=')) {
      args.companyId = arg.split('=')[1];
    } else if (arg.startsWith('--domain=')) {
      args.domain = arg.split('=')[1];
    } else if (arg.startsWith('--max=')) {
      args.max = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--stage1-only') {
      args.stage1Only = true;
    } else if (arg.startsWith('--output=')) {
      args.output = arg.split('=')[1];
    } else if (arg.startsWith('--delay=')) {
      args.delay = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--fresh') {
      args.fresh = true;
    }
  }

  return args;
}

// --- Report Formatting ---

function formatReport(report: CompanyFeatureReport): string {
  const lines: string[] = [];

  lines.push(`# Company Feature Analysis Report: ${report.companyName}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Company ID: ${report.companyId}`);
  lines.push('');

  // Stats summary
  lines.push('## Summary Statistics');
  lines.push(`- **Total Tickets Analyzed:** ${report.stats.totalTickets}`);
  lines.push(`- **Tickets with Feature Requests:** ${report.stats.ticketsWithFeatureRequests} (${report.stats.totalFeatureRequests} total requests)`);
  lines.push(`- **Tickets with Pain Points:** ${report.stats.ticketsWithPainPoints} (${report.stats.totalPainPoints} total pain points)`);

  const frustEntries = Object.entries(report.stats.frustrationDistribution)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`);
  lines.push(`- **Frustration Distribution:** ${frustEntries.join(', ')}`);

  const areaEntries = Object.entries(report.stats.productAreaDistribution)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`);
  lines.push(`- **Product Area Distribution:** ${areaEntries.join(', ')}`);
  lines.push('');

  // Executive Summary
  lines.push('## Executive Summary');
  lines.push(report.executiveSummary);
  lines.push('');

  // Feature Requests
  if (report.featureRequests.length > 0) {
    lines.push('## Feature Requests (Ranked)');
    lines.push('| # | Description | Area | Urgency | Type | Tickets | Evidence |');
    lines.push('|---|------------|------|---------|------|---------|----------|');
    for (let i = 0; i < report.featureRequests.length; i++) {
      const fr = report.featureRequests[i];
      lines.push(`| ${i + 1} | ${fr.description} | ${fr.productArea} | ${fr.urgency} | ${fr.type} | ${fr.ticketCount} | ${fr.evidence} |`);
    }
    lines.push('');
  }

  // Pain Points
  if (report.painPoints.length > 0) {
    lines.push('## Pain Points (Ranked)');
    lines.push('| # | Description | Area | Severity | Tickets | Evidence |');
    lines.push('|---|------------|------|----------|---------|----------|');
    for (let i = 0; i < report.painPoints.length; i++) {
      const pp = report.painPoints[i];
      lines.push(`| ${i + 1} | ${pp.description} | ${pp.productArea} | ${pp.severity} | ${pp.ticketCount} | ${pp.evidence} |`);
    }
    lines.push('');
  }

  // Product Area Themes
  if (report.productAreaThemes.length > 0) {
    lines.push('## Product Area Themes');
    for (const area of report.productAreaThemes) {
      lines.push(`### ${area.productArea} (${area.ticketCount} tickets, Severity: ${area.overallSeverity})`);
      lines.push(`- **Themes:** ${area.themes.join(', ')}`);
      lines.push(`- **Summary:** ${area.summary}`);
      lines.push('');
    }
  }

  // Customer Health
  lines.push('## Customer Health');
  lines.push(`- **Overall Frustration:** ${report.customerHealth.overallFrustration}`);
  lines.push(`- **Product Satisfaction:** ${report.customerHealth.relationship}`);
  lines.push('');

  return lines.join('\n');
}

// --- Main ---

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const serviceClient = createServiceClient();

  if (!args.companyId && !args.domain) {
    console.error('Error: Must provide --company-id=ID or --domain=DOMAIN');
    process.exit(1);
  }

  console.log('\n========================================');
  console.log('  Company Feature Analysis Pipeline');
  console.log('========================================\n');

  // --- Resolve company ---
  let companyId = args.companyId;
  let companyName = 'Unknown';

  if (args.domain && !companyId) {
    console.log(`Resolving domain: ${args.domain}...`);
    const company = await searchCompanyByDomain(args.domain);
    if (!company) {
      console.error(`Error: No company found for domain "${args.domain}"`);
      process.exit(1);
    }
    companyId = company.id;
    companyName = company.properties.name || args.domain;
    console.log(`Found: ${companyName} (ID: ${companyId})\n`);
  } else if (companyId) {
    const company = await getCompanyById(companyId);
    companyName = company?.properties.name || `Company ${companyId}`;
    console.log(`Company: ${companyName} (ID: ${companyId})\n`);
  }

  // --- Fetch tickets ---
  let ticketIds: string[] = [];

  if (args.fresh) {
    console.log('Fetching tickets from HubSpot API (--fresh)...');
    const hsTickets = await getTicketsByCompanyId(companyId!);
    ticketIds = hsTickets.map((t) => t.id);
    console.log(`Found ${ticketIds.length} tickets in HubSpot\n`);
  } else {
    console.log('Fetching tickets from Supabase cache...');
    const { data: tickets, error } = await serviceClient
      .from('support_tickets')
      .select('hubspot_ticket_id, subject')
      .eq('hs_primary_company_id', companyId!)
      .order('hubspot_created_at', { ascending: false });

    if (error) {
      console.error('Error fetching tickets from DB:', error.message);
      process.exit(1);
    }

    ticketIds = (tickets || []).map((t) => t.hubspot_ticket_id);
    console.log(`Found ${ticketIds.length} tickets in Supabase cache\n`);
  }

  if (ticketIds.length === 0) {
    console.log('No tickets found for this company.');
    process.exit(0);
  }

  // Apply max limit
  if (args.max && ticketIds.length > args.max) {
    ticketIds = ticketIds.slice(0, args.max);
    console.log(`Limited to ${args.max} tickets\n`);
  }

  if (args.stage1Only) console.log('Stage 1 only (no synthesis)');
  console.log('');

  // --- Stage 1: Per-ticket feature analysis ---
  console.log(`=== STAGE 1: Analyzing ${ticketIds.length} tickets (Sonnet) ===\n`);

  const analyses: TicketFeatureAnalysis[] = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < ticketIds.length; i++) {
    const ticketId = ticketIds[i];
    process.stdout.write(`  [${String(i + 1).padStart(3)}/${ticketIds.length}] Ticket ${ticketId}...`);

    try {
      const result = await analyzeTicketFeatures(ticketId, serviceClient);

      if (result.success) {
        const a = result.analysis;
        const frCount = a.featureRequests.length;
        const ppCount = a.painPoints.length;
        console.log(` FR:${frCount} PP:${ppCount} Frustration:${a.frustrationLevel} Conf:${a.confidence}`);
        analyses.push(a);
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
    if (i < ticketIds.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, args.delay));
    }
  }

  console.log(`\nStage 1 complete: ${successCount} success, ${failCount} failed`);
  console.log(`  Total feature requests: ${analyses.reduce((s, a) => s + a.featureRequests.length, 0)}`);
  console.log(`  Total pain points: ${analyses.reduce((s, a) => s + a.painPoints.length, 0)}\n`);

  if (args.stage1Only) {
    // Print Stage 1 results summary
    console.log('--- Stage 1 Results ---\n');
    for (const a of analyses) {
      console.log(`[${a.ticketId}] ${a.subject || 'No subject'}`);
      if (a.featureRequests.length > 0) {
        for (const fr of a.featureRequests) {
          console.log(`  FR(${fr.type}): [${fr.productArea}] [${fr.urgency}] ${fr.description}`);
        }
      }
      if (a.painPoints.length > 0) {
        for (const pp of a.painPoints) {
          console.log(`  PP: [${pp.productArea}] [${pp.severity}] ${pp.description}`);
        }
      }
      console.log(`  Frustration: ${a.frustrationLevel} | Confidence: ${a.confidence}`);
      console.log(`  Summary: ${a.summary}`);
      console.log('');
    }
    process.exit(0);
  }

  if (successCount === 0) {
    console.log('No successful analyses — skipping synthesis.');
    process.exit(1);
  }

  // --- Stage 2: Aggregate synthesis ---
  console.log('=== STAGE 2: Aggregate Synthesis (Opus) ===\n');
  console.log('Running synthesis...\n');

  try {
    const report = await synthesizeFeatureReport(analyses, companyName, companyId!);

    // Print report to console
    const formatted = formatReport(report);
    console.log(formatted);

    // Optionally write to file
    if (args.output) {
      // Ensure output directory exists
      const dir = path.dirname(args.output);
      if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(args.output, formatted, 'utf-8');
      console.log(`\nReport written to: ${args.output}`);

      // Also write JSON report
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
