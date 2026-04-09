/**
 * Verification script for Command Center Phase 3 (Forecast Engine).
 * Run: npx tsx src/scripts/verify-command-center-forecast.ts
 */

import { computeRollingForecast } from '@/lib/command-center/compute-forecast';
import { LIKELIHOOD_WEIGHTS } from '@/lib/command-center/config';
import type { DealForecastItem } from '@/lib/command-center/types';

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

console.log('\n=== Forecast Engine Verification ===\n');

// 1. Basic forecast computation
const mockDeals: Partial<DealForecastItem>[] = [
  { hubspotDealId: '1', amount: 100000, likelihoodTier: 'highly_likely', override: null },
  { hubspotDealId: '2', amount: 50000, likelihoodTier: 'likely', override: null },
  { hubspotDealId: '3', amount: 75000, likelihoodTier: 'possible', override: null },
  { hubspotDealId: '4', amount: 30000, likelihoodTier: 'unlikely', override: null },
  { hubspotDealId: '5', amount: 40000, likelihoodTier: 'insufficient_data', override: null },
];

const forecast = computeRollingForecast(mockDeals as DealForecastItem[], 50000, 925000);

console.log('1. computeRollingForecast() with mock data');
check('Returns ForecastSummary', !!forecast);
check('Has all tiers', Object.keys(forecast.tiers).length === 5);
check('Closed won ARR correct', forecast.closedWonARR === 50000);
check('Target correct', forecast.target === 925000);

const expectedWeighted =
  100000 * LIKELIHOOD_WEIGHTS.highly_likely +
  50000 * LIKELIHOOD_WEIGHTS.likely +
  75000 * LIKELIHOOD_WEIGHTS.possible +
  30000 * LIKELIHOOD_WEIGHTS.unlikely +
  40000 * LIKELIHOOD_WEIGHTS.insufficient_data;

check('Weighted ARR correct', forecast.totalWeighted === Math.round(expectedWeighted),
  `Expected ${Math.round(expectedWeighted)}, got ${forecast.totalWeighted}`);
check('Projected total = closedWon + weighted', forecast.projectedTotal === 50000 + Math.round(expectedWeighted));
check('Gap = max(0, target - projected)', forecast.gap === Math.max(0, 925000 - forecast.projectedTotal));
check('Tier counts correct', forecast.tiers.highly_likely.count === 1 && forecast.tiers.likely.count === 1);

// 2. Override handling
console.log('\n2. Override handling');
const dealsWithOverride: Partial<DealForecastItem>[] = [
  {
    hubspotDealId: '1',
    amount: 100000,
    likelihoodTier: 'unlikely',
    override: { likelihood: 'highly_likely', amount: 120000, reason: 'CEO confirmed', overriddenBy: 'adi', overriddenAt: '' },
  },
];

const forecastOverride = computeRollingForecast(dealsWithOverride as DealForecastItem[], 0, 925000);
check('Override likelihood used', forecastOverride.tiers.highly_likely.count === 1);
check('Override amount used', forecastOverride.tiers.highly_likely.rawARR === 120000);
check('Original tier empty', forecastOverride.tiers.unlikely.count === 0);
check('Weighted uses override amount', forecastOverride.tiers.highly_likely.weightedARR === 120000 * LIKELIHOOD_WEIGHTS.highly_likely);

// 3. Edge cases
console.log('\n3. Edge cases');
const emptyForecast = computeRollingForecast([], 0, 925000);
check('Empty deals returns zero weighted', emptyForecast.totalWeighted === 0);
check('Empty deals gap = target', emptyForecast.gap === 925000);
check('Empty deals confidence = low', emptyForecast.confidenceLevel === 'low');

const highForecast = computeRollingForecast(
  [{ hubspotDealId: '1', amount: 1000000, likelihoodTier: 'highly_likely', override: null }] as DealForecastItem[],
  0, 925000,
);
check('High confidence when highly_likely dominates', highForecast.confidenceLevel === 'high');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
