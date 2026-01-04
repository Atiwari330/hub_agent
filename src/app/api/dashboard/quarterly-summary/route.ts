import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { getCurrentQuarter, getQuarterProgress, getQuarterInfo } from '@/lib/utils/quarter';
import { getAllPipelines } from '@/lib/hubspot/pipelines';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { calculateDealRisk } from '@/lib/utils/deal-risk';

// Stage categories
const CLOSED_WON_PATTERNS = ['closedwon', 'closed won', 'closed-won'];
const CLOSED_LOST_PATTERNS = ['closedlost', 'closed lost', 'closed-lost'];
const EXCLUDED_FROM_PIPELINE = ['mql', 'disqualified', 'qualified'];

// Stage probability weights for weighted forecast
// Based on typical SaaS conversion rates by stage
const STAGE_WEIGHTS: Record<string, number> = {
  // Early stages
  sql: 0.1,
  mql: 0.05,
  qualified: 0.1,
  discovery: 0.15,
  // Mid stages
  'demo scheduled': 0.2,
  'demo - scheduled': 0.2,
  'demo completed': 0.4,
  'demo - completed': 0.4,
  // Late stages
  proposal: 0.6,
  'proposal sent': 0.6,
  negotiation: 0.8,
  'contract sent': 0.85,
  'legal review': 0.85,
  'procurement': 0.85,
};

function getStageWeight(stageName: string | null): number {
  if (!stageName) return 0.1;
  const lower = stageName.toLowerCase();

  // Check for exact matches first
  if (STAGE_WEIGHTS[lower]) return STAGE_WEIGHTS[lower];

  // Check for partial matches
  if (lower.includes('demo') && lower.includes('completed')) return 0.4;
  if (lower.includes('demo') && lower.includes('scheduled')) return 0.2;
  if (lower.includes('demo')) return 0.3;
  if (lower.includes('proposal')) return 0.6;
  if (lower.includes('negotiat')) return 0.8;
  if (lower.includes('contract')) return 0.85;
  if (lower.includes('legal')) return 0.85;
  if (lower.includes('sql')) return 0.1;

  // Default weight
  return 0.15;
}

interface AEContribution {
  id: string;
  name: string;
  email: string;
  initials: string;
  target: number;
  closedWon: number;
  attainment: number;
  pipeline: number;
  coverage: number;
  stalePercent: number;
  status: 'on_track' | 'at_risk' | 'behind';
}

interface StageBreakdown {
  stageId: string;
  stageName: string;
  dealCount: number;
  totalValue: number;
  weightedValue: number;
  weight: number;
}

interface RiskFactor {
  description: string;
  impact: number;
  dealCount: number;
  deals: string[];
}

function getOwnerDisplayName(owner: { first_name: string | null; last_name: string | null; email: string }): string {
  if (owner.first_name || owner.last_name) {
    return [owner.first_name, owner.last_name].filter(Boolean).join(' ');
  }
  return owner.email.split('@')[0];
}

