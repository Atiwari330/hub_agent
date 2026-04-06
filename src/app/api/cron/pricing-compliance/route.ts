import { NextResponse } from 'next/server';
import { runPricingCompliance } from '@/lib/briefing/run-pricing-compliance';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_AGE_DAYS = 30;
const STALE_HOURS = 12;

function verifyCronSecret(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true;
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log(`[pricing-compliance-cron] Starting. max-age=${MAX_AGE_DAYS}d, skip-fresh=${STALE_HOURS}h`);

  try {
    const result = await runPricingCompliance({
      concurrency: 3,
      maxAgeDays: MAX_AGE_DAYS,
      skipFreshHours: STALE_HOURS,
    });

    const summary = result.summary;
    console.log(`[pricing-compliance-cron] Done. ${summary.analyzed} analyzed, ${summary.failed} failed, ${result.durationMs}ms`);

    return NextResponse.json({
      success: true,
      analyzed: summary.analyzed,
      failed: summary.failed,
      byStatus: summary.byStatus,
      nonCompliantCount: summary.nonCompliantCount,
      durationMs: result.durationMs,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[pricing-compliance-cron] Failed: ${errMsg}`);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
