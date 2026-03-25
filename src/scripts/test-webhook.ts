/**
 * Test webhook events locally.
 *
 * Usage:
 *   npx tsx src/scripts/test-webhook.ts --type customer_message --ticket <ticket_id>
 *   npx tsx src/scripts/test-webhook.ts --type ticket_created --ticket <ticket_id>
 *   npx tsx src/scripts/test-webhook.ts --type agent_message --ticket <ticket_id>
 *   npx tsx src/scripts/test-webhook.ts --type linear_state_change --ticket <ticket_id>
 *   npx tsx src/scripts/test-webhook.ts --type action_completed --ticket <ticket_id>
 *
 * This script bypasses HTTP and calls the event router directly.
 */

import 'dotenv/config';
import { routeEventSync, getPassesForEvent } from '@/lib/events/event-router';
import type { TicketEventType } from '@/lib/events/event-router';
import { createServiceClient } from '@/lib/supabase/client';

const VALID_TYPES: TicketEventType[] = [
  'customer_message', 'agent_message', 'ticket_created', 'ticket_closed',
  'property_change', 'linear_state_change', 'linear_comment',
  'action_completed', 'sla_threshold',
];

async function main() {
  const args = process.argv.slice(2);
  const typeIdx = args.indexOf('--type');
  const ticketIdx = args.indexOf('--ticket');

  if (typeIdx === -1 || ticketIdx === -1) {
    console.log('Usage: npx tsx src/scripts/test-webhook.ts --type <event_type> --ticket <ticket_id>');
    console.log(`\nValid types: ${VALID_TYPES.join(', ')}`);
    process.exit(1);
  }

  const eventType = args[typeIdx + 1] as TicketEventType;
  const ticketId = args[ticketIdx + 1];

  if (!VALID_TYPES.includes(eventType)) {
    console.error(`Invalid event type: ${eventType}`);
    console.log(`Valid types: ${VALID_TYPES.join(', ')}`);
    process.exit(1);
  }

  // Show what passes will be triggered
  const passes = getPassesForEvent(eventType);
  console.log(`\n--- Test Webhook Event ---`);
  console.log(`Event type: ${eventType}`);
  console.log(`Ticket ID:  ${ticketId}`);
  console.log(`Passes:     ${passes.join(', ')}`);
  console.log('');

  // Verify ticket exists
  const supabase = createServiceClient();
  const { data: ticket } = await supabase
    .from('support_tickets')
    .select('hubspot_ticket_id, subject, hs_primary_company_name')
    .eq('hubspot_ticket_id', ticketId)
    .maybeSingle();

  if (!ticket) {
    console.error(`Ticket ${ticketId} not found in support_tickets table.`);
    process.exit(1);
  }

  console.log(`Ticket:     ${ticket.subject}`);
  console.log(`Company:    ${ticket.hs_primary_company_name}`);
  console.log('');

  // Route the event (synchronous — waits for analysis)
  console.log('Running analysis...');
  const startTime = Date.now();

  const result = await routeEventSync({
    source: 'internal',
    type: eventType,
    ticketId,
    timestamp: new Date().toISOString(),
    metadata: { test: true, triggeredBy: 'test-webhook.ts' },
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nCompleted in ${duration}s`);
  console.log(`Event ID:   ${result.eventId}`);
  console.log(`Passes run: ${result.passes.join(', ')}`);

  // Fetch the updated analysis
  const { data: analysis } = await supabase
    .from('ticket_action_board_analyses')
    .select('situation_summary, customer_temperature, action_items, analyzed_at, pass_versions')
    .eq('hubspot_ticket_id', ticketId)
    .maybeSingle();

  if (analysis) {
    console.log(`\n--- Updated Analysis ---`);
    console.log(`Temperature: ${analysis.customer_temperature}`);
    console.log(`Summary:     ${analysis.situation_summary?.substring(0, 200)}`);
    console.log(`Actions:     ${(analysis.action_items as unknown[])?.length || 0} items`);
    console.log(`Analyzed at: ${analysis.analyzed_at}`);
    if (analysis.pass_versions) {
      console.log(`Pass versions:`, analysis.pass_versions);
    }
  }

  // Check webhook_events log
  const { data: events } = await supabase
    .from('webhook_events')
    .select('id, event_type, passes_triggered, processed_at, error')
    .eq('hubspot_ticket_id', ticketId)
    .order('created_at', { ascending: false })
    .limit(3);

  if (events && events.length > 0) {
    console.log(`\n--- Recent Webhook Events ---`);
    for (const evt of events) {
      const status = evt.error ? `ERROR: ${evt.error}` : evt.processed_at ? 'processed' : 'pending';
      console.log(`  ${evt.id.substring(0, 8)}  ${evt.event_type}  [${status}]  passes: ${evt.passes_triggered?.join(', ')}`);
    }
  }
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
