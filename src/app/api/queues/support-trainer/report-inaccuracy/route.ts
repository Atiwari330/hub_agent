import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

/**
 * POST /api/queues/support-trainer/report-inaccuracy
 * Report an inaccuracy in a ticket's AI training analysis
 */
export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_TRAINER);
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  try {
    const { ticketId, reason } = await request.json();

    if (!ticketId || !reason?.trim()) {
      return NextResponse.json({ error: 'ticketId and reason are required' }, { status: 400 });
    }

    const serviceClient = createServiceClient();
    const { data, error } = await serviceClient
      .from('trainer_inaccuracy_reports')
      .insert({
        hubspot_ticket_id: ticketId,
        user_id: user.id,
        reason: reason.trim(),
      })
      .select()
      .single();

    if (error) {
      console.error('Report inaccuracy error:', error);
      return NextResponse.json({ error: 'Failed to report inaccuracy', details: error.message }, { status: 500 });
    }

    return NextResponse.json({
      report: {
        id: data.id,
        ticketId: data.hubspot_ticket_id,
        userId: data.user_id,
        displayName: user.displayName || user.email,
        reason: data.reason,
        createdAt: data.created_at,
      },
    });
  } catch (error) {
    console.error('Report inaccuracy error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
