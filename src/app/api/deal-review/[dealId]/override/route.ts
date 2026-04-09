import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { createServiceClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { computeLikelihoodTier } from '@/lib/command-center/config';
import { z } from 'zod';

const OverrideSchema = z.object({
  override_likelihood: z.enum([
    'highly_likely',
    'likely',
    'possible',
    'unlikely',
    'not_this_quarter',
    'insufficient_data',
  ]),
  override_reason: z.string().min(1, 'Reason is required'),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const authResult = await checkApiAuth(RESOURCES.AE_DEAL_REVIEW);
  if (authResult instanceof NextResponse) return authResult;

  const user = authResult;
  if (!user.hubspotOwnerId) {
    return NextResponse.json({ error: 'No HubSpot owner linked' }, { status: 403 });
  }

  const { dealId } = await params;
  const body = await request.json();
  const parsed = OverrideSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const service = createServiceClient();

  // Look up internal owner_id
  const { data: owner } = await service
    .from('owners')
    .select('id')
    .eq('hubspot_owner_id', user.hubspotOwnerId)
    .single();

  if (!owner) {
    return NextResponse.json({ error: 'Owner not found' }, { status: 404 });
  }

  // Verify the deal belongs to this AE
  const { data: intel } = await service
    .from('deal_intelligence')
    .select('owner_id, overall_score, llm_status, buyer_sentiment')
    .eq('hubspot_deal_id', dealId)
    .single();

  if (!intel || String(intel.owner_id) !== String(owner.id)) {
    return NextResponse.json({ error: 'Deal not found or not yours' }, { status: 403 });
  }

  const originalLikelihood = computeLikelihoodTier(
    intel.overall_score,
    intel.llm_status,
    intel.buyer_sentiment,
  );

  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from('deal_forecast_overrides')
    .upsert(
      {
        hubspot_deal_id: dealId,
        original_likelihood: originalLikelihood,
        override_likelihood: parsed.data.override_likelihood,
        override_reason: parsed.data.override_reason,
        overridden_by: user.email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'hubspot_deal_id' },
    );

  if (error) {
    console.error('Override save error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const authResult = await checkApiAuth(RESOURCES.AE_DEAL_REVIEW);
  if (authResult instanceof NextResponse) return authResult;

  const user = authResult;
  if (!user.hubspotOwnerId) {
    return NextResponse.json({ error: 'No HubSpot owner linked' }, { status: 403 });
  }

  const { dealId } = await params;
  const service = createServiceClient();

  // Look up internal owner_id
  const { data: owner } = await service
    .from('owners')
    .select('id')
    .eq('hubspot_owner_id', user.hubspotOwnerId)
    .single();

  if (!owner) {
    return NextResponse.json({ error: 'Owner not found' }, { status: 404 });
  }

  // Verify ownership
  const { data: intel } = await service
    .from('deal_intelligence')
    .select('owner_id')
    .eq('hubspot_deal_id', dealId)
    .single();

  if (!intel || String(intel.owner_id) !== String(owner.id)) {
    return NextResponse.json({ error: 'Deal not found or not yours' }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from('deal_forecast_overrides')
    .delete()
    .eq('hubspot_deal_id', dealId);

  if (error) {
    console.error('Override delete error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
