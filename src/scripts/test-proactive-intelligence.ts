/**
 * Phase 6: Proactive Intelligence — End-to-End Test Script
 *
 * Tests all 4 intelligence modules against real data:
 *   1. Escalation Predictor — scores escalation risk for open tickets
 *   2. SLA Monitor — checks SLA thresholds for open tickets
 *   3. Pattern Detector — detects cross-ticket patterns
 *   4. Stale Checker — identifies stale tickets
 *
 * Also tests alert lifecycle (create, acknowledge, resolve).
 *
 * Prerequisites:
 *   - Run migration: supabase/migrations/065_ticket_alerts.sql
 *   - .env.local with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AI_GATEWAY_API_KEY
 *
 * Usage:
 *   npx tsx src/scripts/test-proactive-intelligence.ts
 *   npx tsx src/scripts/test-proactive-intelligence.ts <ticket_id>   # test specific ticket
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Dynamically import modules (they rely on env vars being set)
async function main() {
  const { predictEscalation, runEscalationSweep } = await import('../lib/ai/intelligence/escalation-predictor');
  const { runSlaMonitor, calculateBusinessHours } = await import('../lib/ai/intelligence/sla-monitor');
  const { runPatternDetection } = await import('../lib/ai/intelligence/pattern-detector');
  const { runStaleCheck } = await import('../lib/ai/intelligence/stale-checker');
  const { getActiveAlerts, getActivePatterns, resolveAlerts, upsertAlert } = await import('../lib/ai/intelligence/alert-utils');

  const specificTicket = process.argv[2];

  console.log('='.repeat(70));
  console.log('Phase 6: Proactive Intelligence — End-to-End Test');
  console.log('='.repeat(70));
  console.log();

  // --- Test 1: Business Hours Calculation ---
  console.log('--- Test 1: Business Hours Calculation ---');
  const monday9am = new Date('2026-03-23T13:00:00Z'); // Monday 9 AM ET
  const monday5pm = new Date('2026-03-23T21:00:00Z'); // Monday 5 PM ET
  const friday5pm = new Date('2026-03-27T21:00:00Z'); // Friday 5 PM ET

  const sameDay = calculateBusinessHours(monday9am, monday5pm);
  console.log(`  Same day (Mon 9AM → 5PM ET): ${sameDay.toFixed(1)} business hours (expected: 8.0)`);

  const acrossWeek = calculateBusinessHours(monday9am, friday5pm);
  console.log(`  Mon 9AM → Fri 5PM ET: ${acrossWeek.toFixed(1)} business hours (expected: ~48.0)`);
  console.log();

  // --- Test 2: Escalation Predictor ---
  console.log('--- Test 2: Escalation Predictor ---');
  if (specificTicket) {
    console.log(`  Testing specific ticket: ${specificTicket}`);
    const result = await predictEscalation(specificTicket);
    console.log(`  Ticket ${result.ticketId}:`);
    console.log(`    Risk Score: ${result.riskScore.toFixed(2)}`);
    console.log(`    Stage: ${result.stage}`);
    console.log(`    Reason: ${result.reason}`);
    console.log(`    Alert Created: ${result.alertCreated}`);
  } else {
    console.log('  Running escalation sweep on all open tickets...');
    const sweepStart = Date.now();
    const sweepResult = await runEscalationSweep();
    const sweepMs = Date.now() - sweepStart;
    console.log(`  Tickets checked: ${sweepResult.ticketsChecked}`);
    console.log(`  Alerts created: ${sweepResult.alertsCreated}`);
    console.log(`  High risk tickets: ${sweepResult.highRiskTickets.length > 0 ? sweepResult.highRiskTickets.join(', ') : 'none'}`);
    console.log(`  Errors: ${sweepResult.errors.length > 0 ? sweepResult.errors.join('; ') : 'none'}`);
    console.log(`  Duration: ${(sweepMs / 1000).toFixed(1)}s`);
  }
  console.log();

  // --- Test 3: SLA Monitor ---
  console.log('--- Test 3: SLA Monitor ---');
  const slaStart = Date.now();
  const slaResult = await runSlaMonitor();
  const slaMs = Date.now() - slaStart;
  console.log(`  Tickets checked: ${slaResult.ticketsChecked}`);
  console.log(`  Alerts created: ${slaResult.alertsCreated}`);
  console.log(`  Alerts resolved: ${slaResult.alertsResolved}`);
  console.log(`  SLA breaches: ${slaResult.breaches.length > 0 ? slaResult.breaches.join(', ') : 'none'}`);

  // Show a sample of results
  const slaAlertResults = slaResult.results.filter(r => r.severity !== 'ok');
  if (slaAlertResults.length > 0) {
    console.log(`  Sample SLA alerts (${Math.min(3, slaAlertResults.length)} of ${slaAlertResults.length}):`);
    for (const r of slaAlertResults.slice(0, 3)) {
      console.log(`    ${r.ticketId}: ${r.slaType} — ${r.elapsedBusinessHours}h / ${r.slaTargetHours}h (${r.percentUsed}%) → ${r.severity}`);
    }
  }
  console.log(`  Errors: ${slaResult.errors.length > 0 ? slaResult.errors.join('; ') : 'none'}`);
  console.log(`  Duration: ${(slaMs / 1000).toFixed(1)}s`);
  console.log();

  // --- Test 4: Pattern Detector ---
  console.log('--- Test 4: Pattern Detector ---');
  const patternStart = Date.now();
  const patternResult = await runPatternDetection();
  const patternMs = Date.now() - patternStart;
  console.log(`  Patterns detected: ${patternResult.patternsDetected}`);
  console.log(`  Patterns created: ${patternResult.patternsCreated}`);
  console.log(`  Per-ticket alerts created: ${patternResult.alertsCreated}`);
  console.log(`  Errors: ${patternResult.errors.length > 0 ? patternResult.errors.join('; ') : 'none'}`);
  console.log(`  Duration: ${(patternMs / 1000).toFixed(1)}s`);
  console.log();

  // --- Test 5: Stale Checker ---
  console.log('--- Test 5: Stale Checker ---');
  const staleStart = Date.now();
  const staleResult = await runStaleCheck();
  const staleMs = Date.now() - staleStart;
  console.log(`  Tickets checked: ${staleResult.ticketsChecked}`);
  console.log(`  Going stale (2+ biz days): ${staleResult.goingStale}`);
  console.log(`  Stale (5+ biz days): ${staleResult.stale}`);
  console.log(`  Critical stale (10+ biz days): ${staleResult.criticalStale}`);
  console.log(`  Alerts created: ${staleResult.alertsCreated}`);
  console.log(`  Alerts resolved: ${staleResult.alertsResolved}`);
  console.log(`  Errors: ${staleResult.errors.length > 0 ? staleResult.errors.join('; ') : 'none'}`);
  console.log(`  Duration: ${(staleMs / 1000).toFixed(1)}s`);
  console.log();

  // --- Test 6: Alert Lifecycle ---
  console.log('--- Test 6: Alert Lifecycle ---');

  // Pick a ticket for lifecycle test
  const { data: testTicket } = await supabase
    .from('support_tickets')
    .select('hubspot_ticket_id')
    .eq('is_closed', false)
    .limit(1)
    .single();

  if (testTicket) {
    const testId = testTicket.hubspot_ticket_id;
    console.log(`  Test ticket: ${testId}`);

    // Create a test alert
    const alertId = await upsertAlert({
      ticketId: testId,
      alertType: 'stale',
      severity: 'info',
      title: 'Test alert — lifecycle verification',
      description: 'This alert was created by the test script to verify the alert lifecycle.',
      metadata: { test: true },
    });
    console.log(`  Created test alert: ${alertId}`);

    // Verify it appears in active alerts
    const activeAlerts = await getActiveAlerts([testId]);
    const testAlert = activeAlerts[testId]?.find(a => a.id === alertId);
    console.log(`  Alert appears in active: ${testAlert ? 'YES' : 'NO'}`);

    // Resolve it
    const resolved = await resolveAlerts(testId, 'stale');
    console.log(`  Resolved stale alerts: ${resolved}`);

    // Verify it's gone from active
    const afterResolve = await getActiveAlerts([testId]);
    const stillActive = afterResolve[testId]?.find(a => a.id === alertId);
    console.log(`  Alert still active after resolve: ${stillActive ? 'YES (BUG!)' : 'NO (correct)'}`);
  } else {
    console.log('  Skipped — no open tickets to test with');
  }
  console.log();

  // --- Test 7: Active Patterns Summary ---
  console.log('--- Test 7: Active Patterns Summary ---');
  const activePatterns = await getActivePatterns();
  console.log(`  Active patterns: ${activePatterns.length}`);
  for (const p of activePatterns.slice(0, 3)) {
    console.log(`    [${p.patternType}] ${p.description} (${p.affectedTicketIds.length} tickets, confidence: ${p.confidence.toFixed(2)})`);
  }
  console.log();

  // --- Test 8: Alert Distribution ---
  console.log('--- Test 8: Alert Distribution ---');
  const { data: allOpenTickets } = await supabase
    .from('support_tickets')
    .select('hubspot_ticket_id')
    .eq('is_closed', false);

  if (allOpenTickets) {
    const allAlerts = await getActiveAlerts(allOpenTickets.map(t => t.hubspot_ticket_id));
    const allAlertList = Object.values(allAlerts).flat();

    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    for (const alert of allAlertList) {
      byType[alert.alertType] = (byType[alert.alertType] || 0) + 1;
      bySeverity[alert.severity] = (bySeverity[alert.severity] || 0) + 1;
    }

    console.log(`  Total active alerts: ${allAlertList.length}`);
    console.log(`  By type: ${JSON.stringify(byType)}`);
    console.log(`  By severity: ${JSON.stringify(bySeverity)}`);
  }
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
