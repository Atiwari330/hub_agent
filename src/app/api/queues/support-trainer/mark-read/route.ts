import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

/**
 * POST /api/queues/support-trainer/mark-read
 * Mark a ticket's training analysis as reviewed by the current user
 */
export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_TRAINER);
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  try {
    const { ticketId } = await request.json();

    if (!ticketId) {
      return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
    }

    const serviceClient = createServiceClient();
    const { data, error } = await serviceClient
      .from('trainer_read_confirmations')
      .upsert(
        {
          hubspot_ticket_id: ticketId,
          user_id: user.id,
          read_at: new Date().toISOString(),
        },
        { onConflict: 'hubspot_ticket_id,user_id' }
      )
      .select()
      .single();

    if (error) {
      console.error('Mark read error:', error);
      return NextResponse.json({ error: 'Failed to mark as read', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, readAt: data.read_at });
  } catch (error) {
    console.error('Mark read error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
