import { createServerSupabaseClient } from '@/lib/supabase/client';
import { createServiceClient } from '@/lib/supabase/client';
import { getContactEmailsByDealId } from '@/lib/hubspot/contacts';
import { extractDomain, isFreeEmailProvider } from '@/lib/enrichment/domain-utils';
import { enrichDomain } from '@/lib/enrichment/enrichment-pipeline';
import { SALES_PIPELINE_STAGES } from '@/lib/hubspot/stage-config';

// --- Types ---

export interface DealEnrichmentResult {
  hubspot_deal_id: string;
  status: 'enriched' | 'no_contacts' | 'free_email_only' | 'failed';
  domain: string | null;
  contact_emails: string[];
  selected_email: string | null;
  deal_name: string | null;
  analyzed_at: string;
  error_message?: string;
}

export type AnalyzeResult = {
  success: true;
  enrichment: DealEnrichmentResult;
} | {
  success: false;
  error: string;
  details?: string;
  statusCode?: number;
};

// --- Stage ID to label map ---

const STAGE_LABEL_MAP = new Map(
  Object.values(SALES_PIPELINE_STAGES).map((s) => [s.id, s.label])
);

// --- Main Function ---

export async function analyzeDealEnrichment(
  dealId: string,
  options?: { force?: boolean }
): Promise<AnalyzeResult> {
  const force = options?.force ?? false;

  try {
    // 1. Fetch deal from Supabase
    const supabase = await createServerSupabaseClient();
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('hubspot_deal_id, deal_name, amount, deal_stage, owner_id, close_date')
      .eq('hubspot_deal_id', dealId)
      .single();

    if (dealError || !deal) {
      return {
        success: false,
        error: 'Deal not found',
        details: dealError?.message,
        statusCode: 404,
      };
    }

    // 2. Resolve owner name
    let ownerName: string | null = null;
    if (deal.owner_id) {
      const { data: owner } = await supabase
        .from('owners')
        .select('first_name, last_name')
        .eq('id', deal.owner_id)
        .single();

      if (owner) {
        ownerName = [owner.first_name, owner.last_name].filter(Boolean).join(' ') || null;
      }
    }

    // 3. Resolve stage name
    const stageName = STAGE_LABEL_MAP.get(deal.deal_stage) || deal.deal_stage || 'Unknown';

    // 4. Get contact emails from HubSpot
    const emails = await getContactEmailsByDealId(dealId);

    const serviceClient = createServiceClient();
    const now = new Date().toISOString();

    // Base row for deal_enrichments upsert
    const baseRow = {
      hubspot_deal_id: dealId,
      deal_name: deal.deal_name,
      owner_name: ownerName,
      owner_id: deal.owner_id,
      stage_name: stageName,
      amount: deal.amount ? Number(deal.amount) : null,
      close_date: deal.close_date,
    };

    // 5. No contacts → save status and return
    if (emails.length === 0) {
      const row = {
        ...baseRow,
        status: 'no_contacts',
        domain: null,
        contact_emails: null,
        selected_email: null,
        error_message: null,
        analyzed_at: now,
      };

      await serviceClient.from('deal_enrichments').upsert(row, { onConflict: 'hubspot_deal_id' });

      return {
        success: true,
        enrichment: {
          hubspot_deal_id: dealId,
          status: 'no_contacts',
          domain: null,
          contact_emails: [],
          selected_email: null,
          deal_name: deal.deal_name,
          analyzed_at: now,
        },
      };
    }

    // 6. Extract domains, filter free providers
    const domainCandidates: { email: string; domain: string }[] = [];
    for (const email of emails) {
      const domain = extractDomain(email);
      if (domain && !isFreeEmailProvider(domain)) {
        domainCandidates.push({ email, domain });
      }
    }

    // 7. All free emails → save status and return
    if (domainCandidates.length === 0) {
      const row = {
        ...baseRow,
        status: 'free_email_only',
        domain: null,
        contact_emails: emails,
        selected_email: null,
        error_message: null,
        analyzed_at: now,
      };

      await serviceClient.from('deal_enrichments').upsert(row, { onConflict: 'hubspot_deal_id' });

      return {
        success: true,
        enrichment: {
          hubspot_deal_id: dealId,
          status: 'free_email_only',
          domain: null,
          contact_emails: emails,
          selected_email: null,
          deal_name: deal.deal_name,
          analyzed_at: now,
        },
      };
    }

    // 8. Pick first non-free domain
    const selected = domainCandidates[0];

    // 9. Run enrichment pipeline
    const enrichResult = await enrichDomain(selected.domain, {
      force,
      verbose: false,
      sourceEmail: selected.email,
    });

    // 10. Map enrichment result status to our status
    let status: 'enriched' | 'failed';
    if (enrichResult.status === 'success' || enrichResult.status === 'already_enriched') {
      status = 'enriched';
    } else {
      status = 'failed';
    }

    const row = {
      ...baseRow,
      status,
      domain: selected.domain,
      contact_emails: emails,
      selected_email: selected.email,
      error_message: enrichResult.error || null,
      analyzed_at: now,
    };

    await serviceClient.from('deal_enrichments').upsert(row, { onConflict: 'hubspot_deal_id' });

    return {
      success: true,
      enrichment: {
        hubspot_deal_id: dealId,
        status,
        domain: selected.domain,
        contact_emails: emails,
        selected_email: selected.email,
        deal_name: deal.deal_name,
        analyzed_at: now,
        error_message: enrichResult.error,
      },
    };
  } catch (error) {
    console.error(`Domain enrichment failed for deal ${dealId}:`, error);
    return {
      success: false,
      error: 'Enrichment failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      statusCode: 500,
    };
  }
}
