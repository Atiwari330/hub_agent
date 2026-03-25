/**
 * Phase 7: Contextual Memory — End-to-End Test Script
 *
 * Tests the contextual memory system:
 *   1. Change detection — detects what changed since last analysis
 *   2. Memory-aware analysis — situation + temperature passes use previous context
 *   3. Pass result storage — results are saved to analysis_pass_results table
 *   4. Narrative generation — timeline is built from consecutive analyses
 *
 * Prerequisites:
 *   - Run migration: supabase/migrations/066_contextual_memory.sql
 *   - .env.local with credentials
 *   - At least one analyzed ticket
 *
 * Usage:
 *   npx tsx src/scripts/test-contextual-memory.ts [ticket_id]
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { detectChanges, getPreviousAnalysis } = await import('../lib/ai/memory/change-detector');
  const { generateTimeline } = await import('../lib/ai/memory/narrative-generator');
  const { gatherTicketContext } = await import('../lib/ai/passes/gather-context');
  const { runAnalysisPipeline } = await import('../lib/ai/passes/orchestrator');

  const ticketId = process.argv[2];

  console.log('='.repeat(70));
  console.log('Phase 7: Contextual Memory — End-to-End Test');
  console.log('='.repeat(70));
  console.log();

  // Determine which ticket to test
  let testTicketId = ticketId;
  if (!testTicketId) {
    // Find an analyzed open ticket
    const { data } = await supabase
      .from('ticket_action_board_analyses')
      .select('hubspot_ticket_id')
      .limit(1)
      .single();

    if (!data) {
      console.error('No analyzed tickets found. Provide a ticket ID: npx tsx src/scripts/test-contextual-memory.ts <ticket_id>');
      process.exit(1);
    }
    testTicketId = data.hubspot_ticket_id;
  }

  console.log(`Test ticket: ${testTicketId}`);
  console.log();

  // --- Test 1: Previous Analysis Retrieval ---
  console.log('--- Test 1: Previous Analysis Retrieval ---');
  const previousAnalysis = await getPreviousAnalysis(testTicketId);
  if (previousAnalysis) {
    console.log(`  Previous analysis found (analyzed at: ${previousAnalysis.analyzedAt})`);
    console.log(`  Previous temperature: ${previousAnalysis.temperature}`);
    console.log(`  Previous situation: ${(previousAnalysis.situationSummary || '').slice(0, 100)}...`);
    console.log(`  Previous action items: ${previousAnalysis.actionItems.length}`);
  } else {
    console.log('  No previous analysis found — this will be treated as first analysis');
  }
  console.log();

  // --- Test 2: Change Detection ---
  console.log('--- Test 2: Change Detection ---');
  const context = await gatherTicketContext(testTicketId);
  const changes = await detectChanges(testTicketId, context);
  console.log(`  Is first analysis: ${changes.isFirstAnalysis}`);
  console.log(`  Time since last analysis: ${changes.timeSinceLastAnalysis !== null ? `${changes.timeSinceLastAnalysis.toFixed(1)} hours` : 'N/A'}`);
  console.log(`  New messages: ${changes.newMessageCount}`);
  console.log(`  Linear state changed: ${changes.linearStateChanged}`);
  console.log(`  Change summary:\n${changes.changeSummary.split('\n').map(l => `    ${l}`).join('\n')}`);
  console.log();

  // --- Test 3: Memory-Aware Analysis ---
  console.log('--- Test 3: Memory-Aware Analysis (full pipeline) ---');
  console.log('  Running analysis with contextual memory...');
  const startMs = Date.now();
  const result = await runAnalysisPipeline(testTicketId);
  const elapsedMs = Date.now() - startMs;

  console.log(`  Duration: ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`  Situation: ${result.analysis.situation_summary.slice(0, 150)}...`);
  console.log(`  Temperature: ${result.analysis.customer_temperature} — ${result.analysis.temperature_reason?.slice(0, 100)}`);
  console.log(`  Action items: ${result.analysis.action_items.length}`);
  console.log(`  Status tags: ${result.analysis.status_tags.join(', ')}`);
  if (result.qualityReview) {
    console.log(`  Quality score: ${result.qualityReview.overall_score.toFixed(2)} (approved: ${result.qualityReview.pass_approved})`);
  }
  console.log();

  // --- Test 4: Pass Result Storage ---
  console.log('--- Test 4: Pass Result Storage ---');
  const { data: storedResults, error: storageError } = await supabase
    .from('analysis_pass_results')
    .select('pass_type, created_at')
    .eq('hubspot_ticket_id', testTicketId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (storageError) {
    console.log(`  Error fetching stored results: ${storageError.message}`);
  } else {
    console.log(`  Total stored pass results: ${storedResults?.length || 0}`);
    if (storedResults && storedResults.length > 0) {
      // Group by created_at to show runs
      const runs = new Map<string, string[]>();
      for (const row of storedResults) {
        const key = row.created_at;
        if (!runs.has(key)) runs.set(key, []);
        runs.get(key)!.push(row.pass_type);
      }
      console.log(`  Analysis runs stored: ${runs.size}`);
      let runIdx = 0;
      for (const [ts, passes] of runs) {
        if (runIdx >= 3) { console.log(`    ... and ${runs.size - 3} more runs`); break; }
        console.log(`    Run at ${ts}: ${passes.join(', ')}`);
        runIdx++;
      }
    }
  }
  console.log();

  // --- Test 5: Narrative Timeline ---
  console.log('--- Test 5: Narrative Timeline ---');
  const timeline = await generateTimeline(testTicketId, 10);
  console.log(`  Timeline entries: ${timeline.length}`);
  for (const entry of timeline.slice(0, 5)) {
    const ts = new Date(entry.timestamp).toLocaleString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    console.log(`  [${ts}] ${entry.triggerEvent || 'Analysis'}`);
    for (const change of entry.changes) {
      console.log(`    - ${change}`);
    }
    if (entry.temperatureChange) {
      console.log(`    Temperature: ${entry.temperatureChange.from} → ${entry.temperatureChange.to}`);
    }
    if (entry.situationDelta) {
      console.log(`    Situation: ${entry.situationDelta.slice(0, 120)}...`);
    }
  }
  if (timeline.length > 5) {
    console.log(`  ... and ${timeline.length - 5} more entries`);
  }
  console.log();

  // --- Test 6: Re-analysis with Memory ---
  console.log('--- Test 6: Second Analysis (should use memory from Test 3) ---');
  const changes2 = await detectChanges(testTicketId, context);
  console.log(`  Is first analysis: ${changes2.isFirstAnalysis}`);
  console.log(`  Time since last analysis: ${changes2.timeSinceLastAnalysis !== null ? `${changes2.timeSinceLastAnalysis.toFixed(1)} hours` : 'N/A'}`);
  console.log(`  Previous temperature available: ${changes2.previous.temperature || 'none'}`);
  console.log(`  Previous situation available: ${changes2.previous.situationSummary ? 'yes' : 'no'}`);
  console.log();

  // --- Test 7: Verify timeline grew ---
  console.log('--- Test 7: Timeline After Two Analyses ---');
  const timeline2 = await generateTimeline(testTicketId, 10);
  console.log(`  Timeline entries now: ${timeline2.length} (was ${timeline.length} before re-analysis)`);
  console.log();

  // --- Summary ---
  console.log('='.repeat(70));
  console.log('All tests complete.');
  console.log('='.repeat(70));

  process.exit(0);
}

main().catch((err) => {
  console.error('Test script failed:', err);
  process.exit(1);
});
