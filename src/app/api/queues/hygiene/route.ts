import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { getAllPipelines } from '@/lib/hubspot/pipelines';
import {
  checkDealHygiene,
  determineHygieneStatus,
  type HygieneCheckInput,
  type HygieneCommitment,
  type HygieneStatus,
} from '@/lib/utils/queue-detection';
import { getDaysUntil } from '@/lib/utils/business-days';

// Active stages (excludes MQL, Closed Won, Closed Lost)
const ACTIVE_DEAL_STAGES = [
  '17915773',                                  // SQL
  '138092708',                                 // Discovery
  'baedc188-ba76-4a41-8723-5bb99fe7c5bf',     // Demo - Scheduled
  '963167283',                                 // Demo - Completed
  '59865091',                                  // Proposal
];

interface HygieneQueueDeal {
  id: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  ownerName: string;
  ownerId: string;
  createdAt: string | null;
  businessDaysOld: number;
  status: HygieneStatus;
  missingFields: { field: string; label: string }[];
  commitment: { date: string; daysRemaining: number } | null;
  reason: string;
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const { searchParams } = new URL(request.url);
  const ownerIdFilter = searchParams.get('ownerId');
  const statusFilter = searchParams.get('status'); // needs_commitment, pending, escalated, all

  try {
    // Get target owners
    const { data: owners } = await supabase
      .from('owners')
      .select('id, first_name, last_name, email')
      .in('email', SYNC_CONFIG.TARGET_AE_EMAILS);

    if (!owners || owners.length === 0) {
      return NextResponse.json({
        deals: [],
        counts: { needsCommitment: 0, pending: 0, escalated: 0, total: 0 },
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
          counts: { needsCommitment: 0, pending: 0, escalated: 0, total: 0 },
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

    // Get all pending hygiene commitments
    const dealIds = deals?.map((d) => d.id) || [];
    const { data: commitments } = await supabase
      .from('hygiene_commitments')
      .select('deal_id, commitment_date, status')
      .in('deal_id', dealIds);

    // Create commitment lookup map (most recent per deal)
    const commitmentMap = new Map<string, HygieneCommitment>();
    for (const c of commitments || []) {
      // Only use pending commitments for status determination
      if (c.status === 'pending') {
        commitmentMap.set(c.deal_id, {
          commitment_date: c.commitment_date,
          status: c.status,
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
    const counts = {
      needsCommitment: 0,
      pending: 0,
      escalated: 0,
      total: 0,
    };

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

      const commitment = commitmentMap.get(deal.id) || null;
      const statusResult = determineHygieneStatus({ deal: hygieneInput, commitment });

      // Skip compliant status
      if (statusResult.status === 'compliant') {
        continue;
      }

      // Apply status filter
      if (statusFilter && statusFilter !== 'all' && statusResult.status !== statusFilter) {
        // Still count it for totals
        counts.total++;
        if (statusResult.status === 'needs_commitment') counts.needsCommitment++;
        else if (statusResult.status === 'pending') counts.pending++;
        else if (statusResult.status === 'escalated') counts.escalated++;
        continue;
      }

      // Update counts
      counts.total++;
      if (statusResult.status === 'needs_commitment') counts.needsCommitment++;
      else if (statusResult.status === 'pending') counts.pending++;
      else if (statusResult.status === 'escalated') counts.escalated++;

      const ownerInfo = deal.owner_id ? ownerMap.get(deal.owner_id) : null;

      queueDeals.push({
        id: deal.id,
        dealName: deal.deal_name,
        amount: deal.amount,
        stageName: stageMap.get(deal.deal_stage || '') || deal.deal_stage || 'Unknown',
        ownerName: ownerInfo?.name || 'Unknown',
        ownerId: deal.owner_id || '',
        createdAt: deal.hubspot_created_at,
        businessDaysOld: statusResult.businessDaysOld,
        status: statusResult.status,
        missingFields: statusResult.missingFields,
        commitment: commitment
          ? {
              date: commitment.commitment_date,
              daysRemaining: getDaysUntil(commitment.commitment_date),
            }
          : null,
        reason: statusResult.reason,
      });
    }

    return NextResponse.json({
      deals: queueDeals,
      counts,
    });
  } catch (error) {
    console.error('Hygiene queue error:', error);
    return NextResponse.json(
      { error: 'Failed to get hygiene queue', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
