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
    const { ticketId, noteText } = body;

    if (!ticketId || !noteText) {
      return NextResponse.json(
        { error: 'ticketId and noteText are required' },
        { status: 400 }
      );
    }

    if (typeof noteText !== 'string' || noteText.trim().length < 10) {
      return NextResponse.json(
        { error: 'noteText must be at least 10 characters' },
        { status: 400 }
      );
    }

    const supabase = await createServerSupabaseClient();

    // Delete any existing note for this user+ticket today, then insert new
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    await supabase
      .from('progress_notes')
      .delete()
      .eq('user_id', user.id)
      .eq('hubspot_ticket_id', ticketId)
      .gte('created_at', todayStart.toISOString());

    const { data, error } = await supabase
      .from('progress_notes')
      .insert({
        user_id: user.id,
        hubspot_ticket_id: ticketId,
        note_text: noteText.trim(),
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: 'Failed to save progress note', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, note: data });
  } catch (error) {
    console.error('Progress note error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
