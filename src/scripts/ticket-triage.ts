import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/client';
import {
  gatherTicketContext,
  buildTicketMetadataSection,
  buildLinearSection,
} from '../lib/ai/passes/gather-context';
import { generateText } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import fs from 'fs';
import type { TicketContext } from '../lib/ai/passes/types';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

function getTriageModel() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY is not configured');
  const deepseek = createDeepSeek({ apiKey, baseURL: 'https://ai-gateway.vercel.sh/v1' });
  return deepseek('deepseek/deepseek-v3.2');
}

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const TIMELINE_SYSTEM_PROMPT = `You are analyzing a support ticket's full communication history for a healthcare SaaS company. Your job is to produce a clean, chronological timeline of ALL significant events — customer messages, agent responses, internal notes, Linear engineering activity, and action item completions.

RULES:
- Every entry MUST include a date (YYYY-MM-DD) or datetime if available.
- Merge conversation thread messages and engagement timeline into ONE chronological sequence. De-duplicate events that appear in both sources (same date, same author, same content).
- Flag gaps: if 3+ business days passed between events with no activity, explicitly note "--- GAP: ~X business days of silence ---"
- For Linear activity, note when the engineering ticket was created, any state changes, and any engineer comments with their dates.
- Include action item completions if present — note what was marked done and when.
- Keep each entry to 1-2 sentences max.
- End with a CURRENT_STATE line summarizing: who communicated last, when, and what they said or asked.

Output format:
TIMELINE:
[YYYY-MM-DD] <event description>
[YYYY-MM-DD] <event description>
--- GAP: ~X business days of silence ---
[YYYY-MM-DD] <event description>

CURRENT_STATE: <who communicated last, when, what was said/requested>`;

const STATUS_SYSTEM_PROMPT = `You are determining the current operational status of a support ticket for a healthcare SaaS company. You will receive a reconstructed timeline and ticket metadata.

Determine EXACTLY ONE status from this list:
- AGENT_ACTION_NEEDED — Support agent needs to do something (respond to customer, follow up, relay info from engineering, take an action)
- WAITING_ON_CUSTOMER — Agent sent a message or question to the customer and is waiting for their reply
- WAITING_ON_ENGINEERING — A Linear engineering task is open or in-progress and engineering hasn't resolved it yet. Support has done their part for now.
- ENGINEERING_FOLLOWUP_NEEDED — Engineering completed work or posted a comment (asking for testing, clarification, etc.), but support hasn't relayed that update to the customer or taken the requested action yet
- CLARIFICATION_NEEDED_FROM_LINEAR — A Linear task exists but is stale, unclear, or needs more info from the support side before engineering can proceed
- READY_TO_CLOSE — Issue appears resolved (customer confirmed, fix deployed, or issue is clearly done) and the ticket just needs to be formally closed
- STALE — No meaningful activity from anyone in 5+ business days and it's unclear what needs to happen next

CRITICAL RULES — reason about TIMESTAMPS carefully:
- "Waiting on customer" means the AGENT sent the LAST substantive message AND asked a question or requested information. If the agent just sent an FYI with no question, that's not necessarily waiting on customer.
- If the customer's last message was 3+ business days ago and no agent has responded, that's AGENT_ACTION_NEEDED regardless of what ball_in_court says.
- If a Linear task exists and engineering commented with a question or request for support to do something (test, get clarification, relay info), but support never did it, that's ENGINEERING_FOLLOWUP_NEEDED.
- If ball_in_court says "Customer" but the timeline shows the agent never actually asked a question or the customer already replied, override ball_in_court.
- If engineering marked a task as Done/Completed but nobody told the customer, that's ENGINEERING_FOLLOWUP_NEEDED.
- A ticket with no activity for 5+ business days where the last action was unclear or inconclusive is STALE.

Output EXACTLY these three lines:
STATUS: <one status from the list above>
CONFIDENCE: <HIGH|MEDIUM|LOW>
RATIONALE: <1-2 sentences explaining why, referencing specific dates from the timeline>`;

