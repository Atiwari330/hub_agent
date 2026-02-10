import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { getAllPipelines } from '@/lib/hubspot/pipelines';
import { getBusinessDaysSinceDate } from '@/lib/utils/business-days';
import { getCallsByDealId, getEmailsByDealId, getMeetingsByDealId } from '@/lib/hubspot/engagements';
import { analyzeWeek1Touches, countTouchesInRange, type Week1TouchAnalysis } from '@/lib/utils/touch-counter';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

// Active stages (excludes MQL, Closed Won, Closed Lost)
const ACTIVE_DEAL_STAGES = [
  '17915773',                                  // SQL (legacy)
  '138092708',                                 // SQL/Discovery
  'baedc188-ba76-4a41-8723-5bb99fe7c5bf',     // Demo - Scheduled
  '963167283',                                 // Demo - Completed
  '59865091',                                  // Proposal
];

export interface PplSequenceDeal {
  id: string;
  hubspotDealId: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  stageId: string;
  ownerName: string;
  ownerId: string;
  closeDate: string | null;
  hubspotCreatedAt: string | null;
  // PPL sequence specific
  dealAgeDays: number;
  week1Analysis: Week1TouchAnalysis | null;
  totalTouches: number | null;
  // Meeting compliance
  meetingBooked: boolean;
  meetingBookedDate: string | null;
  // Flags
  needsActivityCheck: boolean;
}

interface QueueResponse {
  deals: PplSequenceDeal[];
  counts: {
    on_track: number;
    behind: number;
    critical: number;
    pending: number;
    meeting_booked: number;
  };
  avgTouchesExcludingMeetings: number | null;
}

export async function GET(request: NextRequest) {
  // Check authorization
  const authResult = await checkApiAuth(RESOURCES.QUEUE_PPL_SEQUENCE);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  const { searchParams } = new URL(request.url);
  const ownerIdFilter = searchParams.get('ownerId');
  const target = parseInt(searchParams.get('target') || '6', 10);
  const fetchActivity = searchParams.get('fetchActivity') !== 'false'; // Default true

  try {
    // Get target owners (exclude Adi Tiwari — not part of PPL sequence compliance)
    const pplAeEmails = SYNC_CONFIG.TARGET_AE_EMAILS.filter(
      (email) => email !== 'atiwari@opusbehavioral.com'
    );
    const { data: owners } = await supabase
      .from('owners')
      .select('id, hubspot_owner_id, first_name, last_name, email')
      .in('email', pplAeEmails);

    if (!owners || owners.length === 0) {
      return NextResponse.json({ deals: [], counts: { on_track: 0, behind: 0, critical: 0, pending: 0, meeting_booked: 0 }, avgTouchesExcludingMeetings: null });
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
        return NextResponse.json({ deals: [], counts: { on_track: 0, behind: 0, critical: 0, pending: 0, meeting_booked: 0 }, avgTouchesExcludingMeetings: null });
      }
      ownerIds = [ownerIdFilter];
    }

    // Fetch PPL deals (lead_source = 'Paid Lead') for target AEs
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
      .in('owner_id', ownerIds)
      .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
      .in('deal_stage', ACTIVE_DEAL_STAGES)
      .eq('lead_source', 'Paid Lead')
      .order('amount', { ascending: false, nullsFirst: false });

    if (dealsError) {
      console.error('[ppl-sequence] Error fetching deals:', dealsError);
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
      const ownerInfo = deal.owner_id ? ownerMap.get(deal.owner_id) : null;
      const hubspotDealId = deal.hubspot_deal_id;

      const dealAgeDays = deal.hubspot_created_at
        ? getBusinessDaysSinceDate(deal.hubspot_created_at)
        : 0;

      let week1Analysis: Week1TouchAnalysis | null = null;
      let totalTouches: number | null = null;
      let needsActivityCheck = false;

      // Only fetch activity data if we have a HubSpot ID and creation date
      if (fetchActivity && hubspotDealId && deal.hubspot_created_at) {
        try {
          // Fetch calls, emails, and meetings from HubSpot
          const [calls, emails, meetings] = await Promise.all([
            getCallsByDealId(hubspotDealId),
            getEmailsByDealId(hubspotDealId),
            getMeetingsByDealId(hubspotDealId),
          ]);

          week1Analysis = analyzeWeek1Touches(calls, emails, deal.hubspot_created_at, target, meetings);

          // Count all touches (no date filter) for total column
          const allTimeTouches = countTouchesInRange(
            calls,
            emails,
            new Date('2020-01-01'),
            new Date('2030-12-31')
          );
          totalTouches = allTimeTouches.total;

          // Count statuses - meeting_booked is separate from on_track
          if (week1Analysis.meetingBooked) {
            counts.meeting_booked++;
          } else {
            counts[week1Analysis.status]++;
          }
        } catch (error) {
          console.warn(`[ppl-sequence] Failed to fetch activity for deal ${hubspotDealId}:`, error);
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
        ownerName: ownerInfo?.name || 'Unknown',
        ownerId: deal.owner_id || '',
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
    console.error('[ppl-sequence] Queue error:', error);
    return NextResponse.json(
      { error: 'Failed to get PPL sequence queue', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
