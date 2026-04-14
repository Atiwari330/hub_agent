/**
 * Centralized AI model provider
 *
 * Default: DeepSeek v3.2 via Vercel AI Gateway. Every call site that uses
 * getModel() — or a pass dispatcher default — lands on DeepSeek. This is the
 * codebase-wide policy: no Anthropic token spend unless a specific feature
 * opts in explicitly.
 *
 * getSonnetModel() and getOpusModel() remain available as honest factories
 * for per-feature opt-in. To reintroduce Claude for a single call site,
 * import the relevant factory here and call it directly — no env var
 * juggling needed. A grep for getSonnetModel / getOpusModel will surface
 * every Claude call site in the codebase.
 *
 * Env-var overrides still work for one-off debugging:
 *   AI_PROVIDER=anthropic   AI_MODEL=claude-sonnet-4-20250514
 *   AI_PROVIDER=deepseek    AI_MODEL=deepseek/deepseek-v3.2   (default)
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';

export function getDeepSeekModel() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY is not configured');

  const deepseek = createDeepSeek({
    apiKey,
    baseURL: 'https://ai-gateway.vercel.sh/v1',
  });
  return deepseek('deepseek/deepseek-v3.2');
}

export function getOpusModel() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY is not configured');

  const anthropic = createAnthropic({
    apiKey,
    baseURL: 'https://ai-gateway.vercel.sh/v1',
  });
  return anthropic('claude-opus-4-6');
}

export function getSonnetModel() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY is not configured');

  const anthropic = createAnthropic({
    apiKey,
    baseURL: 'https://ai-gateway.vercel.sh/v1',
  });
  return anthropic('claude-sonnet-4-20250514');
}

export function getModel() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new Error('AI_GATEWAY_API_KEY is not configured');
  }

  const provider = process.env.AI_PROVIDER || 'deepseek';
  const modelId = process.env.AI_MODEL || 'deepseek/deepseek-v3.2';

  if (provider === 'deepseek') {
    const deepseek = createDeepSeek({
      apiKey,
      baseURL: 'https://ai-gateway.vercel.sh/v1',
    });
    return deepseek(modelId);
  }

  const anthropic = createAnthropic({
    apiKey,
    baseURL: 'https://ai-gateway.vercel.sh/v1',
  });
  return anthropic(modelId);
}
