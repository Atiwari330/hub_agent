import { getDealsByOwnerId } from '../hubspot/deals';
import { getOwnerByEmail, listAllOwners } from '../hubspot/owners';
import { getAllPipelines } from '../hubspot/pipelines';
import { SALES_PIPELINE_ID } from '../hubspot/stage-mappings';
import { ALL_OPEN_STAGE_IDS } from '../hubspot/stage-config';
import { SYNC_CONFIG } from '../hubspot/sync-config';
import { batchFetchDealEngagements } from '../hubspot/batch-engagements';
import { getNotesByDealIdWithAuthor, getTasksByDealId } from '../hubspot/engagements';
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
}): Promise<PplCadenceRunResult> {
  const concurrency = options?.concurrency ?? 3;
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
    }
  }

  // Filter out deals with no creation date
  allDeals = allDeals.filter((d) => d.deal.properties.createdate);

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
