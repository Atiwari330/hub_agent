/**
 * Centralized AI model provider
 *
 * Reads AI_PROVIDER and AI_MODEL from env vars to determine which model to use.
 * Defaults to Claude Sonnet via Anthropic if not set.
 *
 * To swap models, set in .env.local:
 *   AI_PROVIDER=deepseek    AI_MODEL=deepseek/deepseek-v3.2
 *   AI_PROVIDER=anthropic   AI_MODEL=claude-sonnet-4-20250514
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';

export function getModel() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new Error('AI_GATEWAY_API_KEY is not configured');
  }

  const provider = process.env.AI_PROVIDER || 'anthropic';
  const modelId = process.env.AI_MODEL || 'claude-sonnet-4-20250514';

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
