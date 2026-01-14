import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { getAllPipelines } from '@/lib/hubspot/pipelines';
import { calculateDealRisk } from '@/lib/utils/deal-risk';
import { getCurrentQuarter, getQuarterInfo } from '@/lib/utils/quarter';

// Stage patterns
const CLOSED_WON_PATTERNS = ['closedwon', 'closed won', 'closed-won'];
const CLOSED_LOST_PATTERNS = ['closedlost', 'closed lost', 'closed-lost'];
const EXCLUDED_FROM_PIPELINE = ['mql', 'disqualified', 'qualified'];

// Expected days in stage (for velocity calculation)
const STAGE_EXPECTED_DAYS: Record<string, number> = {
  sql: 21,
  mql: 14,
  discovery: 14,
  'demo scheduled': 14,
  'demo - scheduled': 14,
  'demo completed': 14,
  'demo - completed': 14,
  proposal: 21,
  'proposal sent': 21,
  negotiation: 30,
  'contract sent': 14,
};

function getExpectedDays(stageName: string | null): number {
  if (!stageName) return 21;
  const lower = stageName.toLowerCase();
  if (STAGE_EXPECTED_DAYS[lower]) return STAGE_EXPECTED_DAYS[lower];
  if (lower.includes('demo')) return 14;
  if (lower.includes('proposal')) return 21;
  if (lower.includes('negotiat')) return 30;
  if (lower.includes('contract')) return 14;
  return 21;
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  d.setDate(diff);
  return d;
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

interface WeekMetrics {
  sqlCount: number;
  demoScheduledCount: number;
  demoCompletedCount: number;
  closedWonCount: number;
  closedWonAmount: number;
  closedLostCount: number;
}

interface AEComparison {
  id: string;
  name: string;
  initials: string;
  pipeline: number;
  activeDeals: number;
  winRate: number;
  avgCycle: number | null;
  stalePercent: number;
  status: 'green' | 'amber' | 'red';
}

interface StageVelocity {
  stageId: string;
  stageName: string;
  dealCount: number;
  avgDays: number;
  expectedDays: number;
  status: 'green' | 'amber' | 'red';
}

interface LeadSourcePerformance {
  source: string;
  dealCount: number;
  totalValue: number;
  avgValue: number;
  wonCount: number;
  winRate: number;
}

interface SentimentSummary {
  positive: number;
  neutral: number;
  negative: number;
  notableDeals: { name: string; amount: number; sentiment: string; reason: string }[];
}

export async function GET() {
  try {
    const supabase = createServiceClient();
    const now = new Date();
    const thisWeekStart = getWeekStart(now);
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);

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

    // Fetch all deals
    const { data: deals, error: dealsError } = await supabase
      .from('deals')
      .select('*')
      .in('owner_id', ownerIds);

    if (dealsError) {
      console.error('Error fetching deals:', dealsError);
      return NextResponse.json({ error: 'Failed to fetch deals' }, { status: 500 });
    }

    // Fetch sentiment analyses
    const dealIds = (deals || []).map((d) => d.id);
    const { data: sentiments } = await supabase
      .from('sentiment_analyses')
      .select('deal_id, sentiment_score, confidence, summary')
      .in('deal_id', dealIds)
      .order('analyzed_at', { ascending: false });

    const sentimentMap = new Map<string, { score: string; summary: string }>();
    (sentiments || []).forEach((s) => {
      if (!sentimentMap.has(s.deal_id)) {
        sentimentMap.set(s.deal_id, { score: s.sentiment_score, summary: s.summary || '' });
      }
    });

    // Fetch pipelines
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

    // Get current quarter info for pipeline filtering
    const currentQ = getCurrentQuarter();
    const quarterInfo = getQuarterInfo(currentQ.year, currentQ.quarter);

    const isInQuarter = (dateStr: string | null): boolean => {
      if (!dateStr) return false;
      const date = new Date(dateStr);
      return date >= quarterInfo.startDate && date <= quarterInfo.endDate;
    };

    const isInPipeline = (stage: string | null, closeDate: string | null): boolean => {
      if (!stage) return false;
      if (isClosedWon(stage) || isClosedLost(stage)) return false;
      const stageName = stageMap.get(stage) || stage;
      const stageLower = stageName.toLowerCase();
      if (EXCLUDED_FROM_PIPELINE.some((p) => stageLower.includes(p))) return false;
      // Only include deals with close dates in the current quarter
      return isInQuarter(closeDate);
    };

    const isInWeek = (dateStr: string | null, weekStart: Date): boolean => {
      if (!dateStr) return false;
      const date = new Date(dateStr);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      return date >= weekStart && date < weekEnd;
    };

    // Calculate weekly metrics
    function calculateWeekMetrics(weekStart: Date): WeekMetrics {
      const metrics: WeekMetrics = {
        sqlCount: 0,
        demoScheduledCount: 0,
        demoCompletedCount: 0,
        closedWonCount: 0,
        closedWonAmount: 0,
        closedLostCount: 0,
      };

      for (const deal of deals || []) {
        // SQL entries
        if (isInWeek(deal.sql_entered_at, weekStart)) {
          metrics.sqlCount++;
        }
        // Demo Scheduled entries
        if (isInWeek(deal.demo_scheduled_entered_at, weekStart)) {
          metrics.demoScheduledCount++;
        }
        // Demo Completed entries
        if (isInWeek(deal.demo_completed_entered_at, weekStart)) {
          metrics.demoCompletedCount++;
        }
        // Closed Won
        if (isClosedWon(deal.deal_stage) && isInWeek(deal.close_date, weekStart)) {
          metrics.closedWonCount++;
          metrics.closedWonAmount += deal.amount || 0;
        }
        // Closed Lost
        if (isClosedLost(deal.deal_stage) && isInWeek(deal.close_date, weekStart)) {
          metrics.closedLostCount++;
        }
      }

      return metrics;
    }

    const thisWeekMetrics = calculateWeekMetrics(thisWeekStart);
    const lastWeekMetrics = calculateWeekMetrics(lastWeekStart);

    // Calculate AE comparisons
    const aeComparisons: AEComparison[] = [];

    for (const owner of owners || []) {
      const ownerDeals = (deals || []).filter((d) => d.owner_id === owner.id);
      const pipelineDeals = ownerDeals.filter((d) => isInPipeline(d.deal_stage, d.close_date));
      const closedWonDeals = ownerDeals.filter((d) => isClosedWon(d.deal_stage));
      const closedLostDeals = ownerDeals.filter((d) => isClosedLost(d.deal_stage));

      const pipeline = pipelineDeals.reduce((sum, d) => sum + (d.amount || 0), 0);
      const totalClosed = closedWonDeals.length + closedLostDeals.length;
      const winRate = totalClosed > 0 ? (closedWonDeals.length / totalClosed) * 100 : 0;

      // Calculate avg sales cycle
      let avgCycle: number | null = null;
      const dealsWithCycle = closedWonDeals.filter((d) => d.hubspot_created_at && d.close_date);
      if (dealsWithCycle.length > 0) {
        const totalDays = dealsWithCycle.reduce((sum, d) => {
          const created = new Date(d.hubspot_created_at!);
          const closed = new Date(d.close_date!);
          return sum + Math.max(0, Math.ceil((closed.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)));
        }, 0);
        avgCycle = Math.round(totalDays / dealsWithCycle.length);
      }

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
        if (risk.level === 'stale') staleCount++;
      }

      const stalePercent = pipelineDeals.length > 0 ? (staleCount / pipelineDeals.length) * 100 : 0;

      // Determine status
      let status: 'green' | 'amber' | 'red' = 'green';
      if (stalePercent > 25 || winRate < 20) {
        status = 'red';
      } else if (stalePercent > 15 || winRate < 30 || (avgCycle && avgCycle > 50)) {
        status = 'amber';
      }

      aeComparisons.push({
        id: owner.id,
        name: getOwnerDisplayName(owner),
        initials: getOwnerInitials(owner),
        pipeline,
        activeDeals: pipelineDeals.length,
        winRate: Math.round(winRate * 10) / 10,
        avgCycle,
        stalePercent: Math.round(stalePercent * 10) / 10,
        status,
      });
    }

    // Calculate stage velocity
    const stageVelocityMap = new Map<string, { count: number; totalDays: number }>();
    const pipelineDeals = (deals || []).filter((d) => isInPipeline(d.deal_stage, d.close_date));

    for (const deal of pipelineDeals) {
      const stageId = deal.deal_stage || 'unknown';
      const stageName = stageMap.get(stageId) || stageId;

      // Calculate days in stage
      let daysInStage = 0;
      const stageEntry = deal.sql_entered_at || deal.demo_scheduled_entered_at ||
        deal.demo_completed_entered_at || deal.hubspot_created_at;

      if (stageEntry) {
        daysInStage = Math.floor((now.getTime() - new Date(stageEntry).getTime()) / (1000 * 60 * 60 * 24));
      }

      const existing = stageVelocityMap.get(stageId);
      if (existing) {
        existing.count++;
        existing.totalDays += daysInStage;
      } else {
        stageVelocityMap.set(stageId, { count: 1, totalDays: daysInStage });
      }
    }

    const stageVelocity: StageVelocity[] = [];
    stageVelocityMap.forEach((data, stageId) => {
      const stageName = stageMap.get(stageId) || stageId;
      const avgDays = Math.round(data.totalDays / data.count);
      const expectedDays = getExpectedDays(stageName);

      let status: 'green' | 'amber' | 'red' = 'green';
      if (avgDays >= expectedDays * 2) {
        status = 'red';
      } else if (avgDays >= expectedDays * 1.5) {
        status = 'amber';
      }

      stageVelocity.push({
        stageId,
        stageName,
        dealCount: data.count,
        avgDays,
        expectedDays,
        status,
      });
    });

    stageVelocity.sort((a, b) => b.dealCount - a.dealCount);

    // Calculate lead source performance
    const leadSourceMap = new Map<string, {
      count: number;
      value: number;
      wonCount: number;
    }>();

    for (const deal of deals || []) {
      const source = deal.lead_source || 'Unknown';
      const existing = leadSourceMap.get(source);
      const isWon = isClosedWon(deal.deal_stage);

      if (existing) {
        existing.count++;
        existing.value += deal.amount || 0;
        if (isWon) existing.wonCount++;
      } else {
        leadSourceMap.set(source, {
          count: 1,
          value: deal.amount || 0,
          wonCount: isWon ? 1 : 0,
        });
      }
    }

    const leadSourcePerformance: LeadSourcePerformance[] = [];
    leadSourceMap.forEach((data, source) => {
      leadSourcePerformance.push({
        source,
        dealCount: data.count,
        totalValue: data.value,
        avgValue: data.count > 0 ? Math.round(data.value / data.count) : 0,
        wonCount: data.wonCount,
        winRate: data.count > 0 ? Math.round((data.wonCount / data.count) * 1000) / 10 : 0,
      });
    });

    leadSourcePerformance.sort((a, b) => b.totalValue - a.totalValue);

    // Calculate sentiment summary
    const sentimentSummary: SentimentSummary = {
      positive: 0,
      neutral: 0,
      negative: 0,
      notableDeals: [],
    };

    for (const deal of pipelineDeals) {
      const sentiment = sentimentMap.get(deal.id);
      if (sentiment) {
        if (sentiment.score === 'positive') sentimentSummary.positive++;
        else if (sentiment.score === 'neutral') sentimentSummary.neutral++;
        else if (sentiment.score === 'negative') {
          sentimentSummary.negative++;
          if ((deal.amount || 0) >= 50000) {
            sentimentSummary.notableDeals.push({
              name: deal.deal_name,
              amount: deal.amount || 0,
              sentiment: 'negative',
              reason: sentiment.summary.slice(0, 100),
            });
          }
        }
      }
    }

    // Format week labels
    const formatWeekLabel = (date: Date): string => {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    return NextResponse.json({
      thisWeek: {
        label: `Week of ${formatWeekLabel(thisWeekStart)}`,
        startDate: thisWeekStart.toISOString(),
        metrics: thisWeekMetrics,
      },
      lastWeek: {
        label: `Week of ${formatWeekLabel(lastWeekStart)}`,
        startDate: lastWeekStart.toISOString(),
        metrics: lastWeekMetrics,
      },
      deltas: {
        sqlCount: thisWeekMetrics.sqlCount - lastWeekMetrics.sqlCount,
        demoScheduledCount: thisWeekMetrics.demoScheduledCount - lastWeekMetrics.demoScheduledCount,
        demoCompletedCount: thisWeekMetrics.demoCompletedCount - lastWeekMetrics.demoCompletedCount,
        closedWonCount: thisWeekMetrics.closedWonCount - lastWeekMetrics.closedWonCount,
        closedWonAmount: thisWeekMetrics.closedWonAmount - lastWeekMetrics.closedWonAmount,
        closedLostCount: thisWeekMetrics.closedLostCount - lastWeekMetrics.closedLostCount,
      },
      aeComparisons: aeComparisons.sort((a, b) => b.pipeline - a.pipeline),
      stageVelocity: stageVelocity.slice(0, 8),
      leadSourcePerformance: leadSourcePerformance.slice(0, 6),
      sentimentSummary,
    });
  } catch (error) {
    console.error('Error in weekly summary:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
