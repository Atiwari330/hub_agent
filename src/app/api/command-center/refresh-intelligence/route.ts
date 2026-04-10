import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { computeAllDealIntelligence } from '@/lib/intelligence/deal-rules';
import { analyzeDealIntelligence } from '@/lib/intelligence/deal-llm';
import { POST_DEMO_STAGE_IDS } from '@/lib/hubspot/stage-config';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { paginatedFetch } from '@/lib/supabase/paginate';

/**
 * POST /api/command-center/refresh-intelligence
 *
 * Manual trigger for deal intelligence refresh from the Command Center UI.
 * Only re-analyzes deals that have changed since their last LLM run:
 *   - rules `updated_at` is newer than `llm_analyzed_at`
 *   - never been LLM-analyzed
 *   - grade D or F (worth re-checking)
 * Scoped to post-demo deals only (forecast-eligible).
 *
 * Logs to `workflow_runs` so results are visible in the admin panel.
 */
export async function POST() {
  const supabase = createServiceClient();
  const workflowId = crypto.randomUUID();
  const startTime = Date.now();

  // Log workflow start
  await supabase.from('workflow_runs').insert({
    id: workflowId,
    workflow_name: 'refresh-intelligence (manual)',
    status: 'running',
  });

  try {
    // Phase 1: Rules engine (fast, no LLM)
    const phase1 = await computeAllDealIntelligence();

    // Phase 2: Find post-demo deals that need LLM refresh
    const postDemoSet = new Set(POST_DEMO_STAGE_IDS);

    const candidates = await paginatedFetch(() =>
      supabase
        .from('deal_intelligence')
        .select('hubspot_deal_id, stage_id, overall_grade, llm_analyzed_at, updated_at, deal_name')
        .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID),
    );

    const needsAnalysis = candidates.filter((d) => {
      if (!postDemoSet.has(d.stage_id)) return false;
      if (!d.llm_analyzed_at) return true;
      if (d.updated_at && d.updated_at > d.llm_analyzed_at) return true;
      if (d.overall_grade === 'D' || d.overall_grade === 'F') return true;
      return false;
    });

    let llmSuccess = 0;
    let llmErrors = 0;
    const llmErrorDetails: string[] = [];
    const skippedCount = candidates.filter((d) => postDemoSet.has(d.stage_id)).length - needsAnalysis.length;

    for (const deal of needsAnalysis) {
      const result = await analyzeDealIntelligence(deal.hubspot_deal_id);
      if (result.success) {
        llmSuccess++;
      } else {
        llmErrors++;
        llmErrorDetails.push(`${deal.deal_name || deal.hubspot_deal_id}: ${result.error}`);
      }
    }

    const duration = Date.now() - startTime;

    const resultPayload = {
      phase1: { processed: phase1.processed, errors: phase1.errors },
      phase2: {
        eligible: needsAnalysis.length + skippedCount,
        skipped: skippedCount,
        analyzed: llmSuccess,
        errors: llmErrors,
        errorDetails: llmErrorDetails.slice(0, 10),
      },
      durationMs: duration,
    };

    // Log workflow completion
    await supabase.from('workflow_runs').update({
      status: llmErrors > 0 ? 'completed' : 'completed',
      completed_at: new Date().toISOString(),
      result: resultPayload,
      error: llmErrors > 0 ? `${llmErrors} deal(s) failed LLM analysis` : null,
    }).eq('id', workflowId);

    return NextResponse.json({
      success: true,
      ...resultPayload,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    // Log workflow failure
    await supabase.from('workflow_runs').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: errorMessage,
    }).eq('id', workflowId);

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 },
    );
  }
}
