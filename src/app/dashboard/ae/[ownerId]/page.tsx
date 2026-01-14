import { notFound } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { getCurrentQuarter, getQuarterProgress, getQuarterInfo } from '@/lib/utils/quarter';
import { getAllPipelines, getStageNameMap } from '@/lib/hubspot/pipelines';
import { calculateDealRisk } from '@/lib/utils/deal-risk';
import { AEHeader } from '@/components/dashboard/ae-header';
import { MetricsCards } from '@/components/dashboard/metrics-cards';
import { ActivityStatsBar } from '@/components/dashboard/activity-stats-bar';
import { TargetProgress } from '@/components/dashboard/target-progress';
import { ForecastChart } from '@/components/dashboard/forecast-chart';
import { WeeklyPipelineChart } from '@/components/dashboard/weekly-pipeline-chart';
import { DealsTable } from '@/components/dashboard/deals-table';

interface PageProps {
  params: Promise<{ ownerId: string }>;
}

// Stage categories for classification
const CLOSED_WON_PATTERNS = ['closedwon', 'closed won', 'closed-won'];
const CLOSED_LOST_PATTERNS = ['closedlost', 'closed lost', 'closed-lost'];
const EXCLUDED_FROM_PIPELINE = ['mql', 'disqualified', 'qualified'];

