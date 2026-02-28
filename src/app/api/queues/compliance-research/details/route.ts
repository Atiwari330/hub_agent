import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

export interface ComplianceResearchDetails {
  domain: string;
  status: string;
  research_context: {
    state: string;
    services: string[];
    specialties: string[];
    locations: string[];
    companyName: string | null;
  };
  state_requirements: { requirement: string; description: string; source_url: string | null; category: string }[];
  screening_tools: { name: string; description: string; when_required: string; source_url: string | null }[];
  reporting_platforms: { name: string; description: string; url: string | null; state: string; source_url: string | null }[];
  licensing_requirements: { requirement: string; issuing_body: string; description: string; source_url: string | null }[];
  payor_requirements: { payor: string; requirements: string[]; source_url: string | null }[];
  documentation_standards: { standard: string; description: string; applies_to: string; source_url: string | null }[];
  accreditation_info: { body: string; requirement: string; description: string; source_url: string | null }[];
  executive_summary: string | null;
  key_talking_points: string[];
  search_queries: string[];
  source_urls: string[];
  confidence_score: number | null;
  researched_at: string | null;
}

export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_COMPLIANCE_RESEARCH);
  if (authResult instanceof NextResponse) return authResult;

  const domain = request.nextUrl.searchParams.get('domain');
  if (!domain) {
    return NextResponse.json({ error: 'domain query parameter is required' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

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
    console.error('Compliance research details error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch compliance research details', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
