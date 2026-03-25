import { NextResponse } from 'next/server';
import { runEscalationSweep } from '@/lib/ai/intelligence/escalation-predictor';
import { isBusinessHours } from '@/lib/utils/business-hours';

function verifyCronSecret(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true;
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * GET /api/cron/escalation-sweep
 *
 * Runs every 30 minutes during business hours.
 * Scores escalation risk for all open tickets.
 * Uses LLM only for tickets with heuristic score > 0.5.
 */
export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isBusinessHours()) {
    return NextResponse.json({ skipped: true, reason: 'Outside business hours' });
  }

  try {
    const result = await runEscalationSweep();

    return NextResponse.json({
      success: true,
      ticketsChecked: result.ticketsChecked,
      alertsCreated: result.alertsCreated,
      highRiskTickets: result.highRiskTickets,
      errors: result.errors,
    });
  } catch (error) {
    console.error('[escalation-sweep] Cron error:', error);
    return NextResponse.json(
      { error: 'Escalation sweep failed', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

export const maxDuration = 300;
