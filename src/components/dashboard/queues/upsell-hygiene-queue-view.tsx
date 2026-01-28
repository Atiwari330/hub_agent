'use client';

import { BaseHygieneQueueView } from './base-hygiene-queue-view';

// Upsell pipeline missing field colors
const UPSELL_MISSING_FIELD_COLORS: Record<string, string> = {
  'Amount': 'bg-red-100 text-red-700',
  'Close Date': 'bg-pink-100 text-pink-700',
  'Products': 'bg-purple-100 text-purple-700',
};

export function UpsellHygieneQueueView() {
  return (
    <BaseHygieneQueueView
      title="Upsell Deal Hygiene Queue"
      subtitle="Upsell deals missing required fields. Create HubSpot tasks to notify owners."
      apiEndpoint="/api/queues/upsell-hygiene"
      missingFieldColors={UPSELL_MISSING_FIELD_COLORS}
    />
  );
}
