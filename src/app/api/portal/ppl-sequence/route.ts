import { NextResponse } from 'next/server';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth/types';
import { createServiceClient } from '@/lib/supabase/client';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { getAllPipelines } from '@/lib/hubspot/pipelines';
import { getBusinessDaysSinceDate } from '@/lib/utils/business-days';
import { getCallsByDealId, getEmailsByDealId, getMeetingsByDealId } from '@/lib/hubspot/engagements';
import { analyzeWeek1Touches, countTouchesInRange } from '@/lib/utils/touch-counter';
import { ACTIVE_DEAL_STAGES, type PplSequenceDeal, type QueueResponse } from '@/types/ppl-sequence';

export async function GET() {
  const authResult = await checkApiAuth(RESOURCES.PORTAL);
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  if (!user.hubspotOwnerId) {
    return NextResponse.json(
      { error: 'No HubSpot owner linked to this account' },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const target = 6;

  try {
    // Look up AE's owner record from hubspot_owner_id
    const { data: ownerRecord } = await supabase
      .from('owners')
      .select('id, hubspot_owner_id, first_name, last_name, email')
      .eq('hubspot_owner_id', user.hubspotOwnerId)
      .single();

    if (!ownerRecord) {
      return NextResponse.json({
        deals: [],
        counts: { on_track: 0, behind: 0, critical: 0, pending: 0, meeting_booked: 0 },
        avgTouchesExcludingMeetings: null,
      } satisfies QueueResponse);
    }

    const ownerName = [ownerRecord.first_name, ownerRecord.last_name].filter(Boolean).join(' ') || ownerRecord.email;
    const ownerId = ownerRecord.id;

    // Fetch PPL deals (lead_source = 'Paid Lead') for this AE
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
        lead_source
      `)
      .eq('owner_id', ownerId)
      .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
      .in('deal_stage', ACTIVE_DEAL_STAGES)
      .eq('lead_source', 'Paid Lead')
      .order('amount', { ascending: false, nullsFirst: false });

    if (dealsError) {
      console.error('[portal/ppl-sequence] Error fetching deals:', dealsError);
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

    // Build response with PPL sequence analysis
    const pplDeals: PplSequenceDeal[] = [];
    const counts = { on_track: 0, behind: 0, critical: 0, pending: 0, meeting_booked: 0 };

    for (const deal of deals || []) {
      const hubspotDealId = deal.hubspot_deal_id;

      const dealAgeDays = deal.hubspot_created_at
        ? getBusinessDaysSinceDate(deal.hubspot_created_at)
        : 0;

      let week1Analysis: ReturnType<typeof analyzeWeek1Touches> | null = null;
      let totalTouches: number | null = null;
      let needsActivityCheck = false;

      if (hubspotDealId && deal.hubspot_created_at) {
        try {
          const [calls, emails, meetings] = await Promise.all([
            getCallsByDealId(hubspotDealId),
            getEmailsByDealId(hubspotDealId),
            getMeetingsByDealId(hubspotDealId),
          ]);

          week1Analysis = analyzeWeek1Touches(calls, emails, deal.hubspot_created_at, target, meetings);

          const allTimeTouches = countTouchesInRange(
            calls,
            emails,
            new Date('2020-01-01'),
            new Date('2030-12-31')
          );
          totalTouches = allTimeTouches.total;

          if (week1Analysis.meetingBooked) {
            counts.meeting_booked++;
          } else {
            counts[week1Analysis.status]++;
          }
        } catch (error) {
          console.warn(`[portal/ppl-sequence] Failed to fetch activity for deal ${hubspotDealId}:`, error);
          needsActivityCheck = true;
          counts.pending++;
        }
      } else {
        needsActivityCheck = true;
        counts.pending++;
      }

      pplDeals.push({
        id: deal.id,
        hubspotDealId: hubspotDealId || '',
        dealName: deal.deal_name,
        amount: deal.amount,
        stageName: stageMap.get(deal.deal_stage || '') || deal.deal_stage || 'Unknown',
        stageId: deal.deal_stage || '',
        ownerName,
        ownerId,
        closeDate: deal.close_date,
        hubspotCreatedAt: deal.hubspot_created_at,
        dealAgeDays,
        week1Analysis,
        totalTouches,
        meetingBooked: week1Analysis?.meetingBooked ?? false,
        meetingBookedDate: week1Analysis?.meetingBookedDate ?? null,
        needsActivityCheck,
      });
    }

    // Compute avg touches excluding meeting-booked deals
    const nonMeetingDeals = pplDeals.filter(
      (d) => !d.meetingBooked && !d.needsActivityCheck && d.week1Analysis
    );
    const avgTouchesExcludingMeetings = nonMeetingDeals.length > 0
      ? nonMeetingDeals.reduce((sum, d) => sum + (d.week1Analysis?.touches.total ?? 0), 0) / nonMeetingDeals.length
      : null;

    const response: QueueResponse = { deals: pplDeals, counts, avgTouchesExcludingMeetings };
    return NextResponse.json(response);
  } catch (error) {
    console.error('[portal/ppl-sequence] Error:', error);
    return NextResponse.json(
      { error: 'Failed to get PPL sequence data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
