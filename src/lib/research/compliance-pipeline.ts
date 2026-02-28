/**
 * Compliance Research Pipeline Orchestrator
 *
 * Orchestrates the full compliance research flow:
 * 1. Fetch enrichment data from domain_enrichments
 * 2. Extract research context (state, services, specialties)
 * 3. Generate targeted search queries
 * 4. Run Tavily web searches
 * 5. Synthesize with Claude
 * 6. Store results in compliance_research table
 */

import { createServerSupabaseClient, createServiceClient } from '../supabase/client';
import { generateComplianceQueries, type ResearchContext } from './query-generator';
import { searchCompliance } from './tavily-client';
import { analyzeComplianceResearch, type ComplianceAnalysis } from './compliance-analyzer';

export interface ComplianceResearchResult {
  success: true;
  domain: string;
  dealId: string | null;
  status: 'completed' | 'already_researched';
  analysis?: ComplianceAnalysis;
  researchedAt: string;
}

export interface ComplianceResearchError {
  success: false;
  error: string;
  details?: string;
  statusCode?: number;
}

export type CompliancePipelineResult = ComplianceResearchResult | ComplianceResearchError;

/**
 * Extract a US state from enrichment locations array.
 * Returns the first state found, or null.
 */
function extractState(locations: string[]): string | null {
  const US_STATES = [
    'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
    'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho',
    'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana',
    'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
    'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
    'New Hampshire', 'New Jersey', 'New Mexico', 'New York',
    'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
    'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
    'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
    'West Virginia', 'Wisconsin', 'Wyoming', 'District of Columbia',
  ];

  const STATE_ABBREVIATIONS: Record<string, string> = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas',
    CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
    FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
    IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
    KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
    MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
    MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
    NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
    NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
    OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
    SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
    VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
    WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
  };

  for (const location of locations) {
    // Check full state names
    for (const state of US_STATES) {
      if (location.toLowerCase().includes(state.toLowerCase())) {
        return state;
      }
    }
    // Check abbreviations (e.g., "Anchorage, AK")
    for (const [abbr, fullName] of Object.entries(STATE_ABBREVIATIONS)) {
      const pattern = new RegExp(`\\b${abbr}\\b`);
      if (pattern.test(location)) {
        return fullName;
      }
    }
  }

  return null;
}

/**
 * Run the full compliance research pipeline for a domain.
 */
export async function researchCompliance(
  domain: string,
  dealId?: string,
  options?: { force?: boolean }
): Promise<CompliancePipelineResult> {
  const force = options?.force ?? false;

  try {
    const supabase = await createServerSupabaseClient();
    const serviceClient = createServiceClient();

    // 1. Fetch enrichment data
    const { data: enrichment, error: enrichError } = await supabase
      .from('domain_enrichments')
      .select('domain, company_name, services, specialties, locations, company_overview')
      .eq('domain', domain)
      .single();

    if (enrichError || !enrichment) {
      return {
        success: false,
        error: 'Domain enrichment not found',
        details: enrichError?.message || `No enrichment data for domain: ${domain}`,
        statusCode: 404,
      };
    }

    // 2. Extract research context
    const services = Array.isArray(enrichment.services)
      ? (enrichment.services as { name: string }[]).map((s) => s.name)
      : [];
    const specialties = Array.isArray(enrichment.specialties)
      ? (enrichment.specialties as string[])
      : [];
    const locations = Array.isArray(enrichment.locations)
      ? (enrichment.locations as string[])
      : [];

    const state = extractState(locations);
    if (!state) {
      return {
        success: false,
        error: 'Could not determine state',
        details: `No US state found in locations: ${locations.join(', ')}`,
        statusCode: 422,
      };
    }

    const researchContext: ResearchContext = {
      state,
      services,
      specialties,
      locations,
      companyName: enrichment.company_name as string | null,
    };

    // 3. Check for existing research (skip if already done, unless force)
    if (!force) {
      const { data: existing } = await supabase
        .from('compliance_research')
        .select('id, status, researched_at')
        .eq('domain', domain)
        .eq('status', 'completed')
        .single();

      if (existing) {
        return {
          success: true,
          domain,
          dealId: dealId || null,
          status: 'already_researched',
          researchedAt: existing.researched_at,
        };
      }
    }

    // 4. Upsert initial "researching" status
    const now = new Date().toISOString();
    await serviceClient.from('compliance_research').upsert(
      {
        domain,
        hubspot_deal_id: dealId || null,
        research_context: researchContext,
        status: 'researching',
        created_at: now,
        updated_at: now,
      },
      { onConflict: 'domain' }
    );

    // 5. Generate search queries
    const queries = await generateComplianceQueries(researchContext);

    // 6. Run Tavily searches
    const searchOutput = await searchCompliance(queries);

    // 7. Synthesize with Claude
    const analysis = await analyzeComplianceResearch(researchContext, searchOutput);

    // 8. Store completed results
    const researchedAt = new Date().toISOString();
    await serviceClient.from('compliance_research').upsert(
      {
        domain,
        hubspot_deal_id: dealId || null,
        research_context: researchContext,
        status: 'completed',
        state_requirements: analysis.state_requirements,
        screening_tools: analysis.screening_tools,
        reporting_platforms: analysis.reporting_platforms,
        licensing_requirements: analysis.licensing_requirements,
        payor_requirements: analysis.payor_requirements,
        documentation_standards: analysis.documentation_standards,
        accreditation_info: analysis.accreditation_info,
        executive_summary: analysis.executive_summary,
        key_talking_points: analysis.key_talking_points,
        search_queries: queries,
        raw_search_results: searchOutput.rawResponses,
        source_urls: searchOutput.allUrls,
        confidence_score: analysis.confidence_score,
        error_message: null,
        researched_at: researchedAt,
        updated_at: researchedAt,
      },
      { onConflict: 'domain' }
    );

    return {
      success: true,
      domain,
      dealId: dealId || null,
      status: 'completed',
      analysis,
      researchedAt,
    };
  } catch (error) {
    console.error(`Compliance research failed for domain ${domain}:`, error);

    // Try to record failure status
    try {
      const serviceClient = createServiceClient();
      await serviceClient.from('compliance_research').upsert(
        {
          domain,
          hubspot_deal_id: dealId || null,
          research_context: { state: 'unknown', services: [], specialties: [], locations: [], companyName: null },
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'domain' }
      );
    } catch {
      // Ignore failure recording errors
    }

    return {
      success: false,
      error: 'Compliance research failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      statusCode: 500,
    };
  }
}
