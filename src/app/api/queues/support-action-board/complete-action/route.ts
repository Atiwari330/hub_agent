import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { completeActionItems } from '@/lib/ai/passes/action-items-db';
import { routeEvent } from '@/lib/events/event-router';

export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_ACTION_BOARD);
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  try {
    const body = await request.json();
    const { ticketId, actionItemId, actionDescription } = body;

    if (!ticketId || !actionItemId || !actionDescription) {
      return NextResponse.json(
        { error: 'ticketId, actionItemId, and actionDescription are required' },
        { status: 400 }
      );
    }

    // Update the action_items table directly
    await completeActionItems(ticketId, [actionItemId], 'manual', user.id);

    // Also write to legacy action_item_completions for backward compat
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from('action_item_completions')
      .upsert(
        {
          hubspot_ticket_id: ticketId,
          action_item_id: actionItemId,
          action_description: actionDescription,
          completed_by: user.id,
          completed_at: new Date().toISOString(),
          verified: null,
          verification_note: null,
        },
        { onConflict: 'hubspot_ticket_id,action_item_id,completed_by' }
      )
      .select()
      .single();

    if (error) {
      console.warn('[complete-action] Legacy completion upsert failed:', error.message);
    }

    // Emit internal event to trigger verification pass (async, don't block response)
    routeEvent({
      source: 'internal',
      type: 'action_completed',
      ticketId,
      timestamp: new Date().toISOString(),
      metadata: { actionItemId, completionId: data?.id },
    }).catch((err) => {
      console.error('[complete-action] Failed to route event:', err);
    });

    return NextResponse.json({ success: true, completion: data });
  } catch (error) {
    console.error('Complete action error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
