import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { getAllPipelines } from '@/lib/hubspot/pipelines';
import {
  checkNextStepCompliance,
  type NextStepCheckInput,
  type NextStepQueueStatus,
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

interface ExistingTaskInfo {
  hubspotTaskId: string;
  createdAt: string;
  taskType: 'missing' | 'overdue';
  nextStepText: string | null;
  daysOverdue: number | null;
}

interface AnalysisInfo {
  lastAnalyzedAt: string | null;
  analyzedValue: string | null;  // The next_step text that was analyzed
  needsAnalysis: boolean;        // True if next_step changed since last analysis or never analyzed
  analysisStatus: string | null; // The status from last analysis (date_found, date_inferred, etc.)
}

interface NextStepQueueDeal {
  id: string;
  hubspotDealId: string;
  hubspotOwnerId: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  ownerName: string;
  ownerId: string;
  status: NextStepQueueStatus | 'compliant' | 'needs_analysis';
  nextStep: string | null;
  nextStepDueDate: string | null;
  daysOverdue: number | null;
  reason: string;
  existingTask: ExistingTaskInfo | null;
  analysis: AnalysisInfo;
  closeDate: string | null;
}

export async function GET(request: NextRequest) {
  // Check authorization
  const authResult = await checkApiAuth(RESOURCES.QUEUE_NEXT_STEP);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  const { searchParams } = new URL(request.url);
  const ownerIdFilter = searchParams.get('ownerId');
  const statusFilter = searchParams.get('status'); // missing, overdue, all
  const showAll = searchParams.get('showAll') === 'true'; // Show all deals including compliant ones

  try {
    // Get target owners
    const { data: owners } = await supabase
      .from('owners')
      .select('id, hubspot_owner_id, first_name, last_name, email')
      .in('email', SYNC_CONFIG.TARGET_AE_EMAILS);

    if (!owners || owners.length === 0) {
      return NextResponse.json({
        deals: [],
        counts: { missing: 0, overdue: 0, total: 0 },
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
          counts: { missing: 0, overdue: 0, total: 0 },
        });
      }
      ownerIds = [ownerIdFilter];
    }

    // Fetch all active deals for target AEs
    const { data: deals, error: dealsError } = await supabase
      .from('deals')
      .select(`
        id,
        hubspot_deal_id,
        deal_name,
        amount,
        deal_stage,
        owner_id,
        next_step,
        next_step_due_date,
        next_step_status,
        next_step_analyzed_at,
        next_step_analyzed_value,
        close_date
      `)
      .in('owner_id', ownerIds)
      .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
      .in('deal_stage', ACTIVE_DEAL_STAGES)
      .order('amount', { ascending: false, nullsFirst: false });

    if (dealsError) {
      console.error('Error fetching deals for next-step queue:', dealsError);
      return NextResponse.json(
        { error: 'Failed to fetch deals', details: dealsError.message },
        { status: 500 }
      );
    }

    // Get existing next step tasks for these deals
    const dealIds = deals?.map((d) => d.id) || [];
    const { data: existingTasks } = await supabase
      .from('next_step_tasks')
      .select('deal_id, hubspot_task_id, task_type, next_step_text, days_overdue, created_at')
      .in('deal_id', dealIds)
      .order('created_at', { ascending: false });

    // Build a map of deal_id -> most recent task
    const taskMap = new Map<string, { hubspotTaskId: string; createdAt: string; taskType: string; nextStepText: string | null; daysOverdue: number | null }>();
    for (const task of existingTasks || []) {
      // Only keep the most recent task per deal (they're ordered by created_at desc)
      if (!taskMap.has(task.deal_id)) {
        taskMap.set(task.deal_id, {
          hubspotTaskId: task.hubspot_task_id,
          createdAt: task.created_at,
          taskType: task.task_type,
          nextStepText: task.next_step_text,
          daysOverdue: task.days_overdue,
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

    // Process deals and build queue
    const queueDeals: NextStepQueueDeal[] = [];
    const counts = {
      missing: 0,
      overdue: 0,
      compliant: 0,
      needsAnalysis: 0,
      total: 0,
    };

    for (const deal of deals || []) {
      const nextStepInput: NextStepCheckInput = {
        next_step: deal.next_step,
        next_step_due_date: deal.next_step_due_date,
        next_step_status: deal.next_step_status,
      };

      const checkResult = checkNextStepCompliance(nextStepInput);

      // Determine if this deal needs analysis
      const hasNextStep = deal.next_step && deal.next_step.trim().length > 0;
      const hasBeenAnalyzed = deal.next_step_analyzed_at !== null;
      const analysisIsStale = hasBeenAnalyzed && deal.next_step !== deal.next_step_analyzed_value;
      const needsAnalysis = hasNextStep && (!hasBeenAnalyzed || analysisIsStale);

      // Build analysis info
      const analysisInfo: AnalysisInfo = {
        lastAnalyzedAt: deal.next_step_analyzed_at,
        analyzedValue: deal.next_step_analyzed_value,
        needsAnalysis,
        analysisStatus: deal.next_step_status,
      };

      // Determine effective status for display
      let effectiveStatus: NextStepQueueStatus | 'compliant' | 'needs_analysis' = checkResult.status;
      let effectiveReason = checkResult.reason;

      // If deal has next step but hasn't been analyzed, mark as needs_analysis
      if (needsAnalysis && checkResult.status === 'compliant') {
        effectiveStatus = 'needs_analysis';
        effectiveReason = analysisIsStale
          ? 'Next step changed since last analysis. Re-analyze to check for due date.'
          : 'Next step has not been analyzed yet. Analyze to extract due date.';
      }

      // Update counts
      counts.total++;
      if (checkResult.status === 'missing') counts.missing++;
      else if (checkResult.status === 'overdue') counts.overdue++;
      else if (checkResult.status === 'compliant') counts.compliant++;
      if (needsAnalysis) counts.needsAnalysis++;

      // Skip compliant deals unless showAll is true
      if (!showAll && effectiveStatus === 'compliant') {
        continue;
      }

      // Apply status filter (only when not showing all)
      if (!showAll && statusFilter && statusFilter !== 'all' && checkResult.status !== statusFilter) {
        continue;
      }

      const ownerInfo = deal.owner_id ? ownerMap.get(deal.owner_id) : null;

      // Check for existing task
      const existingTaskData = taskMap.get(deal.id);
      let existingTask: ExistingTaskInfo | null = null;

      if (existingTaskData) {
        existingTask = {
          hubspotTaskId: existingTaskData.hubspotTaskId,
          createdAt: existingTaskData.createdAt,
          taskType: existingTaskData.taskType as 'missing' | 'overdue',
          nextStepText: existingTaskData.nextStepText,
          daysOverdue: existingTaskData.daysOverdue,
        };
      }

      queueDeals.push({
        id: deal.id,
        hubspotDealId: deal.hubspot_deal_id,
        hubspotOwnerId: ownerInfo?.hubspotOwnerId || '',
        dealName: deal.deal_name,
        amount: deal.amount,
        stageName: stageMap.get(deal.deal_stage || '') || deal.deal_stage || 'Unknown',
        ownerName: ownerInfo?.name || 'Unknown',
        ownerId: deal.owner_id || '',
        status: effectiveStatus,
        nextStep: deal.next_step,
        nextStepDueDate: deal.next_step_due_date,
        daysOverdue: checkResult.daysOverdue,
        reason: effectiveReason,
        existingTask,
        analysis: analysisInfo,
        closeDate: deal.close_date,
      });
    }

    return NextResponse.json({
      deals: queueDeals,
      counts,
    });
  } catch (error) {
    console.error('Next-step queue error:', error);
    return NextResponse.json(
      { error: 'Failed to get next-step queue', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
