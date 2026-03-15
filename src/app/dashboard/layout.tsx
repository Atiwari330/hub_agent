import { createServerSupabaseClient } from '@/lib/supabase/client';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { getCurrentQuarter, getQuarterProgress } from '@/lib/utils/quarter';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { requireAuth } from '@/lib/auth';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Require authentication for all dashboard pages
  const user = await requireAuth();

  const supabase = await createServerSupabaseClient();

  // Target AEs to show in sidebar (from centralized sync config)
  const TARGET_AE_EMAILS = SYNC_CONFIG.TARGET_AE_EMAILS;

  // Fetch owners and last sync in parallel
  const [ownersResult, lastSyncResult] = await Promise.all([
    supabase
      .from('owners')
      .select('id, first_name, last_name, email')
      .in('email', TARGET_AE_EMAILS)
      .order('last_name', { ascending: true }),
    supabase
      .from('workflow_runs')
      .select('completed_at, status, result')
      .eq('workflow_name', 'sync-hubspot')
      .in('status', ['completed', 'failed'])
      .order('started_at', { ascending: false })
      .limit(1),
  ]);

  const owners = ownersResult.data || [];
  const lastSyncRow = lastSyncResult.data?.[0];
  const lastSync = lastSyncRow?.status === 'completed' ? lastSyncRow.completed_at : null;

  // Check if data is stale (>1 hour since last sync)
  const isStale = !lastSync ||
    (Date.now() - new Date(lastSync).getTime() > 60 * 60 * 1000);

  // Compute sync health from most recent run
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = lastSyncRow?.result as Record<string, any> | null;
  const syncHealth: 'healthy' | 'degraded' | 'failed' | 'unknown' = !lastSyncRow ? 'unknown'
    : lastSyncRow.status === 'failed' ? 'failed'
    : (result?.dealErrors > 0 || result?.upsellDealErrors > 0) ? 'degraded'
    : 'healthy';

  const quarter = getCurrentQuarter();
  const progress = getQuarterProgress(quarter);

  return (
    <DashboardShell
      owners={owners}
      lastSync={lastSync}
      quarterLabel={quarter.label}
      quarterProgress={progress.percentComplete}
      user={user}
      isStale={isStale}
      syncHealth={syncHealth}
    >
      {children}
    </DashboardShell>
  );
}
