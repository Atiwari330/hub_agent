import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_ACTION_BOARD);
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  // Only VP and CS Manager can view accountability report
  if (user.role !== 'vp_revops' && user.role !== 'cs_manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const daysBack = parseInt(request.nextUrl.searchParams.get('days') || '7', 10);
  const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  try {
    // Fetch all support agents
    const { data: agents } = await supabase
      .from('user_profiles')
      .select('id, display_name, email, role')
      .in('role', ['support_agent', 'cs_manager']);

    // Fetch progress notes in the date range
    const { data: progressNotes } = await supabase
      .from('progress_notes')
      .select('user_id, hubspot_ticket_id, note_text, created_at')
      .gte('created_at', startDate)
      .order('created_at', { ascending: false });

    // Fetch unverified action completions
    const { data: unverifiedActions } = await supabase
      .from('action_item_completions')
      .select('hubspot_ticket_id, action_description, completed_by, completed_at, verification_note')
      .eq('verified', false)
      .gte('completed_at', startDate);

    // Fetch tickets that had zero notes today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: openTickets } = await supabase
      .from('support_tickets')
      .select('hubspot_ticket_id, subject, hs_primary_company_name')
      .eq('is_closed', false);

    const { data: todayNotes } = await supabase
      .from('progress_notes')
      .select('hubspot_ticket_id')
      .gte('created_at', todayStart.toISOString());

    const notedToday = new Set((todayNotes || []).map((n) => n.hubspot_ticket_id));
    const unnotedTickets = (openTickets || []).filter(
      (t) => !notedToday.has(t.hubspot_ticket_id)
    );

    // Build agent summary
    const agentSummary = (agents || []).map((agent) => {
      const notes = (progressNotes || []).filter((n) => n.user_id === agent.id);

      // Group notes by date
      const notesByDate: Record<string, number> = {};
      for (const n of notes) {
        const date = new Date(n.created_at).toISOString().split('T')[0];
        notesByDate[date] = (notesByDate[date] || 0) + 1;
      }

      return {
        id: agent.id,
        name: agent.display_name || agent.email || 'Unknown',
        role: agent.role,
        totalNotes: notes.length,
        notesByDate,
      };
    });

    // Resolve user names for unverified actions
    const unverifiedUserIds = [...new Set((unverifiedActions || []).map((a) => a.completed_by))];
    const { data: unverifiedUsers } = await supabase
      .from('user_profiles')
      .select('id, display_name, email')
      .in('id', unverifiedUserIds);
    const unverifiedUserMap = new Map(
      (unverifiedUsers || []).map((u) => [u.id, u.display_name || u.email || 'Unknown'])
    );

    return NextResponse.json({
      agents: agentSummary,
      unnotedTicketsToday: unnotedTickets.map((t) => ({
        ticketId: t.hubspot_ticket_id,
        subject: t.subject,
        companyName: t.hs_primary_company_name,
      })),
      unverifiedActions: (unverifiedActions || []).map((a) => ({
        ticketId: a.hubspot_ticket_id,
        actionDescription: a.action_description,
        completedBy: unverifiedUserMap.get(a.completed_by) || 'Unknown',
        completedAt: a.completed_at,
        verificationNote: a.verification_note,
      })),
      period: {
        startDate,
        endDate: new Date().toISOString(),
        daysBack,
      },
    });
  } catch (error) {
    console.error('Accountability report error:', error);
    return NextResponse.json(
      { error: 'Failed to generate accountability report', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
