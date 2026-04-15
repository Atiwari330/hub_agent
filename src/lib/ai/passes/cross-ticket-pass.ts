import { generateText } from 'ai';
import { getModelForPass } from './models';
import { normalizeFieldHeaders } from '@/lib/ai/parsing/normalize-field-headers';
import type { TicketContext, CrossTicketPassResult, RelatedTicketInfo } from './types';

export async function runCrossTicketPass(context: TicketContext): Promise<CrossTicketPassResult> {
  if (context.relatedTickets.length === 0) {
    return { related_ticket_notes: 'NONE', related_tickets: [] };
  }

  const model = getModelForPass('cross_ticket');

  const systemPrompt = `You are a support coordination analyst for a healthcare SaaS company.

Given a support ticket and other open tickets from the same company, identify any coordination needs. Are these tickets related? Could a response to one contradict information in another? Should the agent be aware of overlapping issues?

Output EXACTLY one field:

RELATED_TICKET_NOTES: Brief coordination notes (1-3 sentences), or "NONE" if no coordination needed.`;

  const relatedList = context.relatedTickets.map((t) => {
    const summary = t.situation_summary ? ` — ${t.situation_summary}` : '';
    return `- TICKET-${t.hubspot_ticket_id}: ${t.subject || 'No subject'}${summary}`;
  }).join('\n');

  const userPrompt = `CURRENT TICKET:
- ID: ${context.ticket.hubspot_ticket_id}
- Subject: ${context.ticket.subject || 'N/A'}
- Company: ${context.ticket.hs_primary_company_name || 'Unknown'}

RELATED OPEN TICKETS FROM SAME COMPANY:
${relatedList}`;

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
  });

  const text = normalizeFieldHeaders(result.text || '');
  const notesMatch = text.match(/RELATED_TICKET_NOTES:\s*(.+?)(?=\n[A-Z_]+:|\n\n|$)/is);
  const notes = notesMatch?.[1]?.trim() || 'NONE';

  const relatedTickets: RelatedTicketInfo[] = context.relatedTickets.map((t) => ({
    ticketId: t.hubspot_ticket_id,
    subject: t.subject || 'No subject',
    summary: t.situation_summary || notes,
  }));

  return { related_ticket_notes: notes, related_tickets: relatedTickets };
}
