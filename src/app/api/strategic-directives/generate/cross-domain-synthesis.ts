/**
 * Phase 3: Cross-Domain Strategic Synthesis
 *
 * Single Opus call with extended thinking to produce strategic directives
 * from the compressed domain briefs and cross-domain correlation data.
 */

import { generateText } from 'ai';
import { getOpusModel } from '@/lib/ai/provider';
import { buildStrategicSystemPrompt, buildStrategicUserPrompt } from './prompts';
import { parseStrategicResponse } from './parsers';
import type {
  DomainBriefs,
  CrossDomainCorrelations,
  DomainDataSource,
  StrategicDirectivesReport,
  StrategicFocus,
} from './types';

const DEFAULT_THINKING_BUDGET = 32000;

export async function runCrossDomainSynthesis(
  briefs: DomainBriefs,
  correlations: CrossDomainCorrelations,
  dataSources: DomainDataSource[],
  timings: { phase1Ms: number; phase2Ms: number },
  options?: { focus?: StrategicFocus; thinkingBudget?: number }
): Promise<StrategicDirectivesReport> {
  const thinkingBudget = options?.thinkingBudget || DEFAULT_THINKING_BUDGET;

  const phase3Start = Date.now();

  const systemPrompt = buildStrategicSystemPrompt();
  const userPrompt = buildStrategicUserPrompt(briefs, correlations, options?.focus);

  const result = await generateText({
    model: getOpusModel(),
    system: systemPrompt,
    prompt: userPrompt,
    providerOptions: {
      anthropic: {
        thinking: { type: 'enabled', budgetTokens: thinkingBudget },
      },
    },
  });

  const phase3Ms = Date.now() - phase3Start;

  const reasoning = result.reasoningText || '';

  return parseStrategicResponse(
    result.text,
    reasoning,
    briefs,
    dataSources,
    {
      phase1Ms: timings.phase1Ms,
      phase2Ms: timings.phase2Ms,
      phase3Ms,
    }
  );
}
