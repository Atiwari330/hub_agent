import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { UPSELL_PIPELINE_ID, UPSELL_ACTIVE_STAGES } from '@/lib/hubspot/upsell-config';
import { getAllPipelines } from '@/lib/hubspot/pipelines';
import { checkUpsellDealHygiene } from '@/lib/utils/queue-detection';
import { getBusinessDaysSinceDate } from '@/lib/utils/business-days';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

interface ExistingTaskInfo {
  hubspotTaskId: string;
  createdAt: string;
  fieldsTaskedFor: string[];
  coversAllCurrentFields: boolean;
}

interface SmartTaskInfo {
  taskId: string;
  title: string;
  createdAt: string;
  priority: string;
}

interface UpsellHygieneQueueDeal {
  id: string;
  hubspotDealId: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  ownerName: string;
  ownerId: string;
  hubspotOwnerId: string;
  createdAt: string | null;
  businessDaysOld: number;
  missingFields: { field: string; label: string }[];
  reason: string;
  existingTask: ExistingTaskInfo | null;
  smartTasks: SmartTaskInfo[];
}

export async function GET(request: NextRequest) {
  // Check authorization
  const authResult = await checkApiAuth(RESOURCES.QUEUE_UPSELL_HYGIENE);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  const { searchParams } = new URL(request.url);
  const ownerIdFilter = searchParams.get('ownerId');

  try {
    // For upsell pipeline, we show ALL owners (not just target AEs)
    // First, get all deals in the upsell pipeline to find the owners
    let query = supabase
      .from('deals')
      .select(`
        id,
        hubspot_deal_id,
        deal_name,
        amount,
        deal_stage,
        owner_id,
        hubspot_owner_id,
        hubspot_created_at,
        close_date,
        products
      `)
      .eq('pipeline', UPSELL_PIPELINE_ID)
      .in('deal_stage', UPSELL_ACTIVE_STAGES)
      .order('amount', { ascending: false, nullsFirst: false });

    // Apply owner filter if specified
    if (ownerIdFilter) {
      query = query.eq('owner_id', ownerIdFilter);
    }

    const { data: deals, error: dealsError } = await query;

    if (dealsError) {
      console.error('Error fetching upsell deals for hygiene queue:', dealsError);
      return NextResponse.json(
        { error: 'Failed to fetch deals', details: dealsError.message },
        { status: 500 }
      );
    }

    if (!deals || deals.length === 0) {
      return NextResponse.json({
        deals: [],
        counts: { total: 0 },
      });
    }

    // Get unique owner IDs from deals
    const ownerIds = [...new Set(deals.filter(d => d.owner_id).map(d => d.owner_id!))];

    // Fetch owner details
    const { data: owners } = await supabase
      .from('owners')
      .select('id, hubspot_owner_id, first_name, last_name, email')
      .in('id', ownerIds);

    // Build owner lookup map
    const ownerMap = new Map<string, { name: string; email: string; hubspotOwnerId: string }>();
    for (const owner of owners || []) {
      const name = [owner.first_name, owner.last_name].filter(Boolean).join(' ') || owner.email;
      ownerMap.set(owner.id, { name, email: owner.email, hubspotOwnerId: owner.hubspot_owner_id });
    }

    // Get existing hygiene tasks for these deals
    const dealIds = deals.map((d) => d.id);
    const { data: existingTasks } = await supabase
      .from('hygiene_tasks')
      .select('deal_id, hubspot_task_id, missing_fields, created_at')
      .in('deal_id', dealIds)
      .order('created_at', { ascending: false });

    // Build a map of deal_id -> most recent task
    const taskMap = new Map<string, { hubspotTaskId: string; createdAt: string; missingFields: string[] }>();
    for (const task of existingTasks || []) {
      if (!taskMap.has(task.deal_id)) {
        taskMap.set(task.deal_id, {
          hubspotTaskId: task.hubspot_task_id,
          createdAt: task.created_at,
          missingFields: task.missing_fields || [],
        });
      }
    }

    // Get smart tasks for these deals
    const { data: smartTasksData } = await supabase
      .from('smart_tasks')
      .select('deal_id, hubspot_task_id, title, priority, created_at')
      .in('deal_id', dealIds)
      .order('created_at', { ascending: false });

    // Build a map of deal_id -> smart tasks array
    const smartTasksMap = new Map<string, SmartTaskInfo[]>();
    for (const task of smartTasksData || []) {
      const dealSmartTasks = smartTasksMap.get(task.deal_id) || [];
      dealSmartTasks.push({
        taskId: task.hubspot_task_id,
        title: task.title,
        createdAt: task.created_at,
        priority: task.priority,
      });
      smartTasksMap.set(task.deal_id, dealSmartTasks);
    }

    // Get stage names for upsell pipeline
    const pipelines = await getAllPipelines();
    const upsellPipeline = pipelines.find((p) => p.id === UPSELL_PIPELINE_ID);
    const stageMap = new Map<string, string>();
    if (upsellPipeline) {
      for (const stage of upsellPipeline.stages) {
        stageMap.set(stage.id, stage.label);
      }
    }

    // Process deals and build queue
    const queueDeals: UpsellHygieneQueueDeal[] = [];

    for (const deal of deals) {
      const hygieneInput = {
        amount: deal.amount,
        close_date: deal.close_date,
        products: deal.products,
      };

      const hygieneCheck = checkUpsellDealHygiene(hygieneInput);

      // Skip compliant deals
      if (hygieneCheck.isCompliant) {
        continue;
      }

      const ownerInfo = deal.owner_id ? ownerMap.get(deal.owner_id) : null;
      const businessDaysOld = deal.hubspot_created_at
        ? getBusinessDaysSinceDate(deal.hubspot_created_at)
        : 999;
      const missingFieldsList = hygieneCheck.missingFields.map((f) => f.label).join(', ');
      const reason = `Missing: ${missingFieldsList}`;

      // Check for existing task
      const existingTaskData = taskMap.get(deal.id);
      let existingTask: ExistingTaskInfo | null = null;

      if (existingTaskData) {
        const currentMissingLabels = hygieneCheck.missingFields.map((f) => f.label);
        const coversAllCurrentFields = currentMissingLabels.every((label) =>
          existingTaskData.missingFields.includes(label)
        );

        existingTask = {
          hubspotTaskId: existingTaskData.hubspotTaskId,
          createdAt: existingTaskData.createdAt,
          fieldsTaskedFor: existingTaskData.missingFields,
          coversAllCurrentFields,
        };
      }

      queueDeals.push({
        id: deal.id,
        hubspotDealId: deal.hubspot_deal_id,
        dealName: deal.deal_name,
        amount: deal.amount,
        stageName: stageMap.get(deal.deal_stage || '') || deal.deal_stage || 'Unknown',
        ownerName: ownerInfo?.name || 'Unknown',
        ownerId: deal.owner_id || '',
        hubspotOwnerId: ownerInfo?.hubspotOwnerId || deal.hubspot_owner_id || '',
        createdAt: deal.hubspot_created_at,
        businessDaysOld,
        missingFields: hygieneCheck.missingFields,
        reason,
        existingTask,
        smartTasks: smartTasksMap.get(deal.id) || [],
      });
    }

    return NextResponse.json({
      deals: queueDeals,
      counts: { total: queueDeals.length },
    });
  } catch (error) {
    console.error('Upsell hygiene queue error:', error);
    return NextResponse.json(
      { error: 'Failed to get upsell hygiene queue', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
