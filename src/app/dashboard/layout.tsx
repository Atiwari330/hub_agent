import { createServerSupabaseClient } from '@/lib/supabase/client';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { getCurrentQuarter, getQuarterProgress } from '@/lib/utils/quarter';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';

// Active stages for queue counting (excludes MQL, Closed Won, Closed Lost)
const ACTIVE_DEAL_STAGES = [
  '17915773',                                  // SQL
  '138092708',                                 // Discovery
  'baedc188-ba76-4a41-8723-5bb99fe7c5bf',     // Demo - Scheduled
  '963167283',                                 // Demo - Completed
  '59865091',                                  // Proposal
];

async function getQueueCounts(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, ownerIds: string[]) {
  try {
    // Fetch active deals with queue-relevant fields
    const { data: deals } = await supabase
      .from('deals')
      .select(`
        id,
        hubspot_created_at,
        deal_substage,
        close_date,
        amount,
        lead_source,
        products,
        deal_collaborator,
        next_step,
        next_step_due_date,
        next_step_status
      `)
      .in('owner_id', ownerIds)
      .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
      .in('deal_stage', ACTIVE_DEAL_STAGES);

    if (!deals || deals.length === 0) {
      return {
        hygiene: { total: 0, escalated: 0 },
        nextStep: { total: 0, overdue: 0 },
        overdueTasks: { total: 0, critical: 0 },
      };
    }

    // Get pending commitments
    const dealIds = deals.map(d => d.id);
    const { data: commitments } = await supabase
      .from('hygiene_commitments')
      .select('deal_id, commitment_date, status')
      .in('deal_id', dealIds)
      .eq('status', 'pending');

    const commitmentMap = new Map(commitments?.map(c => [c.deal_id, c]) || []);

    // Count hygiene issues
    let hygieneTotal = 0;
    let hygieneEscalated = 0;
    let nextStepTotal = 0;
    let nextStepOverdue = 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const deal of deals) {
      // Check hygiene
      const hygieneFields = [
        deal.deal_substage,
        deal.close_date,
        deal.amount,
        deal.lead_source,
        deal.products,
        deal.deal_collaborator,
      ];
      const missingCount = hygieneFields.filter(f => f === null || f === undefined || f === '' || f === 0).length;

      if (missingCount > 0) {
        hygieneTotal++;
        const commitment = commitmentMap.get(deal.id);
        const createdAt = deal.hubspot_created_at ? new Date(deal.hubspot_created_at) : null;
        const daysSinceCreated = createdAt
          ? Math.floor((today.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24))
          : 999;

        // Escalated if: no commitment and deal > 7 days old, OR commitment date passed
        const isNewDeal = daysSinceCreated <= 7;
        if (!commitment && !isNewDeal) {
          hygieneEscalated++;
        } else if (commitment) {
          const commitmentDate = new Date(commitment.commitment_date);
          if (commitmentDate < today) {
            hygieneEscalated++;
          }
        }
      }

      // Check next step
      const hasNextStep = deal.next_step && deal.next_step.trim().length > 0;
      if (!hasNextStep) {
        nextStepTotal++;
      } else if (deal.next_step_due_date && deal.next_step_status) {
        const dueDate = new Date(deal.next_step_due_date);
        if (dueDate < today && (deal.next_step_status === 'date_found' || deal.next_step_status === 'date_inferred')) {
          nextStepTotal++;
          nextStepOverdue++;
        }
      }
    }

    return {
      hygiene: { total: hygieneTotal, escalated: hygieneEscalated },
      nextStep: { total: nextStepTotal, overdue: nextStepOverdue },
      // Overdue tasks are fetched from HubSpot in real-time (not cached)
      // Count is set to 0 here - actual count is shown on the queue page
      overdueTasks: { total: 0, critical: 0 },
    };
  } catch (error) {
    console.error('Error fetching queue counts:', error);
    return {
      hygiene: { total: 0, escalated: 0 },
      nextStep: { total: 0, overdue: 0 },
      overdueTasks: { total: 0, critical: 0 },
    };
  }
}

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

  // Fetch queue counts
  const ownerIds = owners.map(o => o.id);
  const queueCounts = await getQueueCounts(supabase, ownerIds);

  return (
    <DashboardShell
      owners={owners}
      lastSync={lastSync}
      quarterLabel={quarter.label}
      quarterProgress={progress.percentComplete}
      queueCounts={queueCounts}
    >
      {children}
    </DashboardShell>
  );
}
