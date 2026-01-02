import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Target AE emails from the app
const TARGET_AE_EMAILS = [
  'aboyd@opusbehavioral.com',
  'cgarraffa@opusbehavioral.com',
  'jrice@opusbehavioral.com',
  'atiwari@opusbehavioral.com',
];

async function main() {
  console.log('Checking stage data for target AEs...\n');

  // Q1 2026 date range
  const q1Start = '2026-01-01';
  const q1End = '2026-03-31';
  console.log(`Quarter: Q1 2026 (${q1Start} to ${q1End})\n`);

  // Get target AE owner IDs
  const { data: owners, error: ownerError } = await supabase
    .from('owners')
    .select('id, email, first_name, last_name')
    .in('email', TARGET_AE_EMAILS);

  if (ownerError) {
    console.error('Error fetching owners:', ownerError);
    return;
  }

  console.log(`Found ${owners?.length} target AEs:\n`);

  for (const owner of owners || []) {
    console.log(`\n=== ${owner.first_name} ${owner.last_name} (${owner.email}) ===`);

    // Get deals with stage timestamps for this owner
    const { data: deals, error: dealsError } = await supabase
      .from('deals')
      .select(`
        deal_name,
        sql_entered_at,
        demo_scheduled_entered_at,
        demo_completed_entered_at,
        closed_won_entered_at
      `)
      .eq('owner_id', owner.id);

    if (dealsError) {
      console.error(`Error fetching deals for ${owner.email}:`, dealsError);
      continue;
    }

    // Count stage entries in Q1 2026
    let sqlInQ1 = 0;
    let demoScheduledInQ1 = 0;
    let demoCompletedInQ1 = 0;
    let closedWonInQ1 = 0;

    // Count stage entries any time
    let sqlAnyTime = 0;
    let demoCompletedAnyTime = 0;

    for (const deal of deals || []) {
      if (deal.sql_entered_at) {
        sqlAnyTime++;
        const date = new Date(deal.sql_entered_at);
        if (date >= new Date(q1Start) && date <= new Date(q1End)) {
          sqlInQ1++;
        }
      }
      if (deal.demo_scheduled_entered_at) {
        const date = new Date(deal.demo_scheduled_entered_at);
        if (date >= new Date(q1Start) && date <= new Date(q1End)) {
          demoScheduledInQ1++;
        }
      }
      if (deal.demo_completed_entered_at) {
        demoCompletedAnyTime++;
        const date = new Date(deal.demo_completed_entered_at);
        if (date >= new Date(q1Start) && date <= new Date(q1End)) {
          demoCompletedInQ1++;
        }
      }
      if (deal.closed_won_entered_at) {
        const date = new Date(deal.closed_won_entered_at);
        if (date >= new Date(q1Start) && date <= new Date(q1End)) {
          closedWonInQ1++;
        }
      }
    }

    console.log(`  Total deals: ${deals?.length}`);
    console.log(`  With SQL timestamp (any time): ${sqlAnyTime}`);
    console.log(`  With Demo Completed timestamp (any time): ${demoCompletedAnyTime}`);
    console.log(`  In Q1 2026:`);
    console.log(`    SQL: ${sqlInQ1}`);
    console.log(`    Demo Scheduled: ${demoScheduledInQ1}`);
    console.log(`    Demo Completed: ${demoCompletedInQ1}`);
    console.log(`    Closed Won: ${closedWonInQ1}`);

    // Show some example timestamps
    const dealsWithSql = deals?.filter(d => d.sql_entered_at).slice(0, 3);
    if (dealsWithSql && dealsWithSql.length > 0) {
      console.log(`  Sample SQL timestamps:`);
      for (const deal of dealsWithSql) {
        console.log(`    - ${deal.deal_name}: ${deal.sql_entered_at}`);
      }
    }
  }
}

main().catch(console.error);
