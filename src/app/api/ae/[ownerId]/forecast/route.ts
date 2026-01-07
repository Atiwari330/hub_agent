import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { getCurrentQuarter, getQuarterInfo } from '@/lib/utils/quarter';
import {
  calculateWeeklyForecast,
  calculateVariance,
  getCurrentWeekInQuarter,
} from '@/lib/utils/forecast';

interface RouteParams {
  params: Promise<{ ownerId: string }>;
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

    // Validate quarter
    if (quarter < 1 || quarter > 4) {
      return NextResponse.json({ error: 'Quarter must be between 1 and 4' }, { status: 400 });
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

    // Calculate weekly forecast targets
    const forecastWeeks = calculateWeeklyForecast(quotaAmount);

    // Query closed-won deals for this owner
    const { data: deals, error: dealsError } = await supabase
      .from('deals')
      .select('id, deal_name, amount, deal_stage, close_date')
      .eq('owner_id', ownerId);

    if (dealsError) {
      console.error('Error fetching deals:', dealsError);
      return NextResponse.json(
        { error: 'Failed to fetch deals', details: dealsError.message },
        { status: 500 }
      );
    }

    // Filter to closed-won deals in this quarter
    const closedWonDeals = (deals || []).filter((deal) => {
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

    // Generate week boundaries
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

    // Get current week number
    const currentWeekNum = getCurrentWeekInQuarter(quarterInfo.startDate);
    const currentWeekData = weeks.find((w) => w.weekNumber === currentWeekNum);

    // Calculate summary
    const totalClosedWon = closedWonDeals.reduce((sum, d) => sum + (d.amount || 0), 0);
    const forecastToDate = currentWeekData?.forecast || 0;
    const summaryVariance = calculateVariance(totalClosedWon, forecastToDate);

    return NextResponse.json({
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
      weeks,
      summary: {
        currentWeek: currentWeekNum,
        forecastToDate,
        actualToDate: Math.round(totalClosedWon),
        variance: summaryVariance.variance,
        percentOfForecast: Math.round(summaryVariance.percentOfForecast),
        status: summaryVariance.status,
        totalDeals: closedWonDeals.length,
      },
    });
  } catch (error) {
    console.error('Forecast API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
