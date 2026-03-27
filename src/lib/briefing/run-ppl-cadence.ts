import { getDealsByOwnerId } from '../hubspot/deals';
import { getOwnerByEmail, listAllOwners } from '../hubspot/owners';
import { getAllPipelines } from '../hubspot/pipelines';
import { SALES_PIPELINE_ID } from '../hubspot/stage-mappings';
import { ALL_OPEN_STAGE_IDS } from '../hubspot/stage-config';
import { SYNC_CONFIG } from '../hubspot/sync-config';
import { batchFetchDealEngagements } from '../hubspot/batch-engagements';
import { getNotesByDealIdWithAuthor, getTasksByDealId } from '../hubspot/engagements';
import { createServiceClient } from '../supabase/client';
import {
  analyzeCadence,
  computeCadenceMetrics,
  processWithConcurrency,
  formatReport,
} from '../../scripts/ppl-cadence';
import type { CadenceResult, CadenceContext, CadenceMetrics } from '../../scripts/ppl-cadence';
import type { HubSpotDeal } from '../../types/hubspot';
import type { HubSpotEmail, HubSpotCall, HubSpotMeeting } from '../hubspot/engagements';

export type { CadenceResult, CadenceMetrics };

export interface PplCadenceSummary {
  totalDeals: number;
  analyzed: number;
  failed: number;
  totalValue: number;
  byVerdict: Record<string, number>;
  riskCount: number;
  engagementRiskCount: number;
}

export interface PplCadenceRunResult {
  results: CadenceResult[];
  markdown: string;
  summary: PplCadenceSummary;
  durationMs: number;
}

