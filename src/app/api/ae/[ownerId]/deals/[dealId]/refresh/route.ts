import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { getDealWithNextStepHistory } from '@/lib/hubspot/deals';
import { checkNextStepCompliance } from '@/lib/utils/queue-detection';
import { toTimestamp } from '@/lib/utils/timestamps';

interface RouteParams {
  params: Promise<{ ownerId: string; dealId: string }>;
}

/**
 * POST /api/ae/[ownerId]/deals/[dealId]/refresh
 *
 * Refresh a single deal's next step from HubSpot without triggering a full sync.
 * Returns the updated fields so the UI can patch the row in place.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { ownerId, dealId } = await params;
    const supabase = await createServerSupabaseClient();

    // Verify owner exists
    const { data: owner, error: ownerError } = await supabase
      .from('owners')
      .select('id, hubspot_owner_id')
      .eq('id', ownerId)
      .single();

    if (ownerError || !owner) {
      return NextResponse.json({ error: 'Owner not found' }, { status: 404 });
    }

    // Find the deal in our database
    const { data: dbDeal, error: dbDealError } = await supabase
      .from('deals')
      .select('id, hubspot_deal_id, deal_name, owner_id, next_step, next_step_status')
      .eq('id', dealId)
      .single();

    if (dbDealError || !dbDeal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    // Verify the deal belongs to this owner
    if (dbDeal.owner_id !== ownerId) {
      return NextResponse.json(
        { error: 'Deal does not belong to this owner' },
        { status: 403 }
      );
    }

    // Fetch fresh deal data from HubSpot with next step history
    const hubspotResult = await getDealWithNextStepHistory(dbDeal.hubspot_deal_id);

    if (!hubspotResult) {
      return NextResponse.json(
        { error: 'Failed to fetch deal from HubSpot' },
        { status: 502 }
      );
    }

    const { nextStepValue, nextStepUpdatedAt } = hubspotResult;
    const syncedAt = new Date().toISOString();

    // Determine if next step text actually changed
    const nextStepChanged = nextStepValue !== dbDeal.next_step;

    // Build the update payload — focused set, not a full sync
    const updatePayload: Record<string, unknown> = {
      next_step: nextStepValue,
      next_step_last_updated_at: toTimestamp(nextStepUpdatedAt),
      synced_at: syncedAt,
    };

    // If the next step text changed, clear stale analysis so the deal gets flagged as needs_analysis
    if (nextStepChanged) {
      updatePayload.next_step_analyzed_at = null;
      updatePayload.next_step_analyzed_value = null;
      updatePayload.next_step_due_date = null;
      updatePayload.next_step_status = null;
      updatePayload.next_step_confidence = null;
      updatePayload.next_step_display_message = null;
      updatePayload.next_step_action_type = null;
    }

    // Write to Supabase
    const { error: updateError } = await supabase
      .from('deals')
      .update(updatePayload)
      .eq('id', dealId);

    if (updateError) {
      console.error('Error updating deal after refresh:', updateError);
      return NextResponse.json(
        { error: 'Failed to update deal in database' },
        { status: 500 }
      );
    }

    // Re-evaluate queue compliance with the fresh data
    const compliance = checkNextStepCompliance({
      next_step: nextStepValue,
      next_step_due_date: nextStepChanged ? null : (dbDeal.next_step_status ? null : null),
      next_step_status: nextStepChanged ? null : dbDeal.next_step_status,
      next_step_last_updated_at: toTimestamp(nextStepUpdatedAt),
    });

    // If text changed, override status to needs_analysis (even if compliance says compliant/missing)
    const effectiveStatus = nextStepChanged && nextStepValue
      ? 'needs_analysis'
      : !nextStepValue
      ? 'missing'
      : compliance.status;

    return NextResponse.json({
      dealId,
      dealName: dbDeal.deal_name,
      nextStep: nextStepValue,
      nextStepChanged,
      previousNextStep: dbDeal.next_step,
      nextStepLastUpdatedAt: toTimestamp(nextStepUpdatedAt),
      syncedAt,
      status: effectiveStatus,
      daysSinceUpdate: compliance.daysSinceUpdate,
      daysOverdue: compliance.daysOverdue,
      reason: compliance.reason,
    });
  } catch (error) {
    console.error('Refresh deal API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
