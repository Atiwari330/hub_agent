import { NextResponse } from 'next/server';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/client';
import { fetchQ2Deals } from '@/lib/command-center/fetch-q2-deals';

export async function GET() {
  const authResult = await checkApiAuth(RESOURCES.AE_DEAL_REVIEW);
  if (authResult instanceof NextResponse) return authResult;

  const user = authResult;
  if (!user.hubspotOwnerId) {
    return NextResponse.json({ error: 'No HubSpot owner linked' }, { status: 403 });
  }

  const supabase = createServiceClient();

  // Look up internal owner_id from hubspot_owner_id
  const { data: owner } = await supabase
    .from('owners')
    .select('id')
    .eq('hubspot_owner_id', user.hubspotOwnerId)
    .single();

  if (!owner) {
    return NextResponse.json({ error: 'Owner not found' }, { status: 404 });
  }

  const allDeals = await fetchQ2Deals(supabase);
  const myDeals = allDeals.filter((d) => d.ownerId === String(owner.id));

  return NextResponse.json({ deals: myDeals });
}
