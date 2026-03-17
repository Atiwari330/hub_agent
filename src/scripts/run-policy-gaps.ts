/**
 * Policy Gap Analysis — Open Ticket Base
 *
 * Analyzes all open support tickets to identify the top 3-5 management policy
 * decisions that would most improve support team operations. Leverages existing
 * support manager and trainer analyses (no per-ticket LLM calls).
 *
 * Usage:
 *   npx tsx src/scripts/run-policy-gaps.ts [options]
 *
 * Options:
 *   --max=N            Limit to N tickets
 *   --include-closed   Also include tickets closed in the last 30 days
 *   --output=FILE      Write markdown report to a file
 *   --verbose          Print compressed ticket data before LLM call
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/client';
import { generateText } from 'ai';
import { getSonnetModel } from '../lib/ai/provider';
import * as fs from 'fs';

// --- Arg Parsing ---

interface Args {
  max?: number;
  includeClosed: boolean;
  output?: string;
  verbose: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    includeClosed: false,
    verbose: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--max=')) {
      args.max = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--include-closed') {
      args.includeClosed = true;
    } else if (arg.startsWith('--output=')) {
      args.output = arg.split('=')[1];
    } else if (arg === '--verbose') {
      args.verbose = true;
    }
  }

  return args;
}

// --- Types ---

interface TicketRow {
  hubspot_ticket_id: string;
  subject: string | null;
  hs_primary_company_name: string | null;
  priority: string | null;
  ball_in_court: string | null;
  software: string | null;
  source_type: string | null;
  category: string | null;
  ticket_type: string | null;
  is_closed: boolean;
  linear_task: string | null;
  hubspot_created_at: string | null;
}

interface ManagerAnalysis {
  issue_summary: string;
  next_action: string;
  reasoning: string | null;
  engagement_summary: string | null;
  linear_summary: string | null;
  urgency: string;
  action_owner: string | null;
  follow_up_cadence: string | null;
  knowledge_used: string | null;
  days_since_last_activity: number | null;
}

interface TrainerAnalysis {
  customer_ask: string;
  problem_breakdown: string;
  resolution_approach: string;
  coaching_tips: string | null;
  difficulty_level: string;
  knowledge_areas: string | null;
}

// --- Compress ticket for LLM prompt ---

function compressTicket(
  ticket: TicketRow,
  manager: ManagerAnalysis | null,
  trainer: TrainerAnalysis | null
): string {
  const now = new Date();
  const created = ticket.hubspot_created_at ? new Date(ticket.hubspot_created_at) : null;
  const ageDays = created ? Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)) : null;

  const meta = [
    `[${ticket.hubspot_ticket_id}]`,
    ticket.subject || 'No subject',
    `| ${ticket.hs_primary_company_name || 'Unknown'}`,
    ageDays !== null ? `| Age: ${ageDays}d` : '',
    ticket.software ? `| ${ticket.software}` : '',
    ticket.ball_in_court ? `| Ball: ${ticket.ball_in_court}` : '',
    ticket.priority ? `| Priority: ${ticket.priority}` : '',
    ticket.linear_task ? '| Has Linear' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const lines: string[] = [meta];

  if (manager) {
    lines.push(`  Manager: ${manager.issue_summary} | Urgency: ${manager.urgency} | Owner: ${manager.action_owner || 'N/A'}`);
    lines.push(`  Next Action: ${manager.next_action}`);
    if (manager.reasoning) {
      lines.push(`  Reasoning: ${truncate(manager.reasoning, 300)}`);
    }
    if (manager.engagement_summary) {
      lines.push(`  Engagement: ${truncate(manager.engagement_summary, 200)}`);
    }
    if (manager.linear_summary && manager.linear_summary !== 'No engineering escalation.') {
      lines.push(`  Linear: ${truncate(manager.linear_summary, 200)}`);
    }
    if (manager.follow_up_cadence) {
      lines.push(`  Follow-up: ${truncate(manager.follow_up_cadence, 150)}`);
    }
  }

  if (trainer) {
    lines.push(`  Trainer: ${truncate(trainer.customer_ask, 200)} | Difficulty: ${trainer.difficulty_level}`);
    lines.push(`  Problem: ${truncate(trainer.problem_breakdown, 200)}`);
    lines.push(`  Resolution: ${truncate(trainer.resolution_approach, 200)}`);
  }

  if (!manager && !trainer) {
    lines.push('  (No analysis available — raw ticket metadata only)');
  }

  return lines.join('\n');
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\n/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max - 3) + '...' : oneLine;
}

// --- System Prompt ---

function buildSystemPrompt(): string {
  return `You are a senior operations strategist advising the VP of RevOps at Opus Behavioral Health, a healthcare SaaS company that provides an EHR and practice management platform for behavioral health organizations.

You are reviewing open support tickets that have already been individually analyzed. Your job is NOT to triage individual tickets — that's already been done. Your job is to step back and identify the top 3-5 MANAGEMENT POLICY DECISIONS that would most improve support team operations.

A "policy decision" is a clear heuristic, rule, workflow, or decision that management has not yet made, causing support agents to repeatedly encounter ambiguity, delays, or escalation loops. Examples:
- "No clear policy on when to proactively reach out to a customer vs wait for them"
- "No defined handoff protocol between support and engineering when a Linear ticket is opened"
- "No SLA for vendor-dependency communication cadence"
- "No escalation criteria for when a ticket should move from support agent to CS Manager"

These are NOT training issues (those are handled elsewhere). These are DECISION GAPS — places where management needs to make a call and communicate it to the team.

ORGANIZATION CONTEXT:
- Support Agents — Front-line reps who handle tickets as a team.
- CS Manager (Support Manager) — Manages all support agents, triages complex tickets.
- Head of Client Success — Manages CS Manager, heads onboarding/implementation.
- VP of RevOps — Executive leadership, receives strategic recommendations.
- Engineering — Bug fixes, feature requests, tracked via Linear.

For each policy gap you identify:
1. NAME: A clear, concise name for the policy/decision needed (10 words or fewer)
2. PROBLEM: What is happening today because this policy doesn't exist? Be specific — cite ticket patterns.
3. EVIDENCE: List the specific ticket IDs that demonstrate this gap (minimum 2, ideally 3-5)
4. PROPOSED_POLICY: Draft the actual policy/heuristic in 2-3 sentences. Be prescriptive — "When X happens, do Y" format.
5. EXPECTED_IMPACT: What would change if this policy were implemented? Quantify where possible.
6. PRIORITY: critical | high | medium

Respond in this EXACT format:

===EXECUTIVE_SUMMARY===
2-3 sentences: How many tickets reviewed, what % show policy gap patterns, and the single biggest theme.

===POLICY_GAP_1===
NAME: ...
PROBLEM: ...
EVIDENCE: ...
PROPOSED_POLICY: ...
EXPECTED_IMPACT: ...
PRIORITY: ...

===POLICY_GAP_2===
NAME: ...
PROBLEM: ...
EVIDENCE: ...
PROPOSED_POLICY: ...
EXPECTED_IMPACT: ...
PRIORITY: ...

(Continue for 3-5 gaps total, ordered by priority)

===NOISE_VS_SIGNAL===
Briefly note what you considered but rejected — patterns that looked like policy gaps but are actually training issues, one-off incidents, or already-addressed items. This helps the VP of RevOps trust that the signal has been filtered.

Guidelines:
- MAXIMUM 5 policy gaps. If you identify more, merge related ones.
- Each gap must be supported by evidence from at least 2 tickets.
- Focus on DECISIONS, not training. "Agents don't know how to use feature X" is training. "There's no defined workflow for when a customer reports X" is a policy gap.
- Be opinionated. The VP of RevOps wants signal, not a laundry list.
- Look for patterns across tickets — similar stalls, similar escalation paths, similar gaps.`;
}

// --- Build User Prompt ---

function buildUserPrompt(
  compressedTickets: string[],
  stats: {
    total: number;
    withManagerAnalysis: number;
    withTrainerAnalysis: number;
    byUrgency: Record<string, number>;
    byActionOwner: Record<string, number>;
    bySoftware: Record<string, number>;
    byBallInCourt: Record<string, number>;
  }
): string {
  const lines: string[] = [];

  lines.push(`Analyze the following ${stats.total} open support tickets and identify the top 3-5 management policy gaps.\n`);

  lines.push('=== SUMMARY STATISTICS ===');
  lines.push(`Total Tickets: ${stats.total}`);
  lines.push(`With Manager Analysis: ${stats.withManagerAnalysis}`);
  lines.push(`With Trainer Analysis: ${stats.withTrainerAnalysis}`);

  const urgEntries = Object.entries(stats.byUrgency).sort((a, b) => b[1] - a[1]);
  if (urgEntries.length > 0) {
    lines.push(`By Urgency: ${urgEntries.map(([k, v]) => `${k}:${v}`).join(' ')}`);
  }

  const ownerEntries = Object.entries(stats.byActionOwner).sort((a, b) => b[1] - a[1]);
  if (ownerEntries.length > 0) {
    lines.push(`By Action Owner: ${ownerEntries.map(([k, v]) => `${k}:${v}`).join(' ')}`);
  }

  const swEntries = Object.entries(stats.bySoftware).sort((a, b) => b[1] - a[1]);
  if (swEntries.length > 0) {
    lines.push(`By Software: ${swEntries.map(([k, v]) => `${k}:${v}`).join(' ')}`);
  }

  const ballEntries = Object.entries(stats.byBallInCourt).sort((a, b) => b[1] - a[1]);
  if (ballEntries.length > 0) {
    lines.push(`By Ball In Court: ${ballEntries.map(([k, v]) => `${k}:${v}`).join(' ')}`);
  }

  lines.push('');
  lines.push('=== TICKET DATA ===');
  for (const t of compressedTickets) {
    lines.push(t);
    lines.push('');
  }

  return lines.join('\n');
}

// --- Response Parsing ---

interface PolicyGap {
  name: string;
  problem: string;
  evidence: string;
  proposedPolicy: string;
  expectedImpact: string;
  priority: string;
}

interface PolicyGapReport {
  executiveSummary: string;
  policyGaps: PolicyGap[];
  noiseVsSignal: string;
  ticketsAnalyzed: number;
  analyzedAt: string;
}

function parseResponse(text: string, ticketCount: number): PolicyGapReport {
  // Executive summary
  const summaryMatch = text.match(/===EXECUTIVE_SUMMARY===([\s\S]*?)(?====|$)/);
  const executiveSummary = (summaryMatch?.[1] || 'Analysis completed.').trim();

  // Policy gaps (1-5)
  const policyGaps: PolicyGap[] = [];
  for (let i = 1; i <= 5; i++) {
    const gapMatch = text.match(new RegExp(`===POLICY_GAP_${i}===([\s\S]*?)(?====|$)`));
    if (!gapMatch) continue;
    const block = gapMatch[1];

    const field = (name: string): string => {
      const m = block.match(new RegExp(`${name}:\\s*(.+?)(?=\\n[A-Z_]+:|$)`, 'is'));
      return m ? m[1].trim() : '';
    };

    policyGaps.push({
      name: field('NAME'),
      problem: field('PROBLEM'),
      evidence: field('EVIDENCE'),
      proposedPolicy: field('PROPOSED_POLICY'),
      expectedImpact: field('EXPECTED_IMPACT'),
      priority: field('PRIORITY').toLowerCase() || 'medium',
    });
  }

  // Noise vs signal
  const noiseMatch = text.match(/===NOISE_VS_SIGNAL===([\s\S]*?)(?====|$)/);
  const noiseVsSignal = (noiseMatch?.[1] || '').trim();

  return {
    executiveSummary,
    policyGaps,
    noiseVsSignal,
    ticketsAnalyzed: ticketCount,
    analyzedAt: new Date().toISOString(),
  };
}

// --- Report Formatting ---

function formatReport(report: PolicyGapReport): string {
  const lines: string[] = [];

  lines.push('# Policy Gap Analysis Report');
  lines.push(`Generated: ${report.analyzedAt}`);
  lines.push(`Tickets Analyzed: ${report.ticketsAnalyzed}`);
  lines.push('');

  lines.push('## Executive Summary');
  lines.push(report.executiveSummary);
  lines.push('');

  for (let i = 0; i < report.policyGaps.length; i++) {
    const gap = report.policyGaps[i];
    lines.push(`## Policy Gap #${i + 1}: ${gap.name}`);
    lines.push(`**Priority:** ${gap.priority}`);
    lines.push('');
    lines.push(`**Problem:** ${gap.problem}`);
    lines.push('');
    lines.push(`**Evidence:** ${gap.evidence}`);
    lines.push('');
    lines.push(`**Proposed Policy:** ${gap.proposedPolicy}`);
    lines.push('');
    lines.push(`**Expected Impact:** ${gap.expectedImpact}`);
    lines.push('');
  }

  if (report.noiseVsSignal) {
    lines.push('## Noise vs Signal');
    lines.push(report.noiseVsSignal);
    lines.push('');
  }

  return lines.join('\n');
}

// --- Main ---

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabase = createServiceClient();

  console.log('\n========================================');
  console.log('  Policy Gap Analysis');
  console.log('========================================\n');
  if (args.max) console.log(`Max tickets: ${args.max}`);
  if (args.includeClosed) console.log('Including recently closed tickets');
  console.log('');

  // 1. Fetch tickets
  console.log('Fetching tickets...');

  let query = supabase
    .from('support_tickets')
    .select('hubspot_ticket_id, subject, hs_primary_company_name, priority, ball_in_court, software, source_type, category, ticket_type, is_closed, linear_task, hubspot_created_at')
    .order('hubspot_created_at', { ascending: false });

  if (!args.includeClosed) {
    query = query.eq('is_closed', false);
  } else {
    // Open tickets + closed in last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    query = query.or(`is_closed.eq.false,closed_date.gte.${thirtyDaysAgo.toISOString()}`);
  }

  const { data: tickets, error: ticketError } = await query;

  if (ticketError) {
    console.error('Error fetching tickets:', ticketError.message);
    process.exit(1);
  }

  if (!tickets || tickets.length === 0) {
    console.log('No tickets found.');
    process.exit(0);
  }

  let ticketsToAnalyze = tickets as TicketRow[];
  if (args.max && ticketsToAnalyze.length > args.max) {
    ticketsToAnalyze = ticketsToAnalyze.slice(0, args.max);
  }

  console.log(`Found ${ticketsToAnalyze.length} tickets.`);

  // 2. Batch-fetch existing analyses
  const ticketIds = ticketsToAnalyze.map((t) => t.hubspot_ticket_id);

  console.log('Fetching existing analyses...');

  const managerAnalyses: Record<string, ManagerAnalysis> = {};
  const trainerAnalyses: Record<string, TrainerAnalysis> = {};

  const batchSize = 500;
  for (let i = 0; i < ticketIds.length; i += batchSize) {
    const batch = ticketIds.slice(i, i + batchSize);

    const [managerResult, trainerResult] = await Promise.all([
      supabase
        .from('ticket_support_manager_analyses')
        .select('hubspot_ticket_id, issue_summary, next_action, reasoning, engagement_summary, linear_summary, urgency, action_owner, follow_up_cadence, knowledge_used, days_since_last_activity')
        .in('hubspot_ticket_id', batch),
      supabase
        .from('ticket_trainer_analyses')
        .select('hubspot_ticket_id, customer_ask, problem_breakdown, resolution_approach, coaching_tips, difficulty_level, knowledge_areas')
        .in('hubspot_ticket_id', batch),
    ]);

    for (const row of managerResult.data || []) {
      managerAnalyses[row.hubspot_ticket_id] = row as ManagerAnalysis;
    }
    for (const row of trainerResult.data || []) {
      trainerAnalyses[row.hubspot_ticket_id] = row as TrainerAnalysis;
    }
  }

  const withManager = Object.keys(managerAnalyses).length;
  const withTrainer = Object.keys(trainerAnalyses).length;
  console.log(`  Manager analyses: ${withManager}/${ticketsToAnalyze.length}`);
  console.log(`  Trainer analyses: ${withTrainer}/${ticketsToAnalyze.length}`);

  if (withManager === 0 && withTrainer === 0) {
    console.warn('\nWarning: No existing analyses found. Results will be based on raw ticket metadata only.');
    console.warn('Consider running the support-manager or support-trainer analysis first for better results.\n');
  }

  // 3. Compress tickets
  const compressedTickets = ticketsToAnalyze.map((t) =>
    compressTicket(t, managerAnalyses[t.hubspot_ticket_id] || null, trainerAnalyses[t.hubspot_ticket_id] || null)
  );

  if (args.verbose) {
    console.log('\n=== COMPRESSED TICKET DATA ===\n');
    for (const ct of compressedTickets) {
      console.log(ct);
      console.log('');
    }
  }

  // 4. Compute stats
  const byUrgency: Record<string, number> = {};
  const byActionOwner: Record<string, number> = {};
  const bySoftware: Record<string, number> = {};
  const byBallInCourt: Record<string, number> = {};

  for (const t of ticketsToAnalyze) {
    const ma = managerAnalyses[t.hubspot_ticket_id];
    if (ma?.urgency) byUrgency[ma.urgency] = (byUrgency[ma.urgency] || 0) + 1;
    if (ma?.action_owner) byActionOwner[ma.action_owner] = (byActionOwner[ma.action_owner] || 0) + 1;
    if (t.software) bySoftware[t.software] = (bySoftware[t.software] || 0) + 1;
    if (t.ball_in_court) byBallInCourt[t.ball_in_court] = (byBallInCourt[t.ball_in_court] || 0) + 1;
  }

  // 5. Call Sonnet
  console.log('\nRunning policy gap analysis via Sonnet...\n');

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(compressedTickets, {
    total: ticketsToAnalyze.length,
    withManagerAnalysis: withManager,
    withTrainerAnalysis: withTrainer,
    byUrgency,
    byActionOwner,
    bySoftware,
    byBallInCourt,
  });

  const { text, usage } = await generateText({
    model: getSonnetModel(),
    system: systemPrompt,
    prompt: userPrompt,
  });

  // 6. Parse and format
  const report = parseResponse(text, ticketsToAnalyze.length);
  const formatted = formatReport(report);

  console.log(formatted);

  if (usage) {
    console.log(`\nTokens used: ${usage.totalTokens || 'N/A'} (prompt: ${usage.promptTokens || 'N/A'}, completion: ${usage.completionTokens || 'N/A'})`);
  }

  // 7. Write to file if requested
  if (args.output) {
    fs.writeFileSync(args.output, formatted, 'utf-8');
    console.log(`\nReport written to: ${args.output}`);

    const jsonPath = args.output.replace(/\.md$/, '.json');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`JSON data written to: ${jsonPath}`);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
