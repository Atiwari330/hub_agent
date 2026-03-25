import { createServiceClient } from '@/lib/supabase/client';
import { getHubSpotClient } from '@/lib/hubspot/client';
import { getOwnerById } from '@/lib/hubspot/owners';
import { getTicketEngagementTimeline } from '@/lib/hubspot/ticket-engagements';
import { fetchLinearIssueContext } from '@/lib/linear/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import type { TicketContext, ThreadMessage, CompletionData } from './types';

const CUSTOMER_KNOWLEDGE_DIR = path.join(process.cwd(), 'src', 'lib', 'ai', 'knowledge', 'customers');

export async function gatherTicketContext(
  ticketId: string,
  readerClient?: SupabaseClient
): Promise<TicketContext> {
  const supabase = readerClient || createServiceClient();
  const serviceClient = createServiceClient();
  const hsClient = getHubSpotClient();

  // 1. Fetch ticket metadata
  const { data: ticket, error: ticketError } = await supabase
    .from('support_tickets')
    .select('*')
    .eq('hubspot_ticket_id', ticketId)
    .single();

  if (ticketError || !ticket) {
    throw new Error(`Ticket not found: ${ticketError?.message || 'unknown'}`);
  }

  // 2. Resolve owner name
  let ownerName: string | null = null;
  if (ticket.hubspot_owner_id) {
    const { data: owner } = await supabase
      .from('owners')
      .select('first_name, last_name, email')
      .eq('hubspot_owner_id', ticket.hubspot_owner_id)
      .single();
    if (owner) {
      ownerName = [owner.first_name, owner.last_name].filter(Boolean).join(' ') || owner.email || null;
    } else {
      try {
        const hsOwner = await getOwnerById(ticket.hubspot_owner_id);
        if (hsOwner) {
          ownerName = [hsOwner.firstName, hsOwner.lastName].filter(Boolean).join(' ') || hsOwner.email || null;
        }
      } catch {
        console.warn(`Could not fetch owner ${ticket.hubspot_owner_id} from HubSpot`);
      }
    }
  }

  // 3. Fetch conversation thread from HubSpot
  let conversationMessages: ThreadMessage[] = [];
  try {
    const hsTicket = await hsClient.crm.tickets.basicApi.getById(ticketId, [
      'subject',
      'hs_conversations_originating_thread_id',
    ]);
    const threadId = hsTicket.properties.hs_conversations_originating_thread_id;

    if (threadId) {
      const messagesResponse = await hsClient.apiRequest({
        method: 'GET',
        path: `/conversations/v3/conversations/threads/${threadId}/messages`,
      });
      const messagesData = (await messagesResponse.json()) as { results?: ThreadMessage[] };
      conversationMessages = messagesData.results || [];
    }
  } catch (err) {
    console.warn(`Could not fetch conversation thread for ticket ${ticketId}:`, err);
  }

  // 4. Fetch engagement timeline
  let engagementTimeline;
  try {
    engagementTimeline = await getTicketEngagementTimeline(ticketId);
  } catch (err) {
    console.warn(`Could not fetch engagement timeline for ticket ${ticketId}:`, err);
    engagementTimeline = { engagements: [], counts: { emails: 0, notes: 0, calls: 0, meetings: 0, total: 0 } };
  }

  // 5. Fetch Linear engineering context (if linked)
  let linearContext = null;
  if (ticket.linear_task) {
    try {
      linearContext = await fetchLinearIssueContext(ticket.linear_task);
    } catch (err) {
      console.warn(`Could not fetch Linear context for ticket ${ticketId}:`, err);
    }
  }

  // 6. Build conversation text
  const conversationText =
    conversationMessages.length > 0
      ? conversationMessages
          .slice(0, 20)
          .map((msg) => {
            const sender = msg.senders?.map((s) => s.name || s.actorId).join(', ') || 'Unknown';
            const text = msg.text || '(no text)';
            return `[${msg.createdAt}] ${sender}: ${text}`;
          })
          .join('\n\n')
      : 'No conversation thread available.';

  // 7. Build engagement timeline text
  const engagementTimelineText =
    engagementTimeline.engagements.length > 0
      ? engagementTimeline.engagements
          .slice(0, 30)
          .map((e) => {
            const ts = e.timestamp.toISOString().split('T')[0];
            const parts = [`[${ts}] ${e.type.toUpperCase()}`];
            if (e.author) parts.push(`by ${e.author}`);
            if (e.direction) parts.push(`(${e.direction})`);
            if (e.subject) parts.push(`— ${e.subject}`);
            if (e.body) parts.push(`\n    ${e.body.slice(0, 300)}`);
            if (e.duration) parts.push(`\n    Duration: ${Math.round(e.duration / 60)}min`);
            return parts.join(' ');
          })
          .join('\n')
      : 'No engagement timeline available.';

  // 8. Ticket age
  const createdAt = ticket.hubspot_created_at ? new Date(ticket.hubspot_created_at) : null;
  const ageDays = createdAt
    ? Math.round((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // 9. Load customer-specific context
  let customerContext: string | null = null;
  if (ticket.hs_primary_company_name) {
    const normalizedName = ticket.hs_primary_company_name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-');
    const customerFilePath = path.join(CUSTOMER_KNOWLEDGE_DIR, `${normalizedName}.md`);
    try {
      customerContext = fs.readFileSync(customerFilePath, 'utf-8');
    } catch {
      // No customer-specific context — normal for most customers
    }
  }

  // 10. Fetch related open tickets from the same company
  let relatedTickets: { hubspot_ticket_id: string; subject: string | null; situation_summary?: string | null }[] = [];
  if (ticket.hs_primary_company_name) {
    const { data: related } = await supabase
      .from('support_tickets')
      .select('hubspot_ticket_id, subject')
      .eq('hs_primary_company_name', ticket.hs_primary_company_name)
      .eq('is_closed', false)
      .neq('hubspot_ticket_id', ticketId)
      .limit(10);

    if (related && related.length > 0) {
      const relatedIds = related.map((t) => t.hubspot_ticket_id);
      const { data: relatedAnalyses } = await supabase
        .from('ticket_action_board_analyses')
        .select('hubspot_ticket_id, situation_summary')
        .in('hubspot_ticket_id', relatedIds);

      const summaryMap = new Map(
        (relatedAnalyses || []).map((a) => [a.hubspot_ticket_id, a.situation_summary])
      );

      relatedTickets = related.map((t) => ({
        hubspot_ticket_id: t.hubspot_ticket_id,
        subject: t.subject,
        situation_summary: summaryMap.get(t.hubspot_ticket_id) || null,
      }));
    }
  }

  // 11. Fetch recent action item completions
  const recentCompletions: CompletionData[] = [];
  const { data: completionRows } = await serviceClient
    .from('action_item_completions')
    .select('id, action_item_id, action_description, completed_at, completed_by, verified, verification_note')
    .eq('hubspot_ticket_id', ticketId)
    .order('completed_at', { ascending: false })
    .limit(20);

  if (completionRows && completionRows.length > 0) {
    const userIds = [...new Set(completionRows.map((c) => c.completed_by))];
    const { data: users } = await serviceClient
      .from('user_profiles')
      .select('id, display_name, email')
      .in('id', userIds);

    const userMap = new Map(
      (users || []).map((u) => [u.id, u.display_name || u.email || 'Unknown'])
    );

    for (const row of completionRows) {
      recentCompletions.push({
        id: row.id,
        action_item_id: row.action_item_id,
        action_description: row.action_description,
        completed_at: row.completed_at,
        completed_by: row.completed_by,
        completed_by_name: userMap.get(row.completed_by) || 'Unknown',
        verified: row.verified,
        verification_note: row.verification_note,
      });
    }
  }

  return {
    ticket,
    ownerName,
    conversationMessages,
    conversationText,
    engagementTimeline,
    engagementTimelineText,
    linearContext,
    customerContext,
    relatedTickets,
    recentCompletions,
    ageDays,
  };
}

// --- Helpers for building prompt sections ---

export function buildTicketMetadataSection(ctx: TicketContext): string {
  const t = ctx.ticket;
  return `TICKET METADATA:
- Ticket ID: ${t.hubspot_ticket_id}
- Subject: ${t.subject || 'N/A'}
- Source: ${t.source_type || 'N/A'}
- Priority: ${t.priority || 'N/A'}
- Status: ${t.is_closed ? 'Closed' : 'Open'}
- Age: ${ctx.ageDays !== null ? `${ctx.ageDays} days` : 'Unknown'}
- Ball In Court: ${t.ball_in_court || 'N/A'}
- Software: ${t.software || 'N/A'}
- Assigned Rep: ${ctx.ownerName || 'Unassigned'}
- Last Customer Message: ${t.last_customer_message_at || 'Unknown'}
- Last Agent Message: ${t.last_agent_message_at || 'Unknown'}
- Co-Destiny Account: ${t.is_co_destiny ? 'YES — VIP customer requiring elevated attention' : 'No'}

COMPANY:
- Name: ${t.hs_primary_company_name || 'Unknown'}`;
}

export function buildLinearSection(ctx: TicketContext): string {
  const lc = ctx.linearContext;
  if (lc) {
    let section = `LINEAR ENGINEERING CONTEXT:
- Linear Issue: ${lc.identifier} — ${lc.title}
- State: ${lc.state}
- Priority: ${lc.priority}
- Assignee: ${lc.assignee || 'Unassigned'}
- Created: ${lc.createdAt.split('T')[0]}
- Updated: ${lc.updatedAt.split('T')[0]}

Description:
${lc.description || '(no description)'}

Engineering Comments (${lc.comments.length}):
${lc.comments.length > 0
  ? lc.comments.map((c) => `[${c.createdAt.split('T')[0]}] ${c.author}: ${c.body}`).join('\n\n')
  : 'No comments yet.'}`;

    if (lc.relatedIssues.length > 0) {
      section += `\n\nRelated Linear Issues (${lc.relatedIssues.length}):\n` +
        lc.relatedIssues
          .map((ri) => `- ${ri.identifier}: ${ri.title} (${ri.relationType}) — State: ${ri.state}, Priority: ${ri.priority}, Assignee: ${ri.assignee || 'Unassigned'}`)
          .join('\n');
    }
    return section;
  }

  if (ctx.ticket.linear_task) {
    return `LINEAR ENGINEERING CONTEXT:
A Linear engineering ticket is linked to this support ticket (${ctx.ticket.linear_task}), confirming that an engineering escalation HAS occurred. Full details could not be retrieved. Do NOT state there is no engineering escalation.`;
  }

  return '';
}
