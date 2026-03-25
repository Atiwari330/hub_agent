import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { getOwnerById } from '@/lib/hubspot/owners';
import { getActiveAlerts, getActivePatterns } from '@/lib/ai/intelligence/alert-utils';
import type { ActionBoardTicket, LiveActionItem, ActionItemCompletion, ProgressNoteInfo } from '../route';
import type { TicketActionBoardAnalysis, ActionItem, RelatedTicketInfo } from '../analyze/analyze-core';

export interface SingleTicketResponse {
  ticket: ActionBoardTicket;
  patterns: import('@/lib/ai/intelligence/alert-utils').PatternRecord[];
  userRole: string;
  userId: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_ACTION_BOARD);
  if (authResult instanceof NextResponse) return authResult;
  const currentUser = authResult;

  const { ticketId } = await params;

  const supabase = await createServerSupabaseClient();
  const serviceClient = createServiceClient();

  try {
    // Fetch the single ticket
    const { data: ticketRow, error: ticketError } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('hubspot_ticket_id', ticketId)
      .single();

    if (ticketError || !ticketRow) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    // Fetch analysis
    const { data: analysisRow } = await supabase
      .from('ticket_action_board_analyses')
      .select('*')
      .eq('hubspot_ticket_id', ticketId)
      .single();

    let analysis: TicketActionBoardAnalysis | null = null;
    if (analysisRow) {
      analysis = {
        hubspot_ticket_id: analysisRow.hubspot_ticket_id,
        situation_summary: analysisRow.situation_summary,
        action_items: (analysisRow.action_items || []) as ActionItem[],
        customer_temperature: analysisRow.customer_temperature,
        temperature_reason: analysisRow.temperature_reason,
        response_guidance: analysisRow.response_guidance,
        response_draft: analysisRow.response_draft,
        context_snapshot: analysisRow.context_snapshot,
        related_tickets: (analysisRow.related_tickets || []) as RelatedTicketInfo[],
        hours_since_customer_waiting: analysisRow.hours_since_customer_waiting,
        hours_since_last_outbound: analysisRow.hours_since_last_outbound,
        hours_since_last_activity: analysisRow.hours_since_last_activity,
        status_tags: analysisRow.status_tags || [],
        confidence: parseFloat(analysisRow.confidence),
        knowledge_used: analysisRow.knowledge_used,
        ticket_subject: analysisRow.ticket_subject,
        company_name: analysisRow.company_name,
        assigned_rep: analysisRow.assigned_rep,
        age_days: analysisRow.age_days,
        is_closed: analysisRow.is_closed,
        has_linear: analysisRow.has_linear,
        linear_state: analysisRow.linear_state,
        analyzed_at: analysisRow.analyzed_at,
      };
    }

    // Fetch action items (active + recently completed/superseded/expired)
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: itemRows } = await supabase
      .from('action_items')
      .select('*')
      .eq('hubspot_ticket_id', ticketId)
      .or(`status.eq.active,completed_at.gte.${dayAgo},superseded_at.gte.${dayAgo},expired_at.gte.${dayAgo}`)
      .order('sort_order', { ascending: true });

    const actionItems: LiveActionItem[] = [];
    if (itemRows && itemRows.length > 0) {
      const completedByIds = [...new Set(
        itemRows.filter((r) => r.completed_by).map((r) => r.completed_by as string)
      )];
      const userNameMap = new Map<string, string>();
      if (completedByIds.length > 0) {
        const { data: users } = await serviceClient
          .from('user_profiles')
          .select('id, display_name, email')
          .in('id', completedByIds);
        for (const u of users || []) {
          userNameMap.set(u.id, u.display_name || u.email || 'Unknown');
        }
      }

      for (const row of itemRows) {
        actionItems.push({
          id: row.id,
          ticketId: row.hubspot_ticket_id,
          description: row.description,
          who: row.who,
          priority: row.priority,
          status: row.status,
          statusTags: row.status_tags || [],
          createdAt: row.created_at,
          createdByPass: row.created_by_pass,
          completedAt: row.completed_at,
          completedBy: row.completed_by,
          completedByName: row.completed_by ? userNameMap.get(row.completed_by) || null : null,
          completedMethod: row.completed_method,
          supersededAt: row.superseded_at,
          supersededBy: row.superseded_by,
          expiredAt: row.expired_at,
          expiredReason: row.expired_reason,
          verified: row.verified,
          verificationNote: row.verification_note,
          sortOrder: row.sort_order,
        });
      }
    }

    // Fetch recent completions from legacy table (last 7 days)
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: completionRows } = await supabase
      .from('action_item_completions')
      .select('id, hubspot_ticket_id, action_item_id, action_description, completed_by, completed_at, verified, verification_note')
      .eq('hubspot_ticket_id', ticketId)
      .gte('completed_at', weekAgo);

    const completions: ActionItemCompletion[] = [];
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
        completions.push({
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
      .eq('hubspot_ticket_id', ticketId)
      .gte('created_at', todayStart.toISOString());

    const progressNotes: ProgressNoteInfo[] = [];
    let currentUserHasNote = false;
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
        progressNotes.push({
          id: row.id,
          userId: row.user_id,
          userName: noteUserNameMap.get(row.user_id) || 'Unknown',
          noteText: row.note_text,
          createdAt: row.created_at,
        });
        if (row.user_id === currentUser.id) {
          currentUserHasNote = true;
        }
      }
    }

    // Fetch active alerts
    const alertsMap = await getActiveAlerts([ticketId]);
    const alerts = alertsMap[ticketId] || [];

    // Fetch active patterns
    const patterns = await getActivePatterns();

    // Resolve owner name
    let assignedRep: string | null = null;
    if (ticketRow.hubspot_owner_id) {
      const { data: owner } = await supabase
        .from('owners')
        .select('first_name, last_name, email')
        .eq('hubspot_owner_id', ticketRow.hubspot_owner_id)
        .single();

      if (owner) {
        assignedRep = [owner.first_name, owner.last_name].filter(Boolean).join(' ') || owner.email || 'Unknown';
      } else {
        try {
          const hsOwner = await getOwnerById(ticketRow.hubspot_owner_id);
          if (hsOwner) {
            assignedRep = [hsOwner.firstName, hsOwner.lastName].filter(Boolean).join(' ') || hsOwner.email || 'Unknown';
          }
        } catch {
          // skip
        }
      }
    }

    // Build ticket object
    const now = new Date();
    const createdAt = ticketRow.hubspot_created_at ? new Date(ticketRow.hubspot_created_at) : now;
    const ageDays = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

    const ticket: ActionBoardTicket = {
      ticketId: ticketRow.hubspot_ticket_id,
      subject: ticketRow.subject,
      sourceType: ticketRow.source_type,
      priority: ticketRow.priority,
      ballInCourt: ticketRow.ball_in_court,
      software: ticketRow.software,
      companyName: ticketRow.hs_primary_company_name,
      isCoDestiny: ticketRow.is_co_destiny || false,
      assignedRep,
      ageDays,
      isClosed: ticketRow.is_closed || false,
      linearTask: ticketRow.linear_task || null,
      analysis,
      actionItems,
      completions,
      progressNotes,
      currentUserHasNote,
      lastCustomerMessageAt: ticketRow.last_customer_message_at || null,
      lastAgentMessageAt: ticketRow.last_agent_message_at || null,
      alerts,
      escalationRiskScore: ticketRow.escalation_risk_score != null ? parseFloat(ticketRow.escalation_risk_score) : null,
    };

    const response: SingleTicketResponse = {
      ticket,
      patterns,
      userRole: currentUser.role,
      userId: currentUser.id,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Single ticket fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch ticket', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