const NEXT_STEP_SYSTEM_PROMPT = `You are writing the SINGLE most critical next step for a support team managing this healthcare SaaS support ticket.

You will receive: the ticket's status determination, the reconstructed timeline, and full context including Linear engineering details, customer knowledge, and related tickets.

RULES:
- Output ONE concrete action. Not a list of options. Not "consider doing X." A direct instruction that someone can act on immediately.
- Start with an ACTION VERB: "Ask...", "Relay...", "Close...", "Escalate...", "Follow up...", "Test...", "Create...", "Update..."
- Include SPECIFIC details from the context: customer name, specific dates, what to reference, what question to ask.
- If the action involves relaying engineering info to the customer, reference or quote the specific engineering comment or finding.
- If the action involves getting info from the customer for engineering, specify exactly what info is needed.
- If the ticket should be closed, state WHY it's safe to close (e.g., "customer confirmed fix works on Mar 20").
- If the ticket is stale, recommend the most logical action to restart momentum (usually a check-in with the customer or internal escalation).
- If the ticket involves a Co-Destiny / VIP account, note the elevated urgency.
- Keep it to 2-3 sentences max. Every word should be actionable information.

Output EXACTLY these two lines:
NEXT_STEP: <the one critical next step — 2-3 sentences starting with an action verb>
URGENCY: <IMMEDIATE|TODAY|THIS_WEEK|LOW>

Urgency guidelines:
- IMMEDIATE: Customer is angry/escalating, SLA breach, VIP/Co-Destiny with a blocking issue, or ticket has been waiting 5+ days with no response
- TODAY: Agent action needed and customer is waiting, or engineering followup that's been sitting for 2+ days
- THIS_WEEK: Routine follow-ups, clarifications, or actions that aren't time-sensitive
- LOW: Ready to close, or waiting on external party with no urgency`;

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildTimelineUserPrompt(ctx: TicketContext): string {
  let prompt = buildTicketMetadataSection(ctx);

  prompt += `\n\nCONVERSATION THREAD (${ctx.conversationMessages.length} messages):\n${ctx.conversationText}`;
  prompt += `\n\nENGAGEMENT TIMELINE (${ctx.engagementTimeline.engagements.length} items):\n${ctx.engagementTimelineText}`;

  const linearSection = buildLinearSection(ctx);
  if (linearSection) prompt += `\n\n${linearSection}`;

  if (ctx.recentCompletions.length > 0) {
    prompt += `\n\nACTION ITEM COMPLETIONS (${ctx.recentCompletions.length}):`;
    for (const c of ctx.recentCompletions) {
      prompt += `\n- [${c.completed_at?.split('T')[0] || 'unknown'}] "${c.action_description}" completed by ${c.completed_by_name}`;
      if (c.verified !== null) prompt += ` (verified: ${c.verified ? 'yes' : 'no'}${c.verification_note ? ` — ${c.verification_note}` : ''})`;
    }
  }

  return prompt;
}

function buildStatusUserPrompt(ctx: TicketContext, timeline: string): string {
  let prompt = buildTicketMetadataSection(ctx);
  prompt += `\n\nRECONSTRUCTED TIMELINE:\n${timeline}`;
  return prompt;
}

function buildNextStepUserPrompt(
  ctx: TicketContext,
  timeline: string,
  status: string,
  rationale: string
): string {
  let prompt = buildTicketMetadataSection(ctx);
  prompt += `\n\nSTATUS DETERMINATION:\nStatus: ${status}\nRationale: ${rationale}`;
  prompt += `\n\nRECONSTRUCTED TIMELINE:\n${timeline}`;

  const linearSection = buildLinearSection(ctx);
  if (linearSection) prompt += `\n\n${linearSection}`;

  if (ctx.customerContext) {
    prompt += `\n\nCUSTOMER-SPECIFIC KNOWLEDGE:\n${ctx.customerContext}`;
  }

  if (ctx.relatedTickets.length > 0) {
    prompt += `\n\nRELATED OPEN TICKETS FROM SAME COMPANY (${ctx.relatedTickets.length}):`;
    for (const rt of ctx.relatedTickets) {
      prompt += `\n- #${rt.hubspot_ticket_id}: ${rt.subject || 'No subject'}`;
      if (rt.situation_summary) prompt += ` — ${rt.situation_summary}`;
    }
  }

  return prompt;
}

// ---------------------------------------------------------------------------
// Result parsers
// ---------------------------------------------------------------------------

