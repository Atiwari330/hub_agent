import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { ALL_OPEN_STAGE_IDS, SALES_PIPELINE_STAGES } from '@/lib/hubspot/stage-config';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import type { ComplianceResearchDeal, ComplianceResearchQueueResponse } from '@/app/api/queues/compliance-research/route';

const STAGE_LABEL_MAP = new Map(
  Object.values(SALES_PIPELINE_STAGES).map((s) => [s.id, s.label])
);

export async function GET() {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_ENRICHMENT_VIEW);
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  if (!user.hubspotOwnerId) {
    return NextResponse.json({ error: 'No HubSpot owner linked' }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();

  try {
    // Resolve internal owner ID
    const { data: ownerRecord } = await supabase
      .from('owners')
      .select('id')
      .eq('hubspot_owner_id', user.hubspotOwnerId)
      .single();

    if (!ownerRecord) {
      return NextResponse.json({ error: 'Owner not found' }, { status: 404 });
    }

    // Fetch enriched deals for this AE only
    const { data: dealEnrichments, error: deError } = await supabase
      .from('deal_enrichments')
      .select('hubspot_deal_id, domain, status, owner_id')
      .eq('status', 'enriched');

    if (deError) {
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

    // Get only this AE's open deals from the enriched set
    const enrichedDealIds = dealEnrichments.map((de) => de.hubspot_deal_id);
    const { data: deals, error: dealsError } = await supabase
      .from('deals')
      .select('hubspot_deal_id, deal_name, amount, deal_stage, owner_id, close_date')
      .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
      .in('deal_stage', ALL_OPEN_STAGE_IDS)
      .in('hubspot_deal_id', enrichedDealIds)
      .eq('owner_id', ownerRecord.id)
      .order('amount', { ascending: false, nullsFirst: false });

    if (dealsError) {
      return NextResponse.json(
        { error: 'Failed to fetch deals', details: dealsError.message },
        { status: 500 }
      );
    }

    // Build enrichment map: dealId -> domain
    const dealDomainMap = new Map<string, string>();
    for (const de of dealEnrichments) {
      if (de.domain) {
        dealDomainMap.set(de.hubspot_deal_id, de.domain);
      }
    }

    // Fetch domain_enrichments for company data
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

    // Fetch compliance_research data
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

    // Build response
    const ownerName = user.displayName || user.email;

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
          status: compliance.status as NonNullable<ComplianceResearchDeal['research']>['status'],
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
        ownerName,
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
    console.error('My compliance research error:', error);
    return NextResponse.json(
      { error: 'Failed to get compliance data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
