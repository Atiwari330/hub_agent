import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { getCurrentQuarter, getQuarterInfo } from '@/lib/utils/quarter';

interface RouteParams {
  params: Promise<{ ownerId: string }>;
}

interface WeeklyStageData {
  weekStart: string;
  weekEnd: string;
  weekNumber: number;
  sql: number;
  demoScheduled: number;
  demoCompleted: number;
  closedWon: number;
  closedWonAmount: number;
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
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
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

// Closed-won stage detection patterns (same as metrics endpoint)
const CLOSED_WON_PATTERNS = ['closedwon', 'closed won', 'closed-won'];

function isClosedWonStage(stage: string | null): boolean {
  if (!stage) return false;
  const stageLower = stage.toLowerCase();
  return CLOSED_WON_PATTERNS.some((p) => stageLower.includes(p));
}

function isDateInQuarter(dateStr: string | null, quarterStart: Date, quarterEnd: Date): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  return date >= quarterStart && date <= quarterEnd;
}

// GET - Get weekly pipeline data for an AE
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

    // Query deals with stage entry timestamps for this owner in the quarter
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

    // Generate week buckets for the quarter
    const weeklyData: Map<number, WeeklyStageData> = new Map();

    // Initialize all weeks in the quarter
    const currentDate = new Date(quarterInfo.startDate);
    let weekNum = 1;
    while (currentDate <= quarterInfo.endDate && weekNum <= 13) {
      const weekStart = getWeekStart(currentDate);
      const weekEnd = getWeekEnd(currentDate);

      weeklyData.set(weekNum, {
        weekStart: formatDate(weekStart),
        weekEnd: formatDate(weekEnd),
        weekNumber: weekNum,
        sql: 0,
        demoScheduled: 0,
        demoCompleted: 0,
        closedWon: 0,
        closedWonAmount: 0,
      });

      // Move to next week
      currentDate.setDate(currentDate.getDate() + 7);
      weekNum++;
    }

    // Count deals per week per stage
    for (const deal of deals || []) {
      // SQL stage
      if (deal.sql_entered_at) {
        const enteredDate = new Date(deal.sql_entered_at);
        if (enteredDate >= quarterInfo.startDate && enteredDate <= quarterInfo.endDate) {
          const week = getWeekNumberInQuarter(enteredDate, quarterInfo.startDate);
          const weekData = weeklyData.get(week);
          if (weekData) weekData.sql++;
        }
      }

      // Demo Scheduled stage
      if (deal.demo_scheduled_entered_at) {
        const enteredDate = new Date(deal.demo_scheduled_entered_at);
        if (enteredDate >= quarterInfo.startDate && enteredDate <= quarterInfo.endDate) {
          const week = getWeekNumberInQuarter(enteredDate, quarterInfo.startDate);
          const weekData = weeklyData.get(week);
          if (weekData) weekData.demoScheduled++;
        }
      }

      // Demo Completed stage
      if (deal.demo_completed_entered_at) {
        const enteredDate = new Date(deal.demo_completed_entered_at);
        if (enteredDate >= quarterInfo.startDate && enteredDate <= quarterInfo.endDate) {
          const week = getWeekNumberInQuarter(enteredDate, quarterInfo.startDate);
          const weekData = weeklyData.get(week);
          if (weekData) weekData.demoCompleted++;
        }
      }

      // Closed Won stage
      if (deal.closed_won_entered_at) {
        const enteredDate = new Date(deal.closed_won_entered_at);
        if (enteredDate >= quarterInfo.startDate && enteredDate <= quarterInfo.endDate) {
          const week = getWeekNumberInQuarter(enteredDate, quarterInfo.startDate);
          const weekData = weeklyData.get(week);
          if (weekData) {
            weekData.closedWon++;
            weekData.closedWonAmount += deal.amount || 0;
          }
        }
      }
    }

    // Get AE target for this quarter
    const { data: target } = await supabase
      .from('ae_targets')
      .select('target_amount')
      .eq('owner_id', ownerId)
      .eq('fiscal_year', year)
      .eq('fiscal_quarter', quarter)
      .single();

    // Also check quotas table for backward compatibility
    const { data: quota } = await supabase
      .from('quotas')
      .select('quota_amount')
      .eq('owner_id', ownerId)
      .eq('fiscal_year', year)
      .eq('fiscal_quarter', quarter)
      .single();

    const targetAmount = target?.target_amount || quota?.quota_amount || 100000;

    // Calculate totals from weekly data (for chart display)
    const weeks = Array.from(weeklyData.values());
    const totalSql = weeks.reduce((sum, w) => sum + w.sql, 0);
    const totalDemoScheduled = weeks.reduce((sum, w) => sum + w.demoScheduled, 0);
    const totalDemoCompleted = weeks.reduce((sum, w) => sum + w.demoCompleted, 0);
    const totalClosedWon = weeks.reduce((sum, w) => sum + w.closedWon, 0);
    const totalClosedWonAmountFromTimestamps = weeks.reduce((sum, w) => sum + w.closedWonAmount, 0);

    // Calculate closed-won amount using stage + close_date (same logic as metrics endpoint)
    // This ensures consistency with the Quota Progress card
    const closedWonDeals = (deals || []).filter(
      (deal) => isClosedWonStage(deal.deal_stage) && isDateInQuarter(deal.close_date, quarterInfo.startDate, quarterInfo.endDate)
    );
    const totalClosedWonAmount = closedWonDeals.reduce((sum, deal) => sum + (deal.amount || 0), 0);

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
      target: {
        amount: targetAmount,
        closedAmount: totalClosedWonAmount,
        percentComplete: targetAmount > 0 ? (totalClosedWonAmount / targetAmount) * 100 : 0,
        onTrack: totalClosedWonAmount >= targetAmount,
      },
      weeks,
      totals: {
        sql: totalSql,
        demoScheduled: totalDemoScheduled,
        demoCompleted: totalDemoCompleted,
        closedWon: totalClosedWon,
        closedWonAmount: totalClosedWonAmount,
      },
    });
  } catch (error) {
    console.error('Weekly pipeline API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
