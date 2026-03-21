import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { ALL_OPEN_STAGE_IDS, SALES_PIPELINE_STAGES } from '@/lib/hubspot/stage-config';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import type { DomainEnrichmentDeal, DomainEnrichmentQueueResponse } from '@/app/api/queues/domain-enrichment/route';

// Stage label map
const STAGE_LABEL_MAP = new Map(
  Object.values(SALES_PIPELINE_STAGES).map((s) => [s.id, s.label])
);

const STAGE_ENTRY_MAP: Record<string, string> = {
  '2030251': 'mql_entered_at',
  '17915773': 'sql_entered_at',
  '138092708': 'discovery_entered_at',
  'baedc188-ba76-4a41-8723-5bb99fe7c5bf': 'demo_scheduled_entered_at',
  '963167283': 'demo_completed_entered_at',
  '97b2bcc6-fb34-4b56-8e6e-c349c88ef3d5': 'closed_won_entered_at',
  '59865091': 'proposal_entered_at',
};

export async function GET() {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_ENRICHMENT_VIEW);
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  if (!user.hubspotOwnerId) {
    return NextResponse.json({ error: 'No HubSpot owner linked' }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();

  try {
    // Resolve internal owner ID from hubspot_owner_id
    const { data: ownerRecord } = await supabase
      .from('owners')
      .select('id')
      .eq('hubspot_owner_id', user.hubspotOwnerId)
      .single();

    if (!ownerRecord) {
      return NextResponse.json({ error: 'Owner not found' }, { status: 404 });
    }

    // Fetch only this AE's open deals
    const { data: deals, error: dealsError } = await supabase
      .from('deals')
      .select(`
        hubspot_deal_id,
        deal_name,
        amount,
        deal_stage,
        owner_id,
        close_date,
        mql_entered_at,
        sql_entered_at,
        discovery_entered_at,
        demo_scheduled_entered_at,
        demo_completed_entered_at,
        proposal_entered_at,
        closed_won_entered_at
      `)
      .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
      .in('deal_stage', ALL_OPEN_STAGE_IDS)
      .eq('owner_id', ownerRecord.id)
      .order('amount', { ascending: false, nullsFirst: false });

    if (dealsError) {
      return NextResponse.json(
        { error: 'Failed to fetch deals', details: dealsError.message },
        { status: 500 }
      );
    }

    // Fetch existing deal enrichments
    const dealIds = (deals || []).map((d) => d.hubspot_deal_id);
    const enrichmentMap = new Map<string, {
      status: string;
      domain: string | null;
      contact_emails: string[] | null;
      selected_email: string | null;
      error_message: string | null;
      analyzed_at: string | null;
    }>();

    if (dealIds.length > 0) {
      const { data: enrichments } = await supabase
        .from('deal_enrichments')
        .select('hubspot_deal_id, status, domain, contact_emails, selected_email, error_message, analyzed_at')
        .in('hubspot_deal_id', dealIds);

      for (const e of enrichments || []) {
        enrichmentMap.set(e.hubspot_deal_id, e);
      }
    }

    // Batch-fetch domain_enrichments for enriched deals
    const enrichedDomains = [...new Set(
      Array.from(enrichmentMap.values())
        .filter((e) => e.status === 'enriched' && e.domain)
        .map((e) => e.domain!)
    )];

    const domainDataMap = new Map<string, {
      company_name: string | null;
      company_overview: string | null;
      confidence_score: number | null;
      team_members: unknown[] | null;
      services: unknown[] | null;
    }>();

    if (enrichedDomains.length > 0) {
      const { data: domainData } = await supabase
        .from('domain_enrichments')
        .select('domain, company_name, company_overview, confidence_score, team_members, services')
        .in('domain', enrichedDomains);

      for (const d of domainData || []) {
        domainDataMap.set(d.domain, d);
      }
    }

    // Build response
    const now = new Date();
    const ownerName = user.displayName || user.email;

    const result: DomainEnrichmentDeal[] = (deals || []).map((deal) => {
      const stageName = STAGE_LABEL_MAP.get(deal.deal_stage) || deal.deal_stage || 'Unknown';

      let daysInStage: number | null = null;
      const entryColumn = STAGE_ENTRY_MAP[deal.deal_stage];
      const dealRecord = deal as Record<string, unknown>;
      if (entryColumn && dealRecord[entryColumn]) {
        const enteredAt = new Date(dealRecord[entryColumn] as string);
        daysInStage = Math.floor((now.getTime() - enteredAt.getTime()) / (1000 * 60 * 60 * 24));
      }

      const dealEnrichment = enrichmentMap.get(deal.hubspot_deal_id);
      let enrichment: DomainEnrichmentDeal['enrichment'] = null;

      if (dealEnrichment) {
        const domainInfo = dealEnrichment.domain ? domainDataMap.get(dealEnrichment.domain) : null;
        enrichment = {
          status: dealEnrichment.status as NonNullable<DomainEnrichmentDeal['enrichment']>['status'],
          domain: dealEnrichment.domain,
          companyName: domainInfo?.company_name || null,
          companyOverview: domainInfo?.company_overview || null,
          confidenceScore: domainInfo?.confidence_score ? Number(domainInfo.confidence_score) : null,
          teamMemberCount: Array.isArray(domainInfo?.team_members) ? domainInfo.team_members.length : 0,
          serviceCount: Array.isArray(domainInfo?.services) ? domainInfo.services.length : 0,
          analyzedAt: dealEnrichment.analyzed_at,
          contactEmails: dealEnrichment.contact_emails,
          selectedEmail: dealEnrichment.selected_email,
          errorMessage: dealEnrichment.error_message,
        };
      }

      return {
        dealId: deal.hubspot_deal_id,
        dealName: deal.deal_name,
        amount: deal.amount ? Number(deal.amount) : null,
        stageName,
        stageId: deal.deal_stage,
        daysInStage,
        closeDate: deal.close_date,
        ownerName,
        ownerId: deal.owner_id,
        enrichment,
      };
    });

    const enriched = result.filter((d) => d.enrichment?.status === 'enriched').length;
    const noContacts = result.filter((d) => d.enrichment?.status === 'no_contacts').length;
    const freeEmailOnly = result.filter((d) => d.enrichment?.status === 'free_email_only').length;
    const failed = result.filter((d) => d.enrichment?.status === 'failed').length;

    const response: DomainEnrichmentQueueResponse = {
      deals: result,
      counts: {
        total: result.length,
        enriched,
        unenriched: result.length - enriched - noContacts - freeEmailOnly - failed,
        noContacts,
        freeEmailOnly,
        failed,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('My enrichment error:', error);
    return NextResponse.json(
      { error: 'Failed to get enrichment data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
