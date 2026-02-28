import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_DOMAIN_ENRICHMENT);
  if (authResult instanceof NextResponse) return authResult;

  const domain = request.nextUrl.searchParams.get('domain');
  if (!domain) {
    return NextResponse.json({ error: 'domain parameter is required' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

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
