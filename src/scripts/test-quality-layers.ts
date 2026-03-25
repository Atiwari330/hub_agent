/**
 * End-to-end test for Phase 5: Quality Layers (Self-Critique & Refinement).
 *
 * Tests:
 *   1. Runs full analysis on a ticket with quality review enabled
 *   2. Shows quality review scores, dimension breakdown, and issues found
 *   3. Shows whether refinement was triggered and what changed
 *   4. Verifies quality_reviews table has the record
 *   5. Runs analysis with quality review disabled to compare timing
 *
 * Usage:
 *   npx tsx src/scripts/test-quality-layers.ts <ticket_id>
 *   npx tsx src/scripts/test-quality-layers.ts              # picks a random open ticket
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createServiceClient } from '@/lib/supabase/client';
import { runAnalysisPipeline } from '@/lib/ai/passes/orchestrator';
import type { QualityReviewResult } from '@/lib/ai/passes/orchestrator';

const DIVIDER = '─'.repeat(60);

function printDimensionScores(scores: QualityReviewResult['dimension_scores']) {
  const dims = [
    ['Specificity', scores.specificity],
    ['Accuracy', scores.accuracy],
    ['Completeness', scores.completeness],
    ['Temp Calibration', scores.temperature_calibration],
    ['Priority Correct.', scores.priority_correctness],
    ['Actionability', scores.actionability],
  ] as const;

  for (const [name, score] of dims) {
    const bar = '█'.repeat(Math.round(score * 20)) + '░'.repeat(20 - Math.round(score * 20));
    const emoji = score >= 0.7 ? '✓' : score >= 0.5 ? '~' : '✗';
    console.log(`  ${emoji} ${name.padEnd(18)} ${bar} ${score.toFixed(2)}`);
  }
}

async function main() {
  const supabase = createServiceClient();
  let ticketId = process.argv[2];

  // If no ticket ID provided, pick a random open ticket
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
  console.log(DIVIDER);

  // ─── Test 1: Run with quality review ───
  console.log('\n[Test 1] Full analysis WITH quality review');
  console.log(DIVIDER);

  // Ensure quality review is enabled
  const origEnabled = process.env.QUALITY_REVIEW_ENABLED;
  process.env.QUALITY_REVIEW_ENABLED = 'true';

  const startWith = Date.now();
  const resultWith = await runAnalysisPipeline(ticketId);
  const durationWith = Date.now() - startWith;

  console.log(`\nDuration: ${(durationWith / 1000).toFixed(1)}s`);
  console.log(`Confidence (from reviewer): ${resultWith.analysis.confidence.toFixed(2)}`);

  if (resultWith.qualityReview) {
    const qr = resultWith.qualityReview;
    console.log(`\nQuality Review Results:`);
    console.log(`  Overall score: ${qr.overall_score.toFixed(2)}`);
    console.log(`  Approved: ${qr.pass_approved}`);
    console.log(`  Issues found: ${qr.issues.length}`);
    console.log(`\nDimension Scores:`);
    printDimensionScores(qr.dimension_scores);

    if (qr.issues.length > 0) {
      console.log(`\nIssues:`);
      for (const issue of qr.issues) {
        console.log(`  [${issue.severity.toUpperCase()}] ${issue.dimension}`);
        console.log(`    ${issue.description}`);
        console.log(`    Affected: ${issue.affected_field}`);
        console.log(`    Fix: ${issue.suggested_fix}`);
        console.log();
      }
    }

    if (!qr.pass_approved) {
      console.log(`\n⚠ Quality gate FAILED — refinement was triggered`);
    } else {
      console.log(`\n✓ Quality gate PASSED — no refinement needed`);
    }
  } else {
    console.log('\n⚠ No quality review result returned');
  }

  // ─── Test 2: Verify DB storage ───
  console.log(DIVIDER);
  console.log('\n[Test 2] Verify quality_reviews table');

  const { data: reviews, error: reviewError } = await supabase
    .from('quality_reviews')
    .select('*')
    .eq('hubspot_ticket_id', ticketId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (reviewError) {
    console.log(`  ✗ Error querying quality_reviews: ${reviewError.message}`);
    console.log('  → Run migration first: supabase/migrations/064_quality_reviews.sql');
  } else if (!reviews || reviews.length === 0) {
    console.log('  ✗ No quality review found in DB');
  } else {
    const row = reviews[0];
    console.log(`  ✓ Found quality review record: ${row.id}`);
    console.log(`    Score: ${row.overall_score}`);
    console.log(`    Approved: ${row.pass_approved}`);
    console.log(`    Refinement triggered: ${row.refinement_triggered}`);
    console.log(`    Model: ${row.model_used}`);
    console.log(`    Created: ${row.created_at}`);
  }

  // ─── Test 3: Run without quality review for timing comparison ───
  console.log(DIVIDER);
  console.log('\n[Test 3] Full analysis WITHOUT quality review (timing comparison)');

  const startWithout = Date.now();
  const resultWithout = await runAnalysisPipeline(ticketId, { skipQualityReview: true });
  const durationWithout = Date.now() - startWithout;

  console.log(`  Duration without review: ${(durationWithout / 1000).toFixed(1)}s`);
  console.log(`  Duration with review:    ${(durationWith / 1000).toFixed(1)}s`);
  console.log(`  Quality review overhead:  ${((durationWith - durationWithout) / 1000).toFixed(1)}s`);
  console.log(`  Confidence without review: ${resultWithout.analysis.confidence.toFixed(2)} (baseline)`);

  // ─── Test 4: Threshold behavior ───
  console.log(DIVIDER);
  console.log('\n[Test 4] Threshold behavior (set to 1.0 — forces refinement)');

  const origThreshold = process.env.QUALITY_REVIEW_THRESHOLD;
  process.env.QUALITY_REVIEW_THRESHOLD = '1.0';
  process.env.QUALITY_MAX_REFINEMENT_ATTEMPTS = '1';

  const resultForced = await runAnalysisPipeline(ticketId);

  if (resultForced.qualityReview) {
    console.log(`  Score: ${resultForced.qualityReview.overall_score.toFixed(2)}`);
    console.log(`  Approved: ${resultForced.qualityReview.pass_approved}`);
    if (!resultForced.qualityReview.pass_approved) {
      console.log(`  ✓ Refinement was triggered as expected (threshold=1.0)`);
    } else {
      console.log(`  ⚠ Unexpectedly approved (model gave perfect score)`);
    }
  }

  // Restore env
  process.env.QUALITY_REVIEW_THRESHOLD = origThreshold;
  process.env.QUALITY_REVIEW_ENABLED = origEnabled;

  // ─── Summary ───
  console.log('\n' + DIVIDER);
  console.log('SUMMARY');
  console.log(DIVIDER);
  console.log(`  Ticket:              ${ticketId}`);
  console.log(`  Quality review:      ${resultWith.qualityReview ? '✓ ran' : '✗ did not run'}`);
  console.log(`  DB record:           ${reviews && reviews.length > 0 ? '✓ stored' : '✗ missing'}`);
  console.log(`  Timing overhead:     ${((durationWith - durationWithout) / 1000).toFixed(1)}s`);
  console.log(`  Threshold override:  ${resultForced.qualityReview && !resultForced.qualityReview.pass_approved ? '✓ works' : '~ check manually'}`);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
