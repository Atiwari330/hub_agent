import { NextRequest, NextResponse } from 'next/server';
import { computeAllDealIntelligence } from '@/lib/intelligence/deal-rules';

export async function GET(request: NextRequest) {
  // Verify cron secret in production
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    console.log('[Deal Intelligence Cron] Starting Phase 1: Rules engine...');
    const phase1Result = await computeAllDealIntelligence();
    console.log(`[Deal Intelligence Cron] Phase 1 complete: ${phase1Result.processed} deals processed, ${phase1Result.errors} errors`);
    console.log('[Deal Intelligence Cron] Rules-only mode — use Analyze All for LLM');

    return NextResponse.json({
      success: true,
      phase1: {
        processed: phase1Result.processed,
        errors: phase1Result.errors,
      },
    });
  } catch (error) {
    console.error('[Deal Intelligence Cron] Error:', error);
    return NextResponse.json(
      {
        error: 'Deal intelligence computation failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
