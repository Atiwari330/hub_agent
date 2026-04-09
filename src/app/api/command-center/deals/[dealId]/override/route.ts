import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { computeLikelihoodTier } from '@/lib/command-center/config';
import { z } from 'zod';

const OverrideSchema = z.object({
  override_likelihood: z.enum(['highly_likely', 'likely', 'possible', 'unlikely', 'insufficient_data']),
  override_amount: z.number().nullable().optional(),
  override_close_date: z.string().nullable().optional(),
  override_reason: z.string().min(1, 'Reason is required'),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const authResult = await checkApiAuth(RESOURCES.Q2_COMMAND_CENTER);
  if (authResult instanceof NextResponse) return authResult;

  const { dealId } = await params;
  const body = await request.json();
  const parsed = OverrideSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // Get current AI likelihood
  const { data: intelligence } = await supabase
    .from('deal_intelligence')
    .select('overall_score, llm_status, buyer_sentiment')
    .eq('hubspot_deal_id', dealId)
    .single();

  const originalLikelihood = intelligence
    ? computeLikelihoodTier(intelligence.overall_score, intelligence.llm_status, intelligence.buyer_sentiment)
    : 'insufficient_data';

  const { error } = await supabase
    .from('deal_forecast_overrides')
    .upsert(
      {
        hubspot_deal_id: dealId,
        original_likelihood: originalLikelihood,
        override_likelihood: parsed.data.override_likelihood,
        override_amount: parsed.data.override_amount ?? null,
        override_close_date: parsed.data.override_close_date ?? null,
        override_reason: parsed.data.override_reason,
        overridden_by: authResult.email,
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
  const authResult = await checkApiAuth(RESOURCES.Q2_COMMAND_CENTER);
  if (authResult instanceof NextResponse) return authResult;

  const { dealId } = await params;
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
