/**
 * Centralized AI model provider
 *
 * Default: DeepSeek v3.2 via Vercel AI Gateway. Every call site that uses
 * getModel() — or a pass dispatcher default — lands on DeepSeek. This is the
 * codebase-wide policy: no Anthropic token spend unless a specific feature
 * opts in explicitly.
 *
 * The only way to reach Anthropic from this codebase is the AI_PROVIDER env
 * var debug hatch below. There are no named factories for Claude models —
 * reintroducing one should go through a deliberate review, not a utility add.
 *
 * Env-var overrides for one-off debugging:
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
