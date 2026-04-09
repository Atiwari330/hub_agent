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

// Map deal intelligence scores + LLM assessment to a likelihood tier
// This is the bridge between the existing deal-rules.ts scoring and the forecast
export function computeLikelihoodTier(
  overallScore: number,
  llmStatus: string | null,
  buyerSentiment: string | null,
): string {
  // LLM status takes priority when available
  if (llmStatus === 'on_track' && overallScore >= 70) return 'highly_likely';
  if (llmStatus === 'on_track') return 'likely';
  if (llmStatus === 'needs_action' && overallScore >= 55) return 'possible';
  if (llmStatus === 'at_risk') return 'unlikely';
  if (llmStatus === 'stalled') return 'unlikely';
  if (llmStatus === 'nurture') return 'unlikely';

  // Fall back to score-only when no LLM assessment
  if (overallScore >= 80) return 'likely';
  if (overallScore >= 60) return 'possible';
  if (overallScore >= 40) return 'unlikely';
  return 'insufficient_data';
}

// Team Q2 target (kept in sync with q2-goal-tracker/compute.ts AE_TARGETS)
export const Q2_TEAM_TARGET = 925000;
