import { createServiceClient } from '@/lib/supabase/client';
import type { TicketContext, ActionItem } from '@/lib/ai/passes/types';

/**
 * Change Detector — Phase 7, Contextual Memory
 *
 * Detects what changed since the last analysis by comparing current context
 * with previously stored pass results from analysis_pass_results.
 */

export interface PreviousAnalysis {
  situationSummary: string | null;
  contextSnapshot: string | null;
  temperature: string | null;
  temperatureReason: string | null;
  actionItems: ActionItem[];
  statusTags: string[];
  analyzedAt: string | null;
}

export interface TicketChanges {
  // What's new since last analysis
  newMessages: Array<{ sender: string; text: string; timestamp: string }>;
  newMessageCount: number;
  linearStateChanged: boolean;
  linearPreviousState: string | null;
  linearCurrentState: string | null;

  // Previous analysis context
  previous: PreviousAnalysis;

  // Computed
  timeSinceLastAnalysis: number | null; // hours
  isFirstAnalysis: boolean;

  // Pre-built change summary for LLM prompts
  changeSummary: string;
}

/**
 * Fetch the most recent pass results for a ticket.
 * Returns null if no previous analysis exists (first analysis).
 */
export async function getPreviousAnalysis(ticketId: string): Promise<PreviousAnalysis | null> {
  const supabase = createServiceClient();

  // Fetch the most recent analysis from the main analysis table
  const { data: analysis } = await supabase
    .from('ticket_action_board_analyses')
    .select('situation_summary, context_snapshot, customer_temperature, temperature_reason, action_items, status_tags, analyzed_at')
    .eq('hubspot_ticket_id', ticketId)
    .single();

  if (!analysis || !analysis.analyzed_at) return null;

  return {
    situationSummary: analysis.situation_summary || null,
    contextSnapshot: analysis.context_snapshot || null,
    temperature: analysis.customer_temperature || null,
    temperatureReason: analysis.temperature_reason || null,
    actionItems: (analysis.action_items || []) as ActionItem[],
    statusTags: (analysis.status_tags || []) as string[],
    analyzedAt: analysis.analyzed_at,
  };
}

/**
 * Detect what changed since the last analysis.
 * Uses the current context (already gathered) and compares with previous results.
 */
export async function detectChanges(
  ticketId: string,
  currentContext: TicketContext
): Promise<TicketChanges> {
  const previous = await getPreviousAnalysis(ticketId);

  if (!previous || !previous.analyzedAt) {
    return {
      newMessages: [],
      newMessageCount: 0,
      linearStateChanged: false,
      linearPreviousState: null,
      linearCurrentState: currentContext.linearContext?.state || null,
      previous: {
        situationSummary: null,
        contextSnapshot: null,
        temperature: null,
        temperatureReason: null,
        actionItems: [],
        statusTags: [],
        analyzedAt: null,
      },
      timeSinceLastAnalysis: null,
      isFirstAnalysis: true,
      changeSummary: 'This is the first analysis for this ticket.',
    };
  }

  const lastAnalyzedAt = new Date(previous.analyzedAt);
  const timeSinceLastAnalysis = (Date.now() - lastAnalyzedAt.getTime()) / (1000 * 60 * 60);

  // Find messages that arrived after the last analysis
  const newMessages = currentContext.conversationMessages
    .filter((msg) => {
      if (!msg.createdAt) return false;
      return new Date(msg.createdAt) > lastAnalyzedAt;
    })
    .map((msg) => ({
      sender: msg.senders?.map((s) => s.name || s.actorId).join(', ') || 'Unknown',
      text: msg.text || '(no text)',
      timestamp: msg.createdAt,
    }));

  // Check for Linear state changes
  const currentLinearState = currentContext.linearContext?.state || null;
  // We'll compare against the analysis record's linear_state
  const supabase = createServiceClient();
  const { data: analysisRecord } = await supabase
    .from('ticket_action_board_analyses')
    .select('linear_state')
    .eq('hubspot_ticket_id', ticketId)
    .single();

  const previousLinearState = analysisRecord?.linear_state || null;
  const linearStateChanged = !!(currentLinearState && previousLinearState && currentLinearState !== previousLinearState);

  // Build change summary for LLM prompts
  const changeParts: string[] = [];

  if (newMessages.length > 0) {
    changeParts.push(`${newMessages.length} new message${newMessages.length > 1 ? 's' : ''} since last analysis:`);
    for (const msg of newMessages.slice(0, 5)) {
      const preview = msg.text.slice(0, 200);
      changeParts.push(`  - [${msg.timestamp}] ${msg.sender}: ${preview}${msg.text.length > 200 ? '...' : ''}`);
    }
    if (newMessages.length > 5) {
      changeParts.push(`  ... and ${newMessages.length - 5} more messages`);
    }
  }

  if (linearStateChanged) {
    changeParts.push(`Linear issue state changed: ${previousLinearState} → ${currentLinearState}`);
  }

  if (currentContext.linearContext?.comments) {
    const newLinearComments = currentContext.linearContext.comments.filter(
      (c) => new Date(c.createdAt) > lastAnalyzedAt
    );
    if (newLinearComments.length > 0) {
      changeParts.push(`${newLinearComments.length} new Linear comment${newLinearComments.length > 1 ? 's' : ''}`);
    }
  }

  changeParts.push(`Time since last analysis: ${formatTimeSince(timeSinceLastAnalysis)}`);

  const changeSummary = changeParts.length > 0
    ? changeParts.join('\n')
    : 'No significant changes detected since last analysis.';

  return {
    newMessages,
    newMessageCount: newMessages.length,
    linearStateChanged,
    linearPreviousState: previousLinearState,
    linearCurrentState: currentLinearState,
    previous,
    timeSinceLastAnalysis,
    isFirstAnalysis: false,
    changeSummary,
  };
}

function formatTimeSince(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} minutes`;
  if (hours < 24) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}
