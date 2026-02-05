import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

export interface AtRiskCompany {
  id: string;
  hubspotCompanyId: string;
  name: string | null;
  arr: number | null;
  healthScore: number | null;
  healthScoreStatus: string | null;
  sentiment: string | null;
  contractEnd: string | null;
  contractStatus: string | null;
  lastActivityDate: string | null;
  latestMeetingDate: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  hubspotOwnerId: string | null;
  // Computed flags
  isAtRisk: boolean;
  isFlagged: boolean;
}

export interface AtRiskQueueResponse {
  companies: AtRiskCompany[];
  counts: {
    total: number;
    atRisk: number;
    flagged: number;
    bothAtRiskAndFlagged: number;
  };
}

export async function GET(request: NextRequest) {
  // Check authorization
  const authResult = await checkApiAuth(RESOURCES.QUEUE_AT_RISK);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  const { searchParams } = new URL(request.url);
  const ownerIdFilter = searchParams.get('ownerId');
  const statusFilter = searchParams.get('status'); // 'at-risk', 'flagged', 'both', or null for all

  try {
    // Build query for at-risk companies
    let query = supabase
      .from('companies')
      .select(`
        id,
        hubspot_company_id,
        name,
        arr,
        health_score,
        health_score_status,
        sentiment,
        contract_end,
        contract_status,
        last_activity_date,
        latest_meeting_date,
        hubspot_owner_id
      `)
      // Filter for at-risk OR flagged
      .or('health_score_status.eq.At-Risk,sentiment.eq.Flagged')
      // Exclude churned companies
      .neq('contract_status', 'Churned')
      // Sort by ARR descending (biggest $ at risk first)
      .order('arr', { ascending: false, nullsFirst: false });

    // Apply owner filter if specified
    if (ownerIdFilter) {
      query = query.eq('hubspot_owner_id', ownerIdFilter);
    }

    const { data: companies, error: companiesError } = await query;

    if (companiesError) {
      console.error('Error fetching at-risk companies:', companiesError);
      return NextResponse.json(
        { error: 'Failed to fetch companies', details: companiesError.message },
        { status: 500 }
      );
    }

    // Get owner information for the companies
    const ownerIds = [...new Set(
      (companies || [])
        .map((c) => c.hubspot_owner_id)
        .filter((id): id is string => id !== null)
    )];

    const { data: owners } = await supabase
      .from('owners')
      .select('hubspot_owner_id, first_name, last_name, email')
      .in('hubspot_owner_id', ownerIds);

    // Build owner lookup map
    const ownerMap = new Map<string, { name: string; email: string }>();
    for (const owner of owners || []) {
      const name = [owner.first_name, owner.last_name].filter(Boolean).join(' ') || owner.email;
      ownerMap.set(owner.hubspot_owner_id, { name, email: owner.email });
    }

    // Transform and count
    let atRiskCount = 0;
    let flaggedCount = 0;
    let bothCount = 0;

    const transformedCompanies: AtRiskCompany[] = [];

    for (const company of companies || []) {
      const isAtRisk = company.health_score_status === 'At-Risk';
      const isFlagged = company.sentiment === 'Flagged';

      // Apply status filter
      if (statusFilter === 'at-risk' && !isAtRisk) continue;
      if (statusFilter === 'flagged' && !isFlagged) continue;
      if (statusFilter === 'both' && (!isAtRisk || !isFlagged)) continue;

      // Count
      if (isAtRisk) atRiskCount++;
      if (isFlagged) flaggedCount++;
      if (isAtRisk && isFlagged) bothCount++;

      const ownerInfo = company.hubspot_owner_id ? ownerMap.get(company.hubspot_owner_id) : null;

      transformedCompanies.push({
        id: company.id,
        hubspotCompanyId: company.hubspot_company_id,
        name: company.name,
        arr: company.arr,
        healthScore: company.health_score,
        healthScoreStatus: company.health_score_status,
        sentiment: company.sentiment,
        contractEnd: company.contract_end,
        contractStatus: company.contract_status,
        lastActivityDate: company.last_activity_date,
        latestMeetingDate: company.latest_meeting_date,
        ownerName: ownerInfo?.name || null,
        ownerEmail: ownerInfo?.email || null,
        hubspotOwnerId: company.hubspot_owner_id,
        isAtRisk,
        isFlagged,
      });
    }

    const response: AtRiskQueueResponse = {
      companies: transformedCompanies,
      counts: {
        total: transformedCompanies.length,
        atRisk: atRiskCount,
        flagged: flaggedCount,
        bothAtRiskAndFlagged: bothCount,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('At-risk queue error:', error);
    return NextResponse.json(
      { error: 'Failed to get at-risk queue', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
