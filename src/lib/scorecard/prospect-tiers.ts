/**
 * Prospect SPIFF Tier Thresholds
 *
 * Monthly prospect (contact creation) goals for AEs.
 * These are initial defaults - adjust after reviewing actual AE performance.
 */

export const PROSPECT_TIERS = {
  BASELINE: 30,
  TIER_1: 50,
  TIER_2: 75,
  TIER_3: 100,
} as const;

/**
 * Determine the prospect tier label based on count
 */
export function getProspectTier(count: number): string {
  if (count >= PROSPECT_TIERS.TIER_3) return 'Tier 3';
  if (count >= PROSPECT_TIERS.TIER_2) return 'Tier 2';
  if (count >= PROSPECT_TIERS.TIER_1) return 'Tier 1';
  if (count >= PROSPECT_TIERS.BASELINE) return 'Baseline';
  return 'Below';
}
