'use client';

import { BaseHygieneQueueView } from './base-hygiene-queue-view';

// Sales pipeline missing field colors
const SALES_MISSING_FIELD_COLORS: Record<string, string> = {
  'Lead Source': 'bg-orange-100 text-orange-700',
  'Products': 'bg-purple-100 text-purple-700',
  'Amount': 'bg-red-100 text-red-700',
  'Close Date': 'bg-pink-100 text-pink-700',
  'Substage': 'bg-slate-100 text-slate-700',
};

export function HygieneQueueView() {
  return (
    <BaseHygieneQueueView
      title="Deal Hygiene Queue"
      subtitle="Deals missing required fields. Create HubSpot tasks to notify AEs."
      apiEndpoint="/api/queues/hygiene"
      missingFieldColors={SALES_MISSING_FIELD_COLORS}
    />
  );
}
