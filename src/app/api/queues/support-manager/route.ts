import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { getOwnerById } from '@/lib/hubspot/owners';
import type { TicketSupportManagerAnalysis } from './analyze/analyze-core';

// --- Types ---

export interface VoiceMemoInfo {
  id: string;
  durationSeconds: number | null;
  createdAt: string;
  acknowledgedAt: string | null;
}

export interface CsStatusInfo {
  status: 'acknowledged' | 'in_progress' | 'done' | 'blocked';
  updatedAt: string;
  notes: string | null;
}

export interface SupportManagerTicket {
  ticketId: string;
  subject: string | null;
  sourceType: string | null;
  priority: string | null;
  ballInCourt: string | null;
  software: string | null;
  companyName: string | null;
  assignedRep: string | null;
  ageDays: number;
  isClosed: boolean;
  linearTask: string | null;
  analysis: TicketSupportManagerAnalysis | null;
  voiceMemo: VoiceMemoInfo | null;
  csStatus: CsStatusInfo | null;
}

export interface SupportManagerResponse {
  tickets: SupportManagerTicket[];
  counts: {
    total: number;
    analyzed: number;
    unanalyzed: number;
    byUrgency: { critical: number; high: number; medium: number; low: number };
  };
  userRole: string;
}

// --- Route Handler ---

