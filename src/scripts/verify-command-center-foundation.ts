/**
 * Verification script for Command Center Foundation phase.
 *
 * Run: npx tsx src/scripts/verify-command-center-foundation.ts
 *
 * Checks:
 * 1. strategic_initiatives table exists and has seed data
 * 2. deal_forecast_overrides table exists
 * 3. computePacingData() runs without errors
 * 4. computeInitiativeStatus() runs without errors
 * 5. Types compile correctly (if this script runs, they do)
 * 6. workflow_runs accepts deal-intelligence entries
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '@/lib/supabase/client';
import { computeQ2GoalTrackerData } from '@/lib/q2-goal-tracker/compute';
import { computePacingData } from '@/lib/command-center/compute-pacing';
import { computeInitiativeStatus } from '@/lib/command-center/compute-initiatives';
import { computeLikelihoodTier } from '@/lib/command-center/config';

async function main() {
  const supabase = createServiceClient();
  let passed = 0;
  let failed = 0;

  function check(label: string, ok: boolean, detail?: string) {
    if (ok) {
      console.log(`  ✓ ${label}`);
      passed++;
    } else {
      console.log(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
      failed++;
    }
  }

  console.log('\n=== Command Center Foundation Verification ===\n');

  // 1. Check strategic_initiatives table
  console.log('1. strategic_initiatives table');
  const { data: initData, error: initError } = await supabase
    .from('strategic_initiatives')
    .select('*');
  check('Table exists', !initError, initError?.message);
  check('Has seed data', (initData?.length || 0) > 0, `Found ${initData?.length || 0} rows`);

  // 2. Check deal_forecast_overrides table
  console.log('\n2. deal_forecast_overrides table');
  const { error: overrideError } = await supabase
    .from('deal_forecast_overrides')
    .select('id')
    .limit(1);
  check('Table exists', !overrideError, overrideError?.message);

  // 3. Compute pacing data
  console.log('\n3. computePacingData()');
  try {
    const goalData = await computeQ2GoalTrackerData(supabase);
    const pacing = await computePacingData(supabase, goalData);
    check('Runs without error', true);
    check('Returns weekly rows', pacing.weeklyRows.length === 13, `Got ${pacing.weeklyRows.length} rows`);
    check('Returns source breakdown', pacing.sourceBreakdown.length > 0, `Got ${pacing.sourceBreakdown.length} sources`);
    console.log(`    Total leads created: ${pacing.totalLeadsCreated}`);
    console.log(`    Total leads required: ${pacing.totalLeadsRequired}`);
  } catch (e) {
    check('Runs without error', false, (e as Error).message);
  }

  // 4. Compute initiative status
  console.log('\n4. computeInitiativeStatus()');
  try {
    const initiatives = await computeInitiativeStatus(supabase);
    check('Runs without error', true);
    check('Returns initiatives', initiatives.length > 0, `Got ${initiatives.length} initiatives`);
    for (const init of initiatives) {
      console.log(`    ${init.name}: ${init.leadsCreated} leads, ${init.paceStatus}`);
    }
  } catch (e) {
    check('Runs without error', false, (e as Error).message);
  }

  // 5. Config functions
  console.log('\n5. Config');
  check('computeLikelihoodTier (on_track, 85)', computeLikelihoodTier(85, 'on_track', null) === 'highly_likely');
  check('computeLikelihoodTier (null, 45)', computeLikelihoodTier(45, null, null) === 'unlikely');
  check('computeLikelihoodTier (stalled, 30)', computeLikelihoodTier(30, 'stalled', null) === 'unlikely');

  // 6. workflow_runs accepts deal-intelligence entries
  console.log('\n6. workflow_runs integration');
  const testId = crypto.randomUUID();
  const { error: insertError } = await supabase.from('workflow_runs').insert({
    id: testId,
    workflow_name: 'compute-deal-intelligence',
    status: 'pending',
  });
  check('workflow_runs accepts deal-intelligence entries', !insertError, insertError?.message);
  // Clean up test row
  await supabase.from('workflow_runs').delete().eq('id', testId);

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
