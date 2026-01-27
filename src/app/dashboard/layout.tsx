import { createServerSupabaseClient } from '@/lib/supabase/client';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { getCurrentQuarter, getQuarterProgress } from '@/lib/utils/quarter';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
      .select('completed_at')
      .eq('workflow_name', 'sync-hubspot')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1),
  ]);

  const owners = ownersResult.data || [];
  const lastSync = lastSyncResult.data?.[0]?.completed_at || null;

  const quarter = getCurrentQuarter();
  const progress = getQuarterProgress(quarter);

  return (
    <DashboardShell
      owners={owners}
      lastSync={lastSync}
      quarterLabel={quarter.label}
      quarterProgress={progress.percentComplete}
    >
      {children}
    </DashboardShell>
  );
}
