import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

const VALID_STATUSES = ['acknowledged', 'in_progress', 'done', 'blocked'] as const;

/**
 * POST /api/queues/support-manager/cs-status
 * Set ticket status (cs_manager only)
 */
export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_MANAGER);
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  if (user.role !== 'cs_manager' && user.role !== 'vp_revops') {
    return NextResponse.json({ error: 'Only CS Manager or VP RevOps can set ticket status' }, { status: 403 });
  }

  try {
    const { ticketId, status, notes } = await request.json();

    if (!ticketId || !status) {
      return NextResponse.json({ error: 'ticketId and status are required' }, { status: 400 });
    }

    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
    }

    const serviceClient = createServiceClient();
    const { data: csStatus, error } = await serviceClient
      .from('ticket_cs_statuses')
      .upsert(
        {
          hubspot_ticket_id: ticketId,
          status,
          updated_by: user.id,
          notes: notes || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'hubspot_ticket_id' }
      )
      .select()
      .single();

    if (error) {
      console.error('CS status upsert error:', error);
      return NextResponse.json({ error: 'Failed to update status', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ csStatus });
  } catch (error) {
    console.error('CS status error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