export async function runPplCadence(options?: {
  ownerEmails?: string[];
  concurrency?: number;
  maxAgeDays?: number;
  skipFreshHours?: number; // skip deals analyzed within this many hours
}): Promise<PplCadenceRunResult> {
  const concurrency = options?.concurrency ?? 3;
  const maxAgeDays = options?.maxAgeDays;
  const skipFreshHours = options?.skipFreshHours;
  const targetEmails = options?.ownerEmails ??
    SYNC_CONFIG.TARGET_AE_EMAILS.filter((e) => e !== 'atiwari@opusbehavioral.com');

  // Resolve owners
  const allOwners = await listAllOwners();
  const ownerMap = new Map<string, string>();
  for (const o of allOwners) {
    const name = [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email;
    ownerMap.set(o.id, name);
  }

  // Get stage name map
  const pipelines = await getAllPipelines();
  const stageNameMap = new Map<string, string>();
  const salesPipeline = pipelines.find((p) => p.id === SALES_PIPELINE_ID);
  if (salesPipeline) {
    for (const stage of salesPipeline.stages) {
      stageNameMap.set(stage.id, stage.label);
    }
  }

  // Collect PPL deals
  let allDeals: { deal: HubSpotDeal; ownerName: string }[] = [];
  const ownerIdMap = new Map<string, string>(); // dealId → hubspot owner id

  for (const email of targetEmails) {
    const owner = await getOwnerByEmail(email);
    if (!owner) {
      console.warn(`[ppl-cadence] Owner not found: ${email}, skipping`);
      continue;
    }
    const ownerName = [owner.firstName, owner.lastName].filter(Boolean).join(' ') || email;
    console.log(`[ppl-cadence] Fetching deals for ${ownerName}...`);
    const deals = await getDealsByOwnerId(owner.id);

    const pplDeals = deals.filter((d) => {
      const props = d.properties;
      if (props.pipeline !== SALES_PIPELINE_ID) return false;
      if (!ALL_OPEN_STAGE_IDS.includes(props.dealstage || '')) return false;
      const leadSource = props.lead_source || (props as Record<string, string | undefined>)['lead_source__sync_'] || '';
      if (leadSource !== 'Paid Lead') return false;
      return true;
    });

    console.log(`[ppl-cadence]   ${pplDeals.length} PPL deals in open stages`);
    for (const deal of pplDeals) {
      allDeals.push({ deal, ownerName });
      if (owner.id) ownerIdMap.set(deal.id, owner.id);
    }
  }

  // Filter out deals with no creation date
  allDeals = allDeals.filter((d) => d.deal.properties.createdate);

  // Apply max-age filter
  if (maxAgeDays !== undefined) {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    allDeals = allDeals.filter((d) => new Date(d.deal.properties.createdate!).getTime() >= cutoff);
    console.log(`[ppl-cadence] After max-age filter (${maxAgeDays}d): ${allDeals.length} deals`);
  }

  // Skip deals that were recently analyzed (for incremental cron runs)
  if (skipFreshHours !== undefined && allDeals.length > 0) {
    const supabase = createServiceClient();
    const dealIds = allDeals.map((d) => d.deal.id);
    const { data: recentAnalyses } = await supabase
      .from('ppl_cadence_results')
      .select('deal_id, analyzed_at')
      .in('deal_id', dealIds)
      .order('analyzed_at', { ascending: false });

    // Build map of deal_id → latest analyzed_at
    const freshCutoff = Date.now() - skipFreshHours * 60 * 60 * 1000;
    const freshDealIds = new Set<string>();
    if (recentAnalyses) {
      const seen = new Set<string>();
      for (const row of recentAnalyses) {
        if (!seen.has(row.deal_id)) {
          seen.add(row.deal_id);
          if (new Date(row.analyzed_at).getTime() > freshCutoff) {
            freshDealIds.add(row.deal_id);
          }
        }
      }
    }

    const before = allDeals.length;
    allDeals = allDeals.filter((d) => !freshDealIds.has(d.deal.id));
    console.log(`[ppl-cadence] Skipped ${before - allDeals.length} recently analyzed deals (< ${skipFreshHours}h), ${allDeals.length} remaining`);
  }

  if (allDeals.length === 0) {
    return {
      results: [],
      markdown: '# PPL 3-2-1 Cadence Report\n\nNo PPL deals found.\n',
      summary: {
        totalDeals: 0,
        analyzed: 0,
        failed: 0,
        totalValue: 0,
        byVerdict: {},
        riskCount: 0,
        engagementRiskCount: 0,
      },
      durationMs: 0,
    };
  }

  // Batch-fetch engagements
  console.log(`[ppl-cadence] Batch-fetching engagements for ${allDeals.length} deals...`);
  const hubspotDealIds = allDeals.map((d) => d.deal.id).filter(Boolean);
  let engagementMap = new Map<string, { calls: HubSpotCall[]; emails: HubSpotEmail[]; meetings: HubSpotMeeting[] }>();
  if (hubspotDealIds.length > 0) {
    try {
      engagementMap = await batchFetchDealEngagements(hubspotDealIds);
      console.log(`[ppl-cadence]   Fetched engagements for ${engagementMap.size} deals`);
    } catch {
      console.warn('[ppl-cadence]   Batch engagement fetch failed, will fetch per-deal');
    }
  }

  console.log(`[ppl-cadence] Analyzing ${allDeals.length} deals (concurrency: ${concurrency})...`);
  const startTime = Date.now();
  let completed = 0;

  const results = await processWithConcurrency(
    allDeals,
    concurrency,
    async ({ deal, ownerName }) => {
      try {
        const dealId = deal.id;
        const props = deal.properties;
        const createDate = props.createdate!;

        const batchEngagements = engagementMap.get(dealId) || { calls: [], emails: [], meetings: [] };

        const [notes, tasks] = await Promise.all([
          getNotesByDealIdWithAuthor(dealId, ownerMap),
          getTasksByDealId(dealId),
        ]);

        const { calls, emails, meetings } = batchEngagements;
        const stageId = props.dealstage || '';
        const stageName = stageNameMap.get(stageId) || stageId;
        const dealAgeDays = Math.floor(
          (Date.now() - new Date(createDate).getTime()) / (1000 * 60 * 60 * 24)
        );

        const metrics = computeCadenceMetrics(createDate, calls, emails, meetings, tasks, notes);

        const ctx: CadenceContext = {
          deal,
          dealId,
          dealName: props.dealname || 'Unnamed Deal',
          amount: props.amount ? parseFloat(props.amount) : null,
          stageName,
          ownerName,
          closeDate: props.closedate || null,
          createDate,
          dealAgeDays,
          leadSource: props.lead_source || (props as Record<string, string | undefined>)['lead_source__sync_'] || 'Paid Lead',
          calls,
          emails,
          meetings,
          tasks,
          notes,
          metrics,
        };

        const result = await analyzeCadence(ctx);
        completed++;
        const flags = [
          result.riskFlag ? 'RISK' : '',
          result.engagementRisk ? 'ENG_RISK' : '',
        ].filter(Boolean).join(', ');
        console.log(`  [ppl-cadence ${completed}/${allDeals.length}] ✓ ${ctx.dealName} → ${result.verdict}${flags ? ` [${flags}]` : ''}`);
        return result;
      } catch (err) {
        completed++;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.log(`  [ppl-cadence ${completed}/${allDeals.length}] ✗ ${deal.properties.dealname} → ERROR: ${errMsg}`);
        return {
          dealId: deal.id,
          dealName: deal.properties.dealname || 'Unknown',
          amount: deal.properties.amount ? parseFloat(deal.properties.amount) : null,
          stageName: stageNameMap.get(deal.properties.dealstage || '') || 'Unknown',
          ownerName,
          closeDate: deal.properties.closedate || null,
          createDate: deal.properties.createdate || '',
          dealAgeDays: 0,
          metrics: {} as CadenceMetrics,
          timeline: '',
          threeCompliance: 'UNKNOWN',
          threeRationale: '',
          twoCompliance: 'UNKNOWN',
          twoRationale: '',
          oneCompliance: 'UNKNOWN',
          oneRationale: '',
          speedRating: 'UNKNOWN',
          speedRationale: '',
          channelDiversityRating: 'UNKNOWN',
          prospectEngagement: 'UNKNOWN',
          nurtureWindow: 'UNKNOWN',
          engagementInsight: '',
          verdict: 'UNKNOWN',
          coaching: '',
          riskFlag: false,
          engagementRisk: false,
          executiveSummary: '',
          error: errMsg,
        } as CadenceResult;
      }
    }
  );

  const durationMs = Date.now() - startTime;
  const successes = results.filter((r) => !r.error);
  const failures = results.filter((r) => r.error);

  // Build summary
  const totalValue = successes.reduce((sum, r) => sum + (r.amount || 0), 0);
  const byVerdict: Record<string, number> = {};
  for (const r of successes) {
    byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1;
  }

  const filters = 'All Target AEs, Paid Lead, Open Stages';
  const markdown = formatReport(results, filters, false);

  // Persist results to Supabase for dashboard consumption
  await persistPplResults(successes, ownerIdMap);

  return {
    results,
    markdown,
    summary: {
      totalDeals: allDeals.length,
      analyzed: successes.length,
      failed: failures.length,
      totalValue,
      byVerdict,
      riskCount: successes.filter((r) => r.riskFlag).length,
      engagementRiskCount: successes.filter((r) => r.engagementRisk).length,
    },
    durationMs,
  };
}

async function persistPplResults(
  results: CadenceResult[],
  ownerIdMap: Map<string, string>
): Promise<void> {
  if (results.length === 0) return;

  try {
    const supabase = createServiceClient();
    const now = new Date().toISOString();

    const rows = results.map((r) => ({
      deal_id: r.dealId,
      deal_name: r.dealName,
      amount: r.amount,
      stage_name: r.stageName,
      owner_id: ownerIdMap.get(r.dealId) || null,
      owner_name: r.ownerName,
      close_date: r.closeDate,
      create_date: r.createDate,
      deal_age_days: r.dealAgeDays,
      metrics: r.metrics,
      three_compliance: r.threeCompliance,
      three_rationale: r.threeRationale,
      two_compliance: r.twoCompliance,
      two_rationale: r.twoRationale,
      one_compliance: r.oneCompliance,
      one_rationale: r.oneRationale,
      speed_rating: r.speedRating,
      speed_rationale: r.speedRationale,
      channel_diversity_rating: r.channelDiversityRating,
      prospect_engagement: r.prospectEngagement,
      nurture_window: r.nurtureWindow,
      engagement_insight: r.engagementInsight,
      verdict: r.verdict,
      coaching: r.coaching,
      risk_flag: r.riskFlag,
      engagement_risk: r.engagementRisk,
      executive_summary: r.executiveSummary,
      timeline: r.timeline,
      analyzed_at: now,
    }));

    const { error } = await supabase.from('ppl_cadence_results').insert(rows);
    if (error) {
      console.warn(`[ppl-cadence] Failed to persist results: ${error.message}`);
    } else {
      console.log(`[ppl-cadence] Persisted ${rows.length} results to ppl_cadence_results`);
    }
  } catch (err) {
    console.warn(`[ppl-cadence] Error persisting results: ${err instanceof Error ? err.message : err}`);
  }
}
