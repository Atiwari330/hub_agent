import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { getOwnerById } from '@/lib/hubspot/owners';
import type { TicketActionBoardAnalysis, ActionItem, RelatedTicketInfo } from './analyze/analyze-core';

// --- Types ---

export interface ActionItemCompletion {
  id: string;
  actionItemId: string;
  actionDescription: string;
  completedBy: string;
  completedByName: string;
  completedAt: string;
  verified: boolean | null;
  verificationNote: string | null;
}

export interface ProgressNoteInfo {
  id: string;
  userId: string;
  userName: string;
  noteText: string;
  createdAt: string;
}

export interface ActionBoardTicket {
  ticketId: string;
  subject: string | null;
  sourceType: string | null;
  priority: string | null;
  ballInCourt: string | null;
  software: string | null;
  companyName: string | null;
  isCoDestiny: boolean;
  assignedRep: string | null;
  ageDays: number;
  isClosed: boolean;
  linearTask: string | null;
  analysis: TicketActionBoardAnalysis | null;
  completions: ActionItemCompletion[];
  progressNotes: ProgressNoteInfo[];
  currentUserHasNote: boolean;
  lastCustomerMessageAt: string | null;
  lastAgentMessageAt: string | null;
}

export interface ActionBoardResponse {
  tickets: ActionBoardTicket[];
  counts: {
    total: number;
    analyzed: number;
    unanalyzed: number;
    byStatus: Record<string, number>;
  };
  noteProgress: {
    noted: number;
    total: number;
  };
  changedTicketIds: string[];
  userRole: string;
  userId: string;
}

// --- Route Handler ---

