import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import {
  checkDealHygiene,
  determineHygieneStatus,
  checkNextStepCompliance,
  type HygieneCheckInput,
  type NextStepCheckInput,
  type HygieneCommitment,
} from '@/lib/utils/queue-detection';

// Active stages (excludes MQL, Closed Won, Closed Lost)
const ACTIVE_DEAL_STAGES = [
  '17915773',                                  // SQL
  '138092708',                                 // Discovery
  'baedc188-ba76-4a41-8723-5bb99fe7c5bf',     // Demo - Scheduled
  '963167283',                                 // Demo - Completed
  '59865091',                                  // Proposal
];

export async function GET() {
  const supabase = await createServerSupabaseClient();

  try {
    // Get target owners
    const { data: owners } = await supabase
      .from('owners')
      .select('id')
      .in('email', SYNC_CONFIG.TARGET_AE_EMAILS);

    if (!owners || owners.length === 0) {
      return NextResponse.json({
        hygiene: { total: 0, escalated: 0 },
        nextStep: { total: 0, overdue: 0 },
      });
    }

    const ownerIds = owners.map((o) => o.id);

    // Fetch all active deals for target AEs
    const { data: deals, error: dealsError } = await supabase
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

    if (dealsError) {
      console.error('Error fetching deals for queue summary:', dealsError);
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
      .in('deal_id', dealIds)
      .eq('status', 'pending');

    // Create commitment lookup map
    const commitmentMap = new Map<string, HygieneCommitment>();
    for (const c of commitments || []) {
      commitmentMap.set(c.deal_id, {
        commitment_date: c.commitment_date,
        status: c.status,
      });
    }

    // Count hygiene queue items
    let hygieneTotal = 0;
    let hygieneEscalated = 0;

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

      if (!hygieneCheck.isCompliant) {
        const commitment = commitmentMap.get(deal.id) || null;
        const status = determineHygieneStatus({ deal: hygieneInput, commitment });

        if (status.status !== 'compliant') {
          hygieneTotal++;
          if (status.status === 'escalated') {
            hygieneEscalated++;
          }
        }
      }
    }

    // Count next step queue items
    let nextStepTotal = 0;
    let nextStepOverdue = 0;

    for (const deal of deals || []) {
      const nextStepInput: NextStepCheckInput = {
        next_step: deal.next_step,
        next_step_due_date: deal.next_step_due_date,
        next_step_status: deal.next_step_status,
      };

      const nextStepCheck = checkNextStepCompliance(nextStepInput);

      if (nextStepCheck.status !== 'compliant') {
        nextStepTotal++;
        if (nextStepCheck.status === 'overdue') {
          nextStepOverdue++;
        }
      }
    }

    return NextResponse.json({
      hygiene: {
        total: hygieneTotal,
        escalated: hygieneEscalated,
      },
      nextStep: {
        total: nextStepTotal,
        overdue: nextStepOverdue,
      },
    });
  } catch (error) {
    console.error('Queue summary error:', error);
    return NextResponse.json(
      { error: 'Failed to get queue summary', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
