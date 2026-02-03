import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { getAllPipelines } from '@/lib/hubspot/pipelines';
import { getBusinessDaysSinceDate, getDaysUntil, isDateInPast } from '@/lib/utils/business-days';
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

export interface ActiveDealWithMetadata {
  id: string;
  hubspotDealId: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  ownerName: string;
  ownerId: string;
  closeDate: string | null;
  lastActivityDate: string | null;
  nextActivityDate: string | null;
  nextStep: string | null;
  hubspotCreatedAt: string | null;
  // Pre-computed metadata
  daysSinceActivity: number;
  dealAgeDays: number;
  hasNextStep: boolean;
  hasFutureActivity: boolean;
  nextStepOverdue: boolean;
  closeDateInPast: boolean;
  daysUntilClose: number | null;
  // AI next step analysis (cached from DB)
  nextStepDueDate: string | null;
  nextStepStatus: string | null;
  nextStepActionType: string | null;
  nextStepConfidence: number | null;
  nextStepDisplayMessage: string | null;
  nextStepAnalyzedAt: string | null;
}

export async function GET(request: NextRequest) {
  // Check authorization
  const authResult = await checkApiAuth(RESOURCES.QUEUE_STALLED_DEALS);
  if (authResult instanceof NextResponse) return authResult;

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
      return NextResponse.json({ deals: [] });
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
        return NextResponse.json({ deals: [] });
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
        close_date,
        last_activity_date,
        next_activity_date,
        next_step,
        next_step_due_date,
        next_step_status,
        next_step_action_type,
        next_step_confidence,
        next_step_display_message,
        next_step_analyzed_at
      `)
      .in('owner_id', ownerIds)
      .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
      .in('deal_stage', ACTIVE_DEAL_STAGES)
      .order('amount', { ascending: false, nullsFirst: false });

    if (dealsError) {
      console.error('Error fetching deals for stalled queue:', dealsError);
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

    // Build response with pre-computed metadata (no staleness filtering)
    const activeDealsList: ActiveDealWithMetadata[] = [];

    for (const deal of deals || []) {
      const ownerInfo = deal.owner_id ? ownerMap.get(deal.owner_id) : null;

      const dealAgeDays = deal.hubspot_created_at
        ? getBusinessDaysSinceDate(deal.hubspot_created_at)
        : 0;

      let daysSinceActivity: number;
      if (deal.last_activity_date) {
        daysSinceActivity = getBusinessDaysSinceDate(deal.last_activity_date);
      } else {
        // No activity date — use deal age as proxy
        daysSinceActivity = dealAgeDays;
      }

      const hasNextStep = !!(deal.next_step && deal.next_step.trim().length > 0);
      const hasFutureActivity = !!(deal.next_activity_date && !isDateInPast(deal.next_activity_date));
      const nextStepOverdue = !!(
        deal.next_step_due_date &&
        deal.next_step_status &&
        (deal.next_step_status === 'date_found' || deal.next_step_status === 'date_inferred') &&
        isDateInPast(deal.next_step_due_date)
      );
      const closeDateInPast = deal.close_date ? isDateInPast(deal.close_date) : false;
      const daysUntilClose = deal.close_date ? getDaysUntil(deal.close_date) : null;

      activeDealsList.push({
        id: deal.id,
        hubspotDealId: deal.hubspot_deal_id,
        dealName: deal.deal_name,
        amount: deal.amount,
        stageName: stageMap.get(deal.deal_stage || '') || deal.deal_stage || 'Unknown',
        ownerName: ownerInfo?.name || 'Unknown',
        ownerId: deal.owner_id || '',
        closeDate: deal.close_date,
        lastActivityDate: deal.last_activity_date,
        nextActivityDate: deal.next_activity_date,
        nextStep: deal.next_step,
        hubspotCreatedAt: deal.hubspot_created_at,
        daysSinceActivity,
        dealAgeDays,
        hasNextStep,
        hasFutureActivity,
        nextStepOverdue,
        closeDateInPast,
        daysUntilClose,
        nextStepDueDate: deal.next_step_due_date,
        nextStepStatus: deal.next_step_status,
        nextStepActionType: deal.next_step_action_type,
        nextStepConfidence: deal.next_step_confidence,
        nextStepDisplayMessage: deal.next_step_display_message,
        nextStepAnalyzedAt: deal.next_step_analyzed_at,
      });
    }

    return NextResponse.json({ deals: activeDealsList });
  } catch (error) {
    console.error('Stalled deals queue error:', error);
    return NextResponse.json(
      { error: 'Failed to get stalled deals queue', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
