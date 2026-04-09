/**
 * Command Center configuration.
 *
 * AE targets and team total are imported from q2-goal-tracker/compute.ts
 * where they're already maintained. This file adds command-center-specific config.
 */

// Likelihood tier weights for forecast calculation
// These determine how much each deal contributes to the weighted forecast
export const LIKELIHOOD_WEIGHTS: Record<string, number> = {
  highly_likely: 0.85,
  likely: 0.65,
  possible: 0.40,
  unlikely: 0.15,
  insufficient_data: 0.30,
};

// Map LLM assessment to a likelihood tier (LLM-only, no rules fallback)
export function computeLikelihoodTier(
  overallScore: number,
  llmStatus: string | null,
  buyerSentiment: string | null,
): string {
  if (llmStatus === 'on_track' && overallScore >= 70) return 'highly_likely';
  if (llmStatus === 'on_track' || llmStatus === 'no_action_needed') return 'likely';
  if (llmStatus === 'needs_action' && overallScore >= 55) return 'possible';
  if (llmStatus === 'needs_action') return 'unlikely';
  if (llmStatus === 'at_risk') return 'unlikely';
  if (llmStatus === 'stalled') return 'unlikely';
  if (llmStatus === 'nurture') return 'unlikely';

  // LLM said uncertain or no LLM data at all
  return 'insufficient_data';
}

// Team Q2 target (kept in sync with q2-goal-tracker/compute.ts AE_TARGETS)
export const Q2_TEAM_TARGET = 925000;
