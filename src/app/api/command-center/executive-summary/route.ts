import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { computeQ2GoalTrackerData } from '@/lib/q2-goal-tracker/compute';
import { computePacingData } from '@/lib/command-center/compute-pacing';
import { computeInitiativeStatus } from '@/lib/command-center/compute-initiatives';
import { computeRollingForecast } from '@/lib/command-center/compute-forecast';
import { fetchQ2Deals } from '@/lib/command-center/fetch-q2-deals';
import { Q2_TEAM_TARGET } from '@/lib/command-center/config';

interface Insight {
  category: 'forecast' | 'pacing' | 'initiatives' | 'deals' | 'execution';
  status: 'on_track' | 'watch' | 'action_needed';
  title: string;
  detail: string;
}

export async function GET() {
  const authResult = await checkApiAuth(RESOURCES.Q2_COMMAND_CENTER);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  try {
    const [goalTracker, deals, initiatives] = await Promise.all([
      computeQ2GoalTrackerData(supabase),
      fetchQ2Deals(supabase),
      computeInitiativeStatus(supabase),
    ]);

    const pacing = await computePacingData(supabase, goalTracker);
    const closedWonARR = goalTracker.weeklyActuals.reduce((s, w) => s + w.closedWonARR, 0);
    const forecast = computeRollingForecast(deals, closedWonARR, Q2_TEAM_TARGET);
    const currentWeek = goalTracker.progress.currentWeek;

    const insights: Insight[] = [];

    // 1. Forecast vs target
    const projRatio = forecast.projectedTotal / forecast.target;
    if (projRatio >= 0.9) {
      insights.push({
        category: 'forecast',
        status: 'on_track',
        title: 'On pace to hit Q2 target',
        detail: `Projected ${fmt(forecast.projectedTotal)} against ${fmt(forecast.target)} target (${Math.round(projRatio * 100)}% coverage). Confidence: ${forecast.confidenceLevel}.`,
      });
    } else if (projRatio >= 0.7) {
      insights.push({
        category: 'forecast',
        status: 'watch',
        title: `Pipeline tracking ${Math.round((1 - projRatio) * 100)}% below target`,
        detail: `Projected ${fmt(forecast.projectedTotal)} against ${fmt(forecast.target)} target. Gap of ${fmt(forecast.gap)} needs to be closed.`,
      });
    } else {
      insights.push({
        category: 'forecast',
        status: 'action_needed',
        title: `Significant gap to Q2 target`,
        detail: `Projected ${fmt(forecast.projectedTotal)} against ${fmt(forecast.target)} target — only ${Math.round(projRatio * 100)}% coverage. ${fmt(forecast.gap)} gap requires immediate pipeline generation.`,
      });
    }

    // 2. Lead pacing
    const expectedLeads = Math.round(pacing.totalLeadsRequired * (currentWeek / 13));
    const leadRatio = expectedLeads > 0 ? pacing.totalLeadsCreated / expectedLeads : 0;
    if (leadRatio >= 0.9) {
      insights.push({
        category: 'pacing',
        status: 'on_track',
        title: 'Lead creation on pace',
        detail: `${pacing.totalLeadsCreated} leads created vs ${expectedLeads} expected by week ${currentWeek}.`,
      });
    } else {
      insights.push({
        category: 'pacing',
        status: leadRatio >= 0.6 ? 'watch' : 'action_needed',
        title: `Lead creation ${Math.round((1 - leadRatio) * 100)}% behind pace`,
        detail: `${pacing.totalLeadsCreated} leads created vs ${expectedLeads} expected. Need ${pacing.totalLeadsRequired} total for Q2.`,
      });
    }

    // 3. Initiative health
    for (const init of initiatives) {
      if (init.paceStatus === 'behind' && init.q2LeadTarget > 0) {
        insights.push({
          category: 'initiatives',
          status: 'action_needed',
          title: `${init.name} behind pace`,
          detail: `${init.leadsCreated} leads vs ${Math.round(init.expectedByNow)} expected. Target: ${init.q2LeadTarget} leads, ${fmt(init.q2ArrTarget)} ARR.`,
        });
      }
    }

    // 4. At-risk deals
    const dAndF = deals.filter((d) => d.overallGrade === 'D' || d.overallGrade === 'F');
    const dAndFArr = dAndF.reduce((s, d) => s + d.amount, 0);
    const totalPipelineArr = deals.reduce((s, d) => s + d.amount, 0);
    const riskPct = totalPipelineArr > 0 ? dAndFArr / totalPipelineArr : 0;

    if (dAndF.length > 0) {
      insights.push({
        category: 'deals',
        status: riskPct > 0.3 ? 'action_needed' : 'watch',
        title: `${dAndF.length} deals need attention (${Math.round(riskPct * 100)}% of pipeline ARR)`,
        detail: `${fmt(dAndFArr)} in D/F graded deals. Top: ${dAndF.slice(0, 2).map((d) => d.dealName).join(', ')}.`,
      });
    }

    // 5. Top risks — largest unlikely/insufficient_data deals
    const riskyDeals = deals
      .filter((d) => d.likelihoodTier === 'unlikely' || d.likelihoodTier === 'insufficient_data')
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3);

    if (riskyDeals.length > 0 && riskyDeals[0].amount > 10000) {
      insights.push({
        category: 'deals',
        status: 'watch',
        title: `${riskyDeals.length} large deals at risk`,
        detail: riskyDeals.map((d) => `${d.dealName} (${fmt(d.amount)})`).join(', '),
      });
    }

    // Sort: action_needed first, then watch, then on_track
    const statusOrder = { action_needed: 0, watch: 1, on_track: 2 };
    insights.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    return NextResponse.json({ insights, narrative: null });
  } catch (error) {
    console.error('Executive summary error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate summary' },
      { status: 500 },
    );
  }
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}