function parseStatusResult(text: string) {
  const statusMatch = text.match(/STATUS:\s*(.+)/i);
  const confidenceMatch = text.match(/CONFIDENCE:\s*(.+)/i);
  const rationaleMatch = text.match(/RATIONALE:\s*([\s\S]+?)(?=\n[A-Z_]+:|$)/i);
  return {
    status: statusMatch?.[1]?.trim() || 'UNKNOWN',
    confidence: confidenceMatch?.[1]?.trim() || 'LOW',
    rationale: rationaleMatch?.[1]?.trim() || 'Could not determine status.',
  };
}

function parseNextStepResult(text: string) {
  const nextStepMatch = text.match(/NEXT_STEP:\s*([\s\S]+?)(?=\nURGENCY:|$)/i);
  const urgencyMatch = text.match(/URGENCY:\s*(.+)/i);
  return {
    nextStep: nextStepMatch?.[1]?.trim() || 'Review ticket manually.',
    urgency: urgencyMatch?.[1]?.trim() || 'TODAY',
  };
}

// ---------------------------------------------------------------------------
// Per-ticket triage
// ---------------------------------------------------------------------------

interface TriageResult {
  ticketId: string;
  subject: string;
  company: string;
  rep: string;
  ageDays: number;
  priority: string;
  isCoDestiny: boolean;
  hasLinear: boolean;
  status: string;
  confidence: string;
  statusRationale: string;
  nextStep: string;
  urgency: string;
  timeline: string;
  error?: string;
}

