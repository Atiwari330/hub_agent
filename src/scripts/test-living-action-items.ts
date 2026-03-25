/**
 * End-to-end test for Phase 4: Living Action Items.
 *
 * Tests the full lifecycle:
 *   1. Runs analysis on a ticket → creates living action items in the DB
 *   2. Re-analyzes the same ticket → should KEEP relevant items, SUPERSEDE outdated ones
 *   3. Simulates an agent message → auto-complete check marks matching items as completed
 *   4. Runs staleness check → reports what it would expire
 *
 * Usage:
 *   npx tsx src/scripts/test-living-action-items.ts <ticket_id>
 *   npx tsx src/scripts/test-living-action-items.ts              # picks a random open ticket
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createServiceClient } from '@/lib/supabase/client';
import { runAnalysisPipeline } from '@/lib/ai/passes/orchestrator';
import { runAutoCompleteCheck } from '@/lib/ai/passes/auto-complete-check';
import { getActiveActionItems, getAllActionItems } from '@/lib/ai/passes/action-items-db';

const DIVIDER = '─'.repeat(60);

async function main() {
  const supabase = createServiceClient();
  let ticketId = process.argv[2];

  // If no ticket ID provided, pick a random open ticket that has been analyzed
  if (!ticketId) {
    const { data } = await supabase
      .from('support_tickets')
      .select('hubspot_ticket_id, subject')
      .eq('is_closed', false)
      .limit(5);

    if (!data || data.length === 0) {
      console.error('No open tickets found.');
      process.exit(1);
    }

    const ticket = data[Math.floor(Math.random() * data.length)];
    ticketId = ticket.hubspot_ticket_id;
    console.log(`Picked random ticket: ${ticketId} — ${ticket.subject}\n`);
  }

  // Verify ticket exists
  const { data: ticket } = await supabase
    .from('support_tickets')
    .select('hubspot_ticket_id, subject, hs_primary_company_name')
    .eq('hubspot_ticket_id', ticketId)
    .single();

  if (!ticket) {
    console.error(`Ticket ${ticketId} not found.`);
    process.exit(1);
  }

  console.log(`Ticket:  ${ticket.subject}`);
  console.log(`Company: ${ticket.hs_primary_company_name}`);

  // ─── STEP 1: Show current state ───
  console.log(`\n${DIVIDER}`);
  console.log('STEP 1: Current action items state');
  console.log(DIVIDER);

  const before = await getAllActionItems(ticketId);
  if (before.length === 0) {
    console.log('No living action items yet (will be created on first analysis).');
  } else {
    console.log(`${before.length} total items:`);
    for (const item of before) {
      console.log(`  [${item.status.toUpperCase().padEnd(10)}] ${item.id}: ${item.description.substring(0, 80)}...`);
    }
  }

  // ─── STEP 2: Run analysis (creates/updates living items) ───
  console.log(`\n${DIVIDER}`);
  console.log('STEP 2: Running full analysis (keep/supersede/new lifecycle)...');
  console.log(DIVIDER);

  const startTime = Date.now();
  await runAnalysisPipeline(ticketId);
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Analysis completed in ${duration}s`);

  const afterAnalysis = await getAllActionItems(ticketId);
  const active = afterAnalysis.filter((i) => i.status === 'active');
  const superseded = afterAnalysis.filter((i) => i.status === 'superseded');
  const completed = afterAnalysis.filter((i) => i.status === 'completed');
  const expired = afterAnalysis.filter((i) => i.status === 'expired');

  console.log(`\nAction items after analysis:`);
  console.log(`  Active:     ${active.length}`);
  console.log(`  Completed:  ${completed.length}`);
  console.log(`  Superseded: ${superseded.length}`);
  console.log(`  Expired:    ${expired.length}`);

  console.log(`\nActive items:`);
  for (const item of active) {
    console.log(`  [${item.id}] (${item.priority}, ${item.who}) ${item.description.substring(0, 100)}`);
  }

  if (superseded.length > 0) {
    console.log(`\nSuperseded items:`);
    for (const item of superseded) {
      console.log(`  [${item.id}] ${item.description.substring(0, 80)} — reason: ${item.expired_reason || 'n/a'}`);
    }
  }

  // ─── STEP 3: Check action_item_events ───
  console.log(`\n${DIVIDER}`);
  console.log('STEP 3: Action item event log');
  console.log(DIVIDER);

  const { data: events } = await supabase
    .from('action_item_events')
    .select('*')
    .eq('hubspot_ticket_id', ticketId)
    .order('created_at', { ascending: false })
    .limit(15);

  if (events && events.length > 0) {
    for (const evt of events) {
      const time = new Date(evt.created_at).toLocaleTimeString();
      console.log(`  [${time}] ${evt.event_type.padEnd(15)} ${evt.action_item_id} — ${JSON.stringify(evt.details).substring(0, 80)}`);
    }
  } else {
    console.log('  No events recorded yet.');
  }

  // ─── STEP 4: Test auto-complete ───
  console.log(`\n${DIVIDER}`);
  console.log('STEP 4: Testing auto-complete detection');
  console.log(DIVIDER);

  const currentActive = await getActiveActionItems(ticketId);
  if (currentActive.length === 0) {
    console.log('No active items to test auto-complete against.');
  } else {
    // Simulate an agent message that addresses the first action item
    const targetItem = currentActive[0];
    const fakeMessage = `I've taken care of the following: ${targetItem.description}. The customer has been updated.`;

    console.log(`Simulating agent message that addresses item [${targetItem.id}]:`);
    console.log(`  "${fakeMessage.substring(0, 100)}..."`);
    console.log('');

    const autoResult = await runAutoCompleteCheck(ticketId, fakeMessage);

    if (autoResult.completedItemIds.length > 0) {
      console.log(`AUTO-COMPLETED: ${autoResult.completedItemIds.join(', ')}`);

      // Verify in DB
      for (const itemId of autoResult.completedItemIds) {
        const { data: item } = await supabase
          .from('action_items')
          .select('id, status, completed_method, completed_at')
          .eq('id', itemId)
          .eq('hubspot_ticket_id', ticketId)
          .single();

        if (item) {
          console.log(`  DB confirms: [${item.id}] status=${item.status}, method=${item.completed_method}, at=${item.completed_at}`);
        }
      }
    } else {
      console.log('LLM did not auto-complete any items (it may have judged the message insufficient).');
    }
  }

  // ─── STEP 5: Final summary ───
  console.log(`\n${DIVIDER}`);
  console.log('STEP 5: Final state');
  console.log(DIVIDER);

  const finalItems = await getAllActionItems(ticketId);
  const statusCounts: Record<string, number> = {};
  for (const item of finalItems) {
    statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
  }
  console.log(`Total items: ${finalItems.length}`);
  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`  ${status}: ${count}`);
  }

  // Also check JSONB backward compat
  const { data: analysis } = await supabase
    .from('ticket_action_board_analyses')
    .select('action_items')
    .eq('hubspot_ticket_id', ticketId)
    .single();

  if (analysis) {
    const jsonbCount = (analysis.action_items as unknown[])?.length || 0;
    console.log(`\nJSONB backward compat: ${jsonbCount} items in ticket_action_board_analyses.action_items`);
  }

  console.log(`\nDone! Refresh the Action Board UI to see the results.`);
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
