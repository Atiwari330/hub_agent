import { getDealsByOwnerId } from '../hubspot/deals';
import { getOwnerByEmail, listAllOwners } from '../hubspot/owners';
import { getAllPipelines } from '../hubspot/pipelines';
import { SALES_PIPELINE_ID, TRACKED_STAGES } from '../hubspot/stage-mappings';
import { SALES_PIPELINE_STAGES } from '../hubspot/stage-config';
import { batchFetchDealEngagements } from '../hubspot/batch-engagements';
import { getNotesByDealIdWithAuthor, getMeetingsByDealId, getEmailsByDealId } from '../hubspot/engagements';
import { createServiceClient } from '../supabase/client';
import {
  analyzePricingCompliance,
  processWithConcurrency,
} from '../../scripts/pricing-compliance';
import type { PricingComplianceResult, PricingComplianceContext, DemoDetectedVia, ComplianceStatus, RiskLevel } from '../../scripts/pricing-compliance';
import type { HubSpotDeal } from '../../types/hubspot';
import type { HubSpotEmail, HubSpotCall, HubSpotMeeting } from '../hubspot/engagements';

export type { PricingComplianceResult };

// Only analyze deals with demo completed on or after this date
const POLICY_START_DATE = '2026-03-30T00:00:00.000Z';

// Target AEs
const PRICING_TARGET_EMAILS = [
  'cgarraffa@opusbehavioral.com',
  'jrice@opusbehavioral.com',
];

const DEMO_SCHEDULED_STAGE_ID = SALES_PIPELINE_STAGES.DEMO_SCHEDULED.id;

export interface PricingComplianceSummary {
  totalDeals: number;
  analyzed: number;
  failed: number;
  totalValue: number;
  byStatus: Record<string, number>;
  nonCompliantCount: number;
  lastAnalyzedAt: string | null;
}

export interface PricingComplianceRunResult {
  results: PricingComplianceResult[];
  summary: PricingComplianceSummary;
  durationMs: number;
}

