import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { getCurrentQuarter, getQuarterProgress, getQuarterInfo } from '@/lib/utils/quarter';
import { getAllPipelines } from '@/lib/hubspot/pipelines';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

interface RouteParams {
  params: Promise<{ ownerId: string }>;
}

// Stage categories - adjust based on your HubSpot pipeline configuration
// These are common patterns for closed stages
const CLOSED_WON_PATTERNS = ['closedwon', 'closed won', 'closed-won'];
const CLOSED_LOST_PATTERNS = ['closedlost', 'closed lost', 'closed-lost'];
const EXCLUDED_FROM_PIPELINE = ['mql', 'disqualified', 'qualified'];

// GET - Get all metrics for an AE
export async function GET(request: NextRequest, { params }: RouteParams) {
  // Check authorization
  const authResult = await checkApiAuth(RESOURCES.AE_DETAIL);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { ownerId } = await params;
    const supabase = await createServerSupabaseClient();

    // Get query params for specific quarter, or default to current
    const searchParams = request.nextUrl.searchParams;
    const currentQ = getCurrentQuarter();
    const fiscalYear = parseInt(searchParams.get('year') || String(currentQ.year));
    const fiscalQuarter = parseInt(searchParams.get('quarter') || String(currentQ.quarter));
    const quarterInfo = getQuarterInfo(fiscalYear, fiscalQuarter);

    // Verify owner exists
    const { data: owner, error: ownerError } = await supabase
      .from('owners')
      .select('id, first_name, last_name, email, hubspot_owner_id')
      .eq('id', ownerId)
      .single();

    if (ownerError || !owner) {
      return NextResponse.json(
        { error: 'Owner not found' },
        { status: 404 }
      );
    }

    // Get quota for this quarter
    const { data: quotaData } = await supabase
      .from('quotas')
      .select('quota_amount')
      .eq('owner_id', ownerId)
      .eq('fiscal_year', fiscalYear)
      .eq('fiscal_quarter', fiscalQuarter)
      .single();

    const quotaAmount = quotaData?.quota_amount || 0;

    // Get pipeline stages to identify closed-won stages
    const closedWonStages: Set<string> = new Set();
    const closedLostStages: Set<string> = new Set();
    const excludedStages: Set<string> = new Set();

    try {
      const pipelines = await getAllPipelines();
      for (const pipeline of pipelines) {
        for (const stage of pipeline.stages) {
          const stageIdLower = stage.id.toLowerCase();
          const stageLabelLower = stage.label.toLowerCase();

          // Check if closed stage
          if (stage.metadata.isClosed) {
            // Check if won or lost
            if (
              CLOSED_WON_PATTERNS.some(
                (p) => stageIdLower.includes(p) || stageLabelLower.includes(p)
              )
            ) {
              closedWonStages.add(stage.id);
            } else if (
              CLOSED_LOST_PATTERNS.some(
                (p) => stageIdLower.includes(p) || stageLabelLower.includes(p)
              )
            ) {
              closedLostStages.add(stage.id);
            }
          }

          // Check for excluded stages
          if (EXCLUDED_FROM_PIPELINE.some((p) => stageIdLower.includes(p))) {
            excludedStages.add(stage.id);
          }
        }
      }
    } catch (pipelineError) {
      console.warn('Could not fetch pipeline info, using stage name patterns:', pipelineError);
      // Fall back to pattern matching on deal_stage directly
    }

    // Get all deals for this owner
    const { data: allDeals } = await supabase
      .from('deals')
      .select('*')
      .eq('owner_id', ownerId);

    const deals = allDeals || [];

    // Helper to check if a stage is closed-won
    const isClosedWon = (stage: string | null): boolean => {
      if (!stage) return false;
      if (closedWonStages.has(stage)) return true;
      // Fallback to pattern matching
      const stageLower = stage.toLowerCase();
      return CLOSED_WON_PATTERNS.some((p) => stageLower.includes(p));
    };

    // Helper to check if a stage is closed-lost
    const isClosedLost = (stage: string | null): boolean => {
      if (!stage) return false;
      if (closedLostStages.has(stage)) return true;
      const stageLower = stage.toLowerCase();
      return CLOSED_LOST_PATTERNS.some((p) => stageLower.includes(p));
    };

    // Helper to check if a deal is in pipeline (not closed, not excluded, close date in quarter)
    const isInPipeline = (stage: string | null, closeDate: string | null): boolean => {
      if (!stage) return false;
      if (isClosedWon(stage) || isClosedLost(stage)) return false;
      if (excludedStages.has(stage)) return false;
      const stageLower = stage.toLowerCase();
      if (EXCLUDED_FROM_PIPELINE.some((p) => stageLower.includes(p))) return false;
      // Only include deals with close dates in the current quarter
      return isInQuarter(closeDate);
    };

    // Helper to check if a date is within the quarter
    const isInQuarter = (dateStr: string | null): boolean => {
      if (!dateStr) return false;
      const date = new Date(dateStr);
      return date >= quarterInfo.startDate && date <= quarterInfo.endDate;
    };

    // Calculate metrics
    // 1. Closed won deals this quarter
    const closedWonDeals = deals.filter(
      (deal) => isClosedWon(deal.deal_stage) && isInQuarter(deal.close_date)
    );
    const closedWonAmount = closedWonDeals.reduce((sum, deal) => sum + (deal.amount || 0), 0);

    // 2. Pipeline value (active deals with close date in current quarter)
    const pipelineDeals = deals.filter((deal) => isInPipeline(deal.deal_stage, deal.close_date));
    const pipelineValue = pipelineDeals.reduce((sum, deal) => sum + (deal.amount || 0), 0);

    // 3. All closed deals (for win rate calculation)
    const closedWonAll = deals.filter((deal) => isClosedWon(deal.deal_stage));
    const closedLostAll = deals.filter((deal) => isClosedLost(deal.deal_stage));
    const totalClosed = closedWonAll.length + closedLostAll.length;
    const winRate = totalClosed > 0 ? (closedWonAll.length / totalClosed) * 100 : 0;

    // 4. Average deal size (from closed won deals)
    const avgDealSize =
      closedWonAll.length > 0
        ? closedWonAll.reduce((sum, deal) => sum + (deal.amount || 0), 0) / closedWonAll.length
        : 0;

    // 5. Average sales cycle (days from created to closed)
    let avgSalesCycle: number | null = null;
    const dealsWithCycleTimes = closedWonAll.filter(
      (deal) => deal.created_at && deal.close_date
    );
    if (dealsWithCycleTimes.length > 0) {
      const totalDays = dealsWithCycleTimes.reduce((sum, deal) => {
        const created = new Date(deal.created_at);
        const closed = new Date(deal.close_date!);
        const days = Math.ceil((closed.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
        return sum + Math.max(0, days);
      }, 0);
      avgSalesCycle = Math.round(totalDays / dealsWithCycleTimes.length);
    }

    // 6. Quota progress
    const quotaProgress = quotaAmount > 0 ? (closedWonAmount / quotaAmount) * 100 : 0;

    // 7. Pace to goal
    const progress = getQuarterProgress(quarterInfo);
    const expectedByNow = quotaAmount * (progress.percentComplete / 100);
    const pace = closedWonAmount - expectedByNow;
    const onTrack = pace >= 0;

    // Build response
    return NextResponse.json({
      owner: {
        id: owner.id,
        hubspotOwnerId: owner.hubspot_owner_id,
        firstName: owner.first_name,
        lastName: owner.last_name,
        email: owner.email,
        fullName: [owner.first_name, owner.last_name].filter(Boolean).join(' ') || owner.email,
      },
      quarter: {
        year: fiscalYear,
        quarter: fiscalQuarter,
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
    });
  } catch (error) {
    console.error('Metrics API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
