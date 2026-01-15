import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { getAllPipelines } from '@/lib/hubspot/pipelines';
import {
  checkDealHygiene,
  type HygieneCheckInput,
} from '@/lib/utils/queue-detection';
import { getBusinessDaysSinceDate } from '@/lib/utils/business-days';

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
  fieldsTaskedFor: string[];  // Which missing fields the task was created for
  coversAllCurrentFields: boolean;  // True if task covers all currently missing fields
}

interface HygieneQueueDeal {
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
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { searchParams } = new URL(request.url);
  const ownerIdFilter = searchParams.get('ownerId');

  try {
    // Get target owners
    const { data: owners } = await supabase
      .from('owners')
      .select('id, hubspot_owner_id, first_name, last_name, email')
      .in('email', SYNC_CONFIG.TARGET_AE_EMAILS);

    if (!owners || owners.length === 0) {
      return NextResponse.json({
        deals: [],
        counts: { total: 0 },
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
          counts: { total: 0 },
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
        hubspot_created_at,
        deal_substage,
        close_date,
        lead_source,
        products,
        deal_collaborator
      `)
      .in('owner_id', ownerIds)
      .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
      .in('deal_stage', ACTIVE_DEAL_STAGES)
      .order('amount', { ascending: false, nullsFirst: false });

    if (dealsError) {
      console.error('Error fetching deals for hygiene queue:', dealsError);
      return NextResponse.json(
        { error: 'Failed to fetch deals', details: dealsError.message },
        { status: 500 }
      );
    }

    // Get existing hygiene tasks for these deals
    const dealIds = deals?.map((d) => d.id) || [];
    const { data: existingTasks } = await supabase
      .from('hygiene_tasks')
      .select('deal_id, hubspot_task_id, missing_fields, created_at')
      .in('deal_id', dealIds)
      .order('created_at', { ascending: false });

    // Build a map of deal_id -> most recent task
    const taskMap = new Map<string, { hubspotTaskId: string; createdAt: string; missingFields: string[] }>();
    for (const task of existingTasks || []) {
      // Only keep the most recent task per deal (they're ordered by created_at desc)
      if (!taskMap.has(task.deal_id)) {
        taskMap.set(task.deal_id, {
          hubspotTaskId: task.hubspot_task_id,
          createdAt: task.created_at,
          missingFields: task.missing_fields || [],
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
    const queueDeals: HygieneQueueDeal[] = [];

    for (const deal of deals || []) {
      const hygieneInput: HygieneCheckInput = {
        id: deal.id,
        hubspot_created_at: deal.hubspot_created_at,
        deal_substage: deal.deal_substage,
        close_date: deal.close_date,
        amount: deal.amount,
        lead_source: deal.lead_source,
        products: deal.products,
        deal_collaborator: deal.deal_collaborator,
      };

      const hygieneCheck = checkDealHygiene(hygieneInput);

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
        // Check if all current missing fields were covered by the existing task
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
        hubspotOwnerId: ownerInfo?.hubspotOwnerId || '',
        createdAt: deal.hubspot_created_at,
        businessDaysOld,
        missingFields: hygieneCheck.missingFields,
        reason,
        existingTask,
      });
    }

    return NextResponse.json({
      deals: queueDeals,
      counts: { total: queueDeals.length },
    });
  } catch (error) {
    console.error('Hygiene queue error:', error);
    return NextResponse.json(
      { error: 'Failed to get hygiene queue', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
