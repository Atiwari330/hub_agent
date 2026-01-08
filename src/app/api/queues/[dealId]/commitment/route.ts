import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { z } from 'zod';

interface RouteParams {
  params: Promise<{ dealId: string }>;
}

const SetCommitmentSchema = z.object({
  commitmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
});

/**
 * GET /api/queues/[dealId]/commitment
 * Get the current commitment for a deal
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { dealId } = await params;
  const supabase = await createServerSupabaseClient();

  try {
    // Verify deal exists
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('id, deal_name, owner_id')
      .eq('id', dealId)
      .single();

    if (dealError || !deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    // Get the most recent pending commitment
    const { data: commitment, error: commitmentError } = await supabase
      .from('hygiene_commitments')
      .select('*')
      .eq('deal_id', dealId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (commitmentError && commitmentError.code !== 'PGRST116') {
      // PGRST116 is "no rows returned" which is fine
      console.error('Error fetching commitment:', commitmentError);
      return NextResponse.json(
        { error: 'Failed to fetch commitment', details: commitmentError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      dealId,
      commitment: commitment
        ? {
            id: commitment.id,
            commitmentDate: commitment.commitment_date,
            committedAt: commitment.committed_at,
            status: commitment.status,
          }
        : null,
    });
  } catch (error) {
    console.error('Get commitment error:', error);
    return NextResponse.json(
      { error: 'Failed to get commitment', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/queues/[dealId]/commitment
 * Set a new commitment date for a deal
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { dealId } = await params;
  const supabase = await createServerSupabaseClient();

  try {
    // Parse and validate request body
    const body = await request.json();
    const parsed = SetCommitmentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { commitmentDate } = parsed.data;

    // Validate commitment date is in the future
    const commitDate = new Date(commitmentDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (commitDate < today) {
      return NextResponse.json(
        { error: 'Commitment date must be today or in the future' },
        { status: 400 }
      );
    }

    // Verify deal exists and get owner_id
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('id, deal_name, owner_id')
      .eq('id', dealId)
      .single();

    if (dealError || !deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    if (!deal.owner_id) {
      return NextResponse.json({ error: 'Deal has no owner assigned' }, { status: 400 });
    }

    // Check for existing pending commitment
    const { data: existingCommitment } = await supabase
      .from('hygiene_commitments')
      .select('id')
      .eq('deal_id', dealId)
      .eq('status', 'pending')
      .single();

    let commitment;

    if (existingCommitment) {
      // Update existing commitment
      const { data: updated, error: updateError } = await supabase
        .from('hygiene_commitments')
        .update({
          commitment_date: commitmentDate,
          committed_at: new Date().toISOString(),
        })
        .eq('id', existingCommitment.id)
        .select()
        .single();

      if (updateError) {
        console.error('Error updating commitment:', updateError);
        return NextResponse.json(
          { error: 'Failed to update commitment', details: updateError.message },
          { status: 500 }
        );
      }

      commitment = updated;
    } else {
      // Create new commitment
      const { data: created, error: createError } = await supabase
        .from('hygiene_commitments')
        .insert({
          deal_id: dealId,
          owner_id: deal.owner_id,
          commitment_date: commitmentDate,
          status: 'pending',
        })
        .select()
        .single();

      if (createError) {
        console.error('Error creating commitment:', createError);
        return NextResponse.json(
          { error: 'Failed to create commitment', details: createError.message },
          { status: 500 }
        );
      }

      commitment = created;
    }

    return NextResponse.json({
      success: true,
      commitment: {
        id: commitment.id,
        dealId: commitment.deal_id,
        commitmentDate: commitment.commitment_date,
        status: commitment.status,
      },
    });
  } catch (error) {
    console.error('Set commitment error:', error);
    return NextResponse.json(
      { error: 'Failed to set commitment', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/queues/[dealId]/commitment
 * Clear the commitment for a deal (mark as completed if deal is now compliant)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { dealId } = await params;
  const supabase = await createServerSupabaseClient();

  try {
    // Verify deal exists
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('id')
      .eq('id', dealId)
      .single();

    if (dealError || !deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    // Update pending commitment to completed
    const { error: updateError } = await supabase
      .from('hygiene_commitments')
      .update({
        status: 'completed',
        resolved_at: new Date().toISOString(),
      })
      .eq('deal_id', dealId)
      .eq('status', 'pending');

    if (updateError) {
      console.error('Error clearing commitment:', updateError);
      return NextResponse.json(
        { error: 'Failed to clear commitment', details: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Clear commitment error:', error);
    return NextResponse.json(
      { error: 'Failed to clear commitment', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
