import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { computeQ2GoalTrackerData } from '@/lib/q2-goal-tracker/compute';

export async function GET() {
  const authResult = await checkApiAuth(RESOURCES.Q2_GOAL_TRACKER);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const supabase = await createServerSupabaseClient();
    const data = await computeQ2GoalTrackerData(supabase);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Q2 Goal Tracker API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
