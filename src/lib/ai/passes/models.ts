import { getSonnetModel, getModel } from '@/lib/ai/provider';
import { createDeepSeek } from '@ai-sdk/deepseek';
import type { PassType } from './types';

// Model selection per pass type.
// Default: DeepSeek V3.2 for every pass. Codebase-wide policy is to avoid
// Anthropic token spend unless a specific feature opts in explicitly.
//
// The 'sonnet' branch below remains as an escape hatch: set PASS_MODEL_<NAME>=sonnet
// in the environment to re-enable Sonnet for a single pass without any code change
// (useful for A/B testing quality regressions on specific passes).
//
// Env vars:
//   PASS_MODEL_DEFAULT=sonnet           # use Sonnet for all passes
//   PASS_MODEL_ACTION_ITEMS=sonnet      # re-enable Sonnet for the action items pass only
//   PASS_MODEL_RESPONSE_DRAFT=sonnet    # re-enable Sonnet for the response draft pass only

const PASS_MODEL_ENV_MAP: Record<PassType, string> = {
  situation: 'PASS_MODEL_SITUATION',
  action_items: 'PASS_MODEL_ACTION_ITEMS',
  temperature: 'PASS_MODEL_TEMPERATURE',
  timing: 'PASS_MODEL_TIMING',
  verification: 'PASS_MODEL_VERIFICATION',
  cross_ticket: 'PASS_MODEL_CROSS_TICKET',
  response_draft: 'PASS_MODEL_RESPONSE_DRAFT',
  quality_review: 'PASS_MODEL_QUALITY_REVIEW',
  refinement: 'PASS_MODEL_REFINEMENT',
};

function getDeepSeekModel() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY is not configured');

  const deepseek = createDeepSeek({
    apiKey,
    baseURL: 'https://ai-gateway.vercel.sh/v1',
  });
  return deepseek('deepseek/deepseek-v3.2');
}

export function getModelForPass(passType: PassType) {
  // Check per-pass override first
  const envKey = PASS_MODEL_ENV_MAP[passType];
  const perPassOverride = envKey ? process.env[envKey] : undefined;

  const defaultModel = 'deepseek';
  const modelChoice = perPassOverride || process.env.PASS_MODEL_DEFAULT || defaultModel;

  switch (modelChoice) {
    case 'sonnet':
      return getSonnetModel();
    case 'deepseek':
      return getDeepSeekModel();
    default:
      // Fall back to the generic getModel() which reads AI_PROVIDER/AI_MODEL
      return getModel();
  }
}

export { PASS_MODEL_ENV_MAP };
