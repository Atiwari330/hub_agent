import { NextResponse } from 'next/server';
import { runPatternDetection } from '@/lib/ai/intelligence/pattern-detector';
import { isBusinessHours } from '@/lib/utils/business-hours';

function verifyCronSecret(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true;
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * GET /api/cron/pattern-detector
 *
 * Runs every 2 hours during business hours.
 * Detects cross-ticket patterns: keyword clusters, software groupings,
 * company clusters, and volume spikes.
 * Uses LLM to analyze detected clusters.
 */
export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isBusinessHours()) {
    return NextResponse.json({ skipped: true, reason: 'Outside business hours' });
  }

  try {
    const result = await runPatternDetection();

    return NextResponse.json({
      success: true,
      patternsDetected: result.patternsDetected,
      patternsCreated: result.patternsCreated,
      alertsCreated: result.alertsCreated,
      errors: result.errors,
    });
  } catch (error) {
    console.error('[pattern-detector] Cron error:', error);
    return NextResponse.json(
      { error: 'Pattern detection failed', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

export const maxDuration = 300;
