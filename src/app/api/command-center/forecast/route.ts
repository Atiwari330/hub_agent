import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { computeQ2GoalTrackerData } from '@/lib/q2-goal-tracker/compute';
import { computeRollingForecast } from '@/lib/command-center/compute-forecast';
import { fetchQ2Deals } from '@/lib/command-center/fetch-q2-deals';
import { Q2_TEAM_TARGET } from '@/lib/command-center/config';

export async function GET() {
  const authResult = await checkApiAuth(RESOURCES.Q2_COMMAND_CENTER);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  try {
    const [goalTracker, deals] = await Promise.all([
      computeQ2GoalTrackerData(supabase),
      fetchQ2Deals(supabase),
    ]);

    const closedWonARR = goalTracker.weeklyActuals.reduce((s, w) => s + w.closedWonARR, 0);
    const forecast = computeRollingForecast(deals, closedWonARR, Q2_TEAM_TARGET);

    return NextResponse.json(forecast);
  } catch (error) {
    console.error('Forecast API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to compute forecast' },
      { status: 500 },
    );
  }
}