export default async function AEDetailPage({ params }: PageProps) {
  const { ownerId } = await params;
  const supabase = await createServerSupabaseClient();

  // Get current quarter info
  const currentQ = getCurrentQuarter();
  const quarterInfo = getQuarterInfo(currentQ.year, currentQ.quarter);
  const progress = getQuarterProgress(quarterInfo);

  // Fetch owner
  const { data: owner, error: ownerError } = await supabase
    .from('owners')
    .select('id, first_name, last_name, email, hubspot_owner_id')
    .eq('id', ownerId)
    .single();

  if (ownerError || !owner) {
    notFound();
  }

  // Fetch quota, deals, and pipeline info in parallel
  const [quotaResult, dealsResult, pipelines, stageNames] = await Promise.all([
    supabase
      .from('quotas')
      .select('quota_amount')
      .eq('owner_id', ownerId)
      .eq('fiscal_year', currentQ.year)
      .eq('fiscal_quarter', currentQ.quarter)
      .single(),
    supabase
      .from('deals')
      .select('*')
      .eq('owner_id', ownerId)
      .order('amount', { ascending: false, nullsFirst: false }),
    getAllPipelines().catch(() => []),
    getStageNameMap().catch(() => new Map<string, string>()),
  ]);

  const quotaAmount = quotaResult.data?.quota_amount || 0;
  const deals = dealsResult.data || [];

  // Build stage classification sets from pipeline data
  const closedWonStages = new Set<string>();
  const closedLostStages = new Set<string>();
  const excludedStages = new Set<string>();

  for (const pipeline of pipelines) {
    for (const stage of pipeline.stages) {
      const stageIdLower = stage.id.toLowerCase();
      const stageLabelLower = stage.label.toLowerCase();

      if (stage.metadata.isClosed) {
        if (CLOSED_WON_PATTERNS.some((p) => stageIdLower.includes(p) || stageLabelLower.includes(p))) {
          closedWonStages.add(stage.id);
        } else if (CLOSED_LOST_PATTERNS.some((p) => stageIdLower.includes(p) || stageLabelLower.includes(p))) {
          closedLostStages.add(stage.id);
        }
      }

      if (EXCLUDED_FROM_PIPELINE.some((p) => stageIdLower.includes(p))) {
        excludedStages.add(stage.id);
      }
    }
  }

  // Helper functions for stage classification
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

  const isInPipeline = (stage: string | null, closeDate: string | null): boolean => {
    if (!stage) return false;
    if (isClosedWon(stage) || isClosedLost(stage)) return false;
    if (excludedStages.has(stage)) return false;
    const stageLower = stage.toLowerCase();
    if (EXCLUDED_FROM_PIPELINE.some((p) => stageLower.includes(p))) return false;
    // Only include deals with close dates in the current quarter
    return isInQuarter(closeDate);
  };

  const isInQuarter = (dateStr: string | null): boolean => {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    return date >= quarterInfo.startDate && date <= quarterInfo.endDate;
  };

  // Calculate metrics
  const closedWonDeals = deals.filter((deal) => isClosedWon(deal.deal_stage) && isInQuarter(deal.close_date));
  const closedWonAmount = closedWonDeals.reduce((sum, deal) => sum + (deal.amount || 0), 0);

  const pipelineDeals = deals.filter((deal) => isInPipeline(deal.deal_stage, deal.close_date));
  const pipelineValue = pipelineDeals.reduce((sum, deal) => sum + (deal.amount || 0), 0);

  const closedWonAll = deals.filter((deal) => isClosedWon(deal.deal_stage));
  const closedLostAll = deals.filter((deal) => isClosedLost(deal.deal_stage));
  const totalClosed = closedWonAll.length + closedLostAll.length;
  const winRate = totalClosed > 0 ? (closedWonAll.length / totalClosed) * 100 : 0;

  const avgDealSize =
    closedWonAll.length > 0
      ? closedWonAll.reduce((sum, deal) => sum + (deal.amount || 0), 0) / closedWonAll.length
      : 0;

  // Average sales cycle
  let avgSalesCycle: number | null = null;
  const dealsWithCycleTimes = closedWonAll.filter((deal) => deal.created_at && deal.close_date);
  if (dealsWithCycleTimes.length > 0) {
    const totalDays = dealsWithCycleTimes.reduce((sum, deal) => {
      const created = new Date(deal.created_at);
      const closed = new Date(deal.close_date!);
      const days = Math.ceil((closed.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
      return sum + Math.max(0, days);
    }, 0);
    avgSalesCycle = Math.round(totalDays / dealsWithCycleTimes.length);
  }

  // Quota and pace calculations
  const quotaProgress = quotaAmount > 0 ? (closedWonAmount / quotaAmount) * 100 : 0;
  const expectedByNow = quotaAmount * (progress.percentComplete / 100);
  const pace = closedWonAmount - expectedByNow;
  const onTrack = pace >= 0;

  // Build metrics data structure (same shape as API response)
  const metricsData = {
    owner: {
      id: owner.id,
      hubspotOwnerId: owner.hubspot_owner_id,
      firstName: owner.first_name,
      lastName: owner.last_name,
      email: owner.email,
      fullName: [owner.first_name, owner.last_name].filter(Boolean).join(' ') || owner.email,
    },
    quarter: {
      year: currentQ.year,
      quarter: currentQ.quarter,
      label: quarterInfo.label,
      startDate: quarterInfo.startDate.toISOString(),
      endDate: quarterInfo.endDate.toISOString(),
    },
    quarterProgress: {
      daysElapsed: progress.daysElapsed,
      totalDays: progress.totalDays,
      percentComplete: Math.round(progress.percentComplete * 10) / 10,
    },
    quota: {
      amount: quotaAmount,
      closedWon: closedWonAmount,
      progress: Math.round(quotaProgress * 10) / 10,
      hasQuota: quotaAmount > 0,
    },
    paceToGoal: {
      expectedByNow: Math.round(expectedByNow),
      actual: closedWonAmount,
      pace: Math.round(pace),
      onTrack,
    },
    pipeline: {
      totalValue: pipelineValue,
      dealCount: pipelineDeals.length,
    },
    activityStats: {
      avgDealSize: Math.round(avgDealSize),
      avgSalesCycle,
      winRate: Math.round(winRate * 10) / 10,
      totalDeals: deals.length,
      closedWonCount: closedWonAll.length,
      closedLostCount: closedLostAll.length,
    },
  };

  // Enrich deals with stage names and risk assessment
  const enrichedDeals = deals.map((deal) => {
    const stageName = deal.deal_stage ? stageNames.get(deal.deal_stage) || deal.deal_stage : null;

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

    return {
      id: deal.id,
      hubspotDealId: deal.hubspot_deal_id,
      dealName: deal.deal_name,
      amount: deal.amount,
      closeDate: deal.close_date,
      stage: deal.deal_stage,
      stageName,
      pipeline: deal.pipeline,
      description: deal.description,
      createdAt: deal.created_at,
      updatedAt: deal.updated_at,
      hubspotCreatedAt: deal.hubspot_created_at,
      leadSource: deal.lead_source,
      lastActivityDate: deal.last_activity_date,
      nextActivityDate: deal.next_activity_date,
      nextStep: deal.next_step,
      products: deal.products,
      dealSubstage: deal.deal_substage,
      nextStepAnalysis: deal.next_step_analyzed_at
        ? {
            status: deal.next_step_status,
            dueDate: deal.next_step_due_date,
            confidence: deal.next_step_confidence,
            displayMessage: deal.next_step_display_message,
            actionType: deal.next_step_action_type,
            analyzedAt: deal.next_step_analyzed_at,
          }
        : null,
      risk,
    };
  });

  return (
    <div className="p-8">
      {/* Header */}
      <AEHeader
        firstName={metricsData.owner.firstName}
        lastName={metricsData.owner.lastName}
        email={metricsData.owner.email}
      />

      {/* Quarter Info */}
      <div className="text-sm text-gray-500 mb-4">
        {metricsData.quarter.label} &bull; Day {metricsData.quarterProgress.daysElapsed} of{' '}
        {metricsData.quarterProgress.totalDays} ({metricsData.quarterProgress.percentComplete}% complete)
      </div>

      {/* Target Progress Banner */}
      <div className="mb-6">
        <TargetProgress ownerId={ownerId} />
      </div>

      {/* Forecast vs Actual Chart */}
      <div className="mb-6">
        <ForecastChart ownerId={ownerId} />
      </div>

      {/* Metrics Cards */}
      <MetricsCards
        quota={metricsData.quota}
        paceToGoal={metricsData.paceToGoal}
        pipeline={metricsData.pipeline}
        quarterProgress={metricsData.quarterProgress.percentComplete}
      />

      {/* Activity Stats */}
      <ActivityStatsBar
        avgDealSize={metricsData.activityStats.avgDealSize}
        avgSalesCycle={metricsData.activityStats.avgSalesCycle}
        winRate={metricsData.activityStats.winRate}
        totalDeals={metricsData.activityStats.totalDeals}
        closedWonCount={metricsData.activityStats.closedWonCount}
        closedLostCount={metricsData.activityStats.closedLostCount}
      />

      {/* Weekly Pipeline Chart */}
      <div className="mt-6">
        <WeeklyPipelineChart ownerId={ownerId} />
      </div>

      {/* Deals Table */}
      <div className="mt-6">
        <DealsTable deals={enrichedDeals} ownerId={ownerId} />
      </div>
    </div>
  );
}
