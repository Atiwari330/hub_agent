/**
 * Rolling forecast computation.
 * Pure function — no database, no LLM. Takes deals + overrides, returns forecast.
 */

import { LIKELIHOOD_WEIGHTS } from './config';
import type { DealForecastItem, ForecastSummary, LikelihoodTier } from './types';

export function computeRollingForecast(
  deals: DealForecastItem[],
  closedWonARR: number,
  target: number,
): ForecastSummary {
  const tiers: ForecastSummary['tiers'] = {
    highly_likely: { count: 0, rawARR: 0, weightedARR: 0 },
    likely: { count: 0, rawARR: 0, weightedARR: 0 },
    possible: { count: 0, rawARR: 0, weightedARR: 0 },
    unlikely: { count: 0, rawARR: 0, weightedARR: 0 },
    insufficient_data: { count: 0, rawARR: 0, weightedARR: 0 },
  };

  for (const deal of deals) {
    const effectiveTier = (deal.override?.likelihood as LikelihoodTier) || deal.likelihoodTier;
    const effectiveAmount = deal.override?.amount ?? deal.amount;
    const weight = LIKELIHOOD_WEIGHTS[effectiveTier] ?? LIKELIHOOD_WEIGHTS.insufficient_data;

    const tier = tiers[effectiveTier] || tiers.insufficient_data;
    tier.count++;
    tier.rawARR += effectiveAmount;
    tier.weightedARR += effectiveAmount * weight;
  }

  const totalWeighted = Object.values(tiers).reduce((sum, t) => sum + t.weightedARR, 0);
  const projectedTotal = closedWonARR + totalWeighted;
  const gap = Math.max(0, target - projectedTotal);

  const highConfidenceARR = tiers.highly_likely.weightedARR + tiers.likely.weightedARR;
  const confidenceRatio = totalWeighted > 0 ? highConfidenceARR / totalWeighted : 0;
  let confidenceLevel: 'high' | 'medium' | 'low' = 'medium';
  if (confidenceRatio >= 0.6 && projectedTotal >= target * 0.9) confidenceLevel = 'high';
  else if (confidenceRatio < 0.3 || projectedTotal < target * 0.7) confidenceLevel = 'low';

  return {
    totalWeighted: Math.round(totalWeighted),
    target,
    gap: Math.round(gap),
    tiers,
    closedWonARR,
    projectedTotal: Math.round(projectedTotal),
    confidenceLevel,
  };
}