export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_MANAGER);
  if (authResult instanceof NextResponse) return authResult;
  const currentUser = authResult;

  const supabase = await createServerSupabaseClient();

  const mode = request.nextUrl.searchParams.get('mode');
  const actionOwnerFilter = request.nextUrl.searchParams.get('actionOwnerFilter');

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let allTickets: any[] = [];

    if (mode === 'last200') {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .order('hubspot_created_at', { ascending: false })
        .limit(200);

      if (error) {
        return NextResponse.json({ error: 'Failed to fetch tickets', details: error.message }, { status: 500 });
      }
      allTickets = data || [];
    } else {
      // Default: open tickets only
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('is_closed', false);

      if (error) {
        return NextResponse.json({ error: 'Failed to fetch tickets', details: error.message }, { status: 500 });
      }
      allTickets = data || [];
    }

    // Fetch all support manager analyses for these tickets
    const ticketIds = allTickets.map((t) => t.hubspot_ticket_id);
    const analyses: Record<string, TicketSupportManagerAnalysis> = {};

    if (ticketIds.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < ticketIds.length; i += batchSize) {
        const batch = ticketIds.slice(i, i + batchSize);
        const { data: rows } = await supabase
          .from('ticket_support_manager_analyses')
          .select('*')
          .in('hubspot_ticket_id', batch);

        for (const row of rows || []) {
          analyses[row.hubspot_ticket_id] = {
            hubspot_ticket_id: row.hubspot_ticket_id,
            issue_summary: row.issue_summary,
            next_action: row.next_action,
            follow_up_cadence: row.follow_up_cadence || null,
            urgency: row.urgency,
            reasoning: row.reasoning,
            engagement_summary: row.engagement_summary,
            linear_summary: row.linear_summary,
            days_since_last_activity: row.days_since_last_activity,
            last_activity_by: row.last_activity_by,
            ticket_subject: row.ticket_subject,
            company_name: row.company_name,
            assigned_rep: row.assigned_rep,
            age_days: row.age_days,
            is_closed: row.is_closed,
            has_linear: row.has_linear,
            linear_state: row.linear_state,
            confidence: parseFloat(row.confidence),
            knowledge_used: row.knowledge_used || null,
            action_owner: row.action_owner || null,
            analyzed_at: row.analyzed_at,
          };
        }
      }
    }

    // Resolve owner names (DB first, HubSpot API fallback for support-only agents)
    const ownerIds = [...new Set(allTickets.map((t) => t.hubspot_owner_id).filter(Boolean))];
    const ownerMap: Record<string, string> = {};
    if (ownerIds.length > 0) {
      const { data: owners } = await supabase
        .from('owners')
        .select('hubspot_owner_id, first_name, last_name, email')
        .in('hubspot_owner_id', ownerIds);
      for (const o of owners || []) {
        ownerMap[o.hubspot_owner_id] = [o.first_name, o.last_name].filter(Boolean).join(' ') || o.email || 'Unknown';
      }
      // Fetch missing owners from HubSpot API
      const missingIds = ownerIds.filter((id) => !ownerMap[id as string]) as string[];
      for (const id of missingIds) {
        try {
          const hsOwner = await getOwnerById(id);
          if (hsOwner) {
            ownerMap[id] = [hsOwner.firstName, hsOwner.lastName].filter(Boolean).join(' ') || hsOwner.email || 'Unknown';
          }
        } catch {
          // skip — owner will show as unassigned
        }
      }
    }

    // Fetch voice memos for all tickets
    const voiceMemos: Record<string, VoiceMemoInfo> = {};
    if (ticketIds.length > 0) {
      const { data: memoRows } = await supabase
        .from('ticket_voice_memos')
        .select('id, hubspot_ticket_id, duration_seconds, created_at, acknowledged_at')
        .in('hubspot_ticket_id', ticketIds);

      for (const row of memoRows || []) {
        voiceMemos[row.hubspot_ticket_id] = {
          id: row.id,
          durationSeconds: row.duration_seconds,
          createdAt: row.created_at,
          acknowledgedAt: row.acknowledged_at,
        };
      }
    }

    // Fetch CS statuses for all tickets
    const csStatuses: Record<string, CsStatusInfo> = {};
    if (ticketIds.length > 0) {
      const { data: statusRows } = await supabase
        .from('ticket_cs_statuses')
        .select('hubspot_ticket_id, status, updated_at, notes')
        .in('hubspot_ticket_id', ticketIds);

      for (const row of statusRows || []) {
        csStatuses[row.hubspot_ticket_id] = {
          status: row.status,
          updatedAt: row.updated_at,
          notes: row.notes,
        };
      }
    }

    // Build ticket list
    const now = new Date();
    let tickets: SupportManagerTicket[] = allTickets.map((ticket) => {
      const createdAt = ticket.hubspot_created_at ? new Date(ticket.hubspot_created_at) : now;
      const ageDays = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

      return {
        ticketId: ticket.hubspot_ticket_id,
        subject: ticket.subject,
        sourceType: ticket.source_type,
        priority: ticket.priority,
        ballInCourt: ticket.ball_in_court,
        software: ticket.software,
        companyName: ticket.hs_primary_company_name,
        isCoDestiny: ticket.is_co_destiny || false,
        assignedRep: ticket.hubspot_owner_id ? ownerMap[ticket.hubspot_owner_id] || null : null,
        ageDays,
        isClosed: ticket.is_closed || false,
        linearTask: ticket.linear_task || null,
        analysis: analyses[ticket.hubspot_ticket_id] || null,
        voiceMemo: voiceMemos[ticket.hubspot_ticket_id] || null,
        csStatus: csStatuses[ticket.hubspot_ticket_id] || null,
      };
    });

    // Apply action owner filter (for CS Manager "My Team" view)
    if (actionOwnerFilter === 'team') {
      const teamOwners = ['Support Agent', 'Support Manager'];
      tickets = tickets.filter((t) =>
        !t.analysis || !t.analysis.action_owner || teamOwners.includes(t.analysis.action_owner)
      );
    }

    // Sort: unanalyzed first, then by urgency (critical > high > medium > low), then by age
    const urgencyOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    tickets.sort((a, b) => {
      if (a.analysis && !b.analysis) return 1;
      if (!a.analysis && b.analysis) return -1;
      if (a.analysis && b.analysis) {
        const aUrg = urgencyOrder[a.analysis.urgency] ?? 4;
        const bUrg = urgencyOrder[b.analysis.urgency] ?? 4;
        if (aUrg !== bUrg) return aUrg - bUrg;
      }
      return b.ageDays - a.ageDays;
    });

    // Compute counts
    const analyzed = tickets.filter((t) => t.analysis).length;
    const byUrgency = { critical: 0, high: 0, medium: 0, low: 0 };

    for (const t of tickets) {
      if (t.analysis) {
        const urg = t.analysis.urgency as keyof typeof byUrgency;
        if (urg in byUrgency) byUrgency[urg]++;
      }
    }

    const response: SupportManagerResponse = {
      tickets,
      counts: {
        total: tickets.length,
        analyzed,
        unanalyzed: tickets.length - analyzed,
        byUrgency,
      },
      userRole: currentUser.role,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Support manager queue error:', error);
    return NextResponse.json(
      { error: 'Failed to get support manager data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
