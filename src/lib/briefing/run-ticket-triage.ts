import { createServiceClient } from '../supabase/client';
import {
  triageTicket,
  processWithConcurrency,
  formatReport,
} from '../../scripts/ticket-triage';
import type { TriageResult } from '../../scripts/ticket-triage';

export type { TriageResult };

export interface TriageSummary {
  total: number;
  analyzed: number;
  failed: number;
  byStatus: Record<string, number>;
  byUrgency: Record<string, number>;
  immediateCount: number;
}

export interface TriageRunResult {
  results: TriageResult[];
  markdown: string;
  summary: TriageSummary;
  durationMs: number;
}

export async function runTicketTriage(options?: {
  concurrency?: number;
}): Promise<TriageRunResult> {
  const concurrency = options?.concurrency ?? 5;
  const supabase = createServiceClient();

  // Fetch open tickets
  const { data: ticketRows, error } = await supabase
    .from('support_tickets')
    .select('hubspot_ticket_id, subject, hs_primary_company_name')
    .eq('is_closed', false)
    .order('hubspot_created_at', { ascending: true });

  if (error) throw new Error(`Failed to fetch tickets: ${error.message}`);

  const tickets = ticketRows || [];
  if (tickets.length === 0) {
    return {
      results: [],
      markdown: '# Support Ticket Triage\n\nNo open tickets found.\n',
      summary: {
        total: 0,
        analyzed: 0,
        failed: 0,
        byStatus: {},
        byUrgency: {},
        immediateCount: 0,
      },
      durationMs: 0,
    };
  }

  console.log(`[ticket-triage] Analyzing ${tickets.length} tickets (concurrency: ${concurrency})...`);
  const startTime = Date.now();
  let completed = 0;

  const results = await processWithConcurrency(
    tickets,
    concurrency,
    async (row) => {
      const id = row.hubspot_ticket_id;
      try {
        const result = await triageTicket(id);
        completed++;
        console.log(`  [ticket-triage ${completed}/${tickets.length}] ✓ #${id} → ${result.status}`);
        return result;
      } catch (err) {
        completed++;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.log(`  [ticket-triage ${completed}/${tickets.length}] ✗ #${id} → ERROR: ${errMsg}`);
        return {
          ticketId: id,
          subject: row.subject || 'No subject',
          company: row.hs_primary_company_name || 'Unknown',
          rep: 'Unknown',
          ageDays: 0,
          priority: 'N/A',
          isCoDestiny: false,
          hasLinear: false,
          status: 'UNKNOWN',
          confidence: 'LOW',
          statusRationale: '',
          nextStep: '',
          urgency: 'TODAY',
          timeline: '',
          error: errMsg,
        } as TriageResult;
      }
    }
  );

  const durationMs = Date.now() - startTime;
  const successes = results.filter((r) => !r.error);
  const failures = results.filter((r) => r.error);

  // Build summary
  const byStatus: Record<string, number> = {};
  const byUrgency: Record<string, number> = {};
  for (const r of successes) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    byUrgency[r.urgency] = (byUrgency[r.urgency] || 0) + 1;
  }

  const markdown = formatReport(results, false);

  return {
    results,
    markdown,
    summary: {
      total: tickets.length,
      analyzed: successes.length,
      failed: failures.length,
      byStatus,
      byUrgency,
      immediateCount: byUrgency['IMMEDIATE'] || 0,
    },
    durationMs,
  };
}
