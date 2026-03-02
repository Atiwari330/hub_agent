import { createServerSupabaseClient } from '@/lib/supabase/client';
import { researchCompliance } from '@/lib/research/compliance-pipeline';

// --- Types ---

export interface ComplianceAnalyzeResult {
  hubspot_deal_id: string;
  domain: string | null;
  status: 'completed' | 'already_researched' | 'failed';
  deal_name: string | null;
  researched_at: string;
  error_message?: string;
}

export type AnalyzeResult =
  | { success: true; result: ComplianceAnalyzeResult }
  | { success: false; error: string; details?: string; statusCode?: number };

// --- Main Function ---

export async function analyzeComplianceResearch(
  dealId: string,
  options?: { force?: boolean }
): Promise<AnalyzeResult> {
  const force = options?.force ?? false;

  try {
    // 1. Fetch deal from Supabase
    const supabase = await createServerSupabaseClient();
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('hubspot_deal_id, deal_name')
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

    // 2. Fetch deal enrichment to get domain
    const { data: enrichment, error: enrichError } = await supabase
      .from('deal_enrichments')
      .select('domain, status')
      .eq('hubspot_deal_id', dealId)
      .single();

    if (enrichError || !enrichment || enrichment.status !== 'enriched' || !enrichment.domain) {
      console.error(`Deal not enriched: dealId=${dealId}, enrichError=${enrichError?.message}, status=${enrichment?.status}, domain=${enrichment?.domain}`);
      return {
        success: false,
        error: 'Deal not enriched',
        details: `Domain enrichment must be completed before compliance research (status: ${enrichment?.status || 'missing'}, domain: ${enrichment?.domain || 'none'})`,
        statusCode: 422,
      };
    }

    // 3. Run compliance research pipeline
    const result = await researchCompliance(enrichment.domain, dealId, { force });

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        details: result.details,
        statusCode: result.statusCode,
      };
    }

    return {
      success: true,
      result: {
        hubspot_deal_id: dealId,
        domain: enrichment.domain,
        status: result.status,
        deal_name: deal.deal_name,
        researched_at: result.researchedAt,
      },
    };
  } catch (error) {
    console.error(`Compliance research failed for deal ${dealId}:`, error);
    return {
      success: false,
      error: 'Compliance research failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      statusCode: 500,
    };
  }
}
