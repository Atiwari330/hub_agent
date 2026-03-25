import { runAnalysisPipeline } from '@/lib/ai/passes/orchestrator';
import type { SupabaseClient } from '@supabase/supabase-js';

// --- Types (unchanged — backward compatible) ---

export interface ActionItem {
  id: string;
  description: string;
  who: string;
  priority: 'now' | 'today' | 'this_week';
  status_tags: string[];
}

export interface RelatedTicketInfo {
  ticketId: string;
  subject: string;
  summary: string;
}

export interface TicketActionBoardAnalysis {
  hubspot_ticket_id: string;
  situation_summary: string;
  action_items: ActionItem[];
  customer_temperature: string;
  temperature_reason: string | null;
  response_guidance: string | null;
  response_draft: string | null;
  context_snapshot: string | null;
  related_tickets: RelatedTicketInfo[];
  hours_since_customer_waiting: number | null;
  hours_since_last_outbound: number | null;
  hours_since_last_activity: number | null;
  status_tags: string[];
  confidence: number;
  knowledge_used: string | null;
  ticket_subject: string | null;
  company_name: string | null;
  assigned_rep: string | null;
  age_days: number | null;
  is_closed: boolean;
  has_linear: boolean;
  linear_state: string | null;
  analyzed_at: string;
}

export type AnalyzeActionBoardResult =
  | { success: true; analysis: TicketActionBoardAnalysis; usage?: { inputTokens: number; outputTokens: number; totalTokens: number } }
  | { success: false; error: string; details?: string; statusCode?: number };

// --- Core Analysis Function (delegates to multi-pass pipeline) ---

export async function analyzeActionBoardTicket(
  ticketId: string,
  readerClient?: SupabaseClient
): Promise<AnalyzeActionBoardResult> {
  try {
    const result = await runAnalysisPipeline(ticketId, { readerClient });
    return {
      success: true,
      analysis: result.analysis,
      usage: result.usage,
    };
  } catch (error) {
    console.error('Action board analysis error:', error);
    return {
      success: false,
      error: 'Failed to analyze ticket',
      details: error instanceof Error ? error.message : 'Unknown error',
      statusCode: 500,
    };
  }
}
