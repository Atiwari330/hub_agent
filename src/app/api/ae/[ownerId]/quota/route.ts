import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { z } from 'zod';
import { getCurrentQuarter } from '@/lib/utils/quarter';

const QuotaRequestSchema = z.object({
  fiscalYear: z.number().int().min(2020).max(2100),
  fiscalQuarter: z.number().int().min(1).max(4),
  quotaAmount: z.number().positive(),
});

interface RouteParams {
  params: Promise<{ ownerId: string }>;
}

// POST - Create or update quota for an AE
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { ownerId } = await params;
    const supabase = await createServerSupabaseClient();

    // Validate request body
    const body = await request.json();
    const validationResult = QuotaRequestSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: validationResult.error.flatten() },
        { status: 400 }
      );
    }

    const { fiscalYear, fiscalQuarter, quotaAmount } = validationResult.data;

    // Verify owner exists
    const { data: owner, error: ownerError } = await supabase
      .from('owners')
      .select('id')
      .eq('id', ownerId)
      .single();

    if (ownerError || !owner) {
      return NextResponse.json(
        { error: 'Owner not found' },
        { status: 404 }
      );
    }

    // Upsert quota
    const { data: quota, error: quotaError } = await supabase
      .from('quotas')
      .upsert(
        {
          owner_id: ownerId,
          fiscal_year: fiscalYear,
          fiscal_quarter: fiscalQuarter,
          quota_amount: quotaAmount,
        },
        {
          onConflict: 'owner_id,fiscal_year,fiscal_quarter',
        }
      )
      .select()
      .single();

    if (quotaError) {
      console.error('Error upserting quota:', quotaError);
      return NextResponse.json(
        { error: 'Failed to save quota', details: quotaError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      quota,
    });
  } catch (error) {
    console.error('Quota API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET - Get quota for an AE (defaults to current quarter)
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { ownerId } = await params;
    const supabase = await createServerSupabaseClient();

    // Get query params for specific quarter, or default to current
    const searchParams = request.nextUrl.searchParams;
    const currentQ = getCurrentQuarter();
    const fiscalYear = parseInt(searchParams.get('year') || String(currentQ.year));
    const fiscalQuarter = parseInt(searchParams.get('quarter') || String(currentQ.quarter));

    // Verify owner exists
    const { data: owner, error: ownerError } = await supabase
      .from('owners')
      .select('id, first_name, last_name, email')
      .eq('id', ownerId)
      .single();

    if (ownerError || !owner) {
      return NextResponse.json(
        { error: 'Owner not found' },
        { status: 404 }
      );
    }

    // Get quota for this quarter
    const { data: quota } = await supabase
      .from('quotas')
      .select('*')
      .eq('owner_id', ownerId)
      .eq('fiscal_year', fiscalYear)
      .eq('fiscal_quarter', fiscalQuarter)
      .single();

    return NextResponse.json({
      owner,
      fiscalYear,
      fiscalQuarter,
      quota: quota || null,
    });
  } catch (error) {
    console.error('Quota GET API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
