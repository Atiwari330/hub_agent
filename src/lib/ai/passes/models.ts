import { getDeepSeekModel, getModel } from '@/lib/ai/provider';
import type { PassType } from './types';

// Model selection per pass type.
// Default: DeepSeek V3.2 for every pass. Codebase-wide policy is to avoid
// Anthropic token spend unless a specific feature opts in explicitly.
//
// Per-pass env vars below accept 'deepseek' (default) or any value, which
// falls through to getModel() — so AI_PROVIDER=anthropic AI_MODEL=claude-...
// still works as a global debug override. There's no named Anthropic branch
// here; reintroducing one should be an intentional code change.
//
// Env vars:
//   PASS_MODEL_DEFAULT=deepseek         # (default) DeepSeek for all passes
//   PASS_MODEL_ACTION_ITEMS=other       # fall through to getModel() for that pass

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

export function getModelForPass(passType: PassType) {
  const envKey = PASS_MODEL_ENV_MAP[passType];
  const perPassOverride = envKey ? process.env[envKey] : undefined;

  const defaultModel = 'deepseek';
  const modelChoice = perPassOverride || process.env.PASS_MODEL_DEFAULT || defaultModel;

  if (modelChoice === 'deepseek') {
    return getDeepSeekModel();
  }
  // Any other value routes through the generic getModel() which honors
  // AI_PROVIDER / AI_MODEL env vars for debug overrides.
  return getModel();
}

export { PASS_MODEL_ENV_MAP };
