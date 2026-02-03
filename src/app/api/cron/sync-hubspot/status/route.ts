import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();

    // Get the most recent successful sync-hubspot workflow run
    const { data: lastRun } = await supabase
      .from('workflow_runs')
      .select('started_at, completed_at, status')
      .eq('workflow_name', 'sync-hubspot')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single();

    return NextResponse.json({
      lastRun: lastRun?.completed_at || null,
      status: lastRun?.status || null,
    });
  } catch (error) {
    console.error('[sync-hubspot/status] Error fetching status:', error);
    return NextResponse.json({ lastRun: null, status: null });
  }
}
