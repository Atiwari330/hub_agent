import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { getCurrentQuarter, getQuarterInfo } from '@/lib/utils/quarter';
import {
  calculateWeeklyForecast,
  calculateVariance,
  getCurrentWeekInQuarter,
  calculateAllStageForecuts,
  DEFAULT_AVG_DEAL_SIZE,
  type ForecastStage,
} from '@/lib/utils/forecast';

interface RouteParams {
  params: Promise<{ ownerId: string }>;
}

// Type definitions for forecast calculations
interface DealRecord {
  id: string;
  deal_name: string | null;
  amount: number | null;
  deal_stage: string | null;
  close_date: string | null;
  sql_entered_at: string | null;
  demo_scheduled_entered_at: string | null;
  demo_completed_entered_at: string | null;
  closed_won_entered_at: string | null;
}

interface QuarterInfo {
  startDate: Date;
  endDate: Date;
  label: string;
}

interface OwnerRecord {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

interface StageTargets {
  dealsNeeded: number;
  proposalsNeeded: number;
  demosNeeded: number;
  sqlsNeeded: number;
}

interface StageWeeklyForecastItem {
  weekNumber: number;
  weeklyTarget: number;
  cumulativeTarget: number;
}

interface AllStageForecasts {
  targets: StageTargets;
  forecasts: {
    sql: StageWeeklyForecastItem[];
    demo: StageWeeklyForecastItem[];
    proposal: StageWeeklyForecastItem[];
  };
}

// Closed-won stage detection patterns
const CLOSED_WON_PATTERNS = ['closedwon', 'closed won', 'closed-won'];

function isClosedWonStage(stage: string | null): boolean {
  if (!stage) return false;
  const stageLower = stage.toLowerCase();
  return CLOSED_WON_PATTERNS.some((p) => stageLower.includes(p));
}

// Get week number within quarter (1-13)
function getWeekNumberInQuarter(date: Date, quarterStart: Date): number {
  const diffMs = date.getTime() - quarterStart.getTime();
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return Math.max(1, Math.min(13, diffWeeks + 1));
}

// Get start of week (Monday)
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

// Get end of week (Sunday)
function getWeekEnd(date: Date): Date {
  const weekStart = getWeekStart(date);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  return weekEnd;
}

// Format date as YYYY-MM-DD
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

// GET - Get forecast vs actual data for an AE
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { ownerId } = await params;
    const supabase = await createServerSupabaseClient();

    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString());
    const quarter = parseInt(searchParams.get('quarter') || getCurrentQuarter().quarter.toString());
    const stage = (searchParams.get('stage') || 'arr') as ForecastStage;

    // Validate quarter
    if (quarter < 1 || quarter > 4) {
      return NextResponse.json({ error: 'Quarter must be between 1 and 4' }, { status: 400 });
    }

    // Validate stage
    if (!['arr', 'sql', 'demo', 'proposal'].includes(stage)) {
      return NextResponse.json({ error: 'Stage must be arr, sql, demo, or proposal' }, { status: 400 });
    }

    // Get quarter info
    const quarterInfo = getQuarterInfo(year, quarter);

    // Verify owner exists
    const { data: owner, error: ownerError } = await supabase
      .from('owners')
      .select('id, first_name, last_name, email')
      .eq('id', ownerId)
      .single();

    if (ownerError || !owner) {
      return NextResponse.json({ error: 'Owner not found' }, { status: 404 });
    }

    // Get AE quota for this quarter
    const { data: target } = await supabase
      .from('ae_targets')
      .select('target_amount')
      .eq('owner_id', ownerId)
      .eq('fiscal_year', year)
      .eq('fiscal_quarter', quarter)
      .single();

    const { data: quota } = await supabase
      .from('quotas')
      .select('quota_amount')
      .eq('owner_id', ownerId)
      .eq('fiscal_year', year)
      .eq('fiscal_quarter', quarter)
      .single();

    const quotaAmount = target?.target_amount || quota?.quota_amount || 100000;

    // Query deals for this owner with stage timestamps
    const { data: deals, error: dealsError } = await supabase
      .from('deals')
      .select(`
        id,
        deal_name,
        amount,
        deal_stage,
        close_date,
        sql_entered_at,
        demo_scheduled_entered_at,
        demo_completed_entered_at,
        closed_won_entered_at
      `)
      .eq('owner_id', ownerId);

    if (dealsError) {
      console.error('Error fetching deals:', dealsError);
      return NextResponse.json(
        { error: 'Failed to fetch deals', details: dealsError.message },
        { status: 500 }
      );
    }

    // Calculate stage forecasts
    const stageForecasts = calculateAllStageForecuts(quotaAmount, DEFAULT_AVG_DEAL_SIZE);

    // Get current week number
    const currentWeekNum = getCurrentWeekInQuarter(quarterInfo.startDate);

    // Handle different stages
    if (stage === 'arr') {
      return handleArrForecast(
        deals || [],
        quotaAmount,
        quarterInfo,
        currentWeekNum,
        owner,
        year,
        quarter,
        stageForecasts.targets
      );
    } else {
      return handleStageForecast(
        stage,
        deals || [],
        quotaAmount,
        quarterInfo,
        currentWeekNum,
        owner,
        year,
        quarter,
        stageForecasts
      );
    }
  } catch (error) {
    console.error('Forecast API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Handle ARR forecast (closed-won revenue)
function handleArrForecast(
  deals: DealRecord[],
  quotaAmount: number,
  quarterInfo: QuarterInfo,
  currentWeekNum: number,
  owner: OwnerRecord,
  year: number,
  quarter: number,
  targets: StageTargets
) {
  const forecastWeeks = calculateWeeklyForecast(quotaAmount);

  // Filter to closed-won deals in this quarter
  const closedWonDeals = deals.filter((deal) => {
    if (!isClosedWonStage(deal.deal_stage)) return false;
    if (!deal.close_date) return false;
    const closeDate = new Date(deal.close_date);
    return closeDate >= quarterInfo.startDate && closeDate <= quarterInfo.endDate;
  });

  // Calculate actual closed-won amount per week
  const weeklyActuals = new Map<number, number>();
  for (let i = 1; i <= 13; i++) {
    weeklyActuals.set(i, 0);
  }

  for (const deal of closedWonDeals) {
    const closeDate = new Date(deal.close_date!);
    const weekNum = getWeekNumberInQuarter(closeDate, quarterInfo.startDate);
    const current = weeklyActuals.get(weekNum) || 0;
    weeklyActuals.set(weekNum, current + (deal.amount || 0));
  }

  // Build cumulative actuals
  let cumulativeActual = 0;
  const weeks = [];
  const currentDate = new Date(quarterInfo.startDate);
  let weekNum = 1;

  while (currentDate <= quarterInfo.endDate && weekNum <= 13) {
    const weekStart = getWeekStart(currentDate);
    const weekEnd = getWeekEnd(currentDate);
    const weeklyAmount = weeklyActuals.get(weekNum) || 0;
    cumulativeActual += weeklyAmount;

    const forecast = forecastWeeks[weekNum - 1];
    const variance = calculateVariance(cumulativeActual, forecast.cumulativeTarget);

    weeks.push({
      weekNumber: weekNum,
      weekStart: formatDate(weekStart),
      weekEnd: formatDate(weekEnd),
      forecast: forecast.cumulativeTarget,
      actual: Math.round(cumulativeActual),
      weeklyActual: Math.round(weeklyAmount),
      weeklyForecast: forecast.weeklyTarget,
      variance: variance.variance,
      percentOfForecast: Math.round(variance.percentOfForecast),
      status: variance.status,
    });

    currentDate.setDate(currentDate.getDate() + 7);
    weekNum++;
  }

  const currentWeekData = weeks.find((w) => w.weekNumber === currentWeekNum);
  const totalClosedWon = closedWonDeals.reduce((sum, d) => sum + (d.amount || 0), 0);
  const forecastToDate = currentWeekData?.forecast || 0;
  const summaryVariance = calculateVariance(totalClosedWon, forecastToDate);

  return NextResponse.json({
    stage: 'arr',
    stageLabel: 'Closed Won ARR',
    unit: 'currency',
    owner: {
      id: owner.id,
      firstName: owner.first_name,
      lastName: owner.last_name,
      email: owner.email,
    },
    quarter: {
      year,
      quarter,
      label: quarterInfo.label,
      startDate: formatDate(quarterInfo.startDate),
      endDate: formatDate(quarterInfo.endDate),
    },
    quota: quotaAmount,
    targets,
    weeks,
    summary: {
      currentWeek: currentWeekNum,
      forecastToDate,
      actualToDate: Math.round(totalClosedWon),
      variance: summaryVariance.variance,
      percentOfForecast: Math.round(summaryVariance.percentOfForecast),
      status: summaryVariance.status,
      totalCount: closedWonDeals.length,
    },
  });
}

// Handle stage forecast (SQL, Demo, Proposal counts)
function handleStageForecast(
  stage: 'sql' | 'demo' | 'proposal',
  deals: DealRecord[],
  quotaAmount: number,
  quarterInfo: QuarterInfo,
  currentWeekNum: number,
  owner: OwnerRecord,
  year: number,
  quarter: number,
  stageForecasts: AllStageForecasts
) {
  // Map stage to timestamp field
  const stageConfig = {
    sql: {
      field: 'sql_entered_at',
      label: 'SQLs',
      forecast: stageForecasts.forecasts.sql,
      target: stageForecasts.targets.sqlsNeeded,
    },
    demo: {
      field: 'demo_completed_entered_at',
      label: 'Demos Completed',
      forecast: stageForecasts.forecasts.demo,
      target: stageForecasts.targets.demosNeeded,
    },
    proposal: {
      field: 'deal_stage',
      label: 'Proposals',
      forecast: stageForecasts.forecasts.proposal,
      target: stageForecasts.targets.proposalsNeeded,
    },
  };

  const config = stageConfig[stage];

  // Count deals entering this stage per week
  const weeklyActuals = new Map<number, number>();
  for (let i = 1; i <= 13; i++) {
    weeklyActuals.set(i, 0);
  }

  for (const deal of deals) {
    let enteredAt: Date | null = null;

    if (stage === 'sql' && deal.sql_entered_at) {
      enteredAt = new Date(deal.sql_entered_at);
    } else if (stage === 'demo' && deal.demo_completed_entered_at) {
      enteredAt = new Date(deal.demo_completed_entered_at);
    } else if (stage === 'proposal') {
      // For proposals, check if deal is in proposal stage or beyond
      // Use demo_completed_entered_at as proxy (they got a proposal after demo)
      // Or check if stage contains 'proposal'
      const dealStage = (deal.deal_stage || '').toLowerCase();
      if (dealStage.includes('proposal') || dealStage.includes('negotiation')) {
        // Use demo_completed date + some offset, or just count if in quarter
        if (deal.demo_completed_entered_at) {
          enteredAt = new Date(deal.demo_completed_entered_at);
          // Add 1 week to approximate proposal timing
          enteredAt.setDate(enteredAt.getDate() + 7);
        }
      }
    }

    if (enteredAt && enteredAt >= quarterInfo.startDate && enteredAt <= quarterInfo.endDate) {
      const weekNum = getWeekNumberInQuarter(enteredAt, quarterInfo.startDate);
      const current = weeklyActuals.get(weekNum) || 0;
      weeklyActuals.set(weekNum, current + 1);
    }
  }

  // Build cumulative actuals
  let cumulativeActual = 0;
  const weeks = [];
  const currentDate = new Date(quarterInfo.startDate);
  let weekNum = 1;

  while (currentDate <= quarterInfo.endDate && weekNum <= 13) {
    const weekStart = getWeekStart(currentDate);
    const weekEnd = getWeekEnd(currentDate);
    const weeklyCount = weeklyActuals.get(weekNum) || 0;
    cumulativeActual += weeklyCount;

    const forecast = config.forecast[weekNum - 1];
    const variance = calculateVariance(cumulativeActual, forecast.cumulativeTarget);

    weeks.push({
      weekNumber: weekNum,
      weekStart: formatDate(weekStart),
      weekEnd: formatDate(weekEnd),
      forecast: forecast.cumulativeTarget,
      actual: cumulativeActual,
      weeklyActual: weeklyCount,
      weeklyForecast: forecast.weeklyTarget,
      variance: variance.variance,
      percentOfForecast: Math.round(variance.percentOfForecast),
      status: variance.status,
    });

    currentDate.setDate(currentDate.getDate() + 7);
    weekNum++;
  }

  const currentWeekData = weeks.find((w) => w.weekNumber === currentWeekNum);
  const totalActual = cumulativeActual;
  const forecastToDate = currentWeekData?.forecast || 0;
  const summaryVariance = calculateVariance(totalActual, forecastToDate);

  return NextResponse.json({
    stage,
    stageLabel: config.label,
    unit: 'count',
    owner: {
      id: owner.id,
      firstName: owner.first_name,
      lastName: owner.last_name,
      email: owner.email,
    },
    quarter: {
      year,
      quarter,
      label: quarterInfo.label,
      startDate: formatDate(quarterInfo.startDate),
      endDate: formatDate(quarterInfo.endDate),
    },
    quota: quotaAmount,
    targets: stageForecasts.targets,
    targetForStage: config.target,
    weeks,
    summary: {
      currentWeek: currentWeekNum,
      forecastToDate,
      actualToDate: totalActual,
      variance: summaryVariance.variance,
      percentOfForecast: Math.round(summaryVariance.percentOfForecast),
      status: summaryVariance.status,
      totalCount: totalActual,
    },
  });
}
