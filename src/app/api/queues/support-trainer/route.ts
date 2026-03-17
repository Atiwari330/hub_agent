import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { getOwnerById } from '@/lib/hubspot/owners';
import type { TicketTrainerAnalysis } from './analyze/analyze-core';

// --- Types ---

export interface TrainerReadBy {
  userId: string;
  displayName: string;
  readAt: string;
}

export interface TrainerInaccuracyReport {
  id: string;
  userId: string;
  displayName: string;
  reason: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface SupportTrainerTicket {
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
  analysis: TicketTrainerAnalysis | null;
  readBy: TrainerReadBy[];
  commentCount: number;
  inaccuracyReports: TrainerInaccuracyReport[];
}

export interface SupportTrainerResponse {
  tickets: SupportTrainerTicket[];
  counts: {
    total: number;
    analyzed: number;
    unanalyzed: number;
    byDifficulty: { beginner: number; intermediate: number; advanced: number };
  };
  userRole: string;
  currentUser: {
    id: string;
    displayName: string;
    role: string;
  };
  teamMemberCount: number;
}

// --- Route Handler ---

export async function GET(request: NextRequest) {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_TRAINER);
  if (authResult instanceof NextResponse) return authResult;
  const currentUser = authResult;

  const supabase = await createServerSupabaseClient();

  const mode = request.nextUrl.searchParams.get('mode');

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

    // Fetch all trainer analyses for these tickets
    const ticketIds = allTickets.map((t) => t.hubspot_ticket_id);
    const analyses: Record<string, TicketTrainerAnalysis> = {};

    if (ticketIds.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < ticketIds.length; i += batchSize) {
        const batch = ticketIds.slice(i, i + batchSize);
        const { data: rows } = await supabase
          .from('ticket_trainer_analyses')
          .select('*')
          .in('hubspot_ticket_id', batch);

        for (const row of rows || []) {
          analyses[row.hubspot_ticket_id] = {
            hubspot_ticket_id: row.hubspot_ticket_id,
            customer_ask: row.customer_ask,
            problem_breakdown: row.problem_breakdown,
            system_explanation: row.system_explanation,
            interaction_timeline: row.interaction_timeline,
            resolution_approach: row.resolution_approach,
            coaching_tips: row.coaching_tips,
            knowledge_areas: row.knowledge_areas || null,
            difficulty_level: row.difficulty_level,
            ticket_subject: row.ticket_subject,
            company_name: row.company_name,
            assigned_rep: row.assigned_rep,
            age_days: row.age_days,
            is_closed: row.is_closed,
            has_linear: row.has_linear,
            linear_state: row.linear_state,
            confidence: parseFloat(row.confidence),
            analyzed_at: row.analyzed_at,
          };
        }
      }
    }

    // Fetch collaboration data for all tickets
    const readsByTicket: Record<string, TrainerReadBy[]> = {};
    const commentCountByTicket: Record<string, number> = {};
    const inaccuracyByTicket: Record<string, TrainerInaccuracyReport[]> = {};

    if (ticketIds.length > 0) {
      const serviceClient = createServiceClient();

      // Read confirmations
      const { data: reads } = await serviceClient
        .from('trainer_read_confirmations')
        .select('hubspot_ticket_id, user_id, read_at, user_profiles(display_name, email)')
        .in('hubspot_ticket_id', ticketIds);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of (reads || []) as any[]) {
        const tid = r.hubspot_ticket_id;
        if (!readsByTicket[tid]) readsByTicket[tid] = [];
        readsByTicket[tid].push({
          userId: r.user_id,
          displayName: r.user_profiles?.display_name || r.user_profiles?.email || 'Unknown',
          readAt: r.read_at,
        });
      }

      // Comment counts (fetch ticket IDs and count in JS)
      const { data: allComments } = await serviceClient
        .from('trainer_comments')
        .select('hubspot_ticket_id')
        .in('hubspot_ticket_id', ticketIds);

      for (const c of allComments || []) {
        commentCountByTicket[c.hubspot_ticket_id] = (commentCountByTicket[c.hubspot_ticket_id] || 0) + 1;
      }

      // Inaccuracy reports
      const { data: reports } = await serviceClient
        .from('trainer_inaccuracy_reports')
        .select('id, hubspot_ticket_id, user_id, reason, resolved_at, resolved_by, created_at, user_profiles(display_name, email)')
        .in('hubspot_ticket_id', ticketIds)
        .order('created_at', { ascending: true });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of (reports || []) as any[]) {
        const tid = r.hubspot_ticket_id;
        if (!inaccuracyByTicket[tid]) inaccuracyByTicket[tid] = [];
        inaccuracyByTicket[tid].push({
          id: r.id,
          userId: r.user_id,
          displayName: r.user_profiles?.display_name || r.user_profiles?.email || 'Unknown',
          reason: r.reason,
          createdAt: r.created_at,
          resolvedAt: r.resolved_at,
          resolvedBy: r.resolved_by,
        });
      }
    }

    // Count team members with access to the trainer queue
    const serviceClientForCount = createServiceClient();
    const { count: teamMemberCount } = await serviceClientForCount
      .from('user_permissions')
      .select('*', { count: 'exact', head: true })
      .eq('resource', 'queue:support-trainer');

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

    // Build ticket list
    const now = new Date();
    const tickets: SupportTrainerTicket[] = allTickets.map((ticket) => {
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
        assignedRep: ticket.hubspot_owner_id ? ownerMap[ticket.hubspot_owner_id] || null : null,
        ageDays,
        isClosed: ticket.is_closed || false,
        linearTask: ticket.linear_task || null,
        analysis: analyses[ticket.hubspot_ticket_id] || null,
        readBy: readsByTicket[ticket.hubspot_ticket_id] || [],
        commentCount: commentCountByTicket[ticket.hubspot_ticket_id] || 0,
        inaccuracyReports: inaccuracyByTicket[ticket.hubspot_ticket_id] || [],
      };
    });

    // Sort: unanalyzed first, then by difficulty (advanced first), then by age
    const difficultyOrder: Record<string, number> = { advanced: 0, intermediate: 1, beginner: 2 };
    tickets.sort((a, b) => {
      if (a.analysis && !b.analysis) return 1;
      if (!a.analysis && b.analysis) return -1;
      if (a.analysis && b.analysis) {
        const aDiff = difficultyOrder[a.analysis.difficulty_level] ?? 3;
        const bDiff = difficultyOrder[b.analysis.difficulty_level] ?? 3;
        if (aDiff !== bDiff) return aDiff - bDiff;
      }
      return b.ageDays - a.ageDays;
    });

    // Compute counts
    const analyzed = tickets.filter((t) => t.analysis).length;
    const byDifficulty = { beginner: 0, intermediate: 0, advanced: 0 };

    for (const t of tickets) {
      if (t.analysis) {
        const diff = t.analysis.difficulty_level as keyof typeof byDifficulty;
        if (diff in byDifficulty) byDifficulty[diff]++;
      }
    }

    const response: SupportTrainerResponse = {
      tickets,
      counts: {
        total: tickets.length,
        analyzed,
        unanalyzed: tickets.length - analyzed,
        byDifficulty,
      },
      userRole: currentUser.role,
      currentUser: {
        id: currentUser.id,
        displayName: currentUser.displayName || currentUser.email,
        role: currentUser.role,
      },
      teamMemberCount: teamMemberCount || 0,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Support trainer queue error:', error);
    return NextResponse.json(
      { error: 'Failed to get support trainer data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
