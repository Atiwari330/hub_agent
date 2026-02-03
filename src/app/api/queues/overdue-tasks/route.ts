import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { getAllPipelines } from '@/lib/hubspot/pipelines';
import { getTasksByDealId } from '@/lib/hubspot/engagements';
import {
  checkOverdueTasks,
  type TaskCheckInput,
  type OverdueTaskInfo,
} from '@/lib/utils/queue-detection';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

// Active stages (excludes MQL, Closed Won, Closed Lost)
const ACTIVE_DEAL_STAGES = [
  '17915773',                                  // SQL
  '138092708',                                 // Discovery
  'baedc188-ba76-4a41-8723-5bb99fe7c5bf',     // Demo - Scheduled
  '963167283',                                 // Demo - Completed
  '59865091',                                  // Proposal
];

interface ExistingReminderInfo {
  hubspotTaskId: string;
  createdAt: string;
  overdueTaskCount: number;
  oldestOverdueDays: number;
}

interface OverdueTasksQueueDeal {
  id: string;
  hubspotDealId: string;
  hubspotOwnerId: string;
  dealName: string;
  amount: number | null;
  closeDate: string | null;
  stageName: string;
  ownerName: string;
  ownerId: string;
  overdueTaskCount: number;
  oldestOverdueDays: number;
  overdueTasks: OverdueTaskInfo[];
  existingReminder: ExistingReminderInfo | null;
}

export async function GET(request: NextRequest) {
  // Check authorization
  const authResult = await checkApiAuth(RESOURCES.QUEUE_OVERDUE_TASKS);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  const { searchParams } = new URL(request.url);
  const ownerIdFilter = searchParams.get('ownerId');
  const stageFilter = searchParams.get('stage'); // comma-separated stage IDs
  const severityFilter = searchParams.get('severity'); // '3', '7', '14' for days threshold

  try {
    // Get target owners
    const { data: owners } = await supabase
      .from('owners')
      .select('id, hubspot_owner_id, first_name, last_name, email')
      .in('email', SYNC_CONFIG.TARGET_AE_EMAILS);

    if (!owners || owners.length === 0) {
      return NextResponse.json({
        deals: [],
        counts: { total: 0, critical: 0 },
      });
    }

    // Build owner lookup map
    const ownerMap = new Map<string, { name: string; email: string; hubspotOwnerId: string }>();
    for (const owner of owners) {
      const name = [owner.first_name, owner.last_name].filter(Boolean).join(' ') || owner.email;
      ownerMap.set(owner.id, { name, email: owner.email, hubspotOwnerId: owner.hubspot_owner_id });
    }

    let ownerIds = owners.map((o) => o.id);

    // Filter by specific owner if requested
    if (ownerIdFilter) {
      if (!ownerIds.includes(ownerIdFilter)) {
        return NextResponse.json({
          deals: [],
          counts: { total: 0, critical: 0 },
        });
      }
      ownerIds = [ownerIdFilter];
    }

    // Determine which stages to query
    let targetStages = ACTIVE_DEAL_STAGES;
    if (stageFilter) {
      const stageIds = stageFilter.split(',').filter((s) => ACTIVE_DEAL_STAGES.includes(s));
      if (stageIds.length > 0) {
        targetStages = stageIds;
      }
    }

    // Fetch all active deals for target AEs
    const { data: deals, error: dealsError } = await supabase
      .from('deals')
      .select(`
        id,
        hubspot_deal_id,
        deal_name,
        amount,
        close_date,
        deal_stage,
        owner_id
      `)
      .in('owner_id', ownerIds)
      .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
      .in('deal_stage', targetStages)
      .order('amount', { ascending: false, nullsFirst: false });

    if (dealsError) {
      console.error('Error fetching deals for overdue-tasks queue:', dealsError);
      return NextResponse.json(
        { error: 'Failed to fetch deals', details: dealsError.message },
        { status: 500 }
      );
    }

    // Get existing reminders for these deals
    const dealIds = deals?.map((d) => d.id) || [];
    const { data: existingReminders } = await supabase
      .from('overdue_task_reminders')
      .select('deal_id, hubspot_task_id, overdue_task_count, oldest_overdue_days, created_at')
      .in('deal_id', dealIds)
      .order('created_at', { ascending: false });

    // Build a map of deal_id -> most recent reminder
    const reminderMap = new Map<string, ExistingReminderInfo>();
    for (const reminder of existingReminders || []) {
      // Only keep the most recent reminder per deal
      if (!reminderMap.has(reminder.deal_id)) {
        reminderMap.set(reminder.deal_id, {
          hubspotTaskId: reminder.hubspot_task_id,
          createdAt: reminder.created_at,
          overdueTaskCount: reminder.overdue_task_count,
          oldestOverdueDays: reminder.oldest_overdue_days,
        });
      }
    }

    // Get stage names
    const pipelines = await getAllPipelines();
    const salesPipeline = pipelines.find((p) => p.id === SYNC_CONFIG.TARGET_PIPELINE_ID);
    const stageMap = new Map<string, string>();
    if (salesPipeline) {
      for (const stage of salesPipeline.stages) {
        stageMap.set(stage.id, stage.label);
      }
    }

    // Parse severity threshold
    const severityThreshold = severityFilter ? parseInt(severityFilter, 10) : 0;

    // Process deals - fetch tasks from HubSpot for each deal
    const queueDeals: OverdueTasksQueueDeal[] = [];
    let totalCount = 0;
    let criticalCount = 0; // > 7 days overdue

    for (const deal of deals || []) {
      // Fetch tasks from HubSpot for this deal
      const hubspotTasks = await getTasksByDealId(deal.hubspot_deal_id);

      // Convert to TaskCheckInput format
      const taskInputs: TaskCheckInput[] = hubspotTasks.map((t) => ({
        id: t.id,
        hs_task_subject: t.properties.hs_task_subject,
        hs_task_status: t.properties.hs_task_status,
        hs_timestamp: t.properties.hs_timestamp,
      }));

      // Check for overdue tasks
      const overdueResult = checkOverdueTasks(taskInputs);

      // Skip deals with no overdue tasks
      if (!overdueResult.hasOverdueTasks) {
        continue;
      }

      // Apply severity filter
      if (severityThreshold > 0 && overdueResult.oldestOverdueDays < severityThreshold) {
        continue;
      }

      totalCount++;
      if (overdueResult.oldestOverdueDays > 7) {
        criticalCount++;
      }

      const ownerInfo = deal.owner_id ? ownerMap.get(deal.owner_id) : null;

      queueDeals.push({
        id: deal.id,
        hubspotDealId: deal.hubspot_deal_id,
        hubspotOwnerId: ownerInfo?.hubspotOwnerId || '',
        dealName: deal.deal_name,
        amount: deal.amount,
        closeDate: deal.close_date,
        stageName: stageMap.get(deal.deal_stage || '') || deal.deal_stage || 'Unknown',
        ownerName: ownerInfo?.name || 'Unknown',
        ownerId: deal.owner_id || '',
        overdueTaskCount: overdueResult.overdueCount,
        oldestOverdueDays: overdueResult.oldestOverdueDays,
        overdueTasks: overdueResult.overdueTasks,
        existingReminder: reminderMap.get(deal.id) || null,
      });
    }

    return NextResponse.json({
      deals: queueDeals,
      counts: {
        total: totalCount,
        critical: criticalCount,
      },
    });
  } catch (error) {
    console.error('Overdue-tasks queue error:', error);
    return NextResponse.json(
      { error: 'Failed to get overdue-tasks queue', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
