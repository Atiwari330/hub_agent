import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { computeQ2GoalTrackerData } from '@/lib/q2-goal-tracker/compute';
import { computePacingData } from '@/lib/command-center/compute-pacing';
import { computeInitiativeStatus } from '@/lib/command-center/compute-initiatives';
import type { CommandCenterResponse } from '@/lib/command-center/types';

export async function GET() {
  const authResult = await checkApiAuth(RESOURCES.Q2_COMMAND_CENTER);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const supabase = await createServerSupabaseClient();

    const [goalTracker, initiatives] = await Promise.all([
      computeQ2GoalTrackerData(supabase),
      computeInitiativeStatus(supabase),
    ]);

    const pacing = await computePacingData(supabase, goalTracker);

    const response: CommandCenterResponse = {
      goalTracker,
      pacing,
      initiatives,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Command Center error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to compute command center data' },
      { status: 500 }
    );
  }
}