function getOwnerInitials(owner: { first_name: string | null; last_name: string | null; email: string }): string {
  if (owner.first_name && owner.last_name) {
    return `${owner.first_name[0]}${owner.last_name[0]}`.toUpperCase();
  }
  if (owner.first_name) {
    return owner.first_name.slice(0, 2).toUpperCase();
  }
  return owner.email.slice(0, 2).toUpperCase();
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();

    // Get query params for specific quarter, or default to current
    const searchParams = request.nextUrl.searchParams;
    const currentQ = getCurrentQuarter();
    const fiscalYear = parseInt(searchParams.get('year') || String(currentQ.year));
    const fiscalQuarter = parseInt(searchParams.get('quarter') || String(currentQ.quarter));
    const quarterInfo = getQuarterInfo(fiscalYear, fiscalQuarter);
    const progress = getQuarterProgress(quarterInfo);

    // Fetch target owners
    const { data: owners, error: ownersError } = await supabase
      .from('owners')
      .select('id, first_name, last_name, email')
      .in('email', SYNC_CONFIG.TARGET_AE_EMAILS)
      .order('last_name');

    if (ownersError) {
      console.error('Error fetching owners:', ownersError);
      return NextResponse.json({ error: 'Failed to fetch owners' }, { status: 500 });
    }

    const ownerIds = (owners || []).map((o) => o.id);

    // Fetch quotas for all owners
    const { data: quotas } = await supabase
      .from('quotas')
      .select('owner_id, quota_amount')
      .in('owner_id', ownerIds)
      .eq('fiscal_year', fiscalYear)
      .eq('fiscal_quarter', fiscalQuarter);

    // Also check ae_targets table as fallback
    const { data: aeTargets } = await supabase
      .from('ae_targets')
      .select('owner_id, target_amount')
      .in('owner_id', ownerIds)
      .eq('fiscal_year', fiscalYear)
      .eq('fiscal_quarter', fiscalQuarter);

    const quotaMap = new Map<string, number>();
    // First add from ae_targets
    (aeTargets || []).forEach((t) => {
      quotaMap.set(t.owner_id, t.target_amount || 0);
    });
    // Then override with quotas if present
    (quotas || []).forEach((q) => {
      if (q.quota_amount) {
        quotaMap.set(q.owner_id, q.quota_amount);
      }
    });

    // Fetch all deals for target owners
    const { data: deals, error: dealsError } = await supabase
      .from('deals')
      .select('*')
      .in('owner_id', ownerIds);

    if (dealsError) {
      console.error('Error fetching deals:', dealsError);
      return NextResponse.json({ error: 'Failed to fetch deals' }, { status: 500 });
    }

    // Fetch pipelines for stage name lookup
    const pipelines = await getAllPipelines();
    const stageMap = new Map<string, string>();
    const closedWonStages = new Set<string>();
    const closedLostStages = new Set<string>();

    for (const pipeline of pipelines) {
      for (const stage of pipeline.stages) {
        stageMap.set(stage.id, stage.label);

        if (stage.metadata.isClosed) {
          const stageLabelLower = stage.label.toLowerCase();
          if (CLOSED_WON_PATTERNS.some((p) => stageLabelLower.includes(p))) {
            closedWonStages.add(stage.id);
          } else if (CLOSED_LOST_PATTERNS.some((p) => stageLabelLower.includes(p))) {
            closedLostStages.add(stage.id);
          }
        }
      }
    }

    // Helper functions
    const isClosedWon = (stage: string | null): boolean => {
      if (!stage) return false;
      if (closedWonStages.has(stage)) return true;
      const stageLower = stage.toLowerCase();
      return CLOSED_WON_PATTERNS.some((p) => stageLower.includes(p));
    };

    const isClosedLost = (stage: string | null): boolean => {
      if (!stage) return false;
      if (closedLostStages.has(stage)) return true;
      const stageLower = stage.toLowerCase();
      return CLOSED_LOST_PATTERNS.some((p) => stageLower.includes(p));
    };

    const isInPipeline = (stage: string | null): boolean => {
      if (!stage) return true;
      if (isClosedWon(stage) || isClosedLost(stage)) return false;
      const stageName = stageMap.get(stage) || stage;
      const stageLower = stageName.toLowerCase();
      return !EXCLUDED_FROM_PIPELINE.some((p) => stageLower.includes(p));
    };

    const isInQuarter = (dateStr: string | null): boolean => {
      if (!dateStr) return false;
      const date = new Date(dateStr);
      return date >= quarterInfo.startDate && date <= quarterInfo.endDate;
    };

    // Calculate totals
    let totalClosedWon = 0;
    let totalPipeline = 0;
    let totalWeightedPipeline = 0;
    let totalTarget = 0;

    const aeContributions: AEContribution[] = [];
    const stageBreakdownMap = new Map<string, StageBreakdown>();
    const riskFactors: RiskFactor[] = [];
    const staleDeals: { name: string; amount: number; factor: string }[] = [];

    // Process each owner
    for (const owner of owners || []) {
      const ownerDeals = (deals || []).filter((d) => d.owner_id === owner.id);
      const ownerQuota = quotaMap.get(owner.id) || 100000; // Default $100k if no quota set
      totalTarget += ownerQuota;

      // Closed won this quarter
      const closedWonDeals = ownerDeals.filter(
        (d) => isClosedWon(d.deal_stage) && isInQuarter(d.close_date)
      );
      const closedWonAmount = closedWonDeals.reduce((sum, d) => sum + (d.amount || 0), 0);
      totalClosedWon += closedWonAmount;

      // Pipeline deals
      const pipelineDeals = ownerDeals.filter((d) => isInPipeline(d.deal_stage));
      const pipelineValue = pipelineDeals.reduce((sum, d) => sum + (d.amount || 0), 0);
      totalPipeline += pipelineValue;

      // Calculate stale percentage
      let staleCount = 0;
      for (const deal of pipelineDeals) {
        const stageName = stageMap.get(deal.deal_stage || '') || deal.deal_stage || '';
        const risk = calculateDealRisk({
          stageName,
          closeDate: deal.close_date,
          lastActivityDate: deal.last_activity_date,
          nextActivityDate: deal.next_activity_date,
          nextStep: deal.next_step,
          sqlEnteredAt: deal.sql_entered_at,
          demoScheduledEnteredAt: deal.demo_scheduled_entered_at,
          demoCompletedEnteredAt: deal.demo_completed_entered_at,
          hubspotCreatedAt: deal.hubspot_created_at,
          nextStepDueDate: deal.next_step_due_date,
          nextStepStatus: deal.next_step_status,
        });

        if (risk.level === 'stale') {
          staleCount++;
          if ((deal.amount || 0) >= 50000) {
            staleDeals.push({
              name: deal.deal_name,
              amount: deal.amount || 0,
              factor: risk.factors[0]?.message || 'Multiple risk factors',
            });
          }
        }

        // Aggregate by stage for stage breakdown
        const stageId = deal.deal_stage || 'unknown';
        const existing = stageBreakdownMap.get(stageId);
        const weight = getStageWeight(stageName);
        const dealWeightedValue = (deal.amount || 0) * weight;

        if (existing) {
          existing.dealCount++;
          existing.totalValue += deal.amount || 0;
          existing.weightedValue += dealWeightedValue;
        } else {
          stageBreakdownMap.set(stageId, {
            stageId,
            stageName: stageName || 'Unknown',
            dealCount: 1,
            totalValue: deal.amount || 0,
            weightedValue: dealWeightedValue,
            weight,
          });
        }

        totalWeightedPipeline += dealWeightedValue;
      }

      const stalePercent = pipelineDeals.length > 0 ? (staleCount / pipelineDeals.length) * 100 : 0;
      const remaining = ownerQuota - closedWonAmount;
      const coverage = remaining > 0 ? pipelineValue / remaining : 999;
      const attainment = ownerQuota > 0 ? (closedWonAmount / ownerQuota) * 100 : 0;

      // Determine status
      let status: 'on_track' | 'at_risk' | 'behind' = 'on_track';
      if (coverage < 2) {
        status = 'behind';
      } else if (coverage < 3 || stalePercent > 20) {
        status = 'at_risk';
      }

      aeContributions.push({
        id: owner.id,
        name: getOwnerDisplayName(owner),
        email: owner.email,
        initials: getOwnerInitials(owner),
        target: ownerQuota,
        closedWon: closedWonAmount,
        attainment: Math.round(attainment * 10) / 10,
        pipeline: pipelineValue,
        coverage: Math.round(coverage * 10) / 10,
        stalePercent: Math.round(stalePercent * 10) / 10,
        status,
      });
    }

    // Build risk factors from stale deals
    if (staleDeals.length > 0) {
      const totalStaleValue = staleDeals.reduce((sum, d) => sum + d.amount, 0);
      riskFactors.push({
        description: `${staleDeals.length} high-value stale deal${staleDeals.length !== 1 ? 's' : ''}`,
        impact: totalStaleValue,
        dealCount: staleDeals.length,
        deals: staleDeals.map((d) => d.name),
      });
    }

    // Check for low coverage AEs
    const lowCoverageAEs = aeContributions.filter((ae) => ae.coverage < 2);
    if (lowCoverageAEs.length > 0) {
      const gapAmount = lowCoverageAEs.reduce((sum, ae) => {
        const remaining = ae.target - ae.closedWon;
        const needed = remaining * 3 - ae.pipeline; // Need 3x coverage
        return sum + Math.max(0, needed);
      }, 0);

      riskFactors.push({
        description: `${lowCoverageAEs.length} AE${lowCoverageAEs.length !== 1 ? 's' : ''} with <2x coverage`,
        impact: gapAmount,
        dealCount: lowCoverageAEs.length,
        deals: lowCoverageAEs.map((ae) => ae.name),
      });
    }

    // Calculate forecast
    const totalRemaining = totalTarget - totalClosedWon;
    const overallCoverage = totalRemaining > 0 ? totalPipeline / totalRemaining : 999;
    const weightedForecast = totalClosedWon + totalWeightedPipeline;

    // Convert stage breakdown to array and sort
    const stageBreakdown = Array.from(stageBreakdownMap.values()).sort(
      (a, b) => b.totalValue - a.totalValue
    );

    // Determine overall status
    const expectedByNow = totalTarget * (progress.percentComplete / 100);
    const pace = totalClosedWon - expectedByNow;
    const onTrack = pace >= 0;
    const forecastAttainment = totalTarget > 0 ? (weightedForecast / totalTarget) * 100 : 0;

    return NextResponse.json({
      quarter: {
        year: fiscalYear,
        quarter: fiscalQuarter,
        label: quarterInfo.label,
        startDate: quarterInfo.startDate.toISOString(),
        endDate: quarterInfo.endDate.toISOString(),
      },
      progress: {
        daysElapsed: progress.daysElapsed,
        totalDays: progress.totalDays,
        percentComplete: Math.round(progress.percentComplete * 10) / 10,
      },
      target: {
        total: totalTarget,
        closedWon: totalClosedWon,
        attainment: Math.round((totalClosedWon / totalTarget) * 1000) / 10,
        remaining: totalRemaining,
      },
      pace: {
        expectedByNow: Math.round(expectedByNow),
        actual: totalClosedWon,
        difference: Math.round(pace),
        onTrack,
      },
      forecast: {
        weighted: Math.round(weightedForecast),
        attainment: Math.round(forecastAttainment * 10) / 10,
        confidence: forecastAttainment >= 80 ? 'high' : forecastAttainment >= 60 ? 'medium' : 'low',
      },
      pipeline: {
        total: totalPipeline,
        weighted: Math.round(totalWeightedPipeline),
        coverage: Math.round(overallCoverage * 10) / 10,
        coverageStatus: overallCoverage >= 3 ? 'healthy' : overallCoverage >= 2 ? 'watch' : 'at_risk',
      },
      aeContributions: aeContributions.sort((a, b) => b.closedWon - a.closedWon),
      stageBreakdown,
      riskFactors: riskFactors.sort((a, b) => b.impact - a.impact),
    });
  } catch (error) {
    console.error('Error in quarterly summary:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
