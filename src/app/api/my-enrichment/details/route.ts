import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_ENRICHMENT_VIEW);
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  if (!user.hubspotOwnerId) {
    return NextResponse.json({ error: 'No HubSpot owner linked' }, { status: 403 });
  }

  const domain = request.nextUrl.searchParams.get('domain');
  if (!domain) {
    return NextResponse.json({ error: 'domain parameter is required' }, { status: 400 });
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

  const { data, error } = await supabase
    .from('domain_enrichments')
    .select('company_name, company_overview, services, specialties, team_members, community_events, locations, pages_scraped, confidence_score, enriched_at')
    .eq('domain', domain)
    .single();

  if (error) {
    return NextResponse.json({ error: 'Domain not found' }, { status: 404 });
  }

  return NextResponse.json(data);
}
