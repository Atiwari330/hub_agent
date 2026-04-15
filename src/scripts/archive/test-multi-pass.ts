/**
 * Test the multi-pass analysis pipeline against a real ticket.
 *
 * Usage:
 *   npx tsx src/scripts/test-multi-pass.ts              # picks a random open ticket
 *   npx tsx src/scripts/test-multi-pass.ts <ticket_id>  # specific ticket
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createServiceClient } from '../lib/supabase/client';
import { gatherTicketContext } from '../lib/ai/passes/gather-context';
import { runSituationPass } from '../lib/ai/passes/situation-pass';
import { runActionItemPass } from '../lib/ai/passes/action-item-pass';
import { runTemperaturePass } from '../lib/ai/passes/temperature-pass';
import { runTimingPass } from '../lib/ai/passes/timing-pass';
import { runVerificationPass } from '../lib/ai/passes/verification-pass';
import { runCrossTicketPass } from '../lib/ai/passes/cross-ticket-pass';
import { runResponseDraftPass } from '../lib/ai/passes/response-draft-pass';

async function main() {
  const ticketId = process.argv[2];
  const supabase = createServiceClient();

  let targetTicketId = ticketId;

  if (!targetTicketId) {
    console.log('No ticket ID provided, picking a random open ticket...\n');
    const { data: tickets, error } = await supabase
      .from('support_tickets')
      .select('hubspot_ticket_id, subject, hs_primary_company_name')
      .eq('is_closed', false)
      .limit(5);

    if (error || !tickets || tickets.length === 0) {
      console.error('No open tickets found:', error?.message);
      process.exit(1);
    }

    const pick = tickets[Math.floor(Math.random() * tickets.length)];
    targetTicketId = pick.hubspot_ticket_id;
    console.log(`Selected: ${targetTicketId} — "${pick.subject}" (${pick.hs_primary_company_name})\n`);
  }

  // Step 1: Gather context
  console.log('=== GATHERING CONTEXT ===');
  const start = Date.now();
  const context = await gatherTicketContext(targetTicketId, supabase);
  const gatherMs = Date.now() - start;
  console.log(`  Ticket: ${context.ticket.subject}`);
  console.log(`  Company: ${context.ticket.hs_primary_company_name}`);
  console.log(`  Owner: ${context.ownerName}`);
  console.log(`  Conversation messages: ${context.conversationMessages.length}`);
  console.log(`  Engagements: ${context.engagementTimeline.engagements.length}`);
  console.log(`  Linear: ${context.linearContext ? context.linearContext.identifier : 'none'}`);
  console.log(`  Related tickets: ${context.relatedTickets.length}`);
  console.log(`  Recent completions: ${context.recentCompletions.length}`);
  console.log(`  Age: ${context.ageDays} days`);
  console.log(`  (${gatherMs}ms)\n`);

  // Step 2: Run each pass individually
  const results: Record<string, { result: unknown; ms: number }> = {};

  async function runPass(name: string, fn: () => Promise<unknown>) {
    console.log(`=== ${name.toUpperCase()} PASS ===`);
    const s = Date.now();
    try {
      const result = await fn();
      const ms = Date.now() - s;
      results[name] = { result, ms };
      console.log(`  Result: ${JSON.stringify(result, null, 2).split('\n').map((l, i) => i === 0 ? l : '  ' + l).join('\n')}`);
      console.log(`  (${ms}ms)\n`);
    } catch (err) {
      const ms = Date.now() - s;
      console.error(`  ERROR (${ms}ms):`, err instanceof Error ? err.message : err);
      console.log('');
    }
  }

  // Run parallel passes
  await Promise.all([
    runPass('situation', () => runSituationPass(context)),
    runPass('temperature', () => runTemperaturePass(context)),
    runPass('timing', async () => runTimingPass(context)),
    runPass('verification', () => runVerificationPass(context)),
    runPass('cross_ticket', () => runCrossTicketPass(context)),
  ]);

  // Run dependent passes
  const situationSummary = (results.situation?.result as { situation_summary?: string })?.situation_summary;
  const temperature = (results.temperature?.result as { customer_temperature?: string })?.customer_temperature;

  await runPass('action_items', () =>
    runActionItemPass(context, { situationSummary })
  );

  const actionItems = (results.action_items?.result as { action_items?: unknown[] })?.action_items;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await runPass('response_draft', () =>
    runResponseDraftPass(context, { actionItems: actionItems as any, temperature })
  );

  // Summary
  console.log('=== SUMMARY ===');
  const totalMs = Object.values(results).reduce((sum, r) => sum + r.ms, 0) + gatherMs;
  console.log(`  Context gathering: ${gatherMs}ms`);
  for (const [name, { ms }] of Object.entries(results)) {
    console.log(`  ${name}: ${ms}ms`);
  }
  console.log(`  Total wall time: ~${Date.now() - start}ms (parallel passes overlap)`);
  console.log(`  Total sequential time: ${totalMs}ms`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
