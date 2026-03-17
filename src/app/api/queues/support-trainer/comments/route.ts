import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

/**
 * GET /api/queues/support-trainer/comments?ticketId=xxx
 * Fetch comments for a ticket, joined with user profiles for display names
 */
export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_TRAINER);
  if (authResult instanceof NextResponse) return authResult;

  const ticketId = request.nextUrl.searchParams.get('ticketId');
  if (!ticketId) {
    return NextResponse.json({ error: 'ticketId query param is required' }, { status: 400 });
  }

  try {
    const serviceClient = createServiceClient();
    const { data: comments, error } = await serviceClient
      .from('trainer_comments')
      .select('id, hubspot_ticket_id, user_id, body, created_at, user_profiles(display_name, email)')
      .eq('hubspot_ticket_id', ticketId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Fetch comments error:', error);
      return NextResponse.json({ error: 'Failed to fetch comments', details: error.message }, { status: 500 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formatted = (comments || []).map((c: any) => ({
      id: c.id,
      ticketId: c.hubspot_ticket_id,
      userId: c.user_id,
      displayName: c.user_profiles?.display_name || c.user_profiles?.email || 'Unknown',
      body: c.body,
      createdAt: c.created_at,
    }));

    return NextResponse.json({ comments: formatted });
  } catch (error) {
    console.error('Comments GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/queues/support-trainer/comments
 * Create a comment on a ticket's training analysis
 */
export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_TRAINER);
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  try {
    const { ticketId, body } = await request.json();

    if (!ticketId || !body?.trim()) {
      return NextResponse.json({ error: 'ticketId and body are required' }, { status: 400 });
    }

    const serviceClient = createServiceClient();
    const { data, error } = await serviceClient
      .from('trainer_comments')
      .insert({
        hubspot_ticket_id: ticketId,
        user_id: user.id,
        body: body.trim(),
      })
      .select()
      .single();

    if (error) {
      console.error('Create comment error:', error);
      return NextResponse.json({ error: 'Failed to create comment', details: error.message }, { status: 500 });
    }

    return NextResponse.json({
      comment: {
        id: data.id,
        ticketId: data.hubspot_ticket_id,
        userId: data.user_id,
        displayName: user.displayName || user.email,
        body: data.body,
        createdAt: data.created_at,
      },
    });
  } catch (error) {
    console.error('Comments POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
