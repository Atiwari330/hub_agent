import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import type { ComplianceResearchDetails } from '@/app/api/queues/compliance-research/details/route';

export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_ENRICHMENT_VIEW);
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  if (!user.hubspotOwnerId) {
    return NextResponse.json({ error: 'No HubSpot owner linked' }, { status: 403 });
  }

  const domain = request.nextUrl.searchParams.get('domain');
  if (!domain) {
    return NextResponse.json({ error: 'domain query parameter is required' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // Verify this domain belongs to a deal owned by the AE
  const { data: ownerRecord } = await supabase
    .from('owners')
    .select('id')
    .eq('hubspot_owner_id', user.hubspotOwnerId)
    .single();

  if (!ownerRecord) {
    return NextResponse.json({ error: 'Owner not found' }, { status: 404 });
  }

  const { data: dealEnrichment } = await supabase
    .from('deal_enrichments')
    .select('hubspot_deal_id, domain')
    .eq('domain', domain)
    .limit(1)
    .single();

  if (dealEnrichment) {
    const { data: deal } = await supabase
      .from('deals')
      .select('owner_id')
      .eq('hubspot_deal_id', dealEnrichment.hubspot_deal_id)
      .eq('owner_id', ownerRecord.id)
      .single();

    if (!deal) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  try {
    const { data, error } = await supabase
      .from('compliance_research')
      .select(`
        domain,
        status,
        research_context,
        state_requirements,
        screening_tools,
        reporting_platforms,
        licensing_requirements,
        payor_requirements,
        documentation_standards,
        accreditation_info,
        executive_summary,
        key_talking_points,
        search_queries,
        source_urls,
        confidence_score,
        researched_at
      `)
      .eq('domain', domain)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Compliance research not found', details: error?.message },
        { status: 404 }
      );
    }

    const details: ComplianceResearchDetails = {
      domain: data.domain,
      status: data.status,
      research_context: data.research_context as ComplianceResearchDetails['research_context'],
      state_requirements: (data.state_requirements as ComplianceResearchDetails['state_requirements']) || [],
      screening_tools: (data.screening_tools as ComplianceResearchDetails['screening_tools']) || [],
      reporting_platforms: (data.reporting_platforms as ComplianceResearchDetails['reporting_platforms']) || [],
      licensing_requirements: (data.licensing_requirements as ComplianceResearchDetails['licensing_requirements']) || [],
      payor_requirements: (data.payor_requirements as ComplianceResearchDetails['payor_requirements']) || [],
      documentation_standards: (data.documentation_standards as ComplianceResearchDetails['documentation_standards']) || [],
      accreditation_info: (data.accreditation_info as ComplianceResearchDetails['accreditation_info']) || [],
      executive_summary: data.executive_summary,
      key_talking_points: (data.key_talking_points as string[]) || [],
      search_queries: (data.search_queries as string[]) || [],
      source_urls: (data.source_urls as string[]) || [],
      confidence_score: data.confidence_score ? Number(data.confidence_score) : null,
      researched_at: data.researched_at,
    };

    return NextResponse.json(details);
  } catch (error) {
    console.error('My compliance research details error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch compliance research details', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
