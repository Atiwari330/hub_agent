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

    // Fetch shift completions in the date range
    const { data: shiftCompletions } = await supabase
      .from('shift_completions')
      .select('user_id, tickets_reviewed, tickets_total, completed_at')
      .gte('completed_at', startDate)
      .order('completed_at', { ascending: false });

    // Fetch shift reviews in the date range (for per-ticket detail)
    const { data: shiftReviews } = await supabase
      .from('shift_reviews')
      .select('user_id, hubspot_ticket_id, acknowledgment_tag, reviewed_at')
      .gte('reviewed_at', startDate);

    // Fetch unverified action completions
    const { data: unverifiedActions } = await supabase
      .from('action_item_completions')
      .select('hubspot_ticket_id, action_description, completed_by, completed_at, verification_note')
      .eq('verified', false)
      .gte('completed_at', startDate);

    // Fetch tickets that had zero reviews today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: openTickets } = await supabase
      .from('support_tickets')
      .select('hubspot_ticket_id, subject, hs_primary_company_name')
      .eq('is_closed', false);

    const { data: todayReviews } = await supabase
      .from('shift_reviews')
      .select('hubspot_ticket_id')
      .gte('reviewed_at', todayStart.toISOString());

    const reviewedToday = new Set((todayReviews || []).map((r) => r.hubspot_ticket_id));
    const unreviewedTickets = (openTickets || []).filter(
      (t) => !reviewedToday.has(t.hubspot_ticket_id)
    );

    // Build agent summary
    const agentSummary = (agents || []).map((agent) => {
      const completions = (shiftCompletions || []).filter((c) => c.user_id === agent.id);
      const reviews = (shiftReviews || []).filter((r) => r.user_id === agent.id);

      // Group reviews by date
      const reviewsByDate: Record<string, number> = {};
      for (const r of reviews) {
        const date = new Date(r.reviewed_at).toISOString().split('T')[0];
        reviewsByDate[date] = (reviewsByDate[date] || 0) + 1;
      }

      // Group shift completions by date
      const shiftsByDate: Record<string, { reviewed: number; total: number }> = {};
      for (const c of completions) {
        const date = new Date(c.completed_at).toISOString().split('T')[0];
        shiftsByDate[date] = {
          reviewed: c.tickets_reviewed,
          total: c.tickets_total,
        };
      }

      return {
        id: agent.id,
        name: agent.display_name || agent.email || 'Unknown',
        role: agent.role,
        totalShiftCompletions: completions.length,
        totalReviews: reviews.length,
        reviewsByDate,
        shiftsByDate,
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
      unreviewedTicketsToday: unreviewedTickets.map((t) => ({
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
