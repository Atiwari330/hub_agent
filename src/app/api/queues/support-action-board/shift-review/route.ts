import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_ACTION_BOARD);
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  try {
    const body = await request.json();
    const { ticketId, acknowledgmentTag, attentionTarget, blockedReason, shiftNote } = body;

    if (!ticketId || !acknowledgmentTag) {
      return NextResponse.json(
        { error: 'ticketId and acknowledgmentTag are required' },
        { status: 400 }
      );
    }

    const validTags = ['nothing_needed', 'i_can_action', 'needs_attention', 'blocked'];
    if (!validTags.includes(acknowledgmentTag)) {
      return NextResponse.json(
        { error: `acknowledgmentTag must be one of: ${validTags.join(', ')}` },
        { status: 400 }
      );
    }

    const supabase = await createServerSupabaseClient();

    // Check if already reviewed today — upsert by deleting old and inserting new
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Delete any existing review for this user+ticket today
    await supabase
      .from('shift_reviews')
      .delete()
      .eq('user_id', user.id)
      .eq('hubspot_ticket_id', ticketId)
      .gte('reviewed_at', todayStart.toISOString());

    // Insert new review
    const { data, error } = await supabase
      .from('shift_reviews')
      .insert({
        user_id: user.id,
        hubspot_ticket_id: ticketId,
        acknowledgment_tag: acknowledgmentTag,
        attention_target: attentionTarget || null,
        blocked_reason: blockedReason || null,
        shift_note: shiftNote || null,
        reviewed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: 'Failed to submit review', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, review: data });
  } catch (error) {
    console.error('Shift review error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
