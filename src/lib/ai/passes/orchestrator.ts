import { createServiceClient } from '@/lib/supabase/client';
import { gatherTicketContext } from './gather-context';
import { runSituationPass } from './situation-pass';
import { runActionItemPass } from './action-item-pass';
import { runTemperaturePass } from './temperature-pass';
import { runTimingPass } from './timing-pass';
import { runVerificationPass } from './verification-pass';
import { runCrossTicketPass } from './cross-ticket-pass';
import { runResponseDraftPass } from './response-draft-pass';
import type {
  PassType,
  ALL_PASSES as ALL_PASSES_TYPE,
  AllPassResults,
  TicketContext,
} from './types';
import type { TicketActionBoardAnalysis } from '@/app/api/queues/support-action-board/analyze/analyze-core';
import type { SupabaseClient } from '@supabase/supabase-js';

const ALL_PASSES: PassType[] = [
  'situation', 'action_items', 'temperature', 'timing',
  'verification', 'cross_ticket', 'response_draft',
];

export interface AnalysisOptions {
  passes?: PassType[];
  readerClient?: SupabaseClient;
}

export async function runAnalysisPipeline(
  ticketId: string,
  options?: AnalysisOptions
): Promise<{ analysis: TicketActionBoardAnalysis; usage?: { inputTokens: number; outputTokens: number; totalTokens: number } }> {
  const serviceClient = createServiceClient();

  // 1. Gather context (shared across all passes)
  const context = await gatherTicketContext(ticketId, options?.readerClient);
  const passesToRun = options?.passes || ALL_PASSES;

  // 2. Run independent passes in parallel
  const [situationResult, temperatureResult, timingResult, verificationResult, crossTicketResult] =
    await Promise.all([
      passesToRun.includes('situation') ? runSituationPass(context) : null,
      passesToRun.includes('temperature') ? runTemperaturePass(context) : null,
      runTimingPass(context), // always run — it's free (no LLM)
      passesToRun.includes('verification') && context.recentCompletions.filter(c => c.verified === null).length > 0
        ? runVerificationPass(context)
        : null,
      passesToRun.includes('cross_ticket') && context.relatedTickets.length > 0
        ? runCrossTicketPass(context)
        : null,
    ]);

  // 3. Run dependent passes sequentially
  const actionResult = passesToRun.includes('action_items')
    ? await runActionItemPass(context, {
        situationSummary: situationResult?.situation_summary,
      })
    : null;

  const responseResult = passesToRun.includes('response_draft')
    ? await runResponseDraftPass(context, {
        actionItems: actionResult?.action_items,
        temperature: temperatureResult?.customer_temperature,
      })
    : null;

  // 4. Compose final analysis
  const allResults: AllPassResults = {
    situation: situationResult,
    actionItems: actionResult,
    temperature: temperatureResult,
    timing: timingResult,
    verification: verificationResult,
    crossTicket: crossTicketResult,
    responseDraft: responseResult,
  };

  const analysis = composeFinalAnalysis(ticketId, context, allResults);

  // 5. Upsert to DB
  const { error: upsertError } = await serviceClient
    .from('ticket_action_board_analyses')
    .upsert(analysis, { onConflict: 'hubspot_ticket_id' });

  if (upsertError) {
    console.error('Error upserting action board analysis:', upsertError);
  }

  // 6. Apply verification updates
  if (verificationResult && verificationResult.verifications.length > 0) {
    for (const v of verificationResult.verifications) {
      if (!v.completionId) continue;
      await serviceClient
        .from('action_item_completions')
        .update({ verified: v.verified, verification_note: v.note })
        .eq('id', v.completionId);
    }
  }

  // 7. Update pass_versions
  const passVersions: Record<string, string> = {};
  const now = new Date().toISOString();
  for (const pass of passesToRun) {
    passVersions[pass] = now;
  }
  await serviceClient
    .from('ticket_action_board_analyses')
    .update({ pass_versions: passVersions })
    .eq('hubspot_ticket_id', ticketId);

  return { analysis };
}

function composeFinalAnalysis(
  ticketId: string,
  context: TicketContext,
  results: AllPassResults
): TicketActionBoardAnalysis {
  return {
    hubspot_ticket_id: ticketId,
    situation_summary: results.situation?.situation_summary || 'No summary available.',
    action_items: results.actionItems?.action_items || [],
    customer_temperature: results.temperature?.customer_temperature || 'calm',
    temperature_reason: results.temperature?.temperature_reason || null,
    response_guidance: results.responseDraft?.response_guidance || null,
    response_draft: results.responseDraft?.response_draft || null,
    context_snapshot: results.situation?.context_snapshot || null,
    related_tickets: results.crossTicket?.related_tickets || [],
    hours_since_customer_waiting: results.timing.hours_since_customer_waiting,
    hours_since_last_outbound: results.timing.hours_since_last_outbound,
    hours_since_last_activity: results.timing.hours_since_last_activity,
    status_tags: results.actionItems?.status_tags || ['waiting_on_customer'],
    confidence: 0.75, // Multi-pass produces higher baseline confidence
    knowledge_used: null, // Tracked via action-item pass tool usage
    ticket_subject: context.ticket.subject,
    company_name: context.ticket.hs_primary_company_name,
    assigned_rep: context.ownerName,
    age_days: context.ageDays,
    is_closed: context.ticket.is_closed || false,
    has_linear: !!context.ticket.linear_task,
    linear_state: context.linearContext?.state || null,
    analyzed_at: new Date().toISOString(),
  };
}

// Export for selective pass triggering (used by analyze-pass endpoint)
export async function runSelectivePasses(
  ticketId: string,
  passes: PassType[],
  readerClient?: SupabaseClient
): Promise<TicketActionBoardAnalysis> {
  const result = await runAnalysisPipeline(ticketId, { passes, readerClient });
  return result.analysis;
}
