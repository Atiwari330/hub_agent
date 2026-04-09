import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { computeAllDealIntelligence } from '@/lib/intelligence/deal-rules';
import { analyzeDealIntelligence } from '@/lib/intelligence/deal-llm';
import { POST_DEMO_STAGE_IDS } from '@/lib/hubspot/stage-config';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';

/**
 * POST /api/command-center/refresh-intelligence
 *
 * Manual trigger for deal intelligence refresh from the Command Center UI.
 * Only re-analyzes deals that have changed since their last LLM run:
 *   - rules `updated_at` is newer than `llm_analyzed_at`
 *   - never been LLM-analyzed
 *   - grade D or F (worth re-checking)
 * Scoped to post-demo deals only (forecast-eligible).
 */
export async function POST() {
  const supabase = createServiceClient();
  const startTime = Date.now();

  try {
    // Phase 1: Rules engine (fast, no LLM)
    const phase1 = await computeAllDealIntelligence();

    // Phase 2: Find post-demo deals that need LLM refresh
    const postDemoSet = new Set(POST_DEMO_STAGE_IDS);

    const { data: candidates, error } = await supabase
      .from('deal_intelligence')
      .select('hubspot_deal_id, stage_id, overall_grade, llm_analyzed_at, updated_at')
      .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID);

    if (error) throw new Error(`Fetch error: ${error.message}`);

    const needsAnalysis = (candidates || []).filter((d) => {
      // Only post-demo stages
      if (!postDemoSet.has(d.stage_id)) return false;
      // Never analyzed
      if (!d.llm_analyzed_at) return true;
      // Rules scores updated since last LLM run
      if (d.updated_at && d.updated_at > d.llm_analyzed_at) return true;
      // Poor grades worth re-checking
      if (d.overall_grade === 'D' || d.overall_grade === 'F') return true;
      return false;
    });

    let llmSuccess = 0;
    let llmErrors = 0;

    for (const deal of needsAnalysis) {
      const result = await analyzeDealIntelligence(deal.hubspot_deal_id);
      if (result.success) llmSuccess++;
      else llmErrors++;
    }

    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      phase1: { processed: phase1.processed, errors: phase1.errors },
      phase2: { candidates: needsAnalysis.length, analyzed: llmSuccess, errors: llmErrors },
      durationMs: duration,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