export async function runPricingCompliance(options?: {
  ownerEmails?: string[];
  concurrency?: number;
  maxAgeDays?: number;
  skipFreshHours?: number;
}): Promise<PricingComplianceRunResult> {
  const concurrency = options?.concurrency ?? 3;
  const maxAgeDays = options?.maxAgeDays ?? 30;
  const skipFreshHours = options?.skipFreshHours;
  const targetEmails = options?.ownerEmails ?? PRICING_TARGET_EMAILS;

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

  // Collect deals with demo completion
  type DealEntry = {
    deal: HubSpotDeal;
    ownerName: string;
    ownerId: string;
    demoCompletedAt: string;
    demoDetectedVia: DemoDetectedVia;
  };
  let allDeals: DealEntry[] = [];
  const ownerIdMap = new Map<string, string>(); // dealId → owner hubspot id

  for (const email of targetEmails) {
    const owner = await getOwnerByEmail(email);
    if (!owner) {
      console.warn(`[pricing-compliance] Owner not found: ${email}, skipping`);
      continue;
    }
    const ownerName = [owner.firstName, owner.lastName].filter(Boolean).join(' ') || email;
    console.log(`[pricing-compliance] Fetching deals for ${ownerName}...`);
    const deals = await getDealsByOwnerId(owner.id);

    // Primary: deals with demo_completed timestamp
    for (const deal of deals) {
      const props = deal.properties;
      if (props.pipeline !== SALES_PIPELINE_ID) continue;

      const demoCompletedAt = props[TRACKED_STAGES.DEMO_COMPLETED.property] || null;
      if (!demoCompletedAt) continue;
      if (new Date(demoCompletedAt) < new Date(POLICY_START_DATE)) continue;

      // Apply max-age filter
      const daysSinceDemo = (Date.now() - new Date(demoCompletedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceDemo > maxAgeDays) continue;

      allDeals.push({
        deal,
        ownerName,
        ownerId: owner.id,
        demoCompletedAt,
        demoDetectedVia: 'stage_move',
      });
      ownerIdMap.set(deal.id, owner.id);
    }

    // Secondary: deals stuck in Demo Scheduled 48+ hours with completed meetings
    const stuckDeals = deals.filter((d) => {
      const props = d.properties;
      if (props.pipeline !== SALES_PIPELINE_ID) return false;
      if (props.dealstage !== DEMO_SCHEDULED_STAGE_ID) return false;
      if (props[TRACKED_STAGES.DEMO_COMPLETED.property]) return false;
      const scheduledAt = (props as Record<string, string | undefined>)[TRACKED_STAGES.DEMO_SCHEDULED.property];
      if (!scheduledAt) return false;
      if (new Date(scheduledAt) < new Date(POLICY_START_DATE)) return false;
      const hoursSinceScheduled = (Date.now() - new Date(scheduledAt).getTime()) / (1000 * 60 * 60);
      return hoursSinceScheduled >= 48;
    });

    for (const deal of stuckDeals) {
      try {
        const meetings = await getMeetingsByDealId(deal.id);
        const completedMeeting = meetings.find((m) => {
          const meetingTs = m.properties.hs_timestamp;
          if (!meetingTs) return false;
          return new Date(meetingTs) < new Date();
        });
        if (completedMeeting && !allDeals.some((d) => d.deal.id === deal.id)) {
          const meetingTs = completedMeeting.properties.hs_timestamp!;
          allDeals.push({
            deal,
            ownerName,
            ownerId: owner.id,
            demoCompletedAt: meetingTs,
            demoDetectedVia: 'meeting_engagement',
          });
          ownerIdMap.set(deal.id, owner.id);
        }
      } catch {
        // Skip if meeting fetch fails
      }
    }

    console.log(`[pricing-compliance]   ${allDeals.length} total deals so far`);
  }

  // Skip recently analyzed deals
  if (skipFreshHours !== undefined && allDeals.length > 0) {
    const supabase = createServiceClient();
    const dealIds = allDeals.map((d) => d.deal.id);
    const { data: recentAnalyses } = await supabase
      .from('pricing_compliance_results')
      .select('deal_id, analyzed_at')
      .in('deal_id', dealIds)
      .order('analyzed_at', { ascending: false });

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
    console.log(`[pricing-compliance] Skipped ${before - allDeals.length} recently analyzed deals, ${allDeals.length} remaining`);
  }

  if (allDeals.length === 0) {
    return {
      results: [],
      summary: {
        totalDeals: 0,
        analyzed: 0,
        failed: 0,
        totalValue: 0,
        byStatus: {},
        nonCompliantCount: 0,
        lastAnalyzedAt: null,
      },
      durationMs: 0,
    };
  }

  // Batch-fetch engagements
  console.log(`[pricing-compliance] Batch-fetching engagements for ${allDeals.length} deals...`);
  const hubspotDealIds = allDeals.map((d) => d.deal.id).filter(Boolean);
  let engagementMap = new Map<string, { calls: HubSpotCall[]; emails: HubSpotEmail[]; meetings: HubSpotMeeting[] }>();
  if (hubspotDealIds.length > 0) {
    try {
      engagementMap = await batchFetchDealEngagements(hubspotDealIds);
      console.log(`[pricing-compliance]   Fetched engagements for ${engagementMap.size} deals`);
    } catch {
      console.warn('[pricing-compliance]   Batch engagement fetch failed, will fetch per-deal');
    }
  }

  console.log(`[pricing-compliance] Analyzing ${allDeals.length} deals (concurrency: ${concurrency})...`);
  const startTime = Date.now();
  let completed = 0;

  const results = await processWithConcurrency(
    allDeals,
    concurrency,
    async ({ deal, ownerName, ownerId, demoCompletedAt, demoDetectedVia }) => {
      try {
        const dealId = deal.id;
        const props = deal.properties;
        const batchEngagements = engagementMap.get(dealId) || { calls: [], emails: [], meetings: [] };

        const [notes] = await Promise.all([
          getNotesByDealIdWithAuthor(dealId, ownerMap),
        ]);

        let emails = batchEngagements.emails;
        if (emails.length === 0) {
          try {
            emails = await getEmailsByDealId(dealId);
          } catch { /* empty */ }
        }

        const stageId = props.dealstage || '';
        const stageName = stageNameMap.get(stageId) || stageId;

        const ctx: PricingComplianceContext = {
          dealId,
          dealName: props.dealname || 'Unnamed Deal',
          amount: props.amount ? parseFloat(props.amount) : null,
          stageName,
          ownerName,
          ownerId,
          demoCompletedAt,
          demoDetectedVia,
          emails,
          notes,
          meetings: batchEngagements.meetings,
        };

        const result = await analyzePricingCompliance(ctx);
        completed++;
        console.log(`  [pricing-compliance ${completed}/${allDeals.length}] ${ctx.dealName} → ${result.complianceStatus}`);
        return result;
      } catch (err) {
        completed++;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.log(`  [pricing-compliance ${completed}/${allDeals.length}] ${deal.properties.dealname} → ERROR: ${errMsg}`);
        return {
          dealId: deal.id,
          dealName: deal.properties.dealname || 'Unknown',
          amount: deal.properties.amount ? parseFloat(deal.properties.amount) : null,
          stageName: stageNameMap.get(deal.properties.dealstage || '') || 'Unknown',
          ownerName,
          ownerId,
          demoCompletedAt,
          demoDetectedVia,
          pricingSentAt: null,
          hoursToPricing: null,
          exemptionNotedAt: null,
          complianceStatus: 'NON_COMPLIANT' as ComplianceStatus,
          pricingEvidence: null,
          exemptionReason: null,
          analysisRationale: 'Analysis failed.',
          executiveSummary: 'Analysis error — review manually.',
          riskLevel: 'HIGH' as RiskLevel,
          error: errMsg,
        } as PricingComplianceResult;
      }
    },
  );

  const durationMs = Date.now() - startTime;
  const successes = results.filter((r) => !r.error);
  const failures = results.filter((r) => r.error);

  // Persist results
  await persistPricingResults(successes, ownerIdMap);

  // Build summary
  const totalValue = successes.reduce((sum, r) => sum + (r.amount || 0), 0);
  const byStatus: Record<string, number> = {};
  for (const r of successes) {
    byStatus[r.complianceStatus] = (byStatus[r.complianceStatus] || 0) + 1;
  }

  return {
    results,
    summary: {
      totalDeals: allDeals.length,
      analyzed: successes.length,
      failed: failures.length,
      totalValue,
      byStatus,
      nonCompliantCount: successes.filter((r) => r.complianceStatus === 'NON_COMPLIANT').length,
      lastAnalyzedAt: new Date().toISOString(),
    },
    durationMs,
  };
}

async function persistPricingResults(
  results: PricingComplianceResult[],
  ownerIdMap: Map<string, string>,
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
      owner_id: ownerIdMap.get(r.dealId) || r.ownerId || null,
      owner_name: r.ownerName,
      demo_completed_at: r.demoCompletedAt,
      demo_detected_via: r.demoDetectedVia,
      pricing_sent_at: r.pricingSentAt,
      hours_to_pricing: r.hoursToPricing,
      exemption_noted_at: r.exemptionNotedAt,
      compliance_status: r.complianceStatus,
      pricing_evidence: r.pricingEvidence,
      exemption_reason: r.exemptionReason,
      analysis_rationale: r.analysisRationale,
      executive_summary: r.executiveSummary,
      risk_level: r.riskLevel,
      analyzed_at: now,
    }));

    const { error } = await supabase.from('pricing_compliance_results').insert(rows);
    if (error) {
      console.warn(`[pricing-compliance] Failed to persist results: ${error.message}`);
    } else {
      console.log(`[pricing-compliance] Persisted ${rows.length} results to pricing_compliance_results`);
    }
  } catch (err) {
    console.warn(`[pricing-compliance] Error persisting results: ${err instanceof Error ? err.message : err}`);
  }
}