async function triageTicket(ticketId: string): Promise<TriageResult> {
  const model = getTriageModel();
  const ctx = await gatherTicketContext(ticketId);

  // Pass 1: Timeline Reconstruction
  const timelineResult = await generateText({
    model,
    system: TIMELINE_SYSTEM_PROMPT,
    prompt: buildTimelineUserPrompt(ctx),
  });
  const timeline = timelineResult.text;

  // Pass 2: Status Determination
  const statusResult = await generateText({
    model,
    system: STATUS_SYSTEM_PROMPT,
    prompt: buildStatusUserPrompt(ctx, timeline),
  });
  const { status, confidence, rationale } = parseStatusResult(statusResult.text);

  // Pass 3: Next Step Synthesis
  const nextStepResult = await generateText({
    model,
    system: NEXT_STEP_SYSTEM_PROMPT,
    prompt: buildNextStepUserPrompt(ctx, timeline, status, rationale),
  });
  const { nextStep, urgency } = parseNextStepResult(nextStepResult.text);

  return {
    ticketId: ctx.ticket.hubspot_ticket_id,
    subject: ctx.ticket.subject || 'No subject',
    company: ctx.ticket.hs_primary_company_name || 'Unknown',
    rep: ctx.ownerName || 'Unassigned',
    ageDays: ctx.ageDays || 0,
    priority: ctx.ticket.priority || 'N/A',
    isCoDestiny: ctx.ticket.is_co_destiny || false,
    hasLinear: !!ctx.linearContext || !!ctx.ticket.linear_task,
    status,
    confidence,
    statusRationale: rationale,
    nextStep,
    urgency,
    timeline,
  };
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

const STATUS_DISPLAY: Record<string, string> = {
  AGENT_ACTION_NEEDED: 'Agent Action Needed',
  WAITING_ON_CUSTOMER: 'Waiting on Customer',
  WAITING_ON_ENGINEERING: 'Waiting on Engineering',
  ENGINEERING_FOLLOWUP_NEEDED: 'Engineering Followup Needed',
  CLARIFICATION_NEEDED_FROM_LINEAR: 'Clarification Needed from Linear',
  READY_TO_CLOSE: 'Ready to Close',
  STALE: 'Stale',
  UNKNOWN: 'Unknown',
};

const STATUS_ORDER = [
  'AGENT_ACTION_NEEDED',
  'ENGINEERING_FOLLOWUP_NEEDED',
  'CLARIFICATION_NEEDED_FROM_LINEAR',
  'STALE',
  'WAITING_ON_ENGINEERING',
  'WAITING_ON_CUSTOMER',
  'READY_TO_CLOSE',
  'UNKNOWN',
];

const URGENCY_ORDER = ['IMMEDIATE', 'TODAY', 'THIS_WEEK', 'LOW'];

function formatReport(results: TriageResult[], verbose: boolean): string {
  const today = new Date().toISOString().split('T')[0];
  const successes = results.filter((r) => !r.error);
  const failures = results.filter((r) => r.error);

  // Count by status
  const statusCounts: Record<string, number> = {};
  const urgencyCounts: Record<string, number> = {};
  for (const r of successes) {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
    urgencyCounts[r.urgency] = (urgencyCounts[r.urgency] || 0) + 1;
  }

  let report = `# Support Ticket Triage — ${today}\n\n`;
  report += `## Summary\n`;
  report += `- **${results.length}** open tickets analyzed`;
  if (failures.length > 0) report += ` (${failures.length} failed)`;
  report += `\n`;

  for (const status of STATUS_ORDER) {
    if (statusCounts[status]) {
      const immediateCount = successes.filter(
        (r) => r.status === status && r.urgency === 'IMMEDIATE'
      ).length;
      let line = `- ${statusCounts[status]} ${STATUS_DISPLAY[status] || status}`;
      if (immediateCount > 0) line += ` (${immediateCount} IMMEDIATE)`;
      report += `${line}\n`;
    }
  }

  if (urgencyCounts['IMMEDIATE']) {
    report += `\n> **${urgencyCounts['IMMEDIATE']} tickets need IMMEDIATE attention**\n`;
  }

  // Sort: by status order, then urgency, then age descending
  const sorted = [...successes].sort((a, b) => {
    const statusDiff = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    if (statusDiff !== 0) return statusDiff;
    const urgencyDiff = URGENCY_ORDER.indexOf(a.urgency) - URGENCY_ORDER.indexOf(b.urgency);
    if (urgencyDiff !== 0) return urgencyDiff;
    return b.ageDays - a.ageDays;
  });

  // Group by status
  let currentStatus = '';
  for (const r of sorted) {
    if (r.status !== currentStatus) {
      currentStatus = r.status;
      report += `\n---\n\n## ${STATUS_DISPLAY[r.status] || r.status}\n`;
    }

    const coDestinyBadge = r.isCoDestiny ? '  ⚑ CO-DESTINY' : '';
    const linearBadge = r.hasLinear ? ' | **Linear:** linked' : '';

    report += `\n### [${r.urgency}] #${r.ticketId} — "${r.subject}"${coDestinyBadge}\n`;
    report += `**Company:** ${r.company} | **Rep:** ${r.rep} | **Age:** ${r.ageDays} days | **Priority:** ${r.priority}${linearBadge}\n`;
    report += `**Status:** ${STATUS_DISPLAY[r.status] || r.status} (${r.confidence} confidence)\n`;
    report += `**Next Step:** ${r.nextStep}\n`;

    if (verbose) {
      report += `\n<details><summary>Full Timeline</summary>\n\n\`\`\`\n${r.timeline}\n\`\`\`\n\n</details>\n`;
    }
  }

  // Failures
  if (failures.length > 0) {
    report += `\n---\n\n## Errors\n`;
    for (const r of failures) {
      report += `\n### #${r.ticketId} — "${r.subject}"\n`;
      report += `**ERROR:** ${r.error}\n`;
    }
  }

  report += `\n---\n\n*Generated at ${new Date().toISOString()} — ${successes.length} analyzed, ${failures.length} failed*\n`;

  return report;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  let output: string | null = null;
  let concurrency = 5;
  let verbose = false;
  let ticketId: string | null = null;
  let sync = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--output=')) {
      output = args[i].split('=')[1];
    } else if (args[i] === '--output' && args[i + 1]) {
      output = args[++i];
    } else if (args[i].startsWith('--concurrency=')) {
      concurrency = parseInt(args[i].split('=')[1], 10) || 5;
    } else if (args[i] === '--concurrency' && args[i + 1]) {
      concurrency = parseInt(args[++i], 10) || 5;
    } else if (args[i] === '--verbose') {
      verbose = true;
    } else if (args[i].startsWith('--ticket=')) {
      ticketId = args[i].split('=')[1];
    } else if (args[i] === '--ticket' && args[i + 1]) {
      ticketId = args[++i];
    } else if (args[i] === '--sync') {
      sync = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Usage: npx tsx src/scripts/ticket-triage.ts [options]

Analyzes all open support tickets and produces a triage report with the
single most critical next step for each ticket.

Options:
  --sync              Sync tickets from HubSpot before analyzing (requires dev server)
  --output=FILE       Write report to file (default: triage-report-YYYY-MM-DD.md)
  --concurrency=N     Max parallel tickets (default: 5)
  --verbose           Include full reconstructed timeline per ticket
  --ticket=ID         Triage a single ticket (for debugging)
  --help, -h          Show this help
`);
      process.exit(0);
    }
  }

  const today = new Date().toISOString().split('T')[0];
  if (!output) output = `triage-report-${today}.md`;

  return { output, concurrency, verbose, ticketId, sync };
}

async function main() {
  const { output, concurrency, verbose, ticketId, sync } = parseArgs();
  const supabase = createServiceClient();

  // Sync from HubSpot if requested
  if (sync) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    console.log('Syncing tickets from HubSpot...');
    try {
      const res = await fetch(`${baseUrl}/api/cron/sync-tickets`, {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET || ''}` },
      });
      if (!res.ok) {
        const body = await res.text();
        console.error(`Sync failed (${res.status}): ${body}`);
        process.exit(1);
      }
      const data = await res.json();
      console.log(`Sync complete — ${data.ticketsSynced ?? '?'} tickets synced\n`);
    } catch (err) {
      console.error('Sync failed — is the dev server running? (npm run dev)');
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  // Fetch tickets
  let ticketRows: Array<{ hubspot_ticket_id: string; subject: string | null; hs_primary_company_name: string | null }>;

  if (ticketId) {
    const { data, error } = await supabase
      .from('support_tickets')
      .select('hubspot_ticket_id, subject, hs_primary_company_name')
      .eq('hubspot_ticket_id', ticketId)
      .single();
    if (error || !data) {
      console.error(`Ticket ${ticketId} not found: ${error?.message || 'unknown'}`);
      process.exit(1);
    }
    ticketRows = [data];
  } else {
    const { data, error } = await supabase
      .from('support_tickets')
      .select('hubspot_ticket_id, subject, hs_primary_company_name')
      .eq('is_closed', false)
      .order('hubspot_created_at', { ascending: true });
    if (error) {
      console.error(`Failed to fetch tickets: ${error.message}`);
      process.exit(1);
    }
    ticketRows = data || [];
  }

  if (ticketRows.length === 0) {
    console.log('No open tickets found.');
    process.exit(0);
  }

  console.log(`\nAnalyzing ${ticketRows.length} ticket${ticketRows.length === 1 ? '' : 's'} (concurrency: ${concurrency})...\n`);

  const startTime = Date.now();
  let completed = 0;

  const results = await processWithConcurrency(
    ticketRows,
    concurrency,
    async (row, _index) => {
      const id = row.hubspot_ticket_id;
      try {
        const result = await triageTicket(id);
        completed++;
        console.log(`  [${completed}/${ticketRows.length}] ✓ #${id} — ${row.subject || 'No subject'} → ${result.status}`);
        return result;
      } catch (err) {
        completed++;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.log(`  [${completed}/${ticketRows.length}] ✗ #${id} — ${row.subject || 'No subject'} → ERROR: ${errMsg}`);
        return {
          ticketId: id,
          subject: row.subject || 'No subject',
          company: row.hs_primary_company_name || 'Unknown',
          rep: 'Unknown',
          ageDays: 0,
          priority: 'N/A',
          isCoDestiny: false,
          hasLinear: false,
          status: 'UNKNOWN',
          confidence: 'LOW',
          statusRationale: '',
          nextStep: '',
          urgency: 'TODAY',
          timeline: '',
          error: errMsg,
        } as TriageResult;
      }
    }
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successes = results.filter((r) => !r.error).length;
  const failures = results.filter((r) => r.error).length;

  console.log(`\nDone in ${elapsed}s — ${successes} analyzed, ${failures} failed\n`);

  // Generate report
  const report = formatReport(results, verbose);

  // Write to file
  fs.writeFileSync(output, report, 'utf-8');
  console.log(`Report written to ${output}\n`);

  // Print to stdout
  console.log(report);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
