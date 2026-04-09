import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { computeAllDealIntelligence } from '@/lib/intelligence/deal-rules';
import { analyzeDealIntelligence, getDealsNeedingLLMAnalysis } from '@/lib/intelligence/deal-llm';

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const supabase = createServiceClient();
  const workflowId = crypto.randomUUID();
  const startTime = Date.now();

  // Log workflow start
  await supabase.from('workflow_runs').insert({
    id: workflowId,
    workflow_name: 'compute-deal-intelligence',
    status: 'running',
  });

  try {
    // Phase 1: Rules engine (fast, no LLM)
    console.log('[Deal Intelligence] Phase 1: Rules engine...');
    const phase1Result = await computeAllDealIntelligence();
    console.log(`[Deal Intelligence] Phase 1 complete: ${phase1Result.processed} deals, ${phase1Result.errors} errors`);

    // Phase 2: LLM analysis on deals that need it
    console.log('[Deal Intelligence] Phase 2: LLM analysis...');
    const dealIds = await getDealsNeedingLLMAnalysis();
    console.log(`[Deal Intelligence] ${dealIds.length} deals need LLM analysis`);

    let llmSuccess = 0;
    let llmErrors = 0;
    const llmErrorDetails: string[] = [];

    // Process sequentially to avoid rate limits (DeepSeek)
    for (const dealId of dealIds) {
      const result = await analyzeDealIntelligence(dealId);
      if (result.success) {
        llmSuccess++;
      } else {
        llmErrors++;
        llmErrorDetails.push(`${dealId}: ${result.error}`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[Deal Intelligence] Phase 2 complete: ${llmSuccess} analyzed, ${llmErrors} errors, ${duration}ms total`);

    // Log workflow completion
    await supabase.from('workflow_runs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      result: {
        phase1: { processed: phase1Result.processed, errors: phase1Result.errors },
        phase2: { dealsQueued: dealIds.length, analyzed: llmSuccess, errors: llmErrors, errorDetails: llmErrorDetails.slice(0, 10) },
        durationMs: duration,
      },
    }).eq('id', workflowId);

    return NextResponse.json({
      success: true,
      phase1: { processed: phase1Result.processed, errors: phase1Result.errors },
      phase2: { dealsQueued: dealIds.length, analyzed: llmSuccess, errors: llmErrors },
      durationMs: duration,
    });
  } catch (error) {
    console.error('[Deal Intelligence] Fatal error:', error);
    await supabase.from('workflow_runs').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    }).eq('id', workflowId);

    return NextResponse.json(
      { error: 'Deal intelligence computation failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
