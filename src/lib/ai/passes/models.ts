import { getSonnetModel, getModel } from '@/lib/ai/provider';
import { createDeepSeek } from '@ai-sdk/deepseek';
import type { PassType } from './types';

// Model selection per pass type.
// Default: DeepSeek V3.2 for simple passes, Sonnet for action items + response draft.
// Override per pass via env vars, or set PASS_MODEL_DEFAULT to change everything.
//
// Env vars:
//   PASS_MODEL_DEFAULT=sonnet           # use Sonnet for all passes
//   PASS_MODEL_ACTION_ITEMS=deepseek    # override just action items to DeepSeek
//   PASS_MODEL_RESPONSE_DRAFT=deepseek  # override just response draft to DeepSeek

const PASS_MODEL_ENV_MAP: Record<PassType, string> = {
  situation: 'PASS_MODEL_SITUATION',
  action_items: 'PASS_MODEL_ACTION_ITEMS',
  temperature: 'PASS_MODEL_TEMPERATURE',
  timing: 'PASS_MODEL_TIMING',
  verification: 'PASS_MODEL_VERIFICATION',
  cross_ticket: 'PASS_MODEL_CROSS_TICKET',
  response_draft: 'PASS_MODEL_RESPONSE_DRAFT',
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

  // Action items and response draft default to Sonnet (need stronger reasoning + tool use).
  // Everything else defaults to DeepSeek (cheaper, fast enough for simpler tasks).
  const needsStrongModel = passType === 'action_items' || passType === 'response_draft';
  const defaultModel = needsStrongModel ? 'sonnet' : 'deepseek';
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
