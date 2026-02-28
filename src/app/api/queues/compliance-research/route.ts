import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { ALL_OPEN_STAGE_IDS, SALES_PIPELINE_STAGES } from '@/lib/hubspot/stage-config';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';

// --- Types ---

export interface ComplianceResearchDeal {
  dealId: string;
  dealName: string | null;
  amount: number | null;
  stageName: string;
  closeDate: string | null;
  ownerName: string | null;
  ownerId: string | null;
  domain: string | null;
  companyName: string | null;
  services: string[];
  specialties: string[];
  locations: string[];
  research: {
    status: 'completed' | 'researching' | 'failed' | 'pending';
    requirementCount: number;
    sourceCount: number;
    confidenceScore: number | null;
    researchedAt: string | null;
    errorMessage: string | null;
  } | null;
}

export interface ComplianceResearchQueueResponse {
  deals: ComplianceResearchDeal[];
  counts: {
    total: number;
    researched: number;
    unresearched: number;
    failed: number;
  };
}

// --- Stage label map ---

const STAGE_LABEL_MAP = new Map(
  Object.values(SALES_PIPELINE_STAGES).map((s) => [s.id, s.label])
);

// --- Route Handler ---

export async function GET() {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_COMPLIANCE_RESEARCH);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = await createServerSupabaseClient();

  try {
    // 1. Fetch all enriched deals (only deals that have been domain-enriched)
    const { data: dealEnrichments, error: deError } = await supabase
      .from('deal_enrichments')
      .select('hubspot_deal_id, domain, status')
      .eq('status', 'enriched');

    if (deError) {
      console.error('Error fetching deal enrichments:', deError);
      return NextResponse.json(
        { error: 'Failed to fetch deal enrichments', details: deError.message },
        { status: 500 }
      );
    }

    if (!dealEnrichments || dealEnrichments.length === 0) {
      return NextResponse.json({
        deals: [],
        counts: { total: 0, researched: 0, unresearched: 0, failed: 0 },
      });
    }

    // 2. Fetch the actual deals for these enrichments (only open sales pipeline deals)
    const enrichedDealIds = dealEnrichments.map((de) => de.hubspot_deal_id);
    const { data: deals, error: dealsError } = await supabase
      .from('deals')
      .select('hubspot_deal_id, deal_name, amount, deal_stage, owner_id, close_date')
      .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
      .in('deal_stage', ALL_OPEN_STAGE_IDS)
      .in('hubspot_deal_id', enrichedDealIds)
      .order('amount', { ascending: false, nullsFirst: false });

    if (dealsError) {
      console.error('Error fetching deals:', dealsError);
      return NextResponse.json(
        { error: 'Failed to fetch deals', details: dealsError.message },
        { status: 500 }
      );
    }

    // 3. Build enrichment map: dealId -> domain
    const dealDomainMap = new Map<string, string>();
    for (const de of dealEnrichments) {
      if (de.domain) {
        dealDomainMap.set(de.hubspot_deal_id, de.domain);
      }
    }

    // 4. Fetch domain_enrichments for company data
    const domains = [...new Set(dealEnrichments.filter((de) => de.domain).map((de) => de.domain!))];
    const domainDataMap = new Map<string, {
      company_name: string | null;
      services: unknown[] | null;
      specialties: string[] | null;
      locations: string[] | null;
    }>();

    if (domains.length > 0) {
      const { data: domainData } = await supabase
        .from('domain_enrichments')
        .select('domain, company_name, services, specialties, locations')
        .in('domain', domains);

      for (const d of domainData || []) {
        domainDataMap.set(d.domain, d);
      }
    }

    // 5. Fetch compliance_research data
    const complianceMap = new Map<string, {
      status: string;
      state_requirements: unknown[] | null;
      source_urls: string[] | null;
      confidence_score: number | null;
      researched_at: string | null;
      error_message: string | null;
    }>();

    if (domains.length > 0) {
      const { data: complianceData } = await supabase
        .from('compliance_research')
        .select('domain, status, state_requirements, source_urls, confidence_score, researched_at, error_message')
        .in('domain', domains);

      for (const c of complianceData || []) {
        complianceMap.set(c.domain, c);
      }
    }

    // 6. Fetch owner names
    const ownerIds = [...new Set((deals || []).map((d) => d.owner_id).filter((id): id is string => id !== null))];
    const ownerMap = new Map<string, string>();

    if (ownerIds.length > 0) {
      const { data: owners } = await supabase
        .from('owners')
        .select('id, first_name, last_name')
        .in('id', ownerIds);

      for (const owner of owners || []) {
        const name = [owner.first_name, owner.last_name].filter(Boolean).join(' ');
        ownerMap.set(owner.id, name || 'Unknown');
      }
    }

    // 7. Build response
    const result: ComplianceResearchDeal[] = (deals || []).map((deal) => {
      const stageName = STAGE_LABEL_MAP.get(deal.deal_stage) || deal.deal_stage || 'Unknown';
      const domain = dealDomainMap.get(deal.hubspot_deal_id) || null;
      const domainInfo = domain ? domainDataMap.get(domain) : null;
      const compliance = domain ? complianceMap.get(domain) : null;

      const services = Array.isArray(domainInfo?.services)
        ? (domainInfo.services as { name: string }[]).map((s) => s.name)
        : [];
      const specialties = Array.isArray(domainInfo?.specialties)
        ? (domainInfo.specialties as string[])
        : [];
      const locations = Array.isArray(domainInfo?.locations)
        ? (domainInfo.locations as string[])
        : [];

      let research: ComplianceResearchDeal['research'] = null;
      if (compliance) {
        research = {
          status: compliance.status as ComplianceResearchDeal['research'] extends null ? never : NonNullable<ComplianceResearchDeal['research']>['status'],
          requirementCount: Array.isArray(compliance.state_requirements) ? compliance.state_requirements.length : 0,
          sourceCount: Array.isArray(compliance.source_urls) ? compliance.source_urls.length : 0,
          confidenceScore: compliance.confidence_score ? Number(compliance.confidence_score) : null,
          researchedAt: compliance.researched_at,
          errorMessage: compliance.error_message,
        };
      }

      return {
        dealId: deal.hubspot_deal_id,
        dealName: deal.deal_name,
        amount: deal.amount ? Number(deal.amount) : null,
        stageName,
        closeDate: deal.close_date,
        ownerName: deal.owner_id ? ownerMap.get(deal.owner_id) || null : null,
        ownerId: deal.owner_id,
        domain,
        companyName: (domainInfo?.company_name as string) || null,
        services,
        specialties,
        locations,
        research,
      };
    });

    const researched = result.filter((d) => d.research?.status === 'completed').length;
    const failed = result.filter((d) => d.research?.status === 'failed').length;

    const response: ComplianceResearchQueueResponse = {
      deals: result,
      counts: {
        total: result.length,
        researched,
        unresearched: result.length - researched - failed,
        failed,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Compliance research queue error:', error);
    return NextResponse.json(
      {
        error: 'Failed to get compliance research queue',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
