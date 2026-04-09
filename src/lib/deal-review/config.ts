/**
 * AE Deal Review configuration.
 * Maps AE-friendly likelihood labels to internal forecast tiers.
 */

import type { LikelihoodTier } from '@/lib/command-center/types';

export interface AELikelihoodOption {
  value: string;
  label: string;
  description: string;
  internalTier: LikelihoodTier | 'not_this_quarter';
}

export const AE_LIKELIHOOD_OPTIONS: AELikelihoodOption[] = [
  {
    value: 'commit',
    label: 'Commit',
    description: "I'm confident this closes in Q2",
    internalTier: 'highly_likely',
  },
  {
    value: 'strong',
    label: 'Strong',
    description: 'Very likely, minor risks remain',
    internalTier: 'likely',
  },
  {
    value: 'possible',
    label: 'Possible',
    description: 'Could go either way',
    internalTier: 'possible',
  },
  {
    value: 'unlikely',
    label: 'Unlikely',
    description: 'Long shot but not dead',
    internalTier: 'unlikely',
  },
  {
    value: 'not_this_quarter',
    label: 'Not This Quarter',
    description: 'Pushing to Q3+ or lost',
    internalTier: 'not_this_quarter',
  },
];

/** Map an AE-facing value to the internal tier stored in deal_forecast_overrides */
export function mapAETierToInternal(aeValue: string): string {
  const opt = AE_LIKELIHOOD_OPTIONS.find((o) => o.value === aeValue);
  return opt?.internalTier ?? 'insufficient_data';
}

/** Map an internal tier back to the AE-facing value */
export function mapInternalToAETier(internalTier: string): string {
  const opt = AE_LIKELIHOOD_OPTIONS.find((o) => o.internalTier === internalTier);
  return opt?.value ?? internalTier;
}

/** Map an internal tier to the AE-facing label */
export function getAELabelForTier(internalTier: string): string {
  const opt = AE_LIKELIHOOD_OPTIONS.find((o) => o.internalTier === internalTier);
  return opt?.label ?? internalTier;
}
