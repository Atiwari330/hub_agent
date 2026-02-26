import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { getOpenTickets, getRecentlyClosedTickets } from '@/lib/hubspot/tickets';
import { isOpenTicketStage } from '@/lib/hubspot/ticket-stage-config';

// Convert empty strings to null for timestamp fields
const toTimestamp = (value: string | undefined | null): string | null => {
  if (!value || value === '') return null;
  // HubSpot sometimes returns epoch milliseconds as a string
  if (/^\d{13}$/.test(value)) {
    return new Date(parseInt(value, 10)).toISOString();
  }
  return value;
};

// Convert empty strings to null for bigint fields (milliseconds)
const toBigInt = (value: string | undefined | null): number | null => {
  if (!value || value === '') return null;
  const num = parseInt(value, 10);
  return isNaN(num) ? null : num;
};

// Verify cron secret for security
function verifyCronSecret(request: Request): boolean {
  // Skip auth in development mode
  if (process.env.NODE_ENV === 'development') return true;

  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) return true; // Skip if not configured
  return authHeader === `Bearer ${cronSecret}`;
}

const DB_BATCH_SIZE = 100;

export async function GET(request: Request) {
  // Verify the request is from Vercel Cron
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const workflowId = crypto.randomUUID();

  try {
    const startTime = Date.now();

    // Log workflow start
    await supabase.from('workflow_runs').insert({
      id: workflowId,
      workflow_name: 'sync-tickets',
      status: 'running',
    });

    // Fetch open + recently closed tickets in parallel
    console.log('Fetching tickets from HubSpot...');
    const [openTickets, closedTickets] = await Promise.all([
      getOpenTickets(),
      getRecentlyClosedTickets(),
    ]);
    console.log(
      `Found ${openTickets.length} open tickets, ${closedTickets.length} recently closed tickets`
    );

    // Deduplicate by ticket ID (a transitioning ticket could match both)
    const ticketMap = new Map<string, (typeof openTickets)[number]>();
    for (const ticket of openTickets) {
      ticketMap.set(ticket.id, ticket);
    }
    for (const ticket of closedTickets) {
      ticketMap.set(ticket.id, ticket);
    }
    const allTickets = Array.from(ticketMap.values());

    // Transform to database format
    const ticketData = allTickets.map((ticket) => ({
      hubspot_ticket_id: ticket.id,
      subject: ticket.properties.subject,
      source_type: ticket.properties.source_type,
      pipeline: ticket.properties.hs_pipeline,
      pipeline_stage: ticket.properties.hs_pipeline_stage,
      hubspot_owner_id: ticket.properties.hubspot_owner_id,
      hs_primary_company_id: ticket.properties.hs_primary_company_id,
      hs_primary_company_name: ticket.properties.hs_primary_company_name,
      is_closed: !isOpenTicketStage(ticket.properties.hs_pipeline_stage),
      time_to_close: toBigInt(ticket.properties.time_to_close),
      time_to_first_reply: toBigInt(
        ticket.properties.time_to_first_agent_reply
      ),
      closed_date: toTimestamp(ticket.properties.closed_date),
      priority: ticket.properties.hs_ticket_priority,
      category: ticket.properties.hs_ticket_category,
      ball_in_court: ticket.properties.ball_in_court,
      software: ticket.properties.software,
      ticket_type: ticket.properties.ticket_type,
      frt_sla_breached: ticket.properties.frt_sla_breached === 'true',
      nrt_sla_breached: ticket.properties.nrt_sla_breached === 'true',
      linear_task: ticket.properties.linear_task,
      hubspot_created_at: toTimestamp(ticket.properties.createdate),
      last_customer_message_at: toTimestamp(ticket.properties.hs_last_message_received_at),
      last_agent_message_at: toTimestamp(ticket.properties.hs_last_message_sent_at),
      last_contacted_at: toTimestamp(ticket.properties.hs_lastcontacted),
      synced_at: new Date().toISOString(),
    }));

    // Batch upsert tickets
    let ticketSuccess = 0;
    let ticketErrors = 0;

    for (let i = 0; i < ticketData.length; i += DB_BATCH_SIZE) {
      const chunk = ticketData.slice(i, i + DB_BATCH_SIZE);
      const { error: upsertError } = await supabase
        .from('support_tickets')
        .upsert(chunk, { onConflict: 'hubspot_ticket_id' });

      if (upsertError) {
        console.error(
          `Ticket batch upsert error (chunk ${i / DB_BATCH_SIZE + 1}):`,
          upsertError
        );
        ticketErrors += chunk.length;
      } else {
        ticketSuccess += chunk.length;
      }
    }

    // Orphan reconciliation: mark any DB ticket that claims to be open
    // but wasn't in the fresh HubSpot open list as closed.
    // This catches tickets closed in HubSpot between syncs, deleted tickets, etc.
    const freshOpenIds = openTickets.map((t) => t.id);
    let orphansClosed = 0;

    if (freshOpenIds.length > 0) {
      const { count } = await supabase
        .from('support_tickets')
        .update({ is_closed: true, synced_at: new Date().toISOString() })
        .eq('is_closed', false)
        .not('hubspot_ticket_id', 'in', `(${freshOpenIds.join(',')})`);

      orphansClosed = count || 0;
    } else {
      // No open tickets from HubSpot — mark ALL currently-open DB tickets as closed
      const { count } = await supabase
        .from('support_tickets')
        .update({ is_closed: true, synced_at: new Date().toISOString() })
        .eq('is_closed', false);

      orphansClosed = count || 0;
    }

    if (orphansClosed > 0) {
      console.log(`Marked ${orphansClosed} orphaned tickets as closed`);
    }

    // Clean up: remove closed tickets older than 90 days (no longer in sync window)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const { count: deletedCount } = await supabase
      .from('support_tickets')
      .delete({ count: 'exact' })
      .eq('is_closed', true)
      .lt('closed_date', ninetyDaysAgo.toISOString());

    const duration = Date.now() - startTime;

    // Log success
    await supabase
      .from('workflow_runs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        result: {
          openFetched: openTickets.length,
          closedFetched: closedTickets.length,
          totalUnique: allTickets.length,
          ticketsSync: ticketSuccess,
          ticketErrors,
          orphansClosed,
          deletedStale: deletedCount || 0,
          durationMs: duration,
        },
      })
      .eq('id', workflowId);

    console.log(
      `Ticket sync complete in ${duration}ms: ${ticketSuccess} synced (${ticketErrors} errors), ${orphansClosed} orphans closed, ${deletedCount || 0} stale deleted`
    );

    return NextResponse.json({
      success: true,
      openFetched: openTickets.length,
      closedFetched: closedTickets.length,
      ticketsSynced: ticketSuccess,
      ticketErrors,
      orphansClosed,
      deletedStale: deletedCount || 0,
      durationMs: duration,
    });
  } catch (error) {
    console.error('Ticket sync failed:', error);

    // Log failure
    await supabase
      .from('workflow_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      .eq('id', workflowId);

    return NextResponse.json(
      {
        error: 'Ticket sync failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
