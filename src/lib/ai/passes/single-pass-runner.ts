import { generateText, stepCountIs } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getDeepSeekModel } from '@/lib/ai/provider';
import { gatherTicketContext } from './gather-context';
import type { TicketContext } from './types';

// Minimal structural type for AI SDK tools — kept here so callers don't need
// to import the SDK's internal Tool type directly. The SDK's generateText
// accepts anything assignable to Record<string, unknown>.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolMap = Record<string, any>;

export interface SinglePassConfig<T> {
  /** Builds the static system prompt. Called once per analysis. */
  buildSystemPrompt: () => string;
  /** Builds the user prompt from gathered context. */
  buildUserPrompt: (ctx: TicketContext) => string;
  /** Parses the LLM's raw text into the queue-specific analysis shape. */
  parseResponse: (text: string, ctx: TicketContext) => T;
  /** Optional tool map forwarded to generateText (e.g. lookupSupportKnowledge). */
  tools?: ToolMap;
  /** Max LLM steps (tool-call rounds). Defaults to 5 to match the existing queues. */
  maxSteps?: number;
  /** Optional reader client for context-gathering (falls back to service client). */
  readerClient?: SupabaseClient;
}

export interface SinglePassResult<T> {
  analysis: T;
  context: TicketContext;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

/**
 * Single-pass ticket analysis runner used by the trainer and manager queues
 * (and any future queue that wants one LLM call per ticket without the full
 * multi-pass orchestrator). Gathers shared context, calls generateText with
 * the caller's prompt/tool config, and parses the response — but does NOT
 * write to the database. Each queue handles its own upsert because the
 * target tables and shapes differ.
 *
 * See orchestrator.runAnalysisPipeline for the multi-pass variant used by
 * the action-board queue.
 */
export async function runSinglePassAnalysis<T>(
  ticketId: string,
  config: SinglePassConfig<T>,
): Promise<SinglePassResult<T>> {
  const context = await gatherTicketContext(ticketId, config.readerClient);

  const result = await generateText({
    model: getDeepSeekModel(),
    system: config.buildSystemPrompt(),
    prompt: config.buildUserPrompt(context),
    tools: config.tools,
    stopWhen: stepCountIs(config.maxSteps ?? 5),
  });

  const text = result.text || result.steps[result.steps.length - 1]?.text || '';
  const analysis = config.parseResponse(text, context);

  return {
    analysis,
    context,
    usage: {
      inputTokens: result.totalUsage?.inputTokens ?? 0,
      outputTokens: result.totalUsage?.outputTokens ?? 0,
      totalTokens: result.totalUsage?.totalTokens ?? 0,
    },
  };
}
