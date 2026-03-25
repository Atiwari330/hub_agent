import { NextResponse } from 'next/server';
import { runStaleCheck } from '@/lib/ai/intelligence/stale-checker';
import { isBusinessHours } from '@/lib/utils/business-hours';

function verifyCronSecret(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true;
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * GET /api/cron/stale-checker
 *
 * Runs daily at 9 AM ET (weekdays only).
 * Checks open tickets for inactivity:
 *   2 business days → info
 *   5 business days → warning
 *   10 business days → critical (escalate to CS Manager)
 * No LLM needed — pure database queries.
 */
export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isBusinessHours()) {
    return NextResponse.json({ skipped: true, reason: 'Outside business hours' });
  }

  try {
    const result = await runStaleCheck();

    return NextResponse.json({
      success: true,
      ticketsChecked: result.ticketsChecked,
      goingStale: result.goingStale,
      stale: result.stale,
      criticalStale: result.criticalStale,
      alertsCreated: result.alertsCreated,
      alertsResolved: result.alertsResolved,
      errors: result.errors,
    });
  } catch (error) {
    console.error('[stale-checker] Cron error:', error);
    return NextResponse.json(
      { error: 'Stale check failed', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

export const maxDuration = 120;
