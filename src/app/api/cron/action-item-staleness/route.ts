import { NextResponse } from 'next/server';
import { runStalenessCheck } from '@/lib/ai/passes/staleness-check';
import { isBusinessHours } from '@/lib/utils/business-hours';

function verifyCronSecret(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true;
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * GET /api/cron/action-item-staleness
 *
 * Runs every 15 minutes during business hours.
 * Checks active action items older than 2 hours for relevance
 * and expires items that are no longer applicable.
 */
export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only run during business hours
  if (!isBusinessHours()) {
    return NextResponse.json({ skipped: true, reason: 'Outside business hours' });
  }

  try {
    const result = await runStalenessCheck();

    return NextResponse.json({
      success: true,
      ticketsChecked: result.ticketsChecked,
      itemsExpired: result.itemsExpired,
      errors: result.errors,
    });
  } catch (error) {
    console.error('[action-item-staleness] Cron error:', error);
    return NextResponse.json(
      { error: 'Staleness check failed', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

export const maxDuration = 120;
