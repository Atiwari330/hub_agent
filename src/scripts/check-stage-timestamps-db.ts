import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('Checking stage timestamps in database...\n');

  // Check if columns exist by querying a few deals
  const { data: deals, error } = await supabase
    .from('deals')
    .select(`
      id,
      deal_name,
      sql_entered_at,
      demo_scheduled_entered_at,
      demo_completed_entered_at,
      closed_won_entered_at
    `)
    .limit(20);

  if (error) {
    console.error('Error querying deals:', error);
    return;
  }

  console.log(`Found ${deals?.length} deals\n`);

  // Count how many have timestamps
  let sqlCount = 0;
  let demoScheduledCount = 0;
  let demoCompletedCount = 0;
  let closedWonCount = 0;

  for (const deal of deals || []) {
    console.log(`${deal.deal_name}:`);
    console.log(`  SQL: ${deal.sql_entered_at || 'NULL'}`);
    console.log(`  Demo Scheduled: ${deal.demo_scheduled_entered_at || 'NULL'}`);
    console.log(`  Demo Completed: ${deal.demo_completed_entered_at || 'NULL'}`);
    console.log(`  Closed Won: ${deal.closed_won_entered_at || 'NULL'}`);
    console.log('');

    if (deal.sql_entered_at) sqlCount++;
    if (deal.demo_scheduled_entered_at) demoScheduledCount++;
    if (deal.demo_completed_entered_at) demoCompletedCount++;
    if (deal.closed_won_entered_at) closedWonCount++;
  }

  console.log('Summary:');
  console.log(`  SQL timestamps: ${sqlCount}/${deals?.length}`);
  console.log(`  Demo Scheduled timestamps: ${demoScheduledCount}/${deals?.length}`);
  console.log(`  Demo Completed timestamps: ${demoCompletedCount}/${deals?.length}`);
  console.log(`  Closed Won timestamps: ${closedWonCount}/${deals?.length}`);

  // Also check total counts across all deals
  const { count: totalDeals } = await supabase
    .from('deals')
    .select('*', { count: 'exact', head: true });

  const { count: withSql } = await supabase
    .from('deals')
    .select('*', { count: 'exact', head: true })
    .not('sql_entered_at', 'is', null);

  const { count: withDemoCompleted } = await supabase
    .from('deals')
    .select('*', { count: 'exact', head: true })
    .not('demo_completed_entered_at', 'is', null);

  const { count: withClosedWon } = await supabase
    .from('deals')
    .select('*', { count: 'exact', head: true })
    .not('closed_won_entered_at', 'is', null);

  console.log('\nTotal database stats:');
  console.log(`  Total deals: ${totalDeals}`);
  console.log(`  With SQL timestamp: ${withSql}`);
  console.log(`  With Demo Completed timestamp: ${withDemoCompleted}`);
  console.log(`  With Closed Won timestamp: ${withClosedWon}`);
}

main().catch(console.error);
