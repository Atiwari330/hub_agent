import { NextResponse } from 'next/server';
import { runSlaMonitor } from '@/lib/ai/intelligence/sla-monitor';
import { isBusinessHours } from '@/lib/utils/business-hours';

function verifyCronSecret(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true;
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * GET /api/cron/sla-monitor
 *
 * Runs every 5 minutes during business hours.
 * Checks SLA thresholds for all open tickets with customers waiting.
 * No LLM needed — pure timestamp math.
 */
export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isBusinessHours()) {
    return NextResponse.json({ skipped: true, reason: 'Outside business hours' });
  }

  try {
    const result = await runSlaMonitor();

    return NextResponse.json({
      success: true,
      ticketsChecked: result.ticketsChecked,
      alertsCreated: result.alertsCreated,
      alertsResolved: result.alertsResolved,
      breaches: result.breaches,
      errors: result.errors,
    });
  } catch (error) {
    console.error('[sla-monitor] Cron error:', error);
    return NextResponse.json(
      { error: 'SLA monitor failed', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
