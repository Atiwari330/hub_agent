import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Only the 3 requested AEs
const TARGET_AE_EMAILS = [
  'aboyd@opusbehavioral.com', // Amos Boyd
  'cgarraffa@opusbehavioral.com', // Christopher Garraffa
  'jrice@opusbehavioral.com', // Jack Rice
];

// Last week: Jan 26 - Feb 1, 2026
const LAST_WEEK_START = new Date('2026-01-26T00:00:00');
const LAST_WEEK_END = new Date('2026-02-01T23:59:59.999');

async function main() {
  console.log('Demo Completed Last Week (Jan 26 - Feb 1, 2026)');
  console.log('-----------------------------------------------');

  // Get target AE owner records
  const { data: owners, error: ownerError } = await supabase
    .from('owners')
    .select('id, email, first_name, last_name')
    .in('email', TARGET_AE_EMAILS);

  if (ownerError) {
    console.error('Error fetching owners:', ownerError);
    return;
  }

  if (!owners || owners.length === 0) {
    console.log('No owners found for the target emails.');
    return;
  }

  const results: { name: string; count: number; deals: string[] }[] = [];

  for (const owner of owners) {
    // Get deals with demo_completed_entered_at for this owner
    const { data: deals, error: dealsError } = await supabase
      .from('deals')
      .select('deal_name, demo_completed_entered_at')
      .eq('owner_id', owner.id)
      .not('demo_completed_entered_at', 'is', null);

    if (dealsError) {
      console.error(`Error fetching deals for ${owner.email}:`, dealsError);
      continue;
    }

    // Filter deals that entered demo completed last week
    const dealsLastWeek =
      deals?.filter((deal) => {
        if (!deal.demo_completed_entered_at) return false;
        const enteredDate = new Date(deal.demo_completed_entered_at);
        return enteredDate >= LAST_WEEK_START && enteredDate <= LAST_WEEK_END;
      }) || [];

    results.push({
      name: `${owner.first_name} ${owner.last_name}`,
      count: dealsLastWeek.length,
      deals: dealsLastWeek.map((d) => d.deal_name),
    });
  }

  // Sort by name for consistent output
  results.sort((a, b) => a.name.localeCompare(b.name));

  // Print results
  let total = 0;
  for (const result of results) {
    const dealWord = result.count === 1 ? 'deal' : 'deals';
    console.log(`${result.name}: ${result.count} ${dealWord}`);
    if (result.count > 0) {
      for (const dealName of result.deals) {
        console.log(`  - ${dealName}`);
      }
    }
    total += result.count;
  }

  console.log('-----------------------------------------------');
  const totalWord = total === 1 ? 'deal' : 'deals';
  console.log(`Total: ${total} ${totalWord}`);
}

main().catch(console.error);
