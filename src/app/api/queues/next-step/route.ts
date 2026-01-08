import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { getAllPipelines } from '@/lib/hubspot/pipelines';
import {
  checkNextStepCompliance,
  type NextStepCheckInput,
  type NextStepQueueStatus,
} from '@/lib/utils/queue-detection';

// Active stages (excludes MQL, Closed Won, Closed Lost)
const ACTIVE_DEAL_STAGES = [
  '17915773',                                  // SQL
  '138092708',                                 // Discovery
  'baedc188-ba76-4a41-8723-5bb99fe7c5bf',     // Demo - Scheduled
  '963167283',                                 // Demo - Completed
  '59865091',                                  // Proposal
];

interface NextStepQueueDeal {
  id: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  ownerName: string;
  ownerId: string;
  status: NextStepQueueStatus;
  nextStep: string | null;
  nextStepDueDate: string | null;
  daysOverdue: number | null;
  reason: string;
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { searchParams } = new URL(request.url);
  const ownerIdFilter = searchParams.get('ownerId');
  const statusFilter = searchParams.get('status'); // missing, overdue, all

  try {
    // Get target owners
    const { data: owners } = await supabase
      .from('owners')
      .select('id, first_name, last_name, email')
      .in('email', SYNC_CONFIG.TARGET_AE_EMAILS);

    if (!owners || owners.length === 0) {
      return NextResponse.json({
        deals: [],
        counts: { missing: 0, overdue: 0, total: 0 },
      });
    }

    // Build owner lookup map
    const ownerMap = new Map<string, { name: string; email: string }>();
    for (const owner of owners) {
      const name = [owner.first_name, owner.last_name].filter(Boolean).join(' ') || owner.email;
      ownerMap.set(owner.id, { name, email: owner.email });
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
        deal_name,
        amount,
        deal_stage,
        owner_id,
        next_step,
        next_step_due_date,
        next_step_status
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
      total: 0,
    };

    for (const deal of deals || []) {
      const nextStepInput: NextStepCheckInput = {
        next_step: deal.next_step,
        next_step_due_date: deal.next_step_due_date,
        next_step_status: deal.next_step_status,
      };

      const checkResult = checkNextStepCompliance(nextStepInput);

      // Skip compliant deals
      if (checkResult.status === 'compliant') {
        continue;
      }

      // Apply status filter
      if (statusFilter && statusFilter !== 'all' && checkResult.status !== statusFilter) {
        // Still count it for totals
        counts.total++;
        if (checkResult.status === 'missing') counts.missing++;
        else if (checkResult.status === 'overdue') counts.overdue++;
        continue;
      }

      // Update counts
      counts.total++;
      if (checkResult.status === 'missing') counts.missing++;
      else if (checkResult.status === 'overdue') counts.overdue++;

      const ownerInfo = deal.owner_id ? ownerMap.get(deal.owner_id) : null;

      queueDeals.push({
        id: deal.id,
        dealName: deal.deal_name,
        amount: deal.amount,
        stageName: stageMap.get(deal.deal_stage || '') || deal.deal_stage || 'Unknown',
        ownerName: ownerInfo?.name || 'Unknown',
        ownerId: deal.owner_id || '',
        status: checkResult.status,
        nextStep: deal.next_step,
        nextStepDueDate: deal.next_step_due_date,
        daysOverdue: checkResult.daysOverdue,
        reason: checkResult.reason,
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
