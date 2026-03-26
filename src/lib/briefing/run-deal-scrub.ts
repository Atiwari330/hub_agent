import { getOwnerByEmail, listAllOwners } from '../hubspot/owners';
import { getDealsByOwnerId } from '../hubspot/deals';
import { getStageNameMap, getAllPipelines } from '../hubspot/pipelines';
import { SALES_PIPELINE_ID } from '../hubspot/stage-mappings';
import {
  scrubDeal,
  processWithConcurrency,
  formatReport,
} from '../../scripts/deal-scrub';
import type { ScrubResult } from '../../scripts/deal-scrub';

export type { ScrubResult };

export interface DealScrubSummary {
  totalDeals: number;
  analyzed: number;
  failed: number;
  totalValue: number;
  atRiskValue: number;
  byRecommendation: Record<string, { count: number; value: number }>;
}

export interface DealScrubRunResult {
  results: ScrubResult[];
  markdown: string;
  summary: DealScrubSummary;
  ownerName: string;
  durationMs: number;
}

export async function runDealScrub(
  ownerEmail: string,
  options?: { concurrency?: number }
): Promise<DealScrubRunResult> {
  const concurrency = options?.concurrency ?? 3;

  // Resolve owner
  const owner = await getOwnerByEmail(ownerEmail);
  if (!owner) throw new Error(`Owner not found in HubSpot: ${ownerEmail}`);
  const ownerName = [owner.firstName, owner.lastName].filter(Boolean).join(' ') || ownerEmail;

  // Build owner map and stage name map
  const [allOwners, stageNameMap, pipelines] = await Promise.all([
    listAllOwners(),
    getStageNameMap(),
    getAllPipelines(),
  ]);

  const ownerMap = new Map<string, string>();
  for (const o of allOwners) {
    const name = [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email;
    ownerMap.set(o.id, name);
  }

  // Build closed stage ID set
  const closedStageIds = new Set<string>();
  for (const pipeline of pipelines) {
    for (const stage of pipeline.stages) {
      if (stage.metadata.isClosed) {
        closedStageIds.add(stage.id);
      }
    }
  }

  // Fetch deals
  console.log(`[deal-scrub] Fetching deals for ${ownerName}...`);
  let deals = await getDealsByOwnerId(owner.id);

  // Filter to sales pipeline, open stages
  deals = deals.filter((d) => d.properties.pipeline === SALES_PIPELINE_ID);
  deals = deals.filter((d) => !closedStageIds.has(d.properties.dealstage || ''));

  if (deals.length === 0) {
    return {
      results: [],
      markdown: `# Deal Scrub — ${ownerName}\n\nNo open deals found.\n`,
      summary: {
        totalDeals: 0,
        analyzed: 0,
        failed: 0,
        totalValue: 0,
        atRiskValue: 0,
        byRecommendation: {},
      },
      ownerName,
      durationMs: 0,
    };
  }

  console.log(`[deal-scrub] Analyzing ${deals.length} deals for ${ownerName} (concurrency: ${concurrency})...`);
  const startTime = Date.now();
  let completed = 0;

  const results = await processWithConcurrency(
    deals,
    concurrency,
    async (deal) => {
      try {
        const result = await scrubDeal(deal, stageNameMap, ownerMap, ownerName);
        completed++;
        console.log(`  [deal-scrub ${completed}/${deals.length}] ✓ ${deal.properties.dealname} → ${result.recommendation}`);
        return result;
      } catch (err) {
        completed++;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.log(`  [deal-scrub ${completed}/${deals.length}] ✗ ${deal.properties.dealname} → ERROR: ${errMsg}`);
        return {
          dealId: deal.id,
          dealName: deal.properties.dealname || 'Unknown',
          amount: deal.properties.amount ? parseFloat(deal.properties.amount) : null,
          stageName: stageNameMap.get(deal.properties.dealstage || '') || deal.properties.dealstage || 'Unknown',
          closeDate: deal.properties.closedate || null,
          dealAgeDays: 0,
          daysInCurrentStage: null,
          daysUntilClose: null,
          ownerName,
          activityLevel: 'UNKNOWN',
          customerEngagement: 'UNKNOWN',
          aeEffort: 'UNKNOWN',
          dealMomentum: 'UNKNOWN',
          recommendation: 'UNKNOWN',
          recommendationRationale: '',
          executiveSummary: '',
          timeline: '',
          error: errMsg,
        } as ScrubResult;
      }
    }
  );

  const durationMs = Date.now() - startTime;
  const successes = results.filter((r) => !r.error);
  const failures = results.filter((r) => r.error);

  // Build summary
  const totalValue = successes.reduce((sum, r) => sum + (r.amount || 0), 0);
  const byRecommendation: Record<string, { count: number; value: number }> = {};
  for (const r of successes) {
    if (!byRecommendation[r.recommendation]) byRecommendation[r.recommendation] = { count: 0, value: 0 };
    byRecommendation[r.recommendation].count++;
    byRecommendation[r.recommendation].value += r.amount || 0;
  }
  const atRiskValue =
    (byRecommendation['CLOSE_OUT']?.value || 0) + (byRecommendation['MOVE_TO_NURTURE']?.value || 0);

  const markdown = formatReport(results, ownerName, 'All open stages', false);

  return {
    results,
    markdown,
    summary: {
      totalDeals: deals.length,
      analyzed: successes.length,
      failed: failures.length,
      totalValue,
      atRiskValue,
      byRecommendation,
    },
    ownerName,
    durationMs,
  };
}
