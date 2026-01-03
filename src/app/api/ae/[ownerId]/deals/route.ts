import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { getStageNameMap } from '@/lib/hubspot/pipelines';
import { calculateDealRisk } from '@/lib/utils/deal-risk';

interface RouteParams {
  params: Promise<{ ownerId: string }>;
}

// Valid sort columns
const VALID_SORT_COLUMNS = ['amount', 'close_date', 'deal_stage', 'deal_name'] as const;
type SortColumn = (typeof VALID_SORT_COLUMNS)[number];

// GET - Get all deals for an AE
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { ownerId } = await params;
    const supabase = await createServerSupabaseClient();

    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    const sortBy = (searchParams.get('sortBy') || 'amount') as SortColumn;
    const sortOrder = searchParams.get('sortOrder') === 'asc' ? true : false;
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 1000);
    const offset = parseInt(searchParams.get('offset') || '0');
    const stageFilter = searchParams.get('stage');

    // Validate sort column
    if (!VALID_SORT_COLUMNS.includes(sortBy)) {
      return NextResponse.json(
        { error: 'Invalid sortBy parameter' },
        { status: 400 }
      );
    }

    // Verify owner exists
    const { data: owner, error: ownerError } = await supabase
      .from('owners')
      .select('id, first_name, last_name, email')
      .eq('id', ownerId)
      .single();

    if (ownerError || !owner) {
      return NextResponse.json(
        { error: 'Owner not found' },
        { status: 404 }
      );
    }

    // Build query
    let query = supabase
      .from('deals')
      .select('*', { count: 'exact' })
      .eq('owner_id', ownerId);

    // Apply stage filter if provided
    if (stageFilter) {
      query = query.eq('deal_stage', stageFilter);
    }

    // Apply sorting (handle nulls)
    query = query.order(sortBy, { ascending: sortOrder, nullsFirst: false });

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data: deals, error: dealsError, count } = await query;

    if (dealsError) {
      console.error('Error fetching deals:', dealsError);
      return NextResponse.json(
        { error: 'Failed to fetch deals', details: dealsError.message },
        { status: 500 }
      );
    }

    // Get stage name mapping
    let stageNames: Map<string, string>;
    try {
      stageNames = await getStageNameMap();
    } catch {
      // If HubSpot call fails, continue with empty map
      stageNames = new Map();
    }

    // Enrich deals with stage names and risk assessment
    const enrichedDeals = (deals || []).map((deal) => {
      const stageName = deal.deal_stage
        ? stageNames.get(deal.deal_stage) || deal.deal_stage
        : null;

      // Calculate risk assessment
      const risk = calculateDealRisk({
        stageName,
        closeDate: deal.close_date,
        lastActivityDate: deal.last_activity_date,
        nextActivityDate: deal.next_activity_date,
        nextStep: deal.next_step,
        sqlEnteredAt: deal.sql_entered_at,
        demoScheduledEnteredAt: deal.demo_scheduled_entered_at,
        demoCompletedEnteredAt: deal.demo_completed_entered_at,
        hubspotCreatedAt: deal.hubspot_created_at,
      });

      return {
        id: deal.id,
        hubspotDealId: deal.hubspot_deal_id,
        dealName: deal.deal_name,
        amount: deal.amount,
        closeDate: deal.close_date,
        stage: deal.deal_stage,
        stageName,
        pipeline: deal.pipeline,
        description: deal.description,
        createdAt: deal.created_at,
        updatedAt: deal.updated_at,
        // Activity properties
        hubspotCreatedAt: deal.hubspot_created_at,
        leadSource: deal.lead_source,
        lastActivityDate: deal.last_activity_date,
        nextActivityDate: deal.next_activity_date,
        nextStep: deal.next_step,
        products: deal.products,
        dealSubstage: deal.deal_substage,
        // Risk assessment
        risk,
      };
    });

    // Calculate total value
    const totalValue = enrichedDeals.reduce((sum, deal) => sum + (deal.amount || 0), 0);

    return NextResponse.json({
      owner: {
        id: owner.id,
        firstName: owner.first_name,
        lastName: owner.last_name,
        email: owner.email,
      },
      deals: enrichedDeals,
      pagination: {
        total: count || 0,
        limit,
        offset,
      },
      summary: {
        totalValue,
        dealCount: enrichedDeals.length,
      },
    });
  } catch (error) {
    console.error('Deals API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
