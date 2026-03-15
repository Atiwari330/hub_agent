import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();

    // Get the most recent sync-hubspot workflow run (any status)
    const { data: lastRun } = await supabase
      .from('workflow_runs')
      .select('started_at, completed_at, status, result')
      .eq('workflow_name', 'sync-hubspot')
      .in('status', ['completed', 'failed'])
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    // Compute sync health from result
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = lastRun?.result as Record<string, any> | null;
    const health = !lastRun ? 'unknown'
      : lastRun.status === 'failed' ? 'failed'
      : (result?.dealErrors > 0 || result?.upsellDealErrors > 0) ? 'degraded'
      : 'healthy';

    return NextResponse.json({
      lastRun: lastRun?.completed_at || null,
      status: lastRun?.status || null,
      health,
      errorCounts: result ? {
        dealErrors: result.dealErrors || 0,
        upsellDealErrors: result.upsellDealErrors || 0,
      } : null,
    });
  } catch (error) {
    console.error('[sync-hubspot/status] Error fetching status:', error);
    return NextResponse.json({ lastRun: null, status: null, health: 'unknown', errorCounts: null });
  }
}
