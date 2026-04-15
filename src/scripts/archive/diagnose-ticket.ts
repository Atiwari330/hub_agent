import { config } from 'dotenv';
config({ path: '.env.local' });

import { getHubSpotClient } from '../lib/hubspot/client';
import { getOpenTickets } from '../lib/hubspot/tickets';
import { createServiceClient } from '../lib/supabase/client';

const TARGET_TICKET_ID = '39298106652';

const TICKET_PROPERTIES = [
  'subject',
  'source_type',
  'createdate',
  'hs_pipeline',
  'hs_pipeline_stage',
  'hubspot_owner_id',
  'hs_primary_company_name',
  'hs_primary_company_id',
  'hs_is_closed',
  'time_to_close',
  'closed_date',
  'hs_ticket_priority',
  'hs_ticket_category',
  'ball_in_court',
];

async function main() {
  const client = getHubSpotClient();
  const supabase = createServiceClient();

  console.log('=============================================================');
  console.log('  TICKET DIAGNOSTIC: Closed ticket appearing as open');
  console.log(`  Target ticket: ${TARGET_TICKET_ID}`);
  console.log('=============================================================\n');

  // ---------------------------------------------------------------
  // CHECK 1: Fetch ticket directly from HubSpot
  // ---------------------------------------------------------------
  console.log('--- CHECK 1: HubSpot Direct Fetch ---\n');
  try {
    const hsTicket = await client.crm.tickets.basicApi.getById(
      TARGET_TICKET_ID,
      TICKET_PROPERTIES
    );
    const props = hsTicket.properties;

    console.log('  HubSpot ticket properties:');
    console.log(`    subject:            ${props.subject}`);
    console.log(`    hs_pipeline:        ${JSON.stringify(props.hs_pipeline)}`);
    console.log(`    hs_pipeline_stage:  ${JSON.stringify(props.hs_pipeline_stage)}`);
    console.log(`    hs_is_closed:       ${JSON.stringify(props.hs_is_closed)}`);
    console.log(`    hs_is_closed type:  ${typeof props.hs_is_closed}`);
    console.log(`    hs_is_closed === 'true': ${props.hs_is_closed === 'true'}`);
    console.log(`    closed_date:        ${props.closed_date}`);
    console.log(`    createdate:         ${props.createdate}`);
    console.log(`    source_type:        ${props.source_type}`);
    console.log(`    hubspot_owner_id:   ${props.hubspot_owner_id}`);
    console.log(`    hs_ticket_priority: ${props.hs_ticket_priority}`);
    console.log('');

    // Evaluate H1
    if (props.hs_is_closed !== 'true') {
      console.log(
        `  >> H1 CONFIRMED: hs_is_closed is ${JSON.stringify(props.hs_is_closed)}, not 'true'`
      );
      console.log(
        `     The sync would set is_closed = false for this ticket.`
      );
    } else {
      console.log('  >> H1 RULED OUT: hs_is_closed is correctly "true"');
    }

    // Evaluate H3
    if (props.hs_pipeline !== '0') {
      console.log(
        `  >> H3 CONFIRMED: hs_pipeline is ${JSON.stringify(props.hs_pipeline)}, not '0'`
      );
      console.log(
        `     This ticket is NOT in the Support Pipeline. Both sync queries skip it.`
      );
    } else {
      console.log('  >> H3 RULED OUT: hs_pipeline is "0" (Support Pipeline)');
    }
  } catch (err) {
    console.log(`  ERROR fetching from HubSpot: ${err instanceof Error ? err.message : err}`);
  }

  console.log('');

  // ---------------------------------------------------------------
  // CHECK 2: Query ticket from Supabase
  // ---------------------------------------------------------------
  console.log('--- CHECK 2: Supabase DB State ---\n');
  const { data: dbTicket, error: dbError } = await supabase
    .from('support_tickets')
    .select('*')
    .eq('hubspot_ticket_id', TARGET_TICKET_ID)
    .single();

  if (dbError) {
    console.log(`  ERROR: ${dbError.message}`);
    if (dbError.code === 'PGRST116') {
      console.log('  Ticket NOT FOUND in Supabase. It may have been deleted or never synced.');
    }
  } else if (dbTicket) {
    console.log('  Supabase record:');
    console.log(`    is_closed:     ${JSON.stringify(dbTicket.is_closed)}`);
    console.log(`    pipeline:      ${JSON.stringify(dbTicket.pipeline)}`);
    console.log(`    pipeline_stage:${JSON.stringify(dbTicket.pipeline_stage)}`);
    console.log(`    closed_date:   ${dbTicket.closed_date}`);
    console.log(`    synced_at:     ${dbTicket.synced_at}`);
    console.log(`    created_at:    ${dbTicket.created_at}`);
    console.log(`    updated_at:    ${dbTicket.updated_at}`);
    console.log(`    subject:       ${dbTicket.subject}`);
    console.log(`    source_type:   ${dbTicket.source_type}`);
    console.log(`    company:       ${dbTicket.hs_primary_company_name}`);
  }

  console.log('');

  // ---------------------------------------------------------------
  // CHECK 3: Is this ticket in getOpenTickets() results?
  // ---------------------------------------------------------------
  console.log('--- CHECK 3: Is ticket in getOpenTickets() results? ---\n');
  console.log('  Fetching all open tickets from HubSpot (this may take a moment)...');
  const openTickets = await getOpenTickets();
  console.log(`  getOpenTickets() returned ${openTickets.length} tickets`);

  const foundInOpen = openTickets.find((t) => t.id === TARGET_TICKET_ID);
  if (foundInOpen) {
    console.log(`  >> H2 CONFIRMED: Ticket IS in the open results!`);
    console.log(
      `     HubSpot search API considers this ticket open (hs_is_closed filter matched).`
    );
    console.log(`     hs_is_closed value in result: ${JSON.stringify(foundInOpen.properties.hs_is_closed)}`);
  } else {
    console.log(`  >> H2 RULED OUT: Ticket is NOT in the open results.`);
    console.log(`     It should have been updated by the sync's closed tickets query.`);
  }

  console.log('');

  // ---------------------------------------------------------------
  // CHECK 4: Compare DB open tickets vs HubSpot open tickets
  // ---------------------------------------------------------------
  console.log('--- CHECK 4: DB vs HubSpot Open Ticket Comparison ---\n');

  const { data: dbOpenTickets, error: dbOpenError } = await supabase
    .from('support_tickets')
    .select('hubspot_ticket_id, subject, synced_at, pipeline')
    .eq('is_closed', false);

  if (dbOpenError) {
    console.log(`  ERROR: ${dbOpenError.message}`);
  } else {
    const hubspotOpenIds = new Set(openTickets.map((t) => t.id));
    const dbOpenIds = new Set((dbOpenTickets || []).map((t) => t.hubspot_ticket_id));

    console.log(`  DB open tickets (is_closed=false): ${dbOpenIds.size}`);
    console.log(`  HubSpot open tickets:              ${hubspotOpenIds.size}`);

    // Find orphans: in DB as open but NOT in HubSpot open results
    const orphans = (dbOpenTickets || []).filter(
      (t) => !hubspotOpenIds.has(t.hubspot_ticket_id)
    );

    if (orphans.length > 0) {
      console.log(`\n  ORPHANED TICKETS (in DB as open, NOT in HubSpot open results): ${orphans.length}`);
      for (const orphan of orphans) {
        console.log(`    - ${orphan.hubspot_ticket_id}: "${orphan.subject}" (pipeline: ${orphan.pipeline}, synced: ${orphan.synced_at})`);
      }
    } else {
      console.log('\n  No orphaned tickets found — DB and HubSpot are in sync.');
    }

    // Find missing: in HubSpot open but NOT in DB
    const missing = openTickets.filter(
      (t) => !dbOpenIds.has(t.id)
    );
    if (missing.length > 0) {
      console.log(`\n  MISSING FROM DB (in HubSpot open, NOT in DB): ${missing.length}`);
      for (const m of missing) {
        console.log(`    - ${m.id}: "${m.properties.subject}"`);
      }
    }
  }

  console.log('\n=============================================================');
  console.log('  DIAGNOSIS SUMMARY');
  console.log('=============================================================\n');
  console.log('  Review the checks above to determine which hypothesis is confirmed.');
  console.log('  H1 = hs_is_closed has unexpected value in HubSpot');
  console.log('  H2 = HubSpot search API returns this ticket as open');
  console.log('  H3 = Ticket is not in Support Pipeline (hs_pipeline != "0")');
  console.log('  H4 = Sync failed/skipped updating this specific ticket');
  console.log('');
}

main().catch(console.error);