export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_ACTION_BOARD);
  if (authResult instanceof NextResponse) return authResult;
  const currentUser = authResult;

  const supabase = await createServerSupabaseClient();
  const serviceClient = createServiceClient();
  const mode = request.nextUrl.searchParams.get('mode');

  try {
    // Fetch tickets
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
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('is_closed', false);

      if (error) {
        return NextResponse.json({ error: 'Failed to fetch tickets', details: error.message }, { status: 500 });
      }
      allTickets = data || [];
    }

    const ticketIds = allTickets.map((t) => t.hubspot_ticket_id);

    // Fetch analyses, completions, and progress notes in parallel
    const analyses: Record<string, TicketActionBoardAnalysis> = {};
    const completionsMap: Record<string, ActionItemCompletion[]> = {};
    const notesMap: Record<string, ProgressNoteInfo[]> = {};
    const userNotedSet = new Set<string>();

    if (ticketIds.length > 0) {
      const batchSize = 500;

      // Fetch analyses
      for (let i = 0; i < ticketIds.length; i += batchSize) {
        const batch = ticketIds.slice(i, i + batchSize);
        const { data: rows } = await supabase
          .from('ticket_action_board_analyses')
          .select('*')
          .in('hubspot_ticket_id', batch);

        for (const row of rows || []) {
          analyses[row.hubspot_ticket_id] = {
            hubspot_ticket_id: row.hubspot_ticket_id,
            situation_summary: row.situation_summary,
            action_items: (row.action_items || []) as ActionItem[],
            customer_temperature: row.customer_temperature,
            temperature_reason: row.temperature_reason,
            response_guidance: row.response_guidance,
            response_draft: row.response_draft,
            context_snapshot: row.context_snapshot,
            related_tickets: (row.related_tickets || []) as RelatedTicketInfo[],
            hours_since_customer_waiting: row.hours_since_customer_waiting,
            hours_since_last_outbound: row.hours_since_last_outbound,
            hours_since_last_activity: row.hours_since_last_activity,
            status_tags: row.status_tags || [],
            confidence: parseFloat(row.confidence),
            knowledge_used: row.knowledge_used,
            ticket_subject: row.ticket_subject,
            company_name: row.company_name,
            assigned_rep: row.assigned_rep,
            age_days: row.age_days,
            is_closed: row.is_closed,
            has_linear: row.has_linear,
            linear_state: row.linear_state,
            analyzed_at: row.analyzed_at,
          };
        }
      }

      // Fetch recent completions (last 7 days)
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: completionRows } = await supabase
        .from('action_item_completions')
        .select('id, hubspot_ticket_id, action_item_id, action_description, completed_by, completed_at, verified, verification_note')
        .in('hubspot_ticket_id', ticketIds)
        .gte('completed_at', weekAgo);

      if (completionRows && completionRows.length > 0) {
        const completionUserIds = [...new Set(completionRows.map((c) => c.completed_by))];
        const { data: users } = await serviceClient
          .from('user_profiles')
          .select('id, display_name, email')
          .in('id', completionUserIds);

        const userNameMap = new Map(
          (users || []).map((u) => [u.id, u.display_name || u.email || 'Unknown'])
        );

        for (const row of completionRows) {
          if (!completionsMap[row.hubspot_ticket_id]) {
            completionsMap[row.hubspot_ticket_id] = [];
          }
          completionsMap[row.hubspot_ticket_id].push({
            id: row.id,
            actionItemId: row.action_item_id,
            actionDescription: row.action_description,
            completedBy: row.completed_by,
            completedByName: userNameMap.get(row.completed_by) || 'Unknown',
            completedAt: row.completed_at,
            verified: row.verified,
            verificationNote: row.verification_note,
          });
        }
      }

      // Fetch today's progress notes
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { data: noteRows } = await supabase
        .from('progress_notes')
        .select('id, user_id, hubspot_ticket_id, note_text, created_at')
        .in('hubspot_ticket_id', ticketIds)
        .gte('created_at', todayStart.toISOString());

      if (noteRows && noteRows.length > 0) {
        const noteUserIds = [...new Set(noteRows.map((n) => n.user_id))];
        const { data: noteUsers } = await serviceClient
          .from('user_profiles')
          .select('id, display_name, email')
          .in('id', noteUserIds);

        const noteUserNameMap = new Map(
          (noteUsers || []).map((u) => [u.id, u.display_name || u.email || 'Unknown'])
        );

        for (const row of noteRows) {
          if (!notesMap[row.hubspot_ticket_id]) {
            notesMap[row.hubspot_ticket_id] = [];
          }
          notesMap[row.hubspot_ticket_id].push({
            id: row.id,
            userId: row.user_id,
            userName: noteUserNameMap.get(row.user_id) || 'Unknown',
            noteText: row.note_text,
            createdAt: row.created_at,
          });

          if (row.user_id === currentUser.id) {
            userNotedSet.add(row.hubspot_ticket_id);
          }
        }
      }
    }

    // Resolve owner names
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
      const missingIds = ownerIds.filter((id) => !ownerMap[id as string]) as string[];
      for (const id of missingIds) {
        try {
          const hsOwner = await getOwnerById(id);
          if (hsOwner) {
            ownerMap[id] = [hsOwner.firstName, hsOwner.lastName].filter(Boolean).join(' ') || hsOwner.email || 'Unknown';
          }
        } catch {
          // skip
        }
      }
    }

    // Build ticket list
    const now = new Date();
    const tickets: ActionBoardTicket[] = allTickets.map((ticket) => {
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
        completions: completionsMap[ticket.hubspot_ticket_id] || [],
        progressNotes: notesMap[ticket.hubspot_ticket_id] || [],
        currentUserHasNote: userNotedSet.has(ticket.hubspot_ticket_id),
        lastCustomerMessageAt: ticket.last_customer_message_at || null,
        lastAgentMessageAt: ticket.last_agent_message_at || null,
      };
    });

    // Sort: unanalyzed first, then by response wait time (longest first), then by age
    tickets.sort((a, b) => {
      if (a.analysis && !b.analysis) return 1;
      if (!a.analysis && b.analysis) return -1;
      if (a.analysis && b.analysis) {
        const aWait = a.analysis.hours_since_customer_waiting ?? 0;
        const bWait = b.analysis.hours_since_customer_waiting ?? 0;
        if (aWait !== bWait) return bWait - aWait;
      }
      return b.ageDays - a.ageDays;
    });

    // Compute counts
    const analyzed = tickets.filter((t) => t.analysis).length;
    const byStatus: Record<string, number> = {
      reply_needed: 0,
      update_due: 0,
      engineering_ping: 0,
      internal_action: 0,
      waiting_on_customer: 0,
    };

    for (const t of tickets) {
      if (t.analysis) {
        for (const tag of t.analysis.status_tags) {
          if (tag in byStatus) byStatus[tag]++;
        }
      }
    }

    // Compute changed ticket IDs (tickets where activity happened after last analysis)
    const changedTicketIds: string[] = [];
    for (const ticket of allTickets) {
      const analysis = analyses[ticket.hubspot_ticket_id];
      if (!analysis) continue; // unanalyzed tickets aren't "changed"

      const analyzedAt = new Date(analysis.analyzed_at).getTime();
      const timestamps = [
        ticket.last_customer_message_at,
        ticket.last_agent_message_at,
        ticket.last_contacted_at,
        ticket.hs_last_modified_at,
      ].filter(Boolean).map((t: string) => new Date(t).getTime());

      if (timestamps.some((t) => t > analyzedAt)) {
        changedTicketIds.push(ticket.hubspot_ticket_id);
      }
    }

    const noted = tickets.filter((t) => userNotedSet.has(t.ticketId)).length;

    const response: ActionBoardResponse = {
      tickets,
      counts: {
        total: tickets.length,
        analyzed,
        unanalyzed: tickets.length - analyzed,
        byStatus,
      },
      noteProgress: {
        noted,
        total: tickets.length,
      },
      changedTicketIds,
      userRole: currentUser.role,
      userId: currentUser.id,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Action board queue error:', error);
    return NextResponse.json(
      { error: 'Failed to get action board data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
